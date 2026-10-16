/**
 * A notebook, opened the way Jupyter opens one: every code cell is an editor
 * with a Run button and its output appears right underneath, the cells share one
 * Python kernel (see runner.js → persist) so a later cell sees the variables an
 * earlier one defined, and every exercise in the notebook is boxed and grouped
 * so it is obvious which cells belong to it.
 *
 * Everything stays in this browser: edits are kept in localStorage, and the
 * kernel is thrown away when the tab closes.
 */

import { resolveDataFiles } from "./datasets.js";
import { createEditor } from "./editor.js";
import { initPython, onStatus as subscribeStatus, runPython } from "./runner.js";
import { el, escapeHtml, lsGet, lsSet, mdToHtml, slugify, stripAnsi } from "./util.js";

const DRAFT_KEY = "notebook-edit";

function sourceOf(cell) {
  const source = cell.source ?? "";
  return (Array.isArray(source) ? source.join("") : String(source)).replace(/\n$/, "");
}

/** Saved edits for this notebook: { "<notebook path>": { "<cell index>": code } } */
function loadEdits(path) {
  const all = lsGet(DRAFT_KEY, {});
  return (all && all[path]) || {};
}

function saveEdits(path, edits) {
  const all = lsGet(DRAFT_KEY, {}) || {};
  all[path] = edits;
  lsSet(DRAFT_KEY, all);
}

function outputBlock(text, { className = "", label = null, image = null } = {}) {
  const box = el("div", { class: `cell out ${className}`.trim() });
  if (label) box.append(el("div", { class: "cell-tag", text: label }));
  if (image) box.append(el("img", { class: "out-img", src: image, alt: "figure" }));
  else box.append(el("pre", { html: `<code>${escapeHtml(stripAnsi(text).replace(/\n$/, ""))}</code>` }));
  return box;
}

/** A saved output as a data: URI, when it carries a rendered figure. */
function imageDataUri(data) {
  const raw = data["image/png"] ?? data["image/jpeg"];
  if (!raw) return null;
  const mime = data["image/png"] ? "image/png" : "image/jpeg";
  const base64 = (Array.isArray(raw) ? raw.join("") : String(raw)).replace(/\s/g, "");
  return base64 ? `data:${mime};base64,${base64}` : null;
}

/**
 * Render a notebook that can be run.
 * @param {HTMLElement} container
 * @param {object} notebook  the parsed .ipynb
 * @param {{path: string, dataFiles?: object, packages?: string[], exercises?: Array,
 *          glossaryBase?: string, onStatus?: Function}} options
 */
