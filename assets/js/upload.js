/**
 * upload.html — add course material, see what the analyzer found, build practice
 * exercises from notebooks, and save everything to the repository (or to this
 * browser for a preview).
 */

import { CONFIG } from "./config.js";
import { activeCourse, loadCourses, mountCoursePicker } from "./course.js";
import {
  analyzeFile,
  buildDraftProblem,
  dataFileHints,
  extractExerciseUnits,
  importedModules,
  packageHints,
} from "./analyze.js";
import { isBinaryPath, resolveDataFiles, toBase64 } from "./datasets.js";
import { commitFiles, clearToken, loadSettings, parseRepo, saveSettings, verifyToken } from "./github.js";
import { loadGlossary } from "./glossary.js";
import { loadProblems, saveDraft } from "./problems.js";
import { onStatus, runPython } from "./runner.js";
import { TYPE_LABELS, el, escapeHtml, pluralize, slugify } from "./util.js";
import { addUpload, listUploads, removeUpload, totalUploadBytes, uploadLimits } from "./uploads.js";

const MAX_ANALYZE_BYTES = 8 * 1024 * 1024;

const state = {
  files: [],
  drafts: [],
  glossary: null,
  course: null,
  // Folders some class keeps private (data/courses.json → private_paths),
  // e.g. FIN 400's fin400/solutions. Nothing uploaded there is turned into an
  // exercise, because exercises are published.
  privatePaths: [],
  busy: false,
  cancel: false,
  uid: 0,
};

const nodes = {};

/* ------------------------------------------------------------- file input --- */

async function readFile(file) {
  const binary = isBinaryPath(file.name) || (!/\.(ipynb|py|pyw|md|txt|csv|tsv|json|js|html|css|ipynb)$/i.test(file.name) && /\.(xlsx|xls|parquet|zip|png|jpe?g|gif|pdf)$/i.test(file.name));
  if (binary) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { encoding: "base64", content: toBase64(bytes), binary: true, size: bytes.length };
  }
  const text = await file.text();
  return { encoding: "utf-8", content: text, binary: false, size: new TextEncoder().encode(text).length };
}

function targetPath(name) {
  const folder = (nodes.folder.value || CONFIG.uploadFolder || "materials").replace(/^\/+|\/+$/g, "");
  const sub = (nodes.subfolder.value || "").replace(/^\/+|\/+$/g, "").replace(/\s+/g, " ");
  return [folder, sub, name].filter(Boolean).join("/");
}

/** The folder the uploads are going into, without a file name. */
function destinationFolder() {
  const folder = (nodes.folder.value || CONFIG.uploadFolder || "materials").replace(/^\/+|\/+$/g, "");
  const sub = (nodes.subfolder.value || "").replace(/^\/+|\/+$/g, "").replace(/\s+/g, " ");
  return [folder, sub].filter(Boolean).join("/");
}

/** The data folder of the class in the header ("acc525/data", "fin400/data"). */
function courseDataFolder() {
  const root = ((state.course && state.course.paths) || []).filter(Boolean)[0];
  return root ? `${root}/data` : "materials/datasets";
}

