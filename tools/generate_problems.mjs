#!/usr/bin/env node
/**
 * Turn course notebooks into practice exercises.
 *
 * For every exercise it finds in a notebook, it runs the notebook's solution in
 * real Python (Pyodide) with the notebook's earlier code as setup, captures what
 * the cell displays, and writes a problem with a verified expected output.
 * Exercises whose data files are missing from the repository are reported and
 * skipped rather than turned into broken exercises.
 *
 *   npm install --no-save pyodide        # dev-only dependency
 *   node tools/generate_problems.mjs                     # write problems/auto-*.json
 *   node tools/generate_problems.mjs --dry-run           # report only
 *   node tools/generate_problems.mjs --predict-variants  # also add "predict the output"
 *   node tools/generate_problems.mjs --only "Intro to Python" --force
 *
 * The same analysis also runs in the browser, on the upload page — this script
 * exists so the exercises can be generated once and committed to the repository.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_BY_MODULE,
  UNAVAILABLE_MODULES,
  analyzeNotebook,
  buildDraftProblem,
  extractExerciseUnits,
  packageHints,
} from "../assets/js/analyze.js";
import { HARNESS_SOURCE } from "../assets/js/harness.js";
import { gradeRun, gradeText } from "../assets/js/grade.js";
import { normalizeOutput, slugify } from "../assets/js/util.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------- args --- */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const OPTIONS = {
  dryRun: flag("dry-run"),
  predictVariants: flag("predict-variants"),
  force: flag("force"),
  only: value("only", ""),
  outDir: value("out", "problems"),
  includeUnchecked: flag("include-unchecked"),
};

/* -------------------------------------------------------------- pyodide ---- */

let loadPyodide;
let indexURL;
try {
  const resolved = import.meta.resolve("pyodide");
  indexURL = path.dirname(fileURLToPath(resolved));
  ({ loadPyodide } = await import(resolved));
} catch {
  console.error("Pyodide is required:  npm install --no-save pyodide");
  process.exit(2);
}

const pyodide = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
await pyodide.runPythonAsync(HARNESS_SOURCE);

/** Same call shape as assets/js/runner.js. Never throws. */
async function run(spec) {
  try {
    pyodide.globals.set("__fb_spec", JSON.stringify({ tests: "", setup: "", stdin: "", lineLimit: 2000000, ...spec }));
    const raw = await pyodide.runPythonAsync("__fb_exec(__fb_spec)");
    return JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      steps: 0,
      error: {
        type: "ToolchainError",
        message: String((error && error.message) || error).slice(0, 300),
        where: "runtime",
        line: null,
        source: "",
        traceback: "",
      },
    };
  }
}

const loadedPackages = new Set();
const failedPackages = new Set();

/** Load Pyodide packages, remembering failures so one bad name cannot stop the run. */
async function ensurePackages(packages) {
  const todo = [...new Set(packages)].filter((name) => name && !loadedPackages.has(name) && !failedPackages.has(name));
  if (!todo.length) return true;
  process.stdout.write(`    loading ${todo.join(", ")} …\n`);
  try {
    await pyodide.loadPackage(todo);
    todo.forEach((name) => loadedPackages.add(name));
    return true;
  } catch (error) {
    todo.forEach((name) => failedPackages.add(name));
    process.stdout.write(`    ! could not load ${todo.join(", ")}: ${String((error && error.message) || error).slice(0, 120)}\n`);
    return false;
  }
}

/* ------------------------------------------------------------- discovery --- */

const SKIP_DIRS = new Set(["node_modules", "tests", "tools", "assets", ".github", "__pycache__", "venv", ".venv"]);
const DATA_FILE_RE = /\.(csv|tsv|txt|json|xlsx|xls|parquet)$/i;
const BINARY_RE = /\.(xlsx|xls|parquet)$/i;

async function walkRepo(onFile) {
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else await onFile(path.relative(root, full), entry.name);
    }
  }
  await walk(root);
}

