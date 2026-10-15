/**
 * teaching/index.html — every notebook, grouped by part, with the exercises
 * found inside each one.
 */

import { CONFIG } from "./config.js";
import { loadNotebookManifest, renderNotebookList } from "./notebooks.js";
import { loadProblems } from "./problems.js";
import { escapeHtml, pluralize, TYPE_LABELS } from "./util.js";

async function main() {
  const host = document.getElementById("notebooks");
  const summaryHost = document.getElementById("teaching-summary");

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

  summaryHost.innerHTML =
    `<div class="grid cols-3">` +
    `<div class="card center"><div style="font-size:1.5rem;font-weight:700">${totals.notebooks ?? 0}</div><div class="small muted">notebooks</div></div>` +
    `<div class="card center"><div style="font-size:1.5rem;font-weight:700">${totals.exercises ?? 0}</div><div class="small muted">exercises found in notebooks</div></div>` +
    `<div class="card center"><div style="font-size:1.5rem;font-weight:700">${problems.length}</div><div class="small muted">practice exercises linked</div></div>` +
    `</div>` +
    `<p class="small muted">Index built ${escapeHtml(manifest.generated_at || "?")} by <code>tools/build_index.py</code> · ` +
    `${Object.entries(byType)
      .map(([type, count]) => `${count} × ${TYPE_LABELS[type] || type}`)
      .join(", ")}</p>`;

  renderNotebookList(host, manifest, { base: "../", problems, config: CONFIG });

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