/** Is this upload going into a folder its class keeps off the site? */
function isPrivateDestination() {
  const path = destinationFolder();
  return state.privatePaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Say so when the destination is private, and switch exercise generation off.
 * The sources still belong in the repository (that is where the instructor
 * keeps them); an exercise built from a solved notebook would be published,
 * so the page refuses to build one.
 */
function updatePrivateDestination() {
  const privateFolder = isPrivateDestination();
  const warning = document.getElementById("private-warning");
  if (warning) warning.classList.toggle("hidden", !privateFolder);
  for (const box of [nodes.generate, nodes.predict, nodes.commitExercises]) {
    if (box) box.disabled = privateFolder;
  }
}

async function addFiles(fileList) {
  for (const file of [...fileList]) {
    const record = {
      uid: ++state.uid,
      name: file.name,
      size: file.size,
      path: targetPath(file.name),
      status: "new",
      error: null,
      entry: null,
      json: null,
      kind: "material",
      encoding: "utf-8",
      content: "",
    };
    try {
      if (file.size > MAX_ANALYZE_BYTES) {
        record.status = "error";
        record.error = `${(file.size / 1024 / 1024).toFixed(1)} MB is too large to analyze here; commit it directly to materials/.`;
      } else {
        const read = await readFile(file);
        Object.assign(record, read, { kind: read.binary ? "material" : "text" });
        if (read.binary) {
          record.entry = binaryEntry(record);
          record.status = "analyzed";
        } else {
          const analysis = analyzeFile({ name: file.name, text: read.content, path: record.path });
          record.kind = analysis.kind;
          record.entry = analysis.entry;
          record.json = analysis.json;
          record.status = "analyzed";
        }
      }
    } catch (error) {
      record.status = "error";
      record.error = String((error && error.message) || error);
    }
    const existing = state.files.findIndex((item) => item.path === record.path);
    if (existing >= 0) state.files[existing] = record;
    else state.files.push(record);
  }
  renderFiles();
  setStatus("info", `${pluralize(state.files.length, "file")} ready. Press <strong>Analyze files</strong> to build exercises.`);
}

function binaryEntry(record) {
  return {
    id: slugify(record.path.replace(/\.[^.]+$/, "")),
    path: record.path,
    filename: record.name,
    kind: "material",
    title: record.name,
    group: record.path.split("/")[1] || "Course material",
    group_order: 100,
    summary: `Stored data file (${(record.size / 1024).toFixed(0)} KB).`,
    cell_count: 0,
    code_cell_count: 0,
    markdown_cell_count: 0,
    output_cell_count: 0,
    exercises: [],
    matched_topics: [],
    inferred_topics: [],
    binary: true,
  };
}

/* --------------------------------------------------------------- analysis --- */

async function analyzeAll() {
  if (state.busy) {
    setStatus("warn", "The previous run is still going — the progress bar above says where it is.");
    return;
  }
  if (!state.files.length) return setStatus("warn", "Add some files first.");

  setBusy(true, "Analyzing…");
  showProgress("Reading the files…");
  try {
    if (!state.glossary) {
      try {
        state.glossary = await loadGlossary();
      } catch {
        state.glossary = { entries: [] };
      }
    }

    for (const file of state.files) {
      if (file.status === "analyzed" || file.status === "error" || file.binary) continue;
      try {
        const analysis = analyzeFile({ name: file.name, text: file.content, path: file.path });
        file.kind = analysis.kind;
        file.entry = analysis.entry;
        file.json = analysis.json;
        file.status = "analyzed";
      } catch (error) {
        file.status = "error";
        file.error = String((error && error.message) || error);
      }
    }
    renderFiles();

    if (isPrivateDestination()) {
      updatePrivateDestination();
      setStatus(
        "ok",
        "Analysis finished. This destination is private, so no practice exercises were built — they would be published, and these files must not be.",
      );
      return;
    }

    if (!nodes.generate.checked) {
      setStatus("ok", "Analysis finished. Tick “Build practice exercises” to generate exercises from notebooks.");
      return;
    }
    await generateExercises();
  } catch (error) {
    // An exception here used to reject silently: the button looked dead. Always
    // say what happened, and leave the file list intact.
    setStatus(
      "error",
      `Analysis stopped: ${escapeHtml(String((error && error.message) || error))}. Your files are still listed — press <strong>Analyze files</strong> to try again.`,
    );
  } finally {
    setBusy(false);
    hideProgress();
  }
}

/**
 * Uploaded .py files are helper modules the notebooks import ("analyticskit"
 * and friends). They are copied into the sandbox under their own name so the
 * notebook's code can import them unchanged.
 */
function uploadedModules() {
  const modules = new Map();
  for (const file of state.files) {
    if (!/\.pyw?$/i.test(file.name) || file.binary || file.encoding === "base64") continue;
    modules.set(file.name, { repoPath: file.path, content: file.content });
  }
  return modules;
}

async function generateExercises() {
  const notebooks = state.files.filter((file) => file.kind === "notebook" && file.json);
  if (!notebooks.length) {
    return setStatus("warn", "No notebooks in the list, so there was nothing to turn into exercises.");
  }

  state.cancel = false;
  const before = state.drafts.length;
  let checked = 0;
  let needsReview = 0;

  const helperModules = uploadedModules();
  setStatus("info", "Running each notebook solution in Python to capture its output…");
  showProgress(`Starting with ${notebooks[0].name}…`);

  for (const file of notebooks) {
    const units = extractExerciseUnits(file.json).filter((unit) => unit.code);
    for (let index = 0; index < units.length; index++) {
      if (state.cancel) {
        setStatus("warn", "Stopped. Everything generated so far has been kept.");
        renderDrafts();
        return;
      }
      const unit = units[index];
      setProgressText(`${file.name}: exercise ${index + 1} of ${units.length}…`);
      const setup = unit.setupCells.join("\n\n").trim();
      const packages = [...new Set([...packageHints(unit.code), ...packageHints(setup)])];
      // Data the notebook reads (sales.csv and friends) is handed to the sandbox
      // under the plain name the code uses, exactly as the runner does.
      const wanted = dataFileHints(`${unit.code}\n${setup}`);
      const declared = {};
      for (const name of wanted) {
        const added = state.files.find((item) => item.name === name);
        declared[name] = added ? added.path : `${courseDataFolder()}/${name}`;
      }
      const resolved = Object.keys(declared).length ? await resolveDataFiles(declared) : { files: {}, problems: [] };
      const modules = {};
      for (const name of importedModules(`${unit.code}\n${setup}`)) {
        // This used to read `const uploaded = uploaded.has(...)`, which threw a
        // ReferenceError on the first notebook that imports anything — the whole
        // click then failed with nothing on screen.
        const helper = helperModules.has(`${name}.py`) ? helperModules.get(`${name}.py`) : null;
        if (!helper) continue;
        modules[`${name}.py`] = helper.content;
        declared[`${name}.py`] = helper.repoPath;
      }
      const run = await runPython(unit.code, {
        setup,
        packages,
        captureLast: true,
        files: { ...resolved.files, ...modules },
      });
      const drafts = buildDraftProblem(unit, run, {
        notebookPath: file.path,
        notebookTitle: file.entry.title,
        topics: [file.entry.group, ...(file.entry.matched_topics || [])].filter(Boolean).slice(0, 3),
        glossaryEntries: state.glossary.entries,
        exerciseNumber: unit.itemNumber || index + 1,
        idPrefix: "upload",
        withPredictVariant: nodes.predict.checked,
        setupUsable: Boolean(setup),
        dataFiles: Object.keys(declared).length ? declared : null,
        // Exercises built from this upload belong to the class in the header,
        // and a hidden class keeps the notebook's solution out of the draft.
        course: state.course,
      });
      for (const draft of drafts) {
        saveDraft(draft);
        state.drafts.push(draft);
        if (draft.expected_output) checked += 1;
        else needsReview += 1;
      }
    }
  }

  const created = state.drafts.length - before;
  setStatus(
    created ? "ok" : "warn",
    created
      ? `Built ${pluralize(created, "practice exercise")} (${checked} with a verified output, ${needsReview} needing review). They are drafts in this browser — see the practice list.`
      : "No exercises could be built from these notebooks.",
  );
  renderDrafts();
}

/* -------------------------------------------------------------- rendering --- */

function setStatus(kind, html) {
  nodes.status.innerHTML = `<div class="notice ${kind === "ok" ? "ok" : kind === "warn" ? "warn" : kind === "error" ? "bad" : ""}">${html}</div>`;
}

/* --------------------------------------------------------------- progress --- */

function showProgress(text = "") {
  if (!nodes.progress) return;
  nodes.progress.classList.remove("hidden");
  setProgressText(text);
}

function setProgressText(text) {
  if (nodes.progressText) nodes.progressText.textContent = text || "";
}

function hideProgress() {
  if (!nodes.progress) return;
  nodes.progress.classList.add("hidden");
  setProgressText("");
}

/**
 * Lock the long-running buttons while a job runs, so a second click cannot start
 * a second run, and put the job's name on the button that started it.
 */
function setBusy(busy, label) {
  state.busy = busy;
  for (const button of [nodes.analyze, nodes.saveGithub, nodes.saveBrowser]) {
    if (!button) continue;
    if (busy) {
      if (!button.dataset.label) button.dataset.label = button.textContent;
      button.disabled = true;
    } else {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  }
  if (busy && label && nodes.analyze) nodes.analyze.textContent = label;
}

function renderFiles() {
  if (!state.files.length) {
    nodes.files.innerHTML = '<p class="small muted">No files added yet.</p>';
    return;
  }
  const rows = state.files
    .map((file) => {
      const entry = file.entry || {};
      const badge =
        file.status === "saved-github"
          ? '<span class="badge solved">on GitHub</span>'
          : file.status === "saved-browser"
            ? '<span class="badge attempted">in browser</span>'
            : file.status === "error"
              ? '<span class="badge" style="color:var(--bad)">error</span>'
              : '<span class="badge">new</span>';
      const detail = file.error
        ? `<span style="color:var(--bad)">${escapeHtml(file.error)}</span>`
        : `${escapeHtml(entry.title || file.name)}${entry.exercises && entry.exercises.length ? ` · ${pluralize(entry.exercises.length, "exercise")} in the file` : ""}`;
      return (
        `<tr><td>${escapeHtml(file.name)}</td>` +
        `<td><span class="badge">${escapeHtml(file.kind)}</span></td>` +
        `<td class="tiny">${(file.size / 1024).toFixed(0)} KB</td>` +
        `<td class="small">${detail}</td>` +
        `<td class="tiny mono">${escapeHtml(file.path)}</td>` +
        `<td>${badge}</td>` +
        `<td><button class="btn small ghost" data-remove="${file.uid}" type="button">Remove</button></td></tr>`
      );
    })
    .join("");
  nodes.files.innerHTML =
    `<table><thead><tr><th>File</th><th>Kind</th><th>Size</th><th>Detected</th><th>Will be saved as</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  for (const button of nodes.files.querySelectorAll("button[data-remove]")) {
    button.addEventListener("click", () => {
      state.files = state.files.filter((file) => String(file.uid) !== button.dataset.remove);
      renderFiles();
    });
  }
}

function renderDrafts() {
  if (!state.drafts.length) {
    nodes.drafts.innerHTML = '<p class="small muted">Exercises appear here after analyzing a notebook.</p>';
    return;
  }
  const checked = state.drafts.filter((draft) => draft.expected_output).length;
  const rows = state.drafts
    .map(
      (draft) =>
        `<tr><td class="small"><a href="practice/exercise.html?id=${encodeURIComponent(draft.id)}">${escapeHtml(draft.title)}</a></td>` +
        `<td><span class="badge type-${draft.type}">${escapeHtml(TYPE_LABELS[draft.type] || draft.type)}</span></td>` +
        `<td class="tiny">${draft.expected_output ? "checked automatically" : "needs review"}</td></tr>`,
    )
    .join("");
  nodes.drafts.innerHTML =
    `<p class="small muted">${pluralize(state.drafts.length, "exercise")} · ${checked} auto-checked · ${state.drafts.length - checked} need review</p>` +
    `<table><thead><tr><th>Exercise</th><th>Type</th><th>Checking</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ------------------------------------------------------------------ saving --- */

async function saveToBrowser() {
  if (!state.files.length) return setStatus("warn", "Add some files first.");
  const problems = [];
  let saved = 0;
  for (const file of state.files) {
    if (file.binary) {
      file.status = "analyzed";
      problems.push(`${file.name} is a binary file; this browser store keeps text only — use “Save to GitHub” for it.`);
      continue;
    }
    const result = addUpload({
      path: file.path,
      name: file.name,
      kind: file.kind,
      text: file.content,
      entry: file.entry,
    });
    if (result.ok) {
      file.status = "saved-browser";
      saved += 1;
    } else {
      problems.push(`${file.name}: ${result.error}`);
    }
  }
  renderFiles();
  renderUploadSummary();
  const { maxTotalBytes } = uploadLimits();
  setStatus(
    problems.length ? "warn" : "ok",
    `${saved} of ${state.files.length} file(s) stored in this browser (${(totalUploadBytes() / 1024).toFixed(0)} KB of ${maxTotalBytes / 1024} KB). ` +
      `They now appear on the <a href="learning/index.html">learning page</a>, marked “in this browser”, and can be opened and run there.` +
      (problems.length ? `<br><span style="color:var(--bad)">${problems.map(escapeHtml).join("<br>")}</span>` : ""),
  );
}

/**
 * Turn the generated exercises into repository files.
 *
 * Only exercises that can be graded are written: a problem with no expected
 * output and no tests would make tools/build_index.py refuse to rebuild the
 * index, and a broken build is worse than a missing draft. Those stay in the
 * browser until they are finished on the practice page.
 */
function exercisePayload() {
  // Never publish an exercise built from a private folder: its expected
  // output is the answer key.
  if (isPrivateDestination()) return { files: [], skipped: 0, private: true };
  const wanted = !nodes.commitExercises || nodes.commitExercises.checked;
  if (!wanted || !state.drafts.length) return { files: [], skipped: 0 };
  const files = [];
  let skipped = 0;
  for (const draft of state.drafts) {
    if (!draft.expected_output && !draft.tests) {
      skipped += 1;
      continue;
    }
    const problem = { ...draft, generated: { ...(draft.generated || {}), source: "upload page" } };
    delete problem.draft;
    files.push({
      path: `problems/generated/${draft.id}.json`,
      content: `${JSON.stringify(problem, null, 2)}\n`,
      encoding: "utf-8",
      message: `Add exercise ${String(draft.title || draft.id).slice(0, 60)}`,
    });
  }
  return { files, skipped };
}

function githubSettings() {
  return {
    repo: nodes.ghRepo.value.trim() || CONFIG.githubRepo,
    branch: nodes.ghBranch.value.trim() || CONFIG.githubBranch,
    token: nodes.ghToken.value.trim() || loadSettings().token,
    remember: nodes.ghRemember.checked,
  };
}

async function saveToGitHub() {
  if (!state.files.length) return setStatus("warn", "Add some files first.");
  const settings = githubSettings();
  try {
    parseRepo(settings.repo);
  } catch (error) {
    return githubStatus(String(error.message));
  }
  if (!settings.token) return githubStatus("Paste a GitHub token first (see the settings below).");

  state.cancel = false;
  showProgress(`Committing to ${settings.repo}@${settings.branch}…`);
  setStatus("info", `Committing to ${escapeHtml(settings.repo)}@${escapeHtml(settings.branch)}…`);
  const source = state.files.map((file) => ({
    path: file.path,
    content: file.content,
    encoding: file.encoding === "base64" ? "base64" : "utf-8",
    message: `Add ${file.path} from the Python Practice upload page`,
  }));
  const exercises = exercisePayload();
  const payload = [...source, ...exercises.files];

  const results = await commitFiles(payload, {
    ...settings,
    onProgress: ({ index, total, path, state: step, error }) => {
      nodes.progressText.textContent = `${step === "start" ? "Saving" : step === "done" ? "Saved" : "Failed"} ${index + 1}/${total}: ${path}${error ? ` — ${error}` : ""}`;
    },
  });
  hideProgress();

  const ok = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  for (const result of ok) {
    const file = state.files.find((item) => item.path === result.path);
    if (file) file.status = "saved-github";
  }
  renderFiles();
  const savedExercises = exercises.files.length;
  setStatus(
    failed.length ? "warn" : "ok",
    `Committed ${ok.length} of ${results.length} file(s) to <code>${escapeHtml(settings.repo)}</code> — ` +
      `${source.length} source file(s) under <code>${escapeHtml(nodes.folder.value || CONFIG.uploadFolder)}/</code> and ${savedExercises} exercise file(s). ` +
      `The index rebuilds automatically on the next push (the GitHub Actions workflow commits it back and republishes the site), or run <code>python3 tools/build_index.py</code> in your clone.` +
      (exercises.private
        ? "<br>No exercises were committed: the destination is a private folder, and exercises are published."
        : exercises.skipped
          ? `<br>${exercises.skipped} exercise(s) stayed in this browser because nothing can check them yet — they would stop the index build.`
          : "") +
      (failed.length ? `<br><span style="color:var(--bad)">${failed.map((r) => `${escapeHtml(r.path)}: ${escapeHtml(r.error)}`).join("<br>")}</span>` : ""),
  );
}

function downloadBundle() {
  if (!state.files.length) return setStatus("warn", "Add some files first.");
  const bundle = {
    version: 1,
    generated_at: new Date().toISOString(),
    destination: nodes.folder.value || CONFIG.uploadFolder,
    files: state.files.map((file) => ({ path: file.path, encoding: file.encoding, content: file.content })),
    // A bundle applied by the importer becomes part of the published site, so
    // exercises are kept out of it when the source folder is private.
    problems: isPrivateDestination() ? [] : state.drafts,
  };
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: "materials-bundle.json" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus("ok", "Bundle downloaded. Import it with <code>python3 tools/import_materials.py materials-bundle.json</code>.");
}

/* ------------------------------------------------------------------- setup --- */

/** What is already stored in this browser, with a button to clear it. */
function renderUploadSummary() {
  const uploads = listUploads();
  nodes.saveHint.textContent =
    "Saved-to-this-browser uploads are private to this browser; “Save to GitHub” writes the files into " +
    `${CONFIG.uploadFolder}/ in the repository so everyone gets them.`;
  if (!uploads.length) return;
  nodes.saveHint.insertAdjacentHTML(
    "beforeend",
    `<br>Already in this browser: ${pluralize(uploads.length, "file")} (${(totalUploadBytes() / 1024).toFixed(0)} KB). ` +
      `<button class="btn small ghost" id="forget-uploads" type="button">Remove them all</button>`,
  );
  document.getElementById("forget-uploads").addEventListener("click", () => {
    for (const upload of uploads) removeUpload(upload.path);
    for (const file of state.files) {
      if (file.status === "saved-browser") file.status = "analyzed";
    }
    renderUploadSummary();
    renderFiles();
    setStatus("info", "Uploaded files removed from this browser.");
  });
}

function githubStatus(message, kind = "info") {
  nodes.ghStatus.innerHTML = `<span${kind === "error" ? ' style="color:var(--bad)"' : ""}>${escapeHtml(message)}</span>`;
}

function initDropZone() {
  nodes.drop.addEventListener("click", () => nodes.fileInput.click());
  nodes.drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      nodes.fileInput.click();
    }
  });
  nodes.pick.addEventListener("click", () => nodes.fileInput.click());
  nodes.fileInput.addEventListener("change", () => {
    addFiles(nodes.fileInput.files);
    nodes.fileInput.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    nodes.drop.addEventListener(type, (event) => {
      event.preventDefault();
      nodes.drop.style.borderColor = "var(--accent)";
    });
  }
  for (const type of ["dragleave", "drop"]) {
    nodes.drop.addEventListener(type, (event) => {
      event.preventDefault();
      nodes.drop.style.borderColor = "";
    });
  }
  nodes.drop.addEventListener("drop", (event) => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) addFiles(files);
  });
  nodes.fetchUrl.addEventListener("click", async () => {
    const url = nodes.urlInput.value.trim();
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const name = decodeURIComponent(url.split("/").pop().split("?")[0]) || "material.ipynb";
      const pseudo = { name, size: new TextEncoder().encode(text).length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
      await addFiles([pseudo]);
      nodes.urlInput.value = "";
    } catch (error) {
      setStatus("error", `Could not fetch that URL: ${escapeHtml(String((error && error.message) || error))}.<br>Note that browsers can only fetch URLs that allow cross-origin requests — raw.githubusercontent.com does.`);
    }
  });
}