export function renderRunnableNotebook(container, notebook, options = {}) {
  const {
    path = "notebook",
    dataFiles = {},
    packages = [],
    exercises = [],
    glossaryBase = "../glossary.html",
    onStatus = null,
  } = options;
  const edits = loadEdits(path);
  const cells = [];
  let running = false;
  let prepared = false;
  let preparing = null;
  // The In [n] counter: it advances as cells run and starts over on a restart,
  // the way a real notebook numbers its executions.
  let executions = 0;

  container.innerHTML = "";

  /* ------------------------------------------------------------- toolbar -- */
  const status = el("span", { class: "small muted", text: "Python is not started yet." });
  const runAllButton = el("button", { class: "btn small primary", type: "button", text: "▶ Run all cells" });
  const restartButton = el("button", { class: "btn small", type: "button", text: "⟲ Restart kernel" });
  const resetButton = el("button", { class: "btn small ghost", type: "button", text: "Reset edits" });
  const bar = el("div", { class: "notebook-bar" });
  bar.append(runAllButton, restartButton, resetButton, status);

  const dataNames = Object.keys(dataFiles);
  if (dataNames.length) {
    bar.append(
      el("p", {
        class: "small muted",
        style: "flex-basis:100%;margin:.3rem 0 0",
        html:
          `Data files loaded into the notebook: <code>${dataNames.map((n) => escapeHtml(n)).join("</code>, <code>")}</code>` +
          (packages.length ? ` · packages: <code>${packages.map((p) => escapeHtml(p)).join("</code>, <code>")}</code>` : ""),
      }),
    );
  }
  container.append(bar);

  if (onStatus) onStatus({ state: "idle" });

  /* ---------------------------------------------------------------- cells -- */
  const heads = [];
  const usedIds = new Set();
  // The exercise list comes from data/notebooks.json, so the boxes drawn here and
  // the links the page offers always point at the same places. Claiming the
  // anchors first keeps a heading that slugs to the same id from duplicating it.
  const exerciseList = (exercises || [])
    .filter((exercise) => Number.isInteger(exercise?.index))
    .sort((a, b) => a.index - b.index);
  for (const exercise of exerciseList) usedIds.add(exercise.anchor);

  function uniqueId(base) {
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  }

  /** The exercise a cell belongs to; null for the setup cells above the first one. */
  function exerciseAt(index) {
    let found = null;
    for (const exercise of exerciseList) {
      if (exercise.index > index) break;
      found = exercise;
    }
    return found;
  }

  function runCell(index) { /* assigned below; declared here for the buttons */ }

  // Each exercise gets its own bordered group, so the cells that belong to it are
  // obvious instead of looking like one long notebook.
  let host = el("div", { class: "nb-section" });
  container.append(host);
  let hostExercise = null;

  notebook.cells?.forEach((cell, index) => {
    const exercise = exerciseAt(index);
    if (exercise && exercise !== hostExercise) {
      host = el("section", { class: "exercise-group", id: exercise.anchor });
      container.append(host);
      hostExercise = exercise;
    }

    if (cell.cell_type === "markdown") {
      const source = sourceOf(cell);
      if (!source.trim()) return;
      const rendered = mdToHtml(source, { glossaryBase, headingIds: false });
      // The heading that opens an exercise is boxed the way the class study
      // guides box their problems.
      const isExerciseHead = Boolean(exercise) && exercise.index === index;
      const wrapper = el("div", { class: `cell md${isExerciseHead ? " exercise-callout" : ""}` });
      wrapper.innerHTML = rendered.html;
      for (const node of wrapper.querySelectorAll("h1, h2, h3, h4")) {
        const text = node.textContent.trim();
        const id = uniqueId(slugify(text));
        node.id = id;
        heads.push({ level: Number(node.tagName[1]), text, id });
      }
      host.append(wrapper);
      return;
    }
    if (cell.cell_type !== "code") return;

    const code = edits[index] ?? sourceOf(cell);
    const cellEl = el("div", { class: "cell code runnable" });
    const header = el("div", { class: "cell-head" });
    const tag = el("div", { class: "cell-tag", text: `In [${cell.execution_count ?? " "}]` });
    header.append(tag);
    const runHere = el("button", { class: "btn small", type: "button", text: "▶ Run" });
    const clearHere = el("button", { class: "btn small ghost", type: "button", text: "Clear" });
    header.append(el("div", { class: "btn-row" }, [runHere, clearHere]));
    cellEl.append(header);

    const editorHost = el("div");
    const outputHost = el("div", { class: "cell-outputs" });
    cellEl.append(editorHost, outputHost);

    const editor = createEditor(editorHost, {
      value: code,
      minLines: Math.min(12, Math.max(2, code.split("\n").length)),
      onChange: (value) => {
        edits[index] = value;
        saveEdits(path, edits);
      },
      onRun: () => runCell(index),
    });

    runHere.addEventListener("click", () => runCell(index));
    clearHere.addEventListener("click", () => (outputHost.innerHTML = ""));

    host.append(cellEl);
    cells.push({ index, editor, outputHost, tag, source: sourceOf(cell) });

    if (cell.execution_count != null) {
      // Show the outputs the notebook was saved with until the cell is re-run,
      // exactly like Jupyter shows them after opening a notebook.
      const saved = savedOutputs(cell);
      if (saved) outputHost.append(saved);
    }
  });

  /* ---------------------------------------------------------- the kernel -- */

  async function prepare() {
    if (prepared) return;
    if (preparing) return preparing;
    preparing = (async () => {
      setStatus("loading", "Starting Python…");
      await initPython({ packages });
      const resolved = await resolveDataFiles(dataFiles);
      if (resolved.problems.length) {
        setStatus("error", `Some data files could not be loaded: ${resolved.problems.join("; ")}`);
        throw new Error(resolved.problems.join("; "));
      }
      // One run that only materializes the data files in the Python sandbox.
      await runPython("# data files", { files: resolved.files, persist: true });
      prepared = true;
      setStatus("ready", "Python is ready. Run a cell, or press Run all cells.");
    })();
    try {
      await preparing;
    } finally {
      preparing = null;
    }
  }

  function setStatus(state, message) {
    status.textContent = message;
    status.className = `small ${state === "error" ? "bad-text" : "muted"}`;
    if (onStatus) onStatus({ state, message });
  }

  // Note: `onStatus` here is the *option* (may be null); the runtime's own
  // status stream is imported as subscribeStatus.
  subscribeStatus((event) => {
    if (event && event.state === "packages" && event.message) setStatus("loading", event.message);
  });

  function showResult(host, result) {
    host.innerHTML = "";
    for (const png of result.images || []) {
      const box = el("div", { class: "cell out" });
      box.append(el("img", { class: "out-img", src: `data:image/png;base64,${png}`, alt: "figure" }));
      host.append(box);
    }
    if (result.stdout) host.append(outputBlock(result.stdout));
    if (result.error) {
      const where = result.error.where;
      const text = [result.error.traceback, result.error.message].filter(Boolean).join("\n").trim();
      host.append(outputBlock(text || result.error.message, { className: "error", label: where === "tests" ? "Error" : null }));
    }
    if (result.stderr && result.stderr.trim()) {
      host.append(outputBlock(result.stderr, { className: "stderr", label: "stderr" }));
    }
    if (!host.childNodes.length) host.append(el("p", { class: "tiny muted", text: "no output" }));
  }

  async function runOne(index) {
    const cell = cells.find((c) => c.index === index);
    if (!cell) return;
    await prepare();
    cell.outputHost.innerHTML = "<p class='tiny muted'>Running…</p>";
    executions += 1;
    cell.tag.textContent = `In [${executions}]`;
    const result = await runPython(cell.editor.getValue(), {
      persist: true,
      captureLast: true,
      packages,
    });
    showResult(cell.outputHost, result);
    return result && !result.error;
  }

  runCell = async (index) => {
    if (running) return;
    running = true;
    setRunning(true);
    try {
      await runOne(index);
      setStatus("ready", "Done. Python is ready.");
    } catch (error) {
      setStatus("error", String((error && error.message) || error));
    } finally {
      running = false;
      setRunning(false);
    }
  };

  function setRunning(active) {
    for (const button of [runAllButton, restartButton]) button.disabled = active;
  }

  runAllButton.addEventListener("click", async () => {
    if (running) return;
    running = true;
    setRunning(true);
    try {
      await prepare();
      let failed = 0;
      for (const cell of cells) {
        setStatus("loading", `Running cell ${cell.index + 1} of ${cells.length}…`);
        const ok = await runOne(cell.index);
        if (ok === false) {
          failed = failed + 1;
          break;
        }
      }
      setStatus(failed ? "error" : "ready", failed ? "Stopped at the first cell that raised an error." : "All cells ran in order.");
    } catch (error) {
      setStatus("error", String((error && error.message) || error));
    } finally {
      running = false;
      setRunning(false);
    }
  });

  restartButton.addEventListener("click", async () => {
    // Only the namespace goes away: the runtime and the data files stay, so a
    // restart is instant instead of downloading Python again.
    await runPython("", { resetKernel: true });
    executions = 0;
    for (const cell of cells) {
      cell.outputHost.innerHTML = "";
      cell.tag.textContent = "In [ ]";
    }
    setStatus("idle", "Kernel restarted — variables are gone, your edits are kept.");
  });

  resetButton.addEventListener("click", () => {
    for (const cell of cells) {
      cell.editor.setValue(cell.source, { silent: false });
      edits[cell.index] = cell.source;
      cell.outputHost.innerHTML = "";
    }
    saveEdits(path, edits);
    setStatus("idle", "Edits reset to the original notebook code.");
  });

  // Start the runtime as soon as the page is idle: the first Run is then quick.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(() => {
    initPython({ packages }).then(() => {
      if (!prepared) setStatus("ready", "Python is ready. Run a cell, or press Run all cells.");
    }).catch(() => {
      setStatus("idle", "Python starts the first time you run a cell.");
    });
  });

  return { runAll: () => runAllButton.click(), headings: heads, cellCount: cells.length };
}

