/**
 * practice/index.html — browse, filter and pick exercises.
 *
 * Exercises come in sets: FIN 400 keeps its homework (HW 1 … HW 19), its extra
 * practice and its lecture exercises apart, and ACC 525 files its exercises
 * under the notebook they came from. A set is what the "assignment" of an
 * exercise means, and the section is the larger track that set belongs to
 * ("Homework 1–19", "Extra practice", "Lecture notebooks").
 *
 * Everything a learner picked is mirrored in the URL, so a list view can be
 * bookmarked or shared.
 */

import { assignmentForProblem, groupProblems, loadAssignments } from "./assignments.js";
import {
  activeCourse,
  filterProblems as inCourse,
  groupProblemsByPhase,
  loadCourses,
  mountCoursePicker,
  phasesOf,
} from "./course.js";
import {
  el,
  escapeHtml,
  getViewMode,
  param,
  setViewMode,
  TYPE_LABELS,
  TYPE_ORDER,
  viewToggle,
} from "./util.js";
import { filterProblems, loadProblems, problemStats, problemStatus, uniqueValues } from "./problems.js";

const VIEW_KEY = "practice";
const LEVELS = ["easy", "medium", "hard"];
const STATUSES = [
  ["", "All"],
  ["new", "Not started"],
  ["attempted", "In progress"],
  ["solved", "Solved"],
];
const SORTS = [
  ["curated", "Course order (1, 2, 3…)"],
  ["title", "Title"],
  ["difficulty", "Level"],
  ["type", "Type"],
  ["progress", "Least progress first"],
];

function freshFilters() {
  return {
    section: "",
    assignment: "",
    type: "",
    topic: "",
    difficulty: "",
    status: "",
    query: "",
    group: "section",
    sort: "curated",
    phase: "",
  };
}

const state = {
  problems: [],
  course: null,
  view: getViewMode(VIEW_KEY),
  filters: freshFilters(),
};

/** The larger tracks in this class, in course order (Homework, Extra practice…). */
function sections() {
  const found = new Map();
  for (const problem of state.problems) {
    const assignment = assignmentForProblem(problem);
    const bucket = found.get(assignment.group);
    if (bucket) bucket.count += 1;
    else found.set(assignment.group, { label: assignment.group, order: assignment.order, count: 1 });
  }
  return [...found.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function groupings() {
  const options = [
    ["section", "Section"],
    ["assignment", "Set"],
    ["topic", "Topic"],
  ];
  // A class with two halves (FIN 400: .py functions, then notebooks) reads
  // best split that way too, so that grouping is offered whenever it applies.
  if (phasesOf(state.course).length > 1) options.push(["phase", "Half of the course"]);
  options.push(["none", "One list"]);
  return options;
}

function setQueryParams() {
  const url = new URL(location.href);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    const isDefault = (key === "sort" && value === "curated") || (key === "group" && value === "section");
    if (value && !isDefault) params.set(key, value);
  }
  url.search = params.toString();
  history.replaceState(null, "", url);
}

function pick(key, value) {
  state.filters[key] = value;
  setQueryParams();
  renderList();
}

/** One labeled control in the filter bar. */
function filterField(label, control, extra = "") {
  const wrap = el("label", { class: `filter-field${extra ? ` ${extra}` : ""}` });
  wrap.append(el("span", { class: "lbl", text: label }), control);
  return wrap;
}

/** A dropdown bound to one filter key. Every option carries its own value. */
function filterSelect(options, current, key) {
  const select = el("select");
  for (const [value, label] of options) {
    select.append(el("option", { value, text: label, selected: current === value }));
  }
  select.addEventListener("change", () => pick(key, select.value));
  return select;
}

function renderFilters(container) {
  container.innerHTML = "";

  const search = el("input", {
    type: "search",
    placeholder: "Search titles, hints and text…",
    value: state.filters.query,
  });
  search.addEventListener("input", () => pick("query", search.value));

  const bar = el("div", { class: "filter-bar" });
  bar.append(filterField("Search", search, "wide"));
  bar.append(
    filterField(
      "Section",
      filterSelect(
        [["", "All sections"], ...sections().map((section) => [section.label, `${section.label} (${section.count})`])],
        state.filters.section,
        "section",
      ),
    ),
  );
  bar.append(
    filterField(
      "Topic",
      filterSelect(
        [["", "All topics"], ...uniqueValues(state.problems, "topics").map((topic) => [topic, topic])],
        state.filters.topic,
        "topic",
      ),
    ),
  );
  bar.append(
    filterField(
      "Type",
      filterSelect([["", "All types"], ...TYPE_ORDER.map((type) => [type, TYPE_LABELS[type]])], state.filters.type, "type"),
    ),
  );
  bar.append(
    filterField(
      "Level",
      filterSelect([["", "All levels"], ...LEVELS.map((level) => [level, level])], state.filters.difficulty, "difficulty"),
    ),
  );
  bar.append(filterField("Progress", filterSelect(STATUSES, state.filters.status, "status")));
  bar.append(filterField("Group by", filterSelect(groupings(), state.filters.group, "group")));
  bar.append(filterField("Sort", filterSelect(SORTS, state.filters.sort, "sort")));
  container.append(bar);

  const actions = el("div", { class: "filter-actions" });
  actions.append(
    viewToggle(state.view, (value) => {
      state.view = value;
      setViewMode(VIEW_KEY, value);
      renderList();
    }),
  );
  const clear = el("button", { class: "btn small ghost", type: "button", text: "Clear filters" });
  clear.addEventListener("click", () => {
    state.filters = freshFilters();
    setQueryParams();
    renderFilters(container);
    renderList();
  });
  actions.append(clear);
  container.append(actions);
}

/**
 * Title order that reads numbers as numbers: "Practice 2" before "Practice 10".
 * Plain localeCompare compares character by character, which puts 10 right
 * after 1 and is exactly what a numbered track must not do.
 */
function byTitle(a, b) {
  return a.title.localeCompare(b.title, undefined, { numeric: true });
}

/** The track position a problem declares, if any (FIN 400's Practice 1 … 19). */
function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

/** Position of the set an exercise belongs to: homework first, then practice. */
function bySet(a, b) {
  return assignmentForProblem(a).order - assignmentForProblem(b).order;
}

/** Sort key for an exercise with no track position: after every numbered one. */
const UNORDERED = 100000;

function sortedProblems(problems) {
  const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
  const list = [...problems];
  switch (state.filters.sort) {
    case "title":
      return list.sort(byTitle);
    case "difficulty":
      return list.sort(
        (a, b) => (difficultyOrder[a.difficulty] ?? 9) - (difficultyOrder[b.difficulty] ?? 9) || byTitle(a, b),
      );
    case "type":
      return list.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || byTitle(a, b));
    case "progress":
      return list.sort((a, b) => {
        const rank = { new: 0, attempted: 1, solved: 2 };
        return rank[problemStatus(a)] - rank[problemStatus(b)] || byTitle(a, b);
      });
    default:
      // Course order: the set first (HW 1 … HW 19, then practice), then the
      // exercise's own track position, then its title read as a number.
      return list.sort(
        (a, b) => bySet(a, b) || (a.order ?? UNORDERED) - (b.order ?? UNORDERED) || byTitle(a, b),
      );
  }
}