function applySettings() {
  const settings = loadSettings();
  nodes.ghRepo.value = settings.repo || CONFIG.githubRepo;
  nodes.ghBranch.value = settings.branch || CONFIG.githubBranch;
  nodes.ghToken.value = settings.token || "";
  nodes.ghRemember.checked = settings.remember !== false;
}

async function main() {
  for (const id of ["status", "files", "drafts", "drop", "file-input", "pick", "url-input", "fetch-url", "folder", "subfolder", "generate", "predict", "commit-exercises", "analyze", "save-browser", "save-github", "download-bundle", "clear", "progress", "progress-text", "gh-repo", "gh-branch", "gh-token", "gh-remember", "gh-test", "gh-save", "gh-forget", "gh-status", "save-hint"]) {
    nodes[id.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = document.getElementById(id);
  }
  hideProgress();

  initDropZone();
  applySettings();
  nodes.folder.value = nodes.folder.value || CONFIG.uploadFolder;

  nodes.analyze.addEventListener("click", () => {
    analyzeAll().catch((error) => {
      setBusy(false);
      hideProgress();
      setStatus("error", `Analysis failed: ${escapeHtml(String((error && error.message) || error))}. Press <strong>Analyze files</strong> to try again.`);
    });
  });
  // While a job is running, the Python runtime's own messages (downloading
  // Pyodide, loading pandas) belong on the progress line — the first run spends
  // a while there, and a silent button looks broken.
  onStatus((status) => {
    if (state.busy && status && status.message) setProgressText(status.message);
  });
  nodes.folder.addEventListener("input", updatePrivateDestination);
  nodes.subfolder.addEventListener("input", updatePrivateDestination);
  nodes.saveBrowser.addEventListener("click", () => saveToBrowser());
  nodes.saveGithub.addEventListener("click", () => saveToGitHub());
  nodes.downloadBundle.addEventListener("click", () => downloadBundle());
  nodes.clear.addEventListener("click", () => {
    state.files = [];
    renderFiles();
    setStatus("info", "List cleared. Files already saved to GitHub or to this browser were not touched.");
  });

  nodes.ghSave.addEventListener("click", () => {
    saveSettings(githubSettings());
    githubStatus("Settings saved in this browser.");
  });
  nodes.ghForget.addEventListener("click", () => {
    clearToken();
    nodes.ghToken.value = "";
    githubStatus("Token forgotten.");
  });
  nodes.ghTest.addEventListener("click", async () => {
    githubStatus("Contacting GitHub…");
    try {
      const settings = githubSettings();
      const info = await verifyToken(settings);
      saveSettings(settings);
      githubStatus(
        `Connected as ${info.login} — ${info.repo}${info.private ? " (private)" : ""}. ` +
          (info.canWrite ? "Write access confirmed." : "This token cannot write; a push permission is needed."),
      );
    } catch (error) {
      githubStatus(String((error && error.message) || error), "error");
    }
  });

  // Uploading for a class that has its own folder starts in that folder, so the
  // files land in the right place without having to remember the path.
  try {
    const catalog = await loadCourses();
    const course = await activeCourse(catalog);
    state.course = course;
    mountCoursePicker(catalog, { active: course.id });
    const folder = (course.paths || []).filter(Boolean)[0];
    if (folder && nodes.folder && nodes.folder.value === CONFIG.uploadFolder) nodes.folder.value = folder;
    state.privatePaths = catalog.courses.flatMap((candidate) => candidate.privatePaths || []);
    updatePrivateDestination();
  } catch (error) {
    console.warn(error.message);
  }

  renderFiles();
  renderDrafts();
  renderUploadSummary();
  loadProblems().catch(() => {});
}

main();