async function findNotebooks() {
  const found = [];
  await walkRepo((relative) => {
    if (relative.endsWith(".ipynb")) found.push(relative);
  });
  return found.sort();
}

/** basename (lowercase) -> repository path, so a notebook's data file is found. */
async function indexDataFiles() {
  const map = new Map();
  await walkRepo((relative, name) => {
    if (DATA_FILE_RE.test(name)) map.set(name.toLowerCase(), relative);
  });
  return map;
}

/**
 * Modules the notebooks import but Pyodide does not ship: a class helper such as
 * `analyticskit.py` that lives in the repository. Indexed by the name code says
 * in `import analyticskit`, so the file can be copied into the sandbox.
 */
async function indexModules() {
  const map = new Map();
  await walkRepo((relative, name) => {
    if (!name.endsWith(".py")) return;
    const moduleName = name.slice(0, -3);
    if (!map.has(moduleName)) map.set(moduleName, relative);
  });
  return map;
}

/** Read a repository file into the shape the harness expects. */
async function readDataFile(relative) {
  if (BINARY_RE.test(relative)) {
    const bytes = await readFile(path.join(root, relative));
    return { base64: bytes.toString("base64") };
  }
  return readFile(path.join(root, relative), "utf8");
}

function missingDataFile(error, source) {
  if (!error) return null;
  const match = /FileNotFoundError[^\n]*'([^']+)'/.exec(error.message || "") || /No such file or directory: '([^']+)'/.exec(error.traceback || "");
  if (match) return match[1];
  const referenced = /['"]([\w./-]+\.(?:csv|json|txt|xlsx|xls|tsv|parquet))['"]/.exec(source || "");
  if (referenced && /(FileNotFound|does not exist|No such file|OSError)/.test(`${error.message} ${error.traceback || ""}`)) {
    return referenced[1];
  }
  return null;
}

/* ------------------------------------------------------------------ main --- */

const notebooks = (await findNotebooks()).filter((file) => !OPTIONS.only || file.includes(OPTIONS.only));
if (!notebooks.length) {
  console.error(`No notebooks matched${OPTIONS.only ? ` --only ${OPTIONS.only}` : ""}.`);
  process.exit(1);
}

const glossary = JSON.parse(await readFile(path.join(root, "data/glossary.json"), "utf8"));
const dataFileIndex = await indexDataFiles();
const moduleIndex = await indexModules();
const existing = new Set();
for (const file of await readdir(path.join(root, "problems"))) {
  if (!file.endsWith(".json") || file === "index.json") continue;
  const data = JSON.parse(await readFile(path.join(root, "problems", file), "utf8"));
  for (const problem of data.problems || data) existing.add(problem.id);
}

const report = [];
const written = [];
const usedIds = new Set();

for (const notebookPath of notebooks) {
  const json = JSON.parse(await readFile(path.join(root, notebookPath), "utf8"));
  const entry = analyzeNotebook(json, notebookPath);
  const units = extractExerciseUnits(json).filter((unit) => unit.code);
  const problems = [];
  const skipped = [];

  process.stdout.write(`\n${entry.title}  (${units.length} tasks)\n`);

  for (const unit of units) {
    const setup = unit.setupCells.join("\n\n").trim();
    const packages = [...new Set([...packageHints(unit.code), ...packageHints(setup)])];
    await ensurePackages(packages);

    const attempt = (files) => run({ code: unit.code, setup, packages, captureLast: true, files });
    let result = await attempt(null);
    const extraPackages = [];

    // A library the notebook imports may simply not be loaded yet.
    let moduleFiles = null;
    let moduleDataFiles = null;
    const missingModule = /No module named '([^']+)'/.exec(`${(result.error && result.error.message) || ""}`);
    if (missingModule) {
      const moduleName = missingModule[1].split(".")[0];
      const pkg = PACKAGE_BY_MODULE[moduleName];
      if (pkg && !loadedPackages.has(pkg) && (await ensurePackages([pkg]))) {
        extraPackages.push(pkg);
        result = await attempt(null);
      } else if (moduleIndex.has(moduleName)) {
        // The class's own module, committed to the repository: copy it into the
        // sandbox exactly as the upload page does, so `import analyticskit` works.
        const relative = moduleIndex.get(moduleName);
        moduleFiles = { [`${moduleName}.py`]: await readFile(path.join(root, relative), "utf8") };
        moduleDataFiles = { [`${moduleName}.py`]: relative };
        const retry = await attempt(moduleFiles);
        if (retry.ok || (retry.error && !/No module named/.test(retry.error.message || ""))) {
          result = retry;
          process.stdout.write(`  module ${unit.title.slice(0, 48)}  (using ${relative})\n`);
        } else {
          skipped.push({ unit, reason: `${relative} was copied in but the task still fails: ${retry.error.type}` });
          process.stdout.write(`  fail  ${unit.title.slice(0, 56)}  (${retry.error.type})\n`);
          continue;
        }
      } else if (UNAVAILABLE_MODULES[moduleName]) {
        skipped.push({ unit, reason: `needs ${moduleName} (${UNAVAILABLE_MODULES[moduleName]}), which Pyodide does not ship` });
        process.stdout.write(`  skip  ${unit.title.slice(0, 56)}  (no ${moduleName} in the sandbox)\n`);
        continue;
      } else if (!OPTIONS.includeUnchecked) {
        skipped.push({ unit, reason: `needs the module ${moduleName} — add ${moduleName}.py to the repository and re-run` });
        process.stdout.write(`  skip  ${unit.title.slice(0, 56)}  (missing module ${moduleName})\n`);
        continue;
      }
    }

    // A data file the notebook reads is used when it is committed to the repo.
    let dataFiles = moduleDataFiles ? { ...moduleDataFiles } : null;
    if (!result.ok) {
      const missing = missingDataFile(result.error, `${setup}\n${unit.code}`);
      if (missing) {
        const repoPath = dataFileIndex.get(missing.toLowerCase());
        if (!repoPath) {
          skipped.push({ unit, reason: `needs the data file ${missing} — add it to materials/ and re-run` });
          process.stdout.write(`  skip  ${unit.title.slice(0, 56)}  (missing ${missing})\n`);
          continue;
        }
        const files = { ...(moduleFiles || {}), [missing]: await readDataFile(repoPath) };
        const retry = await attempt(files);
        if (retry.ok) {
          result = retry;
          dataFiles = { ...(moduleDataFiles || {}), [missing]: repoPath };
          process.stdout.write(`  data  ${unit.title.slice(0, 56)}  (using ${repoPath})\n`);
        } else {
          const stillMissing = missingDataFile(retry.error, unit.code);
          skipped.push({
            unit,
            reason: `${missing} is at ${repoPath} but the task still fails: ${retry.error.type}${stillMissing ? ` (then needs ${stillMissing})` : ""}`,
          });
          process.stdout.write(`  fail  ${unit.title.slice(0, 56)}  (${retry.error.type})\n`);
          continue;
        }
      } else if (!OPTIONS.includeUnchecked) {
        skipped.push({ unit, reason: `${result.error.type}: ${result.error.message}`.slice(0, 140) });
        process.stdout.write(`  fail  ${unit.title.slice(0, 56)}  (${result.error.type})\n`);
        continue;
      }
    }

    const drafts = buildDraftProblem({ ...unit }, result, {
      notebookPath,
      notebookTitle: entry.title,
      topics: [entry.group, ...(entry.matched_topics || [])].slice(0, 3),
      glossaryEntries: glossary.entries,
      exerciseNumber: unit.itemNumber || problems.length + 1,
      idPrefix: "auto",
      withPredictVariant: OPTIONS.predictVariants,
      setupUsable: Boolean(setup),
      dataFiles,
      extraPackages,
    });

    for (const draft of drafts) {
      if (!OPTIONS.includeUnchecked && !draft.expected_output) continue;
      let id = draft.id;
      let counter = 2;
      while (usedIds.has(id) || existing.has(id)) id = `${draft.id}-${counter++}`;
      usedIds.add(id);
      draft.id = id;
      // A generated problem must pass its own checks.
      if (draft.expected_output) {
        const check =
          draft.type === "predict_output"
            ? gradeText(draft, draft.expected_output)
            : gradeRun(draft, { stdout: draft.expected_output, stderr: "", error: null });
        draft.generated.selfCheck = check.ok ? "passed" : "failed";
        if (!check.ok) {
          draft.generated.note = `Self-check failed: ${JSON.stringify(check.checks.filter((c) => !c.ok).map((c) => c.name))}`;
          process.stdout.write(`  warn  ${draft.id} does not pass its own check\n`);
        }
      }
      problems.push(draft);
    }
    const first = drafts[0];
    process.stdout.write(
      `  ${first.expected_output ? "ok   " : "draft"} ${unit.title.slice(0, 60)}` +
        `${first.expected_output ? `  (${normalizeOutput(first.expected_output).split("\n").length} output lines)` : "  (no output to check)"}\n`,
    );
  }

  const autoChecked = problems.filter((problem) => problem.expected_output).length;
  report.push({
    notebook: notebookPath,
    title: entry.title,
    tasks: units.length,
    problems: problems.length,
    autoChecked,
    skipped: skipped.length,
    skippedReasons: skipped.map((item) => `${item.unit.title} → ${item.reason}`),
  });

  if (problems.length && !OPTIONS.dryRun) {
    // --out may be a repository-relative folder or an absolute one.
    const outDir = path.isAbsolute(OPTIONS.outDir) ? OPTIONS.outDir : path.join(root, OPTIONS.outDir);
    const outPath = path.join(outDir, `auto-${slugify(entry.title).slice(0, 48)}.json`);
    const payload = {
      _generated: {
        by: "tools/generate_problems.mjs",
        from: notebookPath,
        notebook: entry.title,
        tasks: units.length,
        auto_checked: autoChecked,
        note: "Generated from the class notebooks. Regenerate with `node tools/generate_problems.mjs --predict-variants`; edit by hand only if you stop regenerating.",
      },
      problems,
    };
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    written.push({ path: path.relative(root, outPath) || outPath, count: problems.length });
  }
}

