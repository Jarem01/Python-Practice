/**
 * End-to-end check of the Python side, in Node, through exactly the same code
 * path the browser uses: assets/js/harness.js + assets/js/grade.js.
 *
 * For every problem in problems/index.json it verifies that
 *   • the reference answer passes its own checks, and
 *   • for predict-the-output problems the recorded expected_output is really
 *     what the program prints.
 *
 * A class that hides its solutions from students (FIN 400) has no `solution` in
 * the bundle, by design — and its practice sets keep no answer in the repository
 * at all, because the repository is public. Those problems are checked by
 * pointing EXTRA_REFERENCE_ANSWERS at a local JSON file of reference answers
 * that is never committed:
 *
 *   EXTRA_REFERENCE_ANSWERS=/path/to/answers.json npm test
 *
 * Without that file such a problem is reported as SKIPPED with the reason, never
 * as a silent pass.
 *
 * Requires the Pyodide npm package (dev-only):
 *   npm install --no-save pyodide && node --test tests/
 * Without it the file reports SKIP and exits 0.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gradeRun, gradeText } from "../assets/js/grade.js";
import { HARNESS_SOURCE } from "../assets/js/harness.js";
import { normalizeOutput } from "../assets/js/util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bundle = JSON.parse(await readFile(path.join(root, "problems", "index.json"), "utf8"));

/**
 * Reference answers kept out of the published bundle. Only a class that shares
 * its worked answers may store them here (tests/solutions/*.json); a hidden
 * class keeps none in a public repository and uses EXTRA_REFERENCE_ANSWERS.
 */
const referenceAnswers = {};
try {
  for (const name of await readdir(path.join(root, "tests", "solutions"))) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(path.join(root, "tests", "solutions", name), "utf8"));
    for (const [id, code] of Object.entries(data)) {
      if (!id.startsWith("_")) referenceAnswers[id] = code;
    }
  }
} catch {
  /* no side file: every problem must then carry its own solution */
}

/** Optional private file: { problemId: referenceCode }. Never part of the repository. */
if (process.env.EXTRA_REFERENCE_ANSWERS) {
  const extra = JSON.parse(await readFile(process.env.EXTRA_REFERENCE_ANSWERS, "utf8"));
  for (const [id, code] of Object.entries(extra)) {
    if (!id.startsWith("_")) referenceAnswers[id] = code;
  }
}

let loadPyodide = null;
let indexURL = null;
try {
  const resolved = import.meta.resolve("pyodide");
  indexURL = path.dirname(fileURLToPath(resolved));
  ({ loadPyodide } = await import(resolved));
} catch {
  loadPyodide = null;
}

const skip = loadPyodide ? false : "pyodide is not installed (npm install --no-save pyodide)";

let pyodidePromise = null;
async function runtime(packages = []) {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const instance = await loadPyodide({ indexURL });
      await instance.runPythonAsync(HARNESS_SOURCE);
      return instance;
    })();
  }
  const instance = await pyodidePromise;
  if (packages.length) await instance.loadPackage(packages);
  return instance;
}

/** Mirrors runPython() in assets/js/runner.js. */
async function run(spec) {
  const instance = await runtime(spec.packages || []);
  instance.globals.set("__fb_spec", JSON.stringify(spec));
  const raw = await instance.runPythonAsync("__fb_exec(__fb_spec)");
  return JSON.parse(raw);
}

test("the harness captures stdout, stderr and errors", { skip }, async () => {
  const ok = await run({ code: "print('hi')\nimport sys\nprint('warn', file=sys.stderr)\n", tests: "", setup: "", stdin: "", lineLimit: 200000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.stdout, "hi\n");
  assert.equal(ok.stderr, "warn\n");

  const boom = await run({ code: "print(1)\nraise ValueError('nope')\n", tests: "", setup: "", stdin: "", lineLimit: 200000 });
  assert.equal(boom.ok, false);
  assert.equal(boom.stdout, "1\n");
  assert.equal(boom.error.type, "ValueError");
  assert.equal(boom.error.line, 2);
  assert.equal(boom.error.where, "user");
  assert.ok(!boom.error.traceback.includes("<harness>"), "harness frames are hidden from learners");

  const syntax = await run({ code: "for i in range(3)\n", tests: "", setup: "", stdin: "", lineLimit: 200000 });
  assert.equal(syntax.error.type, "SyntaxError");

  const testFail = await run({ code: "total = 10\n", tests: "assert total == 15", setup: "", stdin: "", lineLimit: 200000 });
  assert.equal(testFail.error.where, "tests");
  assert.match(testFail.error.message, /AssertionError/);

  const withInput = await run({ code: "name = input('who? ')\nprint(name.upper())\n", tests: "", setup: "", stdin: "ada\n", lineLimit: 200000 });
  assert.equal(withInput.stdout, "who? ADA\n", "the prompt is echoed, the typed value is not");

  const setup = await run({ code: "print(data)\n", tests: "", setup: "data = [1, 2]\n", stdin: "", lineLimit: 200000 });
  assert.equal(setup.stdout, "[1, 2]\n");
});

test("a data file or module handed to the sandbox is usable by the code", { skip }, async () => {
  const csv = await run({
    code: "import csv\nwith open('sales.csv') as handle:\n    rows = list(csv.reader(handle))\nprint(rows[0][0], rows[1][1])\n",
    setup: "",
    tests: "",
    stdin: "",
    files: { "sales.csv": "region,total\nnorth,10\n" },
    lineLimit: 200000,
  });
  assert.equal(csv.error, null, `a declared data file must be readable: ${csv.error && csv.error.message}`);
  assert.equal(csv.stdout, "region 10\n");

  // An uploaded .py module (a class helper, say) must be importable as well.
  const module = await run({
    code: "import analyticskit\nprint(analyticskit.total([1, 2, 3]))\n",
    setup: "",
    tests: "",
    stdin: "",
    files: { "analyticskit.py": "def total(values):\n    return sum(values)\n" },
    lineLimit: 200000,
  });
  assert.equal(module.error, null, `an uploaded module must be importable: ${module.error && module.error.message}`);
  assert.equal(module.stdout, "6\n");
});

test("the runaway-loop guard stops infinite loops", { skip }, async () => {
  const start = Date.now();
  const result = await run({ code: "n = 0\nwhile True:\n    n += 1\n", tests: "", setup: "", stdin: "", lineLimit: 20000 });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /infinite loop/i);
  assert.ok(Date.now() - start < 60000, "the guard must stop the loop quickly");
});

