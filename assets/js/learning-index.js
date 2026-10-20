/**
 * learning/index.html — every notebook, in course order (Intro 1–4, then
 * Data Analysis 1–6), with the exercises and practice links found in each one.
 * The list can be shown as cards or as a table.
 */

import { CONFIG } from "./config.js";
import {
  activeCourse,
  emptyMaterialNotice,
  filterManifest,
  filterProblems as inCourse,
  loadCourses,
  mountCoursePicker,
} from "./course.js";
import { loadNotebookManifest, renderNotebookList } from "./notebooks.js";
import { loadProblems } from "./problems.js";
import { escapeHtml, getViewMode, pluralize, setViewMode, TYPE_LABELS, viewToggle } from "./util.js";

const VIEW_KEY = "learning";

async function main() {
  const host = document.getElementById("notebooks");
  const summaryHost = document.getElementById("learning-summary");
  const viewBar = document.getElementById("view-bar");

  let course = null;
  try {
    const catalog = await loadCourses();
    course = await activeCourse(catalog);
    mountCoursePicker(catalog, { active: course.id });
    if (course) document.title = `Learning — ${course.code}`;
  } catch (error) {
    course = null;
    console.warn(error.message);
  }

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

  if (course) {
    manifest = filterManifest(manifest, course.id);
    problems = inCourse(problems, course.id);
  }

  const notebooks = manifest.notebooks || [];
  const notebookExercises = notebooks.reduce((total, entry) => total + (entry.exercises?.length || 0), 0);
  const byType = {};
  for (const problem of problems) byType[problem.type] = (byType[problem.type] || 0) + 1;
  const withPractice = notebooks.filter((n) => problems.some((p) => p.notebook === n.path)).length;

  summaryHost.innerHTML =
    `<div class="grid cols-3">` +
    `<div class="tile stat"><div class="tile-value">${notebooks.length}</div><div class="tile-label">notebooks</div></div>` +
    `<div class="tile stat"><div class="tile-value">${notebookExercises}</div><div class="tile-label">exercises found in notebooks</div></div>` +
    `<div class="tile stat"><div class="tile-value">${problems.length}</div><div class="tile-label">practice exercises linked</div></div>` +
    `</div>` +
    `<p class="small muted">${course ? `<strong>${escapeHtml(course.code)}</strong> · ` : ""}Index built ${escapeHtml(manifest.generated_at || "?")} by <code>tools/build_index.py</code> · ` +
    `${withPractice} of ${notebooks.length} sections have practice exercises · ` +
    `${Object.entries(byType)
      .map(([type, count]) => `${count} × ${TYPE_LABELS[type] || type}`)
      .join(", ")}</p>`;

  let view = getViewMode(VIEW_KEY);
  const draw = () => {
    renderNotebookList(host, manifest, {
      base: "../",
      problems,
      config: CONFIG,
      view,
      emptyMessage: course ? emptyMaterialNotice(course) : undefined,
    });
  };

  viewBar.innerHTML = "";
  viewBar.append(viewToggle(view, (value) => {
    view = value;
    setViewMode(VIEW_KEY, value);
    draw();
  }));

  draw();

  const topicHost = document.getElementById("topics");
  const known = new Set(problems.map((problem) => problem.id));
  const knownPaths = new Set(notebooks.map((entry) => entry.path));
  const topics = Object.entries(manifest.topics || {})
    .map(([name, bucket]) => [
      name,
      {
        problems: (bucket.problems || []).filter((id) => known.has(id)),
        notebooks: (bucket.notebooks || []).filter((path) => knownPaths.has(path)),
      },
    ])
    .filter(([, bucket]) => bucket.problems.length || bucket.notebooks.length);
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
