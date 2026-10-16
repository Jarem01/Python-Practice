/**
 * Learning section: reads the generated notebook manifest (data/notebooks.json)
 * and fetches the raw .ipynb files. A notebook is opened by
 * assets/js/notebook-runner.js, which turns every cell into a runnable one; the
 * original .ipynb files are never modified.
 */

import { PATHS, siteUrl } from "./config.js";
import { getUpload, uploadsGroup } from "./uploads.js";
import { el, escapeHtml, pluralize, slugify } from "./util.js";

let manifestCache = null;

/**
 * Add the material saved in this browser (upload.html → “Save to this browser”)
 * to the generated manifest, so a notebook can be opened and run before it has
 * been pushed to the repository. The generated entries win: once a file is in
 * the repository, the built index is the source of truth for it.
 */
function withBrowserUploads(manifest) {
  const fragment = uploadsGroup((manifest.notebooks || []).map((entry) => entry.path));
  if (!fragment) return manifest;
  const totals = manifest.totals || {};
  return {
    ...manifest,
    notebooks: [...(manifest.notebooks || []), ...fragment.entries],
    groups: [...fragment.groups, ...(manifest.groups || [])],
    totals: { ...totals, notebooks: (totals.notebooks || 0) + fragment.entries.length },
  };
}

export async function loadNotebookManifest({ force = false } = {}) {
  if (!manifestCache || force) {
    const response = await fetch(PATHS.notebooks, { cache: force ? "reload" : "no-cache" });
    if (!response.ok) {
      throw new Error(
        `Could not read ${PATHS.notebooks} (HTTP ${response.status}). ` +
          `Run "python3 tools/build_index.py" and serve the folder over HTTP.`,
      );
    }
    manifestCache = await response.json();
  }
  // Only the built index is cached: what this browser has uploaded can change
  // while the page is open, so it is merged on every read.
  return withBrowserUploads(manifestCache);
}

export async function loadNotebookFile(path) {
  try {
    const response = await fetch(siteUrl(path), { cache: "no-cache" });
    if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status})`);
    return await response.json();
  } catch (error) {
    // A notebook uploaded in this browser has no file in the repository yet.
    const upload = getUpload(path);
    if (upload && upload.text) return JSON.parse(upload.text);
    throw error;
  }
}

/* ------------------------------------------------------------ rendering --- */

/**
 * Where a notebook opens. There is one view, and it is the runnable one; the
 * `anchor` jumps straight to an exercise inside it.
 */
export function notebookUrl(path, { base = "", anchor = "" } = {}) {
  const url = `${base}learning/view.html?nb=${encodeURIComponent(path)}`;
  return anchor ? `${url}#${anchor}` : url;
}

export function jupyterLiteUrl(path, { jupyterLiteUrl = "", rawBaseUrl = "" } = {}) {
  if (!jupyterLiteUrl || !rawBaseUrl) return "";
  const raw = `${rawBaseUrl.replace(/\/$/, "")}/${path}`;
  return `${jupyterLiteUrl}${jupyterLiteUrl.includes("?") ? "&" : "?"}fromURL=${encodeURIComponent(raw)}`;
}

/** The short course label ("Intro 2") — falls back to the group name. */
function labelOf(notebook) {
  return notebook.label || notebook.group || "";
}

/** The badges that say which course a notebook belongs to and where it lives. */
function notebookBadges(notebook) {
  const wrap = el("span", { class: "pill-row" });
  wrap.append(el("span", { class: "badge", text: labelOf(notebook) }));
  if (notebook.pending) {
    wrap.append(
      el("span", {
        class: "badge",
        text: "in this browser",
        title: "Uploaded and kept in this browser — push it to the repository to keep it",
      }),
    );
  }
  return wrap;
}

/** How many practice exercises came from this notebook. */
function practiceCount(notebook, problems) {
  return problems.filter((problem) => problem.notebook === notebook.path).length;
}