/* ---------------------------------------------------------------- summary --- */

process.stdout.write("\n=== summary ===\n");
let totalProblems = 0;
let totalChecked = 0;
let totalSkipped = 0;
for (const row of report) {
  totalProblems += row.problems;
  totalChecked += row.autoChecked;
  totalSkipped += row.skipped;
  process.stdout.write(
    `${row.title.slice(0, 52).padEnd(54)} tasks=${String(row.tasks).padStart(2)} ` +
      `problems=${String(row.problems).padStart(2)} auto-checked=${String(row.autoChecked).padStart(2)} skipped=${String(row.skipped).padStart(2)}\n`,
  );
}
process.stdout.write(`\n${totalProblems} problems (${totalChecked} with a verified expected output, ${totalProblems - totalChecked} needing review), ${totalSkipped} tasks skipped for missing data files\n`);

for (const row of report) {
  for (const reason of row.skippedReasons) process.stdout.write(`  skipped: ${row.title.slice(0, 40)} — ${reason}\n`);
}

if (OPTIONS.dryRun) {
  process.stdout.write("\n--dry-run: nothing written\n");
} else {
  for (const file of written) process.stdout.write(`wrote ${file.path} (${file.count})\n`);
  process.stdout.write("\nNext: python3 tools/build_index.py\n");
}
