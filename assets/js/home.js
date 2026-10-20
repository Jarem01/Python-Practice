/**
 * index.html — landing page: overall counts, the learning overview (notebooks
 * with their exercises) and a recommended next exercise.
 */

import { CONFIG } from "./config.js";
import {
  activeCourse,
  filterGlossary,
  filterManifest,
  filterProblems as inCourse,
  loadCourses,
  mountCoursePicker,
  phasesOf,
} from "./course.js";
import { el, escapeHtml, getViewMode, setViewMode, TYPE_LABELS, TYPE_ORDER, viewToggle } from "./util.js";
import { loadGlossary } from "./glossary.js";
import { loadNotebookManifest, renderNotebookList } from "./notebooks.js";
import { loadProblems, problemStats, problemStatus } from "./problems.js";

/**
 * The class itself, at the top of the page: what it is, its two halves, and how
 * much practice is waiting in each. This is the "which half am I in?" view that
 * a two-half class like FIN 400 needs.
 */
function renderCourseHero(course, problems) {
  const host = document.getElementById("course-hero");
  if (!host || !course) return;
  const phases = phasesOf(course);
  const parts = [];

  parts.push('<div class="card">');
  parts.push('<div class="course-chip">');
  parts.push(`<span class="badge">${escapeHtml(course.code)}</span>`);
  if (course.title) parts.push(`<span class="small muted">${escapeHtml(course.title)}</span>`);
  if (course.solutions === "hidden") {
    parts.push('<span class="badge warned" title="Hints are offered; reference answers are not published.">solutions hidden</span>');
  }
  parts.push("</div>");
  if (course.summary) parts.push(`<p>${escapeHtml(course.summary)}</p>`);

  if (phases.length) {
    parts.push('<div class="grid cols-3">');
    for (const phase of phases) {
      const own = problems.filter((problem) => problem.phase === phase.id);
      const solved = own.filter((problem) => problemStatus(problem) === "solved").length;
      const href = `practice/index.html?group=phase&phase=${encodeURIComponent(phase.id)}`;
      parts.push(
        `<a class="tile" href="${href}">` +
          `<div class="row-between"><h3 style="margin:0;font-size:1.02rem">${escapeHtml(phase.title)}</h3>` +
          `<span class="badge${solved ? " solved" : ""}">${own.length} exercise${own.length === 1 ? "" : "s"}</span></div>` +
          (phase.summary ? `<p class="small muted" style="margin:.4rem 0 .3rem">${escapeHtml(phase.summary)}</p>` : "") +
          `<div class="tiny muted">${solved} solved</div></a>`,
      );
    }
    parts.push("</div>");
  }
  parts.push("</div>");
  host.innerHTML = parts.join("");
}

function renderStats(problems, manifest, glossary) {
  const host = document.getElementById("stats");
  const stats = problemStats(problems);
  const notebooks = manifest?.notebooks || [];
  const notebookExercises = notebooks.reduce((total, entry) => total + (entry.exercises?.length || 0), 0);
  const cards = [
    ["Notebooks", notebooks.length, "learning/"],
    ["Notebook exercises", notebookExercises, "learning/"],
    ["Practice exercises", stats.total, "practice/"],
    ["Glossary terms", glossary?.entries?.length ?? 0, "glossary.html"],
  ];
  host.innerHTML = cards
    .map(
      ([label, value, href]) =>
        `<a class="tile stat" href="${href}">` +
        `<div class="tile-value">${value}</div><div class="tile-label">${escapeHtml(label)}</div></a>`,
    )
    .join("");
}

/**
 * Per-section coverage: which assignments have practice exercises, and how far
 * along each one is. This is the answer to "is there practice for every
 * section?" without having to open each one.
 */