/** Data files an exercise declares, read from the repository the way the page does. */
async function materialize(dataFiles) {
  if (!dataFiles || !Object.keys(dataFiles).length) return null;
  const files = {};
  for (const [name, repoPath] of Object.entries(dataFiles)) {
    const absolute = path.join(root, repoPath);
    if (/\.(xlsx|xls|parquet|zip|png|jpe?g|gif|pdf)$/i.test(repoPath)) {
      files[name] = { base64: (await readFile(absolute)).toString("base64") };
    } else {
      files[name] = await readFile(absolute, "utf8");
    }
  }
  return files;
}

for (const problem of bundle.problems) {
  const reference = problem.solution ?? referenceAnswers[problem.id];
  // A hidden class keeps its answers out of the repository on purpose. Say so
  // in the report instead of failing — or quietly passing.
  const noReference =
    problem.type === "predict_output" || reference
      ? false
      : `${problem.id} stores no reference answer (hidden class: the repository is public). ` +
        "Set EXTRA_REFERENCE_ANSWERS to a local answers file to check it.";

  test(`problem "${problem.id}" (${problem.type}) is solvable`, { skip: skip || noReference }, async () => {
    const packages = problem.packages || [];
    // Exactly what the exercise page passes: setup state, declared data files and
    // the Jupyter-style display of a trailing expression.
    const shared = {
      setup: problem.setup || "",
      stdin: problem.stdin || "",
      files: await materialize(problem.data_files),
      captureLast: problem.capture_last_expression === true,
      lineLimit: 200000,
    };
    if (problem.type === "predict_output") {
      const run1 = await run({ code: problem.starter_code || "", tests: "", packages, ...shared });
      assert.equal(run1.error, null, `the code to read must run cleanly: ${run1.error && run1.error.message}`);
      const typed = normalizeOutput(run1.stdout);
      const expected = normalizeOutput(problem.expected_output);
      assert.equal(
        typed,
        expected,
        `expected_output does not match what the program prints.\nprinted: ${JSON.stringify(typed)}\nrecorded: ${JSON.stringify(expected)}`,
      );
      assert.equal(gradeText(problem, run1.stdout).ok, true);
      return;
    }

    assert.ok(reference, `${problem.id} has no reference answer`);
    const result = await run({ code: reference, tests: problem.tests || "", packages, ...shared });
    const verdict = gradeRun(problem, result);
    assert.equal(
      verdict.ok,
      true,
      `the reference solution fails its own checks:\n${JSON.stringify(verdict.checks, null, 2)}\n${result.error ? result.error.message : result.stdout}`,
    );
  });
}

test("a persistent kernel keeps variables between cells, like Jupyter", { skip }, async () => {
  // This is what the runnable notebooks in the Learning section rely on: cell 2
  // sees what cell 1 defined, and "Restart kernel" wipes it again.
  const instance = await runtime([]);
  const cell = async (code, options = {}) => {
    instance.globals.set(
      "__fb_spec",
      JSON.stringify({ code, tests: "", setup: "", stdin: "", lineLimit: 200000, persist: true, ...options }),
    );
    return JSON.parse(await instance.runPythonAsync("__fb_exec(__fb_spec)"));
  };

  const first = await cell("numbers = [1, 2, 3]\ntotal = sum(numbers)\nprint(total)", { resetKernel: true });
  assert.equal(first.stdout, "6\n");

  const second = await cell("print(numbers[0], total * 2)");
  assert.equal(second.error, null, `the second cell must see the first cell's variables: ${second.error && second.error.message}`);
  assert.equal(second.stdout, "1 12\n");

  const restarted = await cell("print('name' in dir())", { resetKernel: true });
  assert.equal(restarted.stdout, "False\n", "restarting the kernel forgets the variables");

  // A cell that is not marked persistent must not leak into the shared kernel.
  const isolated = await run({ code: "print('leak' in dir())", tests: "", setup: "", stdin: "", lineLimit: 200000 });
  assert.equal(isolated.stdout, "False\n");
});

test("a broken starter that is not fixed is graded as incorrect", { skip }, async () => {
  const problem = bundle.problems.find((p) => p.id === "fix-loop-sum-1-to-5");
  assert.ok(problem, "the sample problem set must be present");
  const result = await run({ code: problem.starter_code, tests: problem.tests || "", setup: "", stdin: "", packages: [], lineLimit: 200000 });
  const verdict = gradeRun(problem, result);
  assert.equal(verdict.ok, false, "the unfixed starter code must not pass");
});