function dataFileCount(notebook) {
  return Object.keys(notebook.data_files || {}).length;
}

function notebookActions(notebook, { base, config, compact }) {
  const actions = el("div", { class: "btn-row small" });
  actions.append(
    el("a", {
      class: "btn small primary",
      href: notebookUrl(notebook.path, { base }),
      text: "Run",
      title: "Open it as a runnable notebook",
    }),
  );
  // A notebook that only exists in this browser has no file to link to, so the
  // raw-file and JupyterLite buttons would be dead ends.
  const lite = notebook.pending ? "" : jupyterLiteUrl(notebook.path, config);
  if (lite) {
    actions.append(el("a", { class: "btn small ghost", href: lite, text: "JupyterLite", target: "_blank", rel: "noopener noreferrer" }));
  }
  if (!compact && !notebook.pending) {
    actions.append(el("a", { class: "btn small ghost", href: siteUrl(notebook.path), text: ".ipynb", target: "_blank", rel: "noopener noreferrer" }));
  }
  return actions;
}

function practiceLine(notebook, problems, base, { compact = false } = {}) {
  const related = problems.filter((problem) => problem.notebook === notebook.path);
  if (!related.length) {
    return el("p", {
      class: "tiny muted",
      html: `No practice exercises for this section yet — <a href="${base}practice/index.html">browse the others</a>.`,
    });
  }
  const shown = related.slice(0, compact ? 3 : 4);
  return el("p", {
    class: "small",
    html:
      `<span class="muted">Practice: </span>` +
      shown.map((p) => `<a href="${base}practice/exercise.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>`).join(" · ") +
      (related.length > shown.length
        ? ` · <a href="${base}practice/index.html?assignment=${encodeURIComponent(notebook.path)}">more…</a>`
        : ""),
  });
}

/** One equal-height card, used in the grid layouts. */
function notebookTile(notebook, { base, problems, config, compact }) {
  const card = el("article", { class: "tile" });

  const head = el("div", { class: "row-between" });
  head.append(notebookBadges(notebook));
  const count = practiceCount(notebook, problems);
  head.append(
    el("span", {
      class: `badge${count ? " solved" : ""}`,
      text: count ? `${count} exercise${count === 1 ? "" : "s"}` : "no exercises",
    }),
  );
  card.append(head);

  card.append(el("h3", {}, [el("a", { href: notebookUrl(notebook.path, { base }), text: notebook.title })]));

  const metaBits = [
    pluralize(notebook.cell_count, "cell"),
    `${notebook.code_cell_count} code`,
    notebook.exercises?.length ? pluralize(notebook.exercises.length, "exercise") : "",
  ].filter(Boolean);
  card.append(el("p", { class: "tiny muted", text: metaBits.join(" · ") }));

  if (notebook.summary && !compact) card.append(el("p", { class: "small", text: notebook.summary }));

  if (notebook.exercises?.length) {
    card.append(
      el("ul", {
        class: "small",
        html: notebook.exercises
          .map(
            (exercise) =>
              `<li><a href="${notebookUrl(notebook.path, { base, anchor: exercise.anchor })}">${escapeHtml(exercise.title)}</a></li>`,
          )
          .join(""),
      }),
    );
  }

  card.append(practiceLine(notebook, problems, base, { compact }));
  const foot = el("div", { class: "tile-foot" });
  foot.append(notebookActions(notebook, { base, config, compact }));
  card.append(foot);
  return card;
}