function renderCoverage(problems, manifest) {
  const host = document.getElementById("coverage");
  if (!host) return;
  if (!manifest?.notebooks?.length) {
    host.innerHTML =
      '<h3 style="margin:0">Practice coverage by section</h3>' +
      '<p class="small muted" style="margin:.4rem 0 0">This class has no notebooks in the repository yet, so there is nothing to cover.</p>';
    return;
  }
  const rows = manifest.notebooks.map((notebook) => {
    const own = problems.filter((problem) => problem.notebook === notebook.path);
    const solved = own.filter((problem) => problemStatus(problem) === "solved").length;
    return { notebook, total: own.length, solved };
  });
  const missing = rows.filter((row) => row.total === 0).length;
  host.innerHTML =
    `<div class="row-between"><h3 style="margin:0">Practice coverage by section</h3>` +
    `<span class="badge${missing ? " attempted" : " solved"}">${missing ? `${missing} section${missing === 1 ? "" : "s"} without exercises` : "every section has exercises"}</span></div>` +
    `<p class="small muted" style="margin:.4rem 0 .7rem">Each row is one class section, in course order.</p>` +
    `<table class="data-table"><thead><tr><th>Section</th><th>Notebook</th>` +
    `<th>Practice exercises</th><th>Solved</th><th>Progress</th></tr></thead><tbody>` +
    rows
      .map(({ notebook, total, solved }) => {
        const percent = total ? Math.round((solved / total) * 100) : 0;
        return (
          `<tr><td><span class="badge">${escapeHtml(notebook.label || notebook.group || "")}</span></td>` +
          `<td class="t-title"><a href="learning/view.html?nb=${encodeURIComponent(notebook.path)}">${escapeHtml(notebook.title)}</a></td>` +
          `<td class="num">${total ? total : "<span class=\"muted\">none yet</span>"}</td>` +
          `<td class="num">${solved}</td>` +
          `<td style="min-width:8rem"><div class="progressbar"><span style="width:${percent}%"></span></div></td></tr>`
        );
      })
      .join("") +
    `</tbody></table>`;
}

function renderProgress(problems) {
  const host = document.getElementById("progress");
  const stats = problemStats(problems);
  host.innerHTML =
    `<div class="row-between"><strong>${stats.solved} of ${stats.total} exercises solved</strong><span class="small muted">${stats.percent}%</span></div>` +
    `<div class="progressbar" style="margin-top:.5rem"><span style="width:${stats.percent}%"></span></div>` +
    (stats.attempted ? `<p class="small muted" style="margin:.5rem 0 0">${stats.attempted} in progress</p>` : "");
}

const TYPE_DESCRIPTIONS = {
  fix_the_code: "Broken code that must be repaired — run it, read the error, fix it.",
  fill_in_blank: "Code with gaps; each blank is checked and the finished program is run.",
  predict_output: "Read a program and type the output it will produce.",
  write_from_scratch: "Write the whole solution, with step-by-step hints or a line budget.",
};

/** The four exercise types, as tiles or as one table. */
function renderTypeCards(problems, view) {
  const host = document.getElementById("type-cards");
  host.className = view === "table" ? "" : "grid cols-3";
  host.innerHTML = "";

  const rows = TYPE_ORDER.map((type) => {
    const list = problems.filter((p) => p.type === type);
    return { type, total: list.length, solved: list.filter((p) => problemStatus(p) === "solved").length };
  });

  if (view === "table") {
    const table = el("table", { class: "data-table" });
    table.innerHTML =
      "<thead><tr><th>Type</th><th>Exercises</th><th>Solved</th><th>What it asks you to do</th><th>Practice</th></tr></thead>" +
      "<tbody>" +
      rows
        .map(
          (row) =>
            `<tr><td><span class="badge type-${row.type}">${TYPE_LABELS[row.type]}</span></td>` +
            `<td class="num">${row.total}</td><td class="num">${row.solved}</td>` +
            `<td class="small">${escapeHtml(TYPE_DESCRIPTIONS[row.type])}</td>` +
            `<td><a class="btn small" href="practice/index.html?type=${row.type}">Practice</a></td></tr>`,
        )
        .join("") +
      "</tbody>";
    host.append(table);
    return;
  }

  for (const row of rows) {
    const card = el("a", { class: "tile", href: `practice/index.html?type=${row.type}` });
    card.innerHTML =
      `<div class="row-between"><h3 style="margin:0;font-size:1.02rem">${TYPE_LABELS[row.type]}</h3><span class="badge type-${row.type}">${row.total}</span></div>` +
      `<p class="small muted" style="margin:.4rem 0 .3rem">${escapeHtml(TYPE_DESCRIPTIONS[row.type])}</p>` +
      `<div class="tiny muted">${row.solved} solved</div>`;
    host.append(card);
  }
}

function renderRecommendation(problems) {
  const host = document.getElementById("recommended");
  const inProgress = problems.filter((p) => problemStatus(p) === "attempted");
  const fresh = problems.filter((p) => problemStatus(p) === "new");
  const pick = inProgress[0] || fresh[0] || problems[0];
  if (!pick) {
    host.textContent = "No exercises yet — run tools/build_index.py after adding problems/ files.";
    return;
  }
  host.innerHTML =
    `<p class="small muted" style="margin:0 0 .3rem">${inProgress.length ? "Continue where you left off" : fresh.length ? "Start here" : "Revisit"}</p>` +
    `<p style="margin:0 0 .5rem"><a href="practice/exercise.html?id=${encodeURIComponent(pick.id)}"><strong>${escapeHtml(pick.title)}</strong></a> ` +
    `<span class="badge type-${pick.type}">${TYPE_LABELS[pick.type]}</span></p>` +
    `<p class="small muted" style="margin:0">${escapeHtml((pick.topics || []).join(" · "))}</p>`;
}