function problemHref(problem) {
  return `exercise.html?id=${encodeURIComponent(problem.id)}`;
}

function problemBadges(problem) {
  const status = problemStatus(problem);
  const meta = el("div", { class: "pill-row" });
  meta.append(el("span", { class: `badge type-${problem.type}`, text: TYPE_LABELS[problem.type] || problem.type }));
  meta.append(el("span", { class: "badge", text: problem.difficulty || "easy" }));
  if (status !== "new") meta.append(el("span", { class: `badge ${status}`, text: status }));
  return meta;
}

function problemFacts(problem) {
  const bits = [(problem.topics || []).join(" · ")];
  if (state.filters.group !== "section" && state.filters.group !== "assignment") {
    bits.push(assignmentForProblem(problem).label);
  }
  if ((problem.hints || []).length) bits.push(`${problem.hints.length} hints`);
  return bits.filter(Boolean).join(" · ");
}

/** One exercise as a card, for the tile view. */
function problemTile(problem) {
  const tile = el("a", { class: "tile", href: problemHref(problem) });
  tile.append(el("h3", { html: `${escapeHtml(problem.title)}${problem.draft ? ' <span class="badge">draft</span>' : ""}` }));
  tile.append(el("p", { class: "tiny muted", text: problemFacts(problem) }));
  const foot = el("div", { class: "tile-foot" });
  foot.append(problemBadges(problem));
  tile.append(foot);
  return tile;
}

function tileGridElement(problems) {
  const grid = el("div", { class: "grid cols-3" });
  for (const problem of problems) grid.append(problemTile(problem));
  return grid;
}

