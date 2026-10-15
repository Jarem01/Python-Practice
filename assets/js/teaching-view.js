/**
 * teaching/view.html — renders one `.ipynb` file in the browser.
 * The notebook itself is never modified; this only displays it.
 */

import { CONFIG, siteUrl } from "./config.js";
import { loadNotebookFile, loadNotebookManifest, jupyterLiteUrl, renderNotebook, renderToc } from "./notebooks.js";
import { loadProblems } from "./problems.js";
import { el, escapeHtml, param, pluralize } from "./util.js";

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

  const order = (manifest.notebooks || []).map((n) => n.path);
  const index = order.indexOf(entry.path);
  const previous = index > 0 ? manifest.notebooks[index - 1] : null;
  const next = index >= 0 && index < manifest.notebooks.length - 1 ? manifest.notebooks[index + 1] : null;

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
      if (problem && !related.some((p) => p.id === problem.id)) related.push(problem);
    }
  }

  headerHost.innerHTML = "";
  headerHost.append(el("h1", { text: entry.title, style: "margin-bottom:.2rem" }));
  const meta = [
    entry.group,
    pluralize(entry.cell_count, "cell"),
    `${entry.code_cell_count} code`,
    entry.kernel,
    entry.exercises?.length ? pluralize(entry.exercises.length, "exercise") : "no exercises detected",
  ].filter(Boolean);
  headerHost.append(el("p", { class: "small muted", text: meta.join(" · ") }));
  if (entry.summary) headerHost.append(el("p", { class: "small", text: entry.summary }));

  const actions = el("div", { class: "btn-row", style: "margin-top:.6rem" });
  actions.append(el("a", { class: "btn small ghost", href: siteUrl(entry.path), text: "Open the raw .ipynb", target: "_blank", rel: "noopener noreferrer" }));
  const lite = jupyterLiteUrl(entry.path, CONFIG);
  if (lite) {
    actions.append(el("a", { class: "btn small", href: lite, text: "Open in JupyterLite", target: "_blank", rel: "noopener noreferrer" }));
  } else {
    actions.append(
      el("span", {
        class: "tiny muted",
        html: 'Set <code>jupyterLiteUrl</code> and <code>rawBaseUrl</code> in <code>assets/js/config.js</code> to add a “run this in the browser” button.',
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
      `<p class="small">Notebook files can only be fetched over HTTP. Start a local server in the repository root, e.g. <code>python3 -m http.server 8000</code>, then open <code>http://localhost:8000/teaching/view.html?nb=${encodeURIComponent(entry.path)}</code>.</p></div>`;
    return;
  }

  const rendered = renderNotebook(notebook, { glossaryBase: siteUrl("glossary.html") });
  host.innerHTML = "";
  host.append(rendered.element);
  renderToc(tocHost, rendered.headings);

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
