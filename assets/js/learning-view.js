/**
 * learning/view.html — opens one `.ipynb` file as a runnable notebook in the
 * browser (assets/js/notebook-runner.js). The file on disk is never modified.
 */

import { dataFileHints, packageHints } from "./analyze.js";
import { CONFIG, siteUrl } from "./config.js";
import { loadCourses, mountCoursePicker } from "./course.js";
import { loadNotebookFile, loadNotebookManifest, jupyterLiteUrl, renderToc } from "./notebooks.js";
import { renderRunnableNotebook } from "./notebook-runner.js";
import { loadProblems } from "./problems.js";
import { listUploads } from "./uploads.js";
import { el, escapeHtml, param, pluralize } from "./util.js";

/** "2 data files", or nothing when the notebook needs no data. */
function dataFileCount(entry) {
  const count = Object.keys(entry.data_files || {}).length;
  return count ? pluralize(count, "data file") : "";
}

/** Every cell's source, joined — what the notebook's code refers to. */
function notebookSource(notebook) {
  return (notebook.cells || [])
    .map((cell) => {
      const source = cell.source ?? "";
      return Array.isArray(source) ? source.join("") : String(source);
    })
    .join("\n");
}

/**
 * A notebook that only exists in this browser has no generated index entry, so
 * what its code needs is read out of the code itself: the data files by the name
 * the notebook opens them (matched against the uploads), and the Python packages
 * by their imports.
 */
function dataFilesFromUploads(notebook) {
  const wanted = new Set(dataFileHints(notebookSource(notebook)));
  const files = {};
  for (const upload of listUploads()) {
    if (upload.kind === "notebook" || upload.kind === "script") continue;
    if (wanted.has(upload.name)) files[upload.name] = upload.path;
  }
  return files;
}

