/**
 * learning/index.html — every notebook, in course order (Intro 1–4, then
 * Data Analysis 1–6), with the exercises and practice links found in each one.
 * The list can be shown as cards or as a table.
 */

import { CONFIG } from "./config.js";
import { loadNotebookManifest, renderNotebookList } from "./notebooks.js";
import { loadProblems } from "./problems.js";
import { escapeHtml, getViewMode, pluralize, setViewMode, TYPE_LABELS, viewToggle } from "./util.js";

const VIEW_KEY = "learning";

async function main() {
  const host = document.getElementById("notebooks");
  const summaryHost = document.getElementById("learning-summary");
  const viewBar = document.getElementById("view-bar");

  let manifest = null;
  try {
    manifest = await loadNotebookManifest();
  } catch (error) {
    host.innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  let problems = [];
  try {
    problems = await loadProblems();
  } catch {
    /* the list still works without the practice links */
  }

  const totals = manifest.totals || {};
  const byType = {};
  for (const problem of problems) byType[problem.type] = (byType[problem.type] || 0) + 1;
  const withPractice = (manifest.notebooks || []).filter((n) => problems.some((p) => p.notebook === n.path)).length;

  summaryHost.innerHTML =
    `<div class="grid cols-3">` +
    `<div class="tile stat"><div class="tile-value">${totals.notebooks ?? 0}</div><div class="tile-label">notebooks</div></div>` +
    `<div class="tile stat"><div class="tile-value">${totals.exercises ?? 0}</div><div class="tile-label">exercises found in notebooks</div></div>` +
    `<div class="tile stat"><div class="tile-value">${problems.length}</div><div class="tile-label">practice exercises linked</div></div>` +
    `</div>` +
    `<p class="small muted">Index built ${escapeHtml(manifest.generated_at || "?")} by <code>tools/build_index.py</code> · ` +
    `${withPractice} of ${manifest.notebooks?.length ?? 0} sections have practice exercises · ` +
    `${Object.entries(byType)
      .map(([type, count]) => `${count} × ${TYPE_LABELS[type] || type}`)
      .join(", ")}</p>`;

  let view = getViewMode(VIEW_KEY);
  const draw = () => {
    renderNotebookList(host, manifest, { base: "../", problems, config: CONFIG, view });
  };

  viewBar.innerHTML = "";
  viewBar.append(viewToggle(view, (value) => {
    view = value;
    setViewMode(VIEW_KEY, value);
    draw();
  }));

  draw();

  const topicHost = document.getElementById("topics");
  const topics = Object.entries(manifest.topics || {}).filter(([, bucket]) => bucket.problems?.length);
  if (topics.length) {
    const parts = topics.map(
      ([name, bucket]) =>
        `<li><strong>${escapeHtml(name)}</strong> — ${pluralize(bucket.problems.length, "exercise")}` +
        (bucket.notebooks?.length ? `, ${pluralize(bucket.notebooks.length, "notebook")}` : "") +
        ` · <a href="../practice/index.html?topic=${encodeURIComponent(name)}">practice</a></li>`,
    );
    topicHost.innerHTML = `<ul class="small">${parts.join("")}</ul>`;
  } else {
    topicHost.innerHTML = '<p class="small muted">No topics yet — add a <code>topics</code> list to your problems.</p>';
  }
}

main();