/** The same list as a table, for scanning many notebooks at once. */
function notebookTable(members, { base, problems, config }) {
  const wrap = el("div");
  const table = el("table", { class: "data-table" });
  table.innerHTML =
    "<thead><tr><th>Assignment</th><th>Notebook</th><th>Cells</th><th>Exercises</th><th>Practice</th><th>Data files</th><th>Open</th></tr></thead>";
  const body = el("tbody");
  for (const notebook of members) {
    const count = practiceCount(notebook, problems);
    const row = el("tr");
    row.append(el("td", {}, [notebookBadges(notebook)]));
    row.append(el("td", { class: "t-title" }, [el("a", { href: notebookUrl(notebook.path, { base }), text: notebook.title })]));
    row.append(el("td", { class: "num", text: `${notebook.cell_count} (${notebook.code_cell_count} code)` }));
    row.append(el("td", { class: "num", text: String(notebook.exercises?.length || 0) }));
    row.append(el("td", { class: count ? "" : "muted", text: count ? String(count) : "none yet" }));
    row.append(el("td", { class: "num", text: String(dataFileCount(notebook)) }));
    const actions = el("td");
    actions.append(notebookActions(notebook, { base, config, compact: true }));
    row.append(actions);
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

/**
 * List every notebook with the exercises found inside it, grouped by part.
 * Used by index.html and learning/index.html. `view` is "tiles" or "table".
 */
export function renderNotebookList(container, manifest, options = {}) {
  const { base = "", problems = [], config = {}, emptyMessage = null, compact = false, view = "tiles" } = options;

  container.innerHTML = "";

  if (!manifest.notebooks?.length) {
    const notice = el("div", { class: "notice warn" });
    notice.innerHTML =
      `<p><strong>No notebooks found yet.</strong> Put your <code>.ipynb</code> files anywhere in this repository, ` +
      `then run:</p><pre><code>python3 tools/build_index.py</code></pre>` +
      `<p class="small">This page reads the generated file <code>data/notebooks.json</code>. ` +
      `Any <code>.ipynb</code> anywhere in the repository is picked up, including files you drop in ` +
      `through the <a href="${base}upload.html">Add material</a> page.</p>`;
    if (emptyMessage) notice.querySelector("p").textContent = emptyMessage;
    container.append(notice);
    return;
  }

  for (const group of manifest.groups || []) {
    const members = (group.notebooks || [])
      .map((path) => manifest.notebooks.find((n) => n.path === path))
      .filter(Boolean);
    if (!members.length) continue;

    const section = el("section", { class: "stack" });
    const heading = el("div", { class: "list-group" });
    heading.append(el("h2", { text: group.title || group.name, style: "border:0;margin:0;padding:0;font-size:1.35rem" }));
    heading.append(el("span", { class: "small muted", text: pluralize(members.length, "section") }));
    section.append(heading);

    if (view === "table") {
      section.append(notebookTable(members, { base, problems, config }));
    } else {
      const grid = el("div", { class: "grid cols-3" });
      for (const notebook of members) grid.append(notebookTile(notebook, { base, problems, config, compact }));
      section.append(grid);
    }
    container.append(section);
  }
}

/**
 * Fill the table of contents for a rendered notebook. Exercise headings are
 * marked, so the contents sidebar doubles as the exercise list.
 * @param {Array<{index:number,title:string,anchor:string}>} exercises
 */
export function renderToc(container, headings, { exercises = [] } = {}) {
  container.innerHTML = "";
  // The class notebooks label each task with "#### Exercise 3", so level 4 has to
  // be in the contents or a notebook shows a single entry.
  const relevant = headings.filter((h) => h.level <= 4);
  if (!relevant.length) {
    container.append(el("p", { class: "tiny muted", text: "No headings in this notebook." }));
    return;
  }
  const exerciseIds = new Set([...exercises.map((e) => e.anchor), ...exercises.map((e) => slugify(e.title))]);
  const list = el("ul");
  for (const heading of relevant) {
    // The heading id may carry a suffix (the exercise anchor is taken by the
    // group that holds the exercise), so the heading's own text is checked too.
    const isExercise = exerciseIds.has(heading.id) || exerciseIds.has(slugify(heading.text));
    list.append(
      el("li", { class: `lvl-${heading.level}${isExercise ? " toc-exercise" : ""}` }, [
        el("a", { href: `#${heading.id}`, text: heading.text }),
      ]),
    );
  }
  container.append(list);
}