/**
 * The README is not one of the files the publishing workflow copies to the site
 * (it ships the pages and the material, not the Markdown), so on the deployed
 * site the relative link would 404. Point it at the rendered copy on GitHub
 * instead; a checkout that has no repository configured keeps the local link.
 */
function pointReadmeLink() {
  const link = document.getElementById("readme-link");
  if (!link || !CONFIG.githubRepo) return;
  link.href = `https://github.com/${CONFIG.githubRepo}#readme`;
}

async function main() {
  pointReadmeLink();
  const problemsHost = document.getElementById("problem-count");
  let problems = [];
  let manifest = null;
  let glossary = null;
  let course = null;

  // Which class this page is showing. Without data/courses.json the page still
  // works: it just treats all the material as one class.
  try {
    const catalog = await loadCourses();
    course = await activeCourse(catalog);
    mountCoursePicker(catalog, { active: course.id });
    if (course) document.title = `${course.code} — Python Practice`;
  } catch (error) {
    course = null;
    console.warn(error.message);
  }

  try {
    problems = await loadProblems();
  } catch (error) {
    document.getElementById("warnings").innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
  }
  try {
    manifest = await loadNotebookManifest();
  } catch (error) {
    document.getElementById("warnings").insertAdjacentHTML("beforeend", `<div class="notice warn"><p>${escapeHtml(error.message)}</p></div>`);
  }
  try {
    glossary = await loadGlossary();
  } catch (error) {
    document.getElementById("warnings").insertAdjacentHTML("beforeend", `<div class="notice warn"><p>${escapeHtml(error.message)}</p></div>`);
  }

  if (course) {
    problems = inCourse(problems, course.id);
    if (manifest) manifest = filterManifest(manifest, course.id);
    if (glossary) glossary = filterGlossary(glossary, course.id);
  }

  if (course) renderCourseHero(course, problems);

  const blurb = document.getElementById("learning-blurb");
  if (blurb && course) {
    const phases = phasesOf(course).map((phase) => phase.title).join(", then ");
    blurb.innerHTML =
      `<strong>${escapeHtml(course.code)}</strong> in order${phases ? ` — ${escapeHtml(phases)}` : ""} — with the exercises ` +
      `found inside each section. <strong>Run</strong> opens a notebook as a live, editable notebook in the browser ` +
      `(like Jupyter), with every exercise inside it boxed so you can jump straight to the one you want.`;
  }

  if (problems.length) {
    if (problemsHost) problemsHost.textContent = `${problems.length} exercises`;
    renderStats(problems, manifest, glossary);
    renderCoverage(problems, manifest);
    renderProgress(problems);

    // Tiles or table, remembered like every other list on the site.
    const typeBar = document.getElementById("type-view-bar");
    let typeView = getViewMode("types");
    const drawTypes = () => renderTypeCards(problems, typeView);
    if (typeBar) {
      typeBar.append(
        viewToggle(typeView, (value) => {
          typeView = value;
          setViewMode("types", value);
          drawTypes();
        }),
      );
    }
    drawTypes();
    renderRecommendation(problems);
  } else {
    document.getElementById("main-cards").classList.add("hidden");
  }

  const notebookHost = document.getElementById("notebooks");
  const viewBar = document.getElementById("view-bar");
  if (manifest) {
    let view = getViewMode("learning");
    const draw = () =>
      renderNotebookList(notebookHost, manifest, {
        base: "",
        problems,
        config: CONFIG,
        view,
        emptyMessage: course
          ? `No notebooks for ${course.code} yet. Add them under ${(course.paths || []).filter(Boolean).join("/") || "the repository"}/ and re-run python3 tools/build_index.py.`
          : undefined,
      });
    if (viewBar) {
      viewBar.append(
        viewToggle(view, (value) => {
          view = value;
          setViewMode("learning", value);
          draw();
        }),
      );
    }
    draw();
  } else {
    notebookHost.innerHTML =
      '<div class="notice warn"><p>The notebook index could not be loaded. Run <code>python3 tools/build_index.py</code> and serve this folder over HTTP.</p></div>';
  }
}

main();
