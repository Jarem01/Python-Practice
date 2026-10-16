/**
 * Run-mode end-to-end check: every notebook in the Learning section is executed
 * cell by cell in Pyodide, in one shared namespace, with exactly the data files
 * the page copies into the sandbox (data/notebooks.json → data_files).
 *
 * This is what makes "Run" work in the browser: if this passes, a learner can
 * open the notebook, press “Run all cells” and see output instead of tracebacks.
 *
 *   npm install --no-save pyodide && node --test tests/notebooks.test.mjs
 * A missing pyodide reports SKIP and exits 0.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HARNESS_SOURCE } from "../assets/js/harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifest = JSON.parse(await readFile(path.join(root, "data", "notebooks.json"), "utf8"));

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

let runtimePromise = null;
const installed = new Set();

/** One Pyodide instance for the whole file, like one open browser tab. */
function runtime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const py = await loadPyodide({ indexURL });
      await py.runPythonAsync(HARNESS_SOURCE);
      return py;
    })();
  }
  return runtimePromise;
}

function sourceOf(cell) {
  const source = cell.source ?? "";
  return Array.isArray(source) ? source.join("") : String(source);
}

/** Cells that ask the learner to read the traceback are supposed to raise. */
const EXPECTED_ERROR_RE = /what is the error|error you (?:get|receive)|read the .{0,20}traceback|traceback/i;

async function materialize(dataFiles = {}) {
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

for (const entry of manifest.notebooks) {
  test(`“${entry.label}” runs cell by cell in the browser kernel`, { skip }, async () => {
    const py = await runtime();
    const todo = (entry.packages || []).filter((p) => !installed.has(p));
    if (todo.length) {
      await py.loadPackage(todo);
      todo.forEach((p) => installed.add(p));
    }

    const notebook = JSON.parse(await readFile(path.join(root, entry.path), "utf8"));
    const files = await materialize(entry.data_files);

    let lastMarkdown = "";
    let index = -1;
    let ran = 0;
    for (const cell of notebook.cells || []) {
      if (cell.cell_type === "markdown") {
        lastMarkdown = sourceOf(cell);
        continue;
      }
      if (cell.cell_type !== "code") continue;
      index += 1;
      const code = sourceOf(cell);
      if (!code.trim()) continue;
      ran += 1;
      const spec = {
        code,
        tests: "",
        setup: "",
        stdin: "",
        files,
        persist: true,
        resetKernel: index === 0, // a fresh kernel per notebook
        captureLast: true,
        lineLimit: 2000000,
      };
      py.globals.set("__fb_spec", JSON.stringify(spec));
      const result = JSON.parse(await py.runPythonAsync("__fb_exec(__fb_spec)"));
      if (result.error && !EXPECTED_ERROR_RE.test(lastMarkdown)) {
        assert.fail(
          `cell ${index} failed (${result.error.where}): ${result.error.message}\n` +
            `--- the cell ---\n${code.trim().split("\n").slice(0, 6).join("\n")}`,
        );
      }
    }

    const expected = (notebook.cells || []).filter((c) => c.cell_type === "code" && sourceOf(c).trim()).length;
    assert.equal(ran, expected, "every code cell in the notebook must have run");
  });
}