async function main() {
  const host = document.getElementById("notebook");
  const tocHost = document.getElementById("toc");
  const headerHost = document.getElementById("notebook-header");
  const path = param("nb");

  let manifest = null;
  try {
    manifest = await loadNotebookManifest();
  } catch (error) {
    host.innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  const entry = (manifest.notebooks || []).find((n) => n.path === path);
  if (!entry) {
    const options = (manifest.notebooks || [])
      .map((n) => `<li><a href="view.html?nb=${encodeURIComponent(n.path)}">${escapeHtml(n.title)}</a></li>`)
      .join("");
    host.innerHTML =
      `<div class="notice warn"><p><strong>Notebook not found:</strong> <code>${escapeHtml(path || "(none)")}</code></p>` +
      (options ? `<p class="small">Available notebooks:</p><ul class="small">${options}</ul>` : "") +
      `<p class="small">If you just added the file, run <code>python3 tools/build_index.py</code> and reload.</p></div>`;
    return;
  }

  document.title = `${entry.title} · ${manifest.root || "Python Practice"}`;

  // A notebook opened from a shared link should say which class it belongs to,
  // even when the header picker is remembering the other class.
  let course = null;
  try {
    const catalog = await loadCourses();
    course = catalog.courses.find((candidate) => candidate.id === entry.course) || null;
    if (course) mountCoursePicker(catalog, { active: course.id });
  } catch {
    course = null;
  }

  // Previous/next walk the notebooks of this class only: jumping from FIN 400
  // into an ACC 525 notebook would drop the learner in the wrong course.
  const siblings = (manifest.notebooks || []).filter((n) => !entry.course || n.course === entry.course);
  const index = siblings.findIndex((n) => n.path === entry.path);
  const previous = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  let problems = [];
  try {
    problems = await loadProblems();
  } catch {
    /* exercises are a bonus on this page */
  }
  const related = [];
  for (const topic of entry.matched_topics || []) {
    for (const id of manifest.topics?.[topic]?.problems || []) {
      const problem = problems.find((p) => p.id === id);
      if (!problem || related.some((p) => p.id === problem.id)) continue;
      if (entry.course && problem.course && problem.course !== entry.course) continue;
      related.push(problem);
    }
  }

  headerHost.innerHTML = "";
  headerHost.append(el("h1", { text: entry.title, style: "margin-bottom:.2rem" }));
  const meta = [
    course ? course.code : entry.group,
    course && entry.phase ? (course.phases || []).find((phase) => phase.id === entry.phase)?.title : "",
    entry.group,
    pluralize(entry.cell_count, "cell"),
    `${entry.code_cell_count} code`,
    entry.kernel,
    entry.exercises?.length ? pluralize(entry.exercises.length, "exercise") : "no exercises detected",
    dataFileCount(entry),
  ].filter(Boolean);
  headerHost.append(el("p", { class: "small muted", text: meta.join(" · ") }));
  if (entry.summary) headerHost.append(el("p", { class: "small", text: entry.summary }));

  if (entry.pending) {
    headerHost.append(
      el("div", {
        class: "notice warn small",
        html: "<p>This notebook was saved in this browser and is not in the repository yet. Its edits, outputs and exercises are kept here until you push it from the <a href=\"../upload.html\">Add material</a> page.</p>",
      }),
    );
  }

  const actions = el("div", { class: "btn-row", style: "margin-top:.6rem" });
  if (!entry.pending) {
    actions.append(el("a", { class: "btn small ghost", href: siteUrl(entry.path), text: "Open the raw .ipynb", target: "_blank", rel: "noopener noreferrer" }));
  }
  const lite = entry.pending ? "" : jupyterLiteUrl(entry.path, CONFIG);
  if (lite) {
    actions.append(el("a", { class: "btn small", href: lite, text: "Open in JupyterLite", target: "_blank", rel: "noopener noreferrer" }));
  } else if (!entry.pending) {
    actions.append(
      el("span", {
        class: "tiny muted",
        html: 'Set <code>jupyterLiteUrl</code> and <code>rawBaseUrl</code> in <code>assets/js/config.js</code> to offer this notebook in JupyterLite as well.',
      }),
    );
  }
  headerHost.append(actions);

  if (entry.exercises?.length) {
    const box = el("div", { class: "card", style: "margin-top:1rem" });
    box.append(el("h3", { text: `Exercises in this notebook (${entry.exercises.length})`, style: "margin-top:0" }));
    const list = el("ul", { class: "small" });
    for (const exercise of entry.exercises) {
      list.append(el("li", {}, [el("a", { href: `#${exercise.anchor}`, text: exercise.title })]));
    }
    box.append(list);
    headerHost.append(box);
  }

  if (related.length) {
    const box = el("div", { class: "card", style: "margin-top:1rem" });
    box.append(el("h3", { text: "Practice what this notebook teaches", style: "margin-top:0" }));
    const list = el("ul", { class: "small" });
    for (const problem of related) {
      list.append(
        el("li", {}, [
          el("a", { href: `../practice/exercise.html?id=${encodeURIComponent(problem.id)}`, text: problem.title }),
          el("span", { class: "tiny muted", text: ` — ${(problem.topics || []).join(", ")}` }),
        ]),
      );
    }
    box.append(list);
    headerHost.append(box);
  }

  let notebook;
  try {
    notebook = await loadNotebookFile(entry.path);
  } catch (error) {
    host.innerHTML =
      `<div class="notice bad"><p>${escapeHtml(error.message)}</p>` +
      `<p class="small">Notebook files can only be fetched over HTTP. Start a local server in the repository root, e.g. <code>python3 -m http.server 8000</code>, then open <code>http://localhost:8000/learning/view.html?nb=${encodeURIComponent(entry.path)}</code>.</p></div>`;
    return;
  }

  // There is one way to read a notebook here: the way it runs. Every cell is an
  // editor with a Run button, and the exercises inside it are boxed and grouped.
  const runner = renderRunnableNotebook(host, notebook, {
    path: entry.path,
    dataFiles: entry.data_files || (entry.pending ? dataFilesFromUploads(notebook) : {}),
    packages: entry.packages || (entry.pending ? packageHints(notebookSource(notebook)) : []),
    exercises: entry.exercises || [],
    glossaryBase: siteUrl("glossary.html"),
  });
  renderToc(tocHost, runner.headings, { exercises: entry.exercises || [] });

  const nav = el("div", { class: "row-between", style: "margin-top:2rem" });
  const left = el("div", { class: "btn-row" });
  left.append(el("a", { class: "btn ghost", href: "index.html", text: "All notebooks" }));
  if (previous) left.append(el("a", { class: "btn", href: `view.html?nb=${encodeURIComponent(previous.path)}`, text: `← ${previous.title}` }));
  nav.append(left);
  if (next) nav.append(el("a", { class: "btn", href: `view.html?nb=${encodeURIComponent(next.path)}`, text: `${next.title} →` }));
  document.getElementById("notebook-nav").append(nav);

  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView({ block: "start" });
  }
}

main();
