/**
 * Teaching section: reads the generated notebook manifest (data/notebooks.json),
 * fetches the raw .ipynb files and renders them in the browser. The original
 * notebooks are never modified — this only displays them.
 */

import { PATHS, siteUrl } from "./config.js";
import { el, escapeHtml, mdToHtml, pluralize, slugify } from "./util.js";

const EXERCISE_WORDS =
  /\b(exercise|exercises|task|tasks|assignment|practice|challenge|aufgabe|übung|opgave|oppgave|ödev|练习|习题|練習|問題|課題|연습)\b/i;

const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_RE, "");
}

let manifestCache = null;

export async function loadNotebookManifest({ force = false } = {}) {
  if (manifestCache && !force) return manifestCache;
  const response = await fetch(PATHS.notebooks, { cache: force ? "reload" : "no-cache" });
  if (!response.ok) {
    throw new Error(
      `Could not read ${PATHS.notebooks} (HTTP ${response.status}). ` +
        `Run "python3 tools/build_index.py" and serve the folder over HTTP.`,
    );
  }
  manifestCache = await response.json();
  return manifestCache;
}

export async function loadNotebookFile(path) {
  const response = await fetch(siteUrl(path), { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status})`);
  return response.json();
}

/* ------------------------------------------------------------ rendering --- */

function injectHeadingIds(html, usedIds) {
  const headings = [];
  const out = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_match, level, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    let id = slugify(text);
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    usedIds.add(id);
    headings.push({ level: Number(level), text, id });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { html: out, headings };
}

function sourceOf(cell) {
  const source = cell.source ?? "";
  return Array.isArray(source) ? source.join("") : String(source);
}

function imageOutput(data) {
  const raw = data["image/png"] ?? data["image/jpeg"];
  const mime = data["image/png"] ? "image/png" : "image/jpeg";
  const base64 = Array.isArray(raw) ? raw.join("") : String(raw ?? "");
  if (!base64) return null;
  return `data:${mime};base64,${base64.replace(/\n/g, "")}`;
}

function renderOutputs(cell, container) {
  for (const output of cell.outputs || []) {
    const kind = output.output_type;
    if (kind === "stream") {
      const text = Array.isArray(output.text) ? output.text.join("") : String(output.text ?? "");
      container.append(el("pre", { class: "out-stream", html: `<code>${escapeHtml(stripAnsi(text).replace(/\n$/, ""))}</code>` }));
      continue;
    }
    if (kind === "execute_result" || kind === "display_data") {
      const data = output.data || {};
      const image = imageOutput(data);
      if (data["text/plain"]) {
        const text = Array.isArray(data["text/plain"]) ? data["text/plain"].join("") : String(data["text/plain"]);
        container.append(el("pre", { html: `<code>${escapeHtml(stripAnsi(text).replace(/\n$/, ""))}</code>` }));
      } else if (image) {
        container.append(el("img", { class: "out-img", src: image, alt: "cell output" }));
      } else if (data["text/html"]) {
        container.append(el("div", { class: "small muted", text: "HTML output (shown as an image-free placeholder)" }));
      }
      continue;
    }
    if (kind === "error") {
      const trace = stripAnsi((output.traceback || []).join("\n") || `${output.ename}: ${output.evalue}`);
      container.append(el("pre", { class: "out-error", html: `<code>${escapeHtml(trace)}</code>` }));
    }
  }
}

/**
 * Render a parsed .ipynb document.
 * @returns {{element: HTMLElement, headings: Array, exerciseAnchors: Array}}
 */
export function renderNotebook(notebook, { glossaryBase = "glossary.html" } = {}) {
  const root = el("div", { class: "notebook" });
  const usedIds = new Set();
  const headings = [];
  const exerciseAnchors = [];
  let cellIndex = 0;
  let executionCount = 0;

  for (const cell of notebook.cells || []) {
    if (cell.cell_type === "markdown") {
      const source = sourceOf(cell);
      if (!source.trim()) {
        cellIndex++;
        continue;
      }
      const rendered = mdToHtml(source, { glossaryBase, headingIds: false });
      const withIds = injectHeadingIds(rendered.html, usedIds);
      headings.push(...withIds.headings);

      const firstHeading = withIds.headings[0];
      const isExercise = firstHeading && EXERCISE_WORDS.test(firstHeading.text);
      if (isExercise) exerciseAnchors.push({ id: firstHeading.id, title: firstHeading.text });

      const wrapper = el("div", { class: `cell md${isExercise ? " exercise-callout" : ""}` });
      wrapper.append(el("div", { html: withIds.html }));
      root.append(wrapper);
      cellIndex++;
      continue;
    }

    if (cell.cell_type === "code") {
      executionCount += 1;
      const code = sourceOf(cell).replace(/\n$/, "");
      const label = cell.execution_count ? `In [${cell.execution_count}]` : `In [ ]`;
      const cellEl = el("div", { class: "cell code" });
      cellEl.append(el("div", { class: "cell-tag", text: label }));
      cellEl.append(el("pre", { html: `<code>${escapeHtml(code)}</code>` }));
      const outputs = el("div", { class: "cell out" });
      renderOutputs(cell, outputs);
      if (outputs.childNodes.length) cellEl.append(outputs);
      root.append(cellEl);
      cellIndex++;
      continue;
    }

    // raw cells are shown as plain text so nothing is silently dropped
    const raw = sourceOf(cell);
    if (raw.trim()) root.append(el("pre", { html: `<code>${escapeHtml(raw)}</code>` }));
    cellIndex++;
  }

  if (!root.childNodes.length) {
    root.append(el("p", { class: "muted", text: "This notebook is empty." }));
  }
  return { element: root, headings, exerciseAnchors, cells: executionCount };
}

export function notebookUrl(path, { base = "", anchor = "" } = {}) {
  const url = `${base}teaching/view.html?nb=${encodeURIComponent(path)}`;
  return anchor ? `${url}#${anchor}` : url;
}