function tableElement(problems) {
  const wrap = el("div");
  const table = el("table", { class: "data-table" });
  table.innerHTML =
    "<thead><tr><th>Exercise</th><th>Set</th><th>Topic</th><th>Type</th><th>Level</th><th>Status</th></tr></thead>";
  const body = el("tbody");
  for (const problem of problems) {
    const status = problemStatus(problem);
    const row = el("tr");
    row.append(
      el("td", { class: "t-title", html: `<a href="${problemHref(problem)}">${escapeHtml(problem.title)}</a>${problem.draft ? ' <span class="badge">draft</span>' : ""}` }),
    );
    row.append(el("td", { text: assignmentForProblem(problem).label }));
    row.append(el("td", { text: (problem.topics || []).join(", ") }));
    row.append(el("td", { text: TYPE_LABELS[problem.type] || problem.type }));
    row.append(el("td", { text: problem.difficulty || "easy" }));
    row.append(el("td", { text: status }));
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

/** The chosen view of a set of exercises. */
function problemsView(problems) {
  return state.view === "table" ? tableElement(problems) : tileGridElement(problems);
}

/** Group exercises by the larger track they belong to (Homework, Extra practice…). */
function sectionBuckets(problems) {
  const found = new Map();
  for (const problem of problems) {
    const assignment = assignmentForProblem(problem);
    const bucket = found.get(assignment.group);
    if (bucket) bucket.problems.push(problem);
    else found.set(assignment.group, { key: assignment.group, label: assignment.group, order: assignment.order, problems: [problem] });
  }
  return [...found.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function renderList() {
  const container = document.getElementById("problem-list");
  const summary = document.getElementById("list-summary");
  const matched = filterProblems(state.problems, state.filters)
    .filter((problem) => !state.filters.phase || problem.phase === state.filters.phase)
    .filter((problem) => !state.filters.section || assignmentForProblem(problem).group === state.filters.section);
  const filtered = sortedProblems(matched);
  const stats = problemStats(state.problems);

  summary.innerHTML =
    `<div class="row-between"><span class="small muted">${filtered.length} of ${stats.total} exercises shown</span>` +
    `<span class="small muted">${stats.solved} solved · ${stats.attempted} in progress</span></div>` +
    `<div class="progressbar" style="margin-top:.4rem"><span style="width:${stats.percent}%"></span></div>`;

  container.innerHTML = "";
  if (!filtered.length) {
    if (!state.problems.length && state.course) {
      container.append(
        el("div", {
          class: "notice warn",
          html:
            `<p><strong>No practice exercises for ${escapeHtml(state.course.code)} yet.</strong></p>` +
            `<p class="small">Add a problem file under <code>problems/</code> with ` +
            `<code>"course": "${escapeHtml(state.course.id)}"</code>, then run ` +
            `<code>python3 tools/build_index.py</code>. ` +
            `<a href="../learning/index.html">Browse this class's material</a>.</p>`,
        }),
      );
      return;
    }
    container.append(el("p", { class: "muted", text: "No exercise matches these filters." }));
    return;
  }

  if (state.filters.group === "none") {
    container.append(problemsView(filtered));
    return;
  }

  const buckets =
    state.filters.group === "phase"
      ? groupProblemsByPhase(filtered, state.course)
      : state.filters.group === "section"
        ? sectionBuckets(filtered)
        : groupProblems(filtered, state.filters.group);

  for (const bucket of buckets) {
    const heading = el("div", { class: "list-group" });
    heading.append(el("h3", { text: bucket.label }));
    heading.append(
      el("span", {
        class: "small muted",
        text: `${bucket.problems.length} exercise${bucket.problems.length === 1 ? "" : "s"}`,
      }),
    );
    if (state.filters.group === "section") {
      const sets = new Set(bucket.problems.map((problem) => assignmentForProblem(problem).key)).size;
      heading.append(el("span", { class: "badge", text: `${sets} set${sets === 1 ? "" : "s"}` }));
    } else if (state.filters.group === "assignment" && bucket.group && bucket.group !== bucket.label) {
      heading.append(el("span", { class: "badge", text: bucket.group }));
    }
    container.append(heading);
    if (state.filters.group === "phase" && bucket.summary) {
      container.append(el("p", { class: "small muted", text: bucket.summary, style: "margin:0 0 .6rem" }));
    }
    // Sequential inside a group: the set, then the numbered track, then title.
    const ordered =
      state.filters.sort === "curated"
        ? [...bucket.problems].sort(
            (a, b) => bySet(a, b) || byOrder(a, b) || byTitle(a, b),
          )
        : bucket.problems;
    container.append(problemsView(ordered));
  }
}

async function main() {
  const filtersHost = document.getElementById("filters");
  const listHost = document.getElementById("problem-list");
  try {
    state.problems = await loadProblems();
  } catch (error) {
    listHost.innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  // One class at a time: the list, its filters and its counts all belong to the
  // class picked in the header. Without data/courses.json everything is shown.
  try {
    const catalog = await loadCourses();
    state.course = await activeCourse(catalog);
    mountCoursePicker(catalog, { active: state.course.id });
    state.problems = inCourse(state.problems, state.course.id);
  } catch (error) {
    state.course = null;
    console.warn(error.message);
  }

  await loadAssignments();

  for (const key of ["section", "assignment", "type", "topic", "difficulty", "status", "query", "group", "sort", "phase"]) {
    const value = param(key);
    if (value) state.filters[key] = value;
  }

  renderFilters(filtersHost);
  renderList();
  const scope = state.course ? `${state.course.code} · ` : "";
  document.getElementById("count-badge").textContent =
    `${scope}${state.problems.length} exercises · ${sections().length} sections`;
  if (state.course) document.title = `Practice — ${state.course.code}`;
}

main();
