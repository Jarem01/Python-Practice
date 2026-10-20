/**
 * Analyze course material — in the browser (upload page) and in Node (the
 * generator in tools/generate_problems.mjs).
 *
 * This module mirrors the rules in tools/build_index.py, and tests/analyze.test.mjs
 * checks that both produce the same titles, exercise lists and groups for the
 * notebooks in this repository. Keep the two implementations in sync.
 *
 * Pure module: no DOM, no fetch, no Pyodide.
 */

import { plainText, slugify } from "./util.js";

export const MATERIALS_DIR = "materials";

/** Words that mark a heading as an exercise. Matches EXERCISE_WORDS in Python. */
export const EXERCISE_WORDS =
  /\b(exercise|exercises|task|tasks|assignment|practice|challenge|question|problem|aufgabe|übung|opgave|oppgave|ödev|练习|习题|練習|問題|課題|연습)\b/i;

const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/gm;
const PY_PART_RE =
  /(?:part|del|chapter|chap|lesson|week|module|lektion|kapitel|kapittel|del|tema|主题|章|課|课|第)[\s\-_]*(\d{1,2})/i;

export const GENERIC_FOLDERS = new Set([
  "notebooks", "notebook", "jupyter", "src", "python", "scripts", "code",
  "exercises", "lessons", "labs", "course", "class",
]);

/* ------------------------------------------------------------------ cells --- */

export function cellSource(cell) {
  const source = cell && cell.source != null ? cell.source : "";
  return Array.isArray(source) ? source.join("") : String(source);
}

/** Human-readable output blocks of a code cell — same notion as the Python side. */
export function textOutputs(cell) {
  const blocks = [];
  for (const output of (cell && cell.outputs) || []) {
    const kind = output.output_type;
    if (kind === "stream") {
      blocks.push(Array.isArray(output.text) ? output.text.join("") : String(output.text ?? ""));
    } else if (kind === "execute_result" || kind === "display_data") {
      const data = output.data || {};
      if (data["text/plain"]) {
        blocks.push(Array.isArray(data["text/plain"]) ? data["text/plain"].join("") : String(data["text/plain"]));
      } else if (data["image/png"]) {
        blocks.push("[image output]");
      }
    } else if (kind === "error") {
      blocks.push((output.traceback || []).join("\n"));
    }
  }
  return blocks.filter((block) => block && block.trim());
}

/** \"Exercise 3\" is an exercise; a long headline like \"... - EXERCISE SOLUTIONS\" is not. */
export function looksLikeExercise(heading, cell, title = "") {
  const tags = ((cell && cell.metadata && cell.metadata.tags) || []).map((tag) => String(tag).toLowerCase());
  if (tags.some((tag) => tag.includes("exercise") || tag.includes("task"))) return true;
  const text = String(heading).trim();
  if (title && text === title) return false;
  if (!EXERCISE_WORDS.test(text)) return false;
  return /\d/.test(text) || text.length <= 30;
}