export function jupyterLiteUrl(path, { jupyterLiteUrl = "", rawBaseUrl = "" } = {}) {
  if (!jupyterLiteUrl || !rawBaseUrl) return "";
  const raw = `${rawBaseUrl.replace(/\/$/, "")}/${path}`;
  return `${jupyterLiteUrl}${jupyterLiteUrl.includes("?") ? "&" : "?"}fromURL=${encodeURIComponent(raw)}`;
}

/**
 * List every notebook with the exercises found inside it, grouped by part.
 * Used by both index.html and teaching/index.html.
 */
export function renderNotebookList(container, manifest, options = {}) {
  const {
    base = "",
    problems = [],
    config = {},
    emptyMessage = null,
    compact = false,
  } = options;

  const problemsByIdMap = new Map(problems.map((p) => [p.id, p]));
  container.innerHTML = "";

  if (!manifest.notebooks?.length) {
    const notice = el("div", { class: "notice warn" });
    notice.innerHTML =
      `<p><strong>No notebooks found yet.</strong> Put your <code>.ipynb</code> files anywhere in this repository, ` +
      `then run:</p><pre><code>python3 tools/build_index.py</code></pre>` +
      `<p class="small">This page reads the generated file <code>data/notebooks.json</code>. ` +
      `Any <code>.ipynb</code> anywhere in the repository is picked up, including files you drop in ` +
      `through the <a href="upload.html">Add material</a> page.</p>`;
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
    section.append(el("h2", { text: group.title || group.name }));

    const grid = el("div", { class: "grid cols-2" });
    for (const notebook of members) {
      const card = el("article", { class: "card" });

      const titleLink = el("a", { href: notebookUrl(notebook.path, { base }), text: notebook.title });
      card.append(el("h3", {}, [titleLink]));

      const metaBits = [
        pluralize(notebook.cell_count, "cell"),
        `${notebook.code_cell_count} code`,
        notebook.exercises?.length ? pluralize(notebook.exercises.length, "exercise") : "no exercises found",
      ];
      if (notebook.kernel) metaBits.push(notebook.kernel);
      card.append(el("p", { class: "tiny muted", text: metaBits.join(" · ") }));

      if (notebook.summary && !compact) {
        card.append(el("p", { class: "small", text: notebook.summary }));
      }

      if (notebook.exercises?.length) {
        const list = el("ul", { class: "small", html: notebook.exercises
          .map(
            (exercise) =>
              `<li><a href="${notebookUrl(notebook.path, { base, anchor: exercise.anchor })}">${escapeHtml(exercise.title)}</a></li>`,
          )
          .join("") });
        card.append(list);
      }

      const topics = notebook.matched_topics || [];
      const related = [];
      for (const topic of topics) {
        for (const id of manifest.topics?.[topic]?.problems || []) {
          const problem = problemsByIdMap.get(id);
          if (problem) related.push(problem);
        }
      }
      const uniqueRelated = [...new Map(related.map((p) => [p.id, p])).values()];

      const actions = el("div", { class: "btn-row small" });
      actions.append(el("a", { class: "btn small", href: notebookUrl(notebook.path, { base }), text: "Read" }));
      const lite = jupyterLiteUrl(notebook.path, config);
      if (lite) {
        actions.append(el("a", { class: "btn small", href: lite, text: "JupyterLite", target: "_blank", rel: "noopener noreferrer" }));
      }
      actions.append(el("a", { class: "btn small ghost", href: siteUrl(notebook.path), text: ".ipynb", target: "_blank", rel: "noopener noreferrer" }));
      card.append(actions);

      if (uniqueRelated.length) {
        card.append(
          el("p", {
            class: "small",
            html:
              `<span class="muted">Practice ${escapeHtml(topics.join(", "))}: </span>` +
              uniqueRelated
                .slice(0, 4)
                .map((p) => `<a href="${base}practice/exercise.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>`)
                .join(" · ") +
              (uniqueRelated.length > 4
                ? ` · <a href="${base}practice/index.html?topic=${encodeURIComponent(topics[0] || "")}">more…</a>`
                : ""),
          }),
        );
      }

      grid.append(card);
    }
    section.append(grid);
    container.append(section);
  }
}

/** Fill the table of contents for a rendered notebook. */
export function renderToc(container, headings, { base = "" } = {}) {
  container.innerHTML = "";
  // The class notebooks label each task with "#### Exercise 3", so level 4 has to
  // be in the contents or a notebook shows a single entry.
  const relevant = headings.filter((h) => h.level <= 4);
  if (!relevant.length) {
    container.append(el("p", { class: "tiny muted", text: "No headings in this notebook." }));
    return;
  }
  const list = el("ul");
  for (const heading of relevant) {
    list.append(
      el("li", { class: `lvl-${heading.level}` }, [
        el("a", { href: `#${heading.id}`, text: heading.text }),
      ]),
    );
  }
  container.append(list);
}
