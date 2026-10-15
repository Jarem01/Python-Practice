/**
 * Pyodide loader + a thin wrapper around the Python harness.
 *
 * The runtime is imported lazily (only when the learner first runs code) and
 * the instance is shared by every exercise page in the tab session.
 */

import { CONFIG } from "./config.js";
import { HARNESS_SOURCE } from "./harness.js";

let pyodide = null;
let loadingPromise = null;
const loadedPackages = new Set();
const listeners = new Set();

/** Subscribe to runtime status events. Returns an unsubscribe function. */
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status) {
  for (const fn of [...listeners]) {
    try {
      fn(status);
    } catch {
      /* a broken listener must not break the runner */
    }
  }
}

export function isReady() {
  return pyodide !== null;
}

export function statusSnapshot() {
  if (pyodide) return { state: "ready" };
  if (loadingPromise) return { state: "loading", message: "Starting Python…" };
  return { state: "idle" };
}

async function loadPackages(packages) {
  const todo = [...new Set(packages)].filter((p) => p && !loadedPackages.has(p));
  if (!todo.length || !pyodide) return;
  emit({ state: "packages", message: `Loading Python packages: ${todo.join(", ")}…` });
  await pyodide.loadPackage(todo, {
    messageCallback: (msg) => emit({ state: "packages", message: msg }),
  });
  todo.forEach((p) => loadedPackages.add(p));
  emit({ state: "ready" });
}

/**
 * Load (once) the Python runtime plus the harness.
 * @param {{packages?: string[], force?: boolean}} options
 */
export async function initPython({ packages = [], force = false } = {}) {
  if (pyodide && !force) {
    await loadPackages(packages);
    return pyodide;
  }
  if (!loadingPromise || force) {
    loadingPromise = (async () => {
      emit({ state: "loading", message: `Downloading Python runtime (Pyodide ${CONFIG.pyodideVersion})…` });
      const module = await import(/* @vite-ignore */ `${CONFIG.pyodideIndexURL}pyodide.mjs`);
      const instance = await module.loadPyodide({
        indexURL: CONFIG.pyodideIndexURL,
        stdout: () => {},
        stderr: () => {},
      });
      emit({ state: "loading", message: "Preparing the Python sandbox…" });
      await instance.runPythonAsync(HARNESS_SOURCE);
      pyodide = instance;
      pyodide.runPythonAsync("import sys; sys.setrecursionlimit(3000)").catch(() => {});
      emit({ state: "ready" });
      return instance;
    })().catch((error) => {
      pyodide = null;
      loadingPromise = null;
      loadedPackages.clear();
      emit({ state: "error", message: String((error && error.message) || error) });
      throw error;
    });
  }
  await loadingPromise;
  await loadPackages(packages);
  return pyodide;
}

/**
 * Run Python code in the sandbox.
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, error:object|null, steps:number}>}
 */
export async function runPython(code, options = {}) {
  const {
    stdin = "",
    tests = "",
    setup = "",
    packages = [],
    captureLast = false,
    files = null,
    lineLimit = CONFIG.lineLimit,
  } = options;

  let instance;
  try {
    instance = await initPython({ packages });
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      steps: 0,
      runtime: true,
      error: {
        type: "RuntimeError",
        message: `Python could not be started: ${String((error && error.message) || error)}`,
        where: "runtime",
        line: null,
        source: "",
        traceback: "",
      },
    };
  }

  const spec = { code, tests, setup, stdin, lineLimit, captureLast, files };
  try {
    instance.globals.set("__fb_spec", JSON.stringify(spec));
    const raw = await instance.runPythonAsync("__fb_exec(__fb_spec)");
    const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
    return parsed;
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      steps: 0,
      runtime: true,
      error: {
        type: "RuntimeError",
        message: `The Python sandbox failed: ${String((error && error.message) || error)}`,
        where: "runtime",
        line: null,
        source: "",
        traceback: String((error && error.stack) || ""),
      },
    };
  }
}

/** Forget the current interpreter; the next run downloads/creates a fresh one. */
export function resetPython() {
  pyodide = null;
  loadingPromise = null;
  loadedPackages.clear();
  emit({ state: "idle" });
}