export function groupForPath(path) {
  const parts = String(path).replace(/\\/g, "/").split("/");
  if (parts[0] === MATERIALS_DIR) {
    return parts.length > 2 ? { group: parts[1], order: 100 } : { group: "Course material", order: 100 };
  }
  for (const folder of parts.slice(0, -1)) {
    const match = PY_PART_RE.exec(folder);
    if (match) return { group: `Part ${Number(match[1])}`, order: Number(match[1]) };
  }
  const stem = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  const match = PY_PART_RE.exec(stem);
  if (match) {
    const number = Number(match[1]);
    const prefix = stem.slice(0, match.index).replace(/[\s\-_–—(.·|:]+$/, "").replace(/\s+/g, " ").trim();
    return prefix ? { group: prefix, order: number } : { group: `Part ${number}`, order: number };
  }
  if (parts.length > 1 && !GENERIC_FOLDERS.has(parts[0].toLowerCase())) {
    return { group: parts[0], order: 100 };
  }
  return { group: "Notebooks", order: 999 };
}

/* -------------------------------------------------------------- notebooks --- */

export function analyzeNotebook(json, path) {
  const cells = (json && json.cells) || [];
  const markdownCells = cells.filter((cell) => cell.cell_type === "markdown");
  const codeCells = cells.filter((cell) => cell.cell_type === "code");

  let title = "";
  for (const cell of markdownCells) {
    const match = /^(#{1,6})\s+(.*?)\s*$/m.exec(cellSource(cell));
    if (match && match[1] === "#") {
      title = plainText(match[2]);
      break;
    }
  }

  const exercises = [];
  cells.forEach((cell, index) => {
    if (cell.cell_type !== "markdown") return;
    const source = cellSource(cell);
    for (const match of source.matchAll(/^(#{1,6})[ \t]+(.*?)[ \t]*$/gm)) {
      const heading = plainText(match[2]);
      if (looksLikeExercise(heading, cell, title)) {
        exercises.push({ index, title: heading, anchor: slugify(heading) });
      }
    }
  });

  const metadata = (json && json.metadata) || {};
  const kernel =
    ((metadata.kernelspec || {}).display_name) ||
    ((metadata.language_info || {}).name) ||
    "";
  const { group, order } = groupForPath(path);
  const summary = markdownCells.length ? firstParagraph(cellSource(markdownCells[0])) : "";

  return {
    id: slugify(path.replace(/\.[^.]+$/, "")),
    path: String(path).replace(/\\/g, "/"),
    filename: String(path).replace(/\\/g, "/").split("/").pop(),
    kind: String(path).startsWith(`${MATERIALS_DIR}/`) ? "material" : "notebook",
    title: title || basenameTitle(path),
    group,
    group_order: order,
    kernel,
    summary,
    cell_count: cells.length,
    code_cell_count: codeCells.length,
    markdown_cell_count: markdownCells.length,
    output_cell_count: codeCells.filter((cell) => textOutputs(cell).length).length,
    exercises,
    inferred_topics: [],
    matched_topics: [],
  };
}

export function analyzePython(text, path) {
  const source = String(text ?? "");
  const lines = source.split(/\r\n?|\n/);
  const doc = /^\s*("""|''')([\s\S]*?)\1/.exec(source);
  let title = "";
  let summary = "";
  if (doc) {
    const block = doc[2].split("\n").map((line) => line.trim()).filter(Boolean);
    if (block.length) {
      title = block[0].slice(0, 120);
      summary = block.slice(1, 4).join(" ").slice(0, 220);
    }
  }
  if (!title) {
    for (const line of lines.slice(0, 12)) {
      const comment = /^\s*#\s*(.+)/.exec(line);
      if (comment) {
        title = comment[1].trim().slice(0, 120);
        break;
      }
    }
  }

  const definitions = [];
  lines.forEach((line, index) => {
    const match = /^\s*(?:async\s+)?(def|class)\s+(\w+)/.exec(line);
    if (match) definitions.push({ kind: match[1], name: match[2], line: index + 1 });
  });

  const exercises = [];
  lines.forEach((line, index) => {
    const match = /^\s*#\s*-*\s*(exercise|task|practice|challenge|question)\s*(\d+)?/i.exec(line);
    if (match) {
      const label = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2] || ""}`.trim();
      exercises.push({ index, title: label, anchor: slugify(label) });
    }
  });

  const { group, order } = groupForPath(path);
  return {
    id: slugify(String(path).replace(/\.[^.]+$/, "")),
    path: String(path).replace(/\\/g, "/"),
    filename: String(path).replace(/\\/g, "/").split("/").pop(),
    kind: "script",
    title: title || basenameTitle(path),
    group,
    group_order: order,
    summary,
    line_count: lines.length,
    code_lines: lines.filter((line) => line.trim() && !line.trim().startsWith("#")).length,
    definitions,
    exercises,
    inferred_topics: [],
    matched_topics: [],
  };
}

export function analyzeFile({ name, text, path }) {
  const target = path || `${MATERIALS_DIR}/${name}`;
  const lower = target.toLowerCase();
  if (lower.endsWith(".ipynb") || lower.endsWith(".json")) {
    const json = JSON.parse(text);
    if (!Array.isArray(json.cells)) throw new Error("This JSON file is not a Jupyter notebook (no cells array).");
    return { kind: "notebook", entry: analyzeNotebook(json, target), json };
  }
  if (lower.endsWith(".py") || lower.endsWith(".pyw")) {
    return { kind: "script", entry: analyzePython(text, target), json: null };
  }
  return {
    kind: "text",
    entry: {
      id: slugify(target.replace(/\.[^.]+$/, "")),
      path: String(target).replace(/\\/g, "/"),
      filename: name,
      kind: "material",
      title: basenameTitle(target),
      group: groupForPath(target).group,
      group_order: groupForPath(target).order,
      summary: firstParagraph(text) || `${text.split(/\r\n?|\n/).length} lines of supporting material.`,
      cell_count: 0,
      code_cell_count: 0,
      markdown_cell_count: 0,
      output_cell_count: 0,
      exercises: [],
      inferred_topics: [],
      matched_topics: [],
      bytes: text.length,
    },
    json: null,
  };
}

/* ---------------------------------------------------------- exercise units --- */

/**
 * Pair each exercise heading with the prose and code that belong to it, and
 * with the code that ran before it (the notebook's sequential state).
 */
/** Strip markdown/HTML noise and shorten a long question into a title. */
export function cleanTitle(text, limit = 90) {
  // plainText turns the notebooks' `8<sup>3</sup>` into `8^3`, so a title never
  // shows markup in a list, a badge or a page heading.
  const cleaned = plainText(String(text || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"));
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1).replace(/[\s,;:.!?]+$/, "")}…`;
}

/**
 * Split a notebook into individual tasks.
 *
 * Course notebooks mix two shapes and both must work:
 *   * "#### Exercise 3" sections that contain the task and its code, and
 *   * sections whose numbered items ("1. Print the ...") each own the code
 *     cell that follows them.
 * Every task therefore becomes one unit with its own prompt, code cells and the
 * code that ran before it (the notebook's sequential state).
 */
export function extractExerciseUnits(json) {
  const cells = (json && json.cells) || [];
  const units = [];
  // Every code cell in document order: a task's setup is everything above its
  // own first code cell, which is what makes a notebook cell runnable at all.
  const allCode = [];
  let current = null;

  const startUnit = (unit) => {
    if (current) units.push(current);
    current = { setupCells: [...allCode], codeCells: [], ...unit };
  };
  const appendText = (text) => {
    if (!current) return;
    current.prompt = current.prompt ? `${current.prompt}\n${text}`.trim() : String(text).trim();
  };

  cells.forEach((cell, index) => {
    const source = cellSource(cell);
    if (cell.cell_type === "code") {
      const code = source.replace(/\s+$/, "");
      if (source.trim()) allCode.push(code);
      if (current) current.codeCells.push(code);
      return;
    }
    if (cell.cell_type !== "markdown") return;

    let fenced = false;
    for (const line of source.split(/\r\n?|\n/)) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        appendText(line);
        continue;
      }
      if (fenced) {
        appendText(line);
        continue;
      }

      const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(line);
      if (heading) {
        const text = plainText(heading[2]);
        if (looksLikeExercise(text, cell)) {
          startUnit({ kind: "section", index, title: text, section: text, anchor: slugify(text), prompt: line.trim() });
        } else {
          appendText(line);
        }
        continue;
      }

      const item = /^(\d{1,2})[.)]\s+(.*)$/.exec(line);
      if (item) {
        const text = cleanTitle(item[2], 200) || `Item ${item[1]}`;
        startUnit({
          kind: "item",
          index,
          itemNumber: Number(item[1]),
          section: current ? current.section || "" : "",
          title: cleanTitle(item[2]) || `Item ${item[1]}`,
          anchor: slugify(text),
          prompt: line.trim(),
        });
        continue;
      }

      appendText(line);
    }
  });

  if (current) units.push(current);

  // A section whose prose read "here is Exercise 3" has no code of its own:
  // fold its text into the task that follows instead of losing it.
  const merged = [];
  units.forEach((unit, position) => {
    const hasCode = unit.codeCells.length > 0;
    if (unit.kind === "section" && !hasCode) {
      const next = units[position + 1];
      if (next) {
        const intro = String(unit.prompt || "").replace(/^#{1,6}\s+/, "").trim();
        if (intro && !next.prompt.includes(intro)) next.prompt = `${intro}\n\n${next.prompt}`.trim();
        return;
      }
    }
    merged.push(unit);
  });

  return merged
    .map((unit) => ({ ...unit, code: unit.codeCells.join("\n\n").trim() }))
    .filter((unit) => unit.title || unit.code);
}

/**
 * Pyodide packaging names for the libraries a course typically imports.
 * Keys are the import names used in code, values are the Pyodide package names.
 */
/**
 * Library used in notebooks -> Pyodide package name. Only packages the Pyodide
 * distribution actually ships are listed; "not available" means the exercise
 * cannot run in the browser sandbox (verified against Pyodide 314.x).
 */
export const PACKAGE_BY_MODULE = {
  numpy: "numpy",
  pandas: "pandas",
  matplotlib: "matplotlib",
  scipy: "scipy",
  sklearn: "scikit-learn",
  statsmodels: "statsmodels",
  sympy: "sympy",
  PIL: "pillow",
};

/** Modules that do not exist in the Pyodide distribution. */
export const UNAVAILABLE_MODULES = {
  openpyxl: "reading .xlsx files",
  seaborn: "seaborn plots",
  xlrd: "legacy .xls files",
};

const PACKAGE_RULES = [
  ["numpy", /\b(?:import|from)\s+numpy\b|\bnp\./],
  ["pandas", /\b(?:import|from)\s+pandas\b|\bpd\.(?:DataFrame|Series|read_)/],
  ["matplotlib", /\b(?:import|from)\s+matplotlib\b|\bplt\./],
  ["scipy", /\b(?:import|from)\s+scipy\b/],
  ["scikit-learn", /\b(?:import|from)\s+sklearn\b|LinearRegression|train_test_split|RandomForest/],
  ["statsmodels", /\b(?:import|from)\s+statsmodels\b|\bsm\.(?:OLS|add_constant)|smf\./],
];

/** Extra files a piece of notebook code reads (csv, xlsx, txt, ...). */
export function dataFileHints(code) {
  const names = new Set();
  const text = String(code || "");
  for (const match of text.matchAll(/['"]([\w./\\-]+\.(?:csv|tsv|txt|json|xlsx|xls|parquet))['"]/gi)) {
    const raw = match[1].replace(/\\/g, "/");
    const base = raw.split("/").pop();
    if (base) names.add(base);
  }
  return [...names];
}

/**
 * Top-level module names a chunk of code imports (`import numpy as np` ->
 * "numpy", `from analyticskit import helper` -> "analyticskit"). Used to decide
 * whether an uploaded .py file is a module the code needs.
 */
export function importedModules(code) {
  const names = new Set();
  for (const match of String(code || "").matchAll(/^\s*(?:import\s+([\w.]+)|from\s+([\w.]+)\s+import)/gm)) {
    const name = String(match[1] || match[2] || "").split(".")[0];
    if (name && name !== "__future__") names.add(name);
  }
  return [...names];
}

/** Which Pyodide packages a chunk of code needs. */
export function packageHints(code) {
  const text = String(code || "");
  return PACKAGE_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

const HINT_RE = /^\s*(?:[-*+]\s+|(?:\d{1,2}[.)])\s+)(.+)$/;

/** Bullet points of the exercise text become the draft's hints. */
export function extractHints(prompt, limit = 6) {
  const hints = [];
  for (const line of String(prompt || "").split(/\r\n?|\n/)) {
    const match = HINT_RE.exec(line);
    if (!match) continue;
    const value = match[1].replace(/\s+/g, " ").trim();
    if (value.length < 8 || value.length > 300) continue;
    if (hints.includes(value)) continue;
    hints.push(value);
    if (hints.length >= limit) break;
  }
  return hints;
}

/** Glossary slugs whose terms appear in the exercise text or code. */
export function matchGlossary(text, glossary, limit = 4) {
  if (!glossary || !glossary.entries) return [];
  const haystack = String(text || "");
  const hits = [];
  for (const entry of glossary.entries) {
    const words = [entry.term, ...(entry.aliases || [])].filter((word) => /^[A-Za-z][A-Za-z0-9 ._-]{2,}$/.test(word));
    if (words.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack))) {
      hits.push(entry.slug || slugify(entry.term));
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/**
 * Turn one exercise unit into a draft problem.
 * @param {{title: string, prompt: string, codeCells: string[], setupCells: string[], index: number}} unit
 * @param {{ok: boolean, stdout: string, error: object|null}|null} run  result of running the unit, or null
 */
export function buildDraftProblem(unit, run, options = {}) {
  const {
    notebookPath = "",
    notebookTitle = "",
    topics = [],
    glossary = [],
    glossaryEntries = null,
    exerciseNumber = 1,
    idPrefix = "auto",
    withPredictVariant = false,
    setupUsable = true,
    dataFiles = null,
    extraPackages = [],
    // { id, solutions: "shown"|"hidden" } — the class the material is for. A
    // hidden class never puts a solution on the draft it generates either.
    course = null,
  } = options;

  const solution = unit.codeCells.join("\n\n").trim();
  const setup = unit.setupCells.join("\n\n").trim();
  const stdout = run && run.stdout ? run.stdout.replace(/\s+$/, "") : "";
  const autoChecked = Boolean(run && run.ok && stdout);
  const packages = [...new Set([...packageHints(solution), ...packageHints(setup), ...extraPackages])];
  const slugBase = slugify(`${notebookTitle || notebookPath} ${unit.title}`);
  const id = `${idPrefix}-${slugBase}`.slice(0, 90);
  const lineCount = solution.split("\n").filter((line) => line.trim()).length;
  // "Introduction to Python (Part 1) - Class Exercise Solutions" -> "Introduction to Python (Part 1)"
  const label = (notebookTitle.match(/^(.*?\(Part \d+\))/) || [])[1] || notebookTitle;

  const problem = {
    id,
    type: "write_from_scratch",
    title: `${unit.title}${label ? ` · ${label}` : ""}`.slice(0, 120),
    topics,
    difficulty: lineCount > 12 ? "hard" : lineCount > 6 ? "medium" : "easy",
    mode: "both",
    line_count: Math.max(2, lineCount),
    prompt: unit.prompt || `Write code that solves **${unit.title}**.`,
    hints: extractHints(unit.prompt),
    solution: `${solution}\n`,
    notebook: notebookPath || undefined,
    packages,
    glossary: glossaryEntries ? matchGlossary(`${unit.prompt}\n${solution}`, { entries: glossaryEntries }) : glossary,
    draft: true,
    // Notebook cells display the value of the last expression, so the sandbox
    // does the same: data.head() and print(data.head()) then grade the same.
    capture_last_expression: true,
    generated: {
      from: notebookPath,
      cell: unit.index,
      exercise: exerciseNumber,
      autoChecked,
      source: "tools/generate_problems.mjs",
    },
  };

  if (course && course.id) {
    problem.course = course.id;
    problem.solutions = course.solutions === "hidden" ? "hidden" : "shown";
    if (problem.solutions === "hidden") delete problem.solution;
  }

  if (setupUsable && setup) problem.setup = `${setup}\n`;
  if (dataFiles && Object.keys(dataFiles).length) problem.data_files = dataFiles;

  if (autoChecked) {
    problem.expected_output = stdout;
    problem.test_summary = "Checks that your program prints the output the notebook solution produces.";
  } else if (run && !run.ok && run.error) {
    problem.generated.note = `The notebook solution raised ${run.error.type} when run on its own: ${run.error.message}`;
  } else {
    problem.generated.note = "The notebook solution prints nothing, so this draft has no automatic check yet.";
  }

  const problems = [problem];

  if (withPredictVariant && autoChecked && lineCount <= 6 && stdout.split("\n").length <= 5) {
    problems.push({
      id: `${id}-predict`,
      type: "predict_output",
      title: `Predict the output: ${unit.title}`.slice(0, 120),
      topics,
      difficulty: "easy",
      prompt: `${unit.prompt}\n\n**The code below is the notebook's solution. Type exactly what it prints.**`,
      starter_code: `${solution}\n`,
      expected_output: stdout,
      hints: problem.hints.slice(0, 3),
      // A class that hides solutions gets no reference answer here either; the
      // predict variant still ships its expected output, which is why FIN 400
      // is built from write-from-scratch / fix-the-code exercises instead.
      ...(problem.solutions === "hidden" ? { solutions: "hidden" } : { solution: `${solution}\n` }),
      ...(course && course.id ? { course: course.id } : {}),
      notebook: notebookPath || undefined,
      packages,
      glossary: problem.glossary,
      draft: true,
      capture_last_expression: true,
      // The code only makes sense with the notebook state around it, so the
      // predict variant needs the same setup (and the same data files) as the
      // exercise it came from — without them it raises NameError for a learner.
      ...(problem.setup ? { setup: problem.setup } : {}),
      ...(problem.data_files ? { data_files: problem.data_files } : {}),
      generated: { ...problem.generated, variant: "predict" },
    });
  }

  return problems;
}

/* ----------------------------------------------------------------- misc ---- */

export function firstParagraph(text) {
  for (const chunk of String(text || "").split(/\n\s*\n/)) {
    const line = chunk.trim();
    if (!line || /^[#!|`>]|^---/.test(line)) continue;
    const cleaned = line.replace(/[`*_>#[\]]/g, "").replace(/\([^)]*\)/g, "").trim();
    if (cleaned.length > 20) return cleaned.slice(0, 220);
  }
  return "";
}

function basenameTitle(path) {
  const base = String(path).replace(/\\/g, "/").split("/").pop() || "material";
  return base.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}