/** The outputs a notebook was saved with, rendered read-only. */
function savedOutputs(cell) {
  const blocks = (cell.outputs || []).map(savedOutputBlock).filter(Boolean);
  if (!blocks.length) return null;
  const host = el("div");
  for (const block of blocks) host.append(block);
  return host;
}

/** One saved output: a figure if it has one, otherwise its text. */
function savedOutputBlock(output) {
  const kind = output.output_type;
  if (kind === "stream") {
    const text = Array.isArray(output.text) ? output.text.join("") : String(output.text ?? "");
    return text.trim() ? outputBlock(text, { label: "saved output" }) : null;
  }
  if (kind === "execute_result" || kind === "display_data") {
    const data = output.data || {};
    const image = imageDataUri(data);
    // A figure is what the cell produced; the text/plain next to it is only the
    // fallback repr of the same object, so the image wins when both exist.
    if (image) return outputBlock("", { image, label: "saved figure" });
    const raw = data["text/plain"];
    const text = Array.isArray(raw) ? raw.join("") : String(raw ?? "");
    return text.trim() ? outputBlock(text, { label: "saved output" }) : null;
  }
  if (kind === "error") {
    const trace = stripAnsi((output.traceback || []).join("\n") || `${output.ename}: ${output.evalue}`);
    return outputBlock(trace, { className: "error", label: "saved error" });
  }
  return null;
}


