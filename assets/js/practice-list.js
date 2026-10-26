/**
 * practice/index.html — browse, filter and pick exercises.
 *
 * The list is organized the way the course is: by assignment (the notebook the
 * exercise came from), then by topic, with filters for type, topic, difficulty
 * and progress. Everything a learner picked is mirrored in the URL, so a list
 * view can be bookmarked or shared.
 */

import { assignmentForProblem, assignmentsForProblems, groupProblems, loadAssignments } from "./assignments.js";
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

const state = {
  problems: [],
  assignments: [],
  course: null,
  catalog: null,
  view: getViewMode(VIEW_KEY),
  filters: { assignment: "", type: "", topic: "", difficulty: "", status: "", query: "", group: "assignment", sort: "curated", phase: "" },
};

const DIFFICULTIES = ["easy", "medium", "hard"];
const STATUSES = [
  ["", "all"],
  ["new", "not started"],
  ["attempted", "in progress"],
  ["solved", "solved"],
];
function groupings() {
  const options = [
    ["assignment", "by assignment"],
    ["topic", "by topic"],
  ];
  // A class with two halves (FIN 400: .py functions, then notebooks) reads
  // best split that way, so that grouping is offered whenever it applies.
  if (phasesOf(state.course).length > 1) options.push(["phase", "by half of the course"]);
  options.push(["none", "one list"]);
  return options;
}

function setQueryParams() {
  const url = new URL(location.href);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    const isDefault = (key === "sort" && value === "curated") || (key === "group" && value === "assignment");
    if (value && !isDefault) params.set(key, value);
  }
  url.search = params.toString();
  history.replaceState(null, "", url);
}

function pillRow(options, current, onPick) {
  const row = el("div", { class: "pill-row" });
  for (const [value, label] of options) {
    const pill = el("button", { class: "pill", type: "button", text: label, "aria-pressed": String(current === value), "data-value": value });
    pill.addEventListener("click", () => {
      onPick(value);
      [...row.children].forEach((child) => child.setAttribute("aria-pressed", String(child.dataset.value === value)));
    });
    row.append(pill);
  }
  return row;
}

function renderFilters(container) {
  container.innerHTML = "";

  const search = el("input", {
    type: "search",
    placeholder: "Search titles, text and hints…",
    value: state.filters.query,
    style: "min-width:16em",
  });
  search.addEventListener("input", () => {
    state.filters.query = search.value;
    setQueryParams();
    renderList();
  });
  container.append(el("div", { class: "group" }, [el("span", { class: "lbl", text: "Search" }), search]));

  const assignmentSelect = el("select");
  assignmentSelect.append(el("option", { value: "", text: "all assignments", selected: state.filters.assignment === "" }));
  for (const assignment of state.assignments) {
    assignmentSelect.append(
      el("option", {
        value: assignment.key,
        text: `${assignment.label} (${assignment.count})`,
        selected: state.filters.assignment === assignment.key,
      }),
    );
  }
  assignmentSelect.addEventListener("change", () => {
    state.filters.assignment = assignmentSelect.value;
    setQueryParams();
    renderList();
  });
  container.append(el("div", { class: "group" }, [el("span", { class: "lbl", text: "Assignment" }), assignmentSelect]));

  const topics = ["", ...uniqueValues(state.problems, "topics")];
  const topicSelect = el("select");
  for (const topic of topics) {
    topicSelect.append(el("option", { value: topic, text: topic || "all topics", selected: state.filters.topic === topic }));
  }
  topicSelect.addEventListener("change", () => {
    state.filters.topic = topicSelect.value;
    setQueryParams();
    renderList();
  });
  container.append(el("div", { class: "group" }, [el("span", { class: "lbl", text: "Topic" }), topicSelect]));

  container.append(
    el("div", { class: "group" }, [
      el("span", { class: "lbl", text: "Type" }),
      pillRow([["", "all"], ...TYPE_ORDER.map((t) => [t, TYPE_LABELS[t]])], state.filters.type, (value) => {
        state.filters.type = value;
        setQueryParams();
        renderList();
      }),
    ]),
  );

  container.append(
    el("div", { class: "group" }, [
      el("span", { class: "lbl", text: "Difficulty" }),
      pillRow([["", "all"], ...DIFFICULTIES.map((d) => [d, d])], state.filters.difficulty, (value) => {
        state.filters.difficulty = value;
        setQueryParams();
        renderList();
      }),
    ]),
  );

  // The halves of the class, offered as a filter when the class has them.
  const phases = phasesOf(state.course);
  if (phases.length > 1) {
    container.append(
      el("div", { class: "group" }, [
        el("span", { class: "lbl", text: "Half" }),
        pillRow(
          [["", "both halves"], ...phases.map((phase) => [phase.id, phase.title.split("—")[0].trim() || phase.title])],
          state.filters.phase,
          (value) => {
            state.filters.phase = value;
            setQueryParams();
            renderList();
          },
        ),
      ]),
    );
  }

  const statusCounts = problemStats(state.problems);
  container.append(
    el("div", { class: "group" }, [
      el("span", { class: "lbl", text: "Progress" }),
      pillRow(
        STATUSES.map(([value, label]) => {
          const count =
            value === "solved"
              ? statusCounts.solved
              : value === "attempted"
                ? statusCounts.attempted
                : value === "new"
                  ? statusCounts.total - statusCounts.solved - statusCounts.attempted
                  : statusCounts.total;
          return [value, `${label} (${count})`];
        }),
        state.filters.status,
        (value) => {
          state.filters.status = value;
          setQueryParams();
          renderList();
        },
      ),
    ]),
  );

  container.append(
    el("div", { class: "group" }, [
      el("span", { class: "lbl", text: "Group" }),
      pillRow(groupings(), state.filters.group, (value) => {
        state.filters.group = value;
        setQueryParams();
        renderList();
      }),
    ]),
  );

  // Cards or a table — the same exercises either way.
  container.append(
    viewToggle(state.view, (value) => {
      state.view = value;
      setViewMode(VIEW_KEY, value);
      renderList();
    }),
  );

  const sort = el("select");
  for (const [value, label] of [
    ["curated", "course order (1, 2, 3…)"],
    ["title", "title"],
    ["difficulty", "difficulty"],
    ["type", "type"],
    ["progress", "least progress first"],
  ]) {
    sort.append(el("option", { value, text: label, selected: state.filters.sort === value }));
  }
  sort.addEventListener("change", () => {
    state.filters.sort = sort.value;
    setQueryParams();
    renderList();
  });
  container.append(el("div", { class: "group" }, [el("span", { class: "lbl", text: "Sort" }), sort]));

  const clear = el("button", { class: "btn small ghost", type: "button", text: "Clear filters" });
  clear.addEventListener("click", () => {
    state.filters = { assignment: "", type: "", topic: "", difficulty: "", status: "", query: "", group: "assignment", sort: "curated", phase: "" };
    setQueryParams();
    renderFilters(container);
    renderList();
  });
  container.append(clear);
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
      // "Assignment order": the notebook the exercise came from, then its topic,
      // then the order it appears in inside that notebook. A numbered track
      // (FIN 400's Practice 1 … 19) carries its own `order`, so it reads in the
      // order the class works through it instead of alphabetically.
      return list.sort((a, b) => {
        const left = assignmentForProblem(a);
        const right = assignmentForProblem(b);
        return (
          // An explicit track position wins over everything, so a numbered set
          // is read 1, 2, 3 … even when its exercises come from several
          // notebooks. Exercises without one keep the assignment order.
          (a.order ?? UNORDERED) - (b.order ?? UNORDERED) ||
          left.order - right.order ||
          left.label.localeCompare(right.label) ||
          (a.topics || []).join().localeCompare((b.topics || []).join()) ||
          byTitle(a, b)
        );
      });
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
  if (state.filters.group !== "assignment") bits.push(assignmentForProblem(problem).label);
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
    "<thead><tr><th>Exercise</th><th>Assignment</th><th>Topic</th><th>Type</th><th>Level</th><th>Status</th></tr></thead>";
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

function renderList() {
  const container = document.getElementById("problem-list");
  const summary = document.getElementById("list-summary");
  const matched = filterProblems(state.problems, state.filters).filter(
    (problem) => !state.filters.phase || problem.phase === state.filters.phase,
  );
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
    if (state.filters.group === "assignment" && bucket.group && bucket.group !== bucket.label) {
      heading.append(el("span", { class: "badge", text: bucket.group }));
    }
    container.append(heading);
    if (state.filters.group === "phase" && bucket.summary) {
      container.append(el("p", { class: "small muted", text: bucket.summary, style: "margin:0 0 .6rem" }));
    }
    // Sequential inside a group: the numbered track first, then topic and
    // title. Sorting on the title alone would put Practice 10 before Practice 2.
    const ordered =
      state.filters.sort === "curated"
        ? [...bucket.problems].sort(
            (a, b) =>
              byOrder(a, b) ||
              (a.topics || []).join().localeCompare((b.topics || []).join()) ||
              byTitle(a, b),
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
    state.catalog = await loadCourses();
    state.course = await activeCourse(state.catalog);
    mountCoursePicker(state.catalog, { active: state.course.id });
    state.problems = inCourse(state.problems, state.course.id);
  } catch (error) {
    state.course = null;
    console.warn(error.message);
  }

  await loadAssignments();
  state.assignments = assignmentsForProblems(state.problems);

  for (const key of ["assignment", "type", "topic", "difficulty", "status", "query", "group", "sort", "phase"]) {
    const value = param(key);
    if (value) state.filters[key] = value;
  }

  // A class whose exercises are not tied to notebooks yet (FIN 400 while its
  // class files are still being added) would otherwise show one anonymous
  // "General exercises" group. Its halves are the useful grouping there.
  if (!param("group") && state.course && phasesOf(state.course).length > 1 && state.assignments.length <= 1) {
    state.filters.group = "phase";
  }

  // A class with numbered tracks reads as one sequence — Practice 1, 2, 3 … —
  // so it starts as a single list. The pills still group it by module or half.
  if (!param("group") && state.problems.some((problem) => problem.order != null)) {
    state.filters.group = "none";
  }
  renderFilters(filtersHost);
  renderList();
  const scope = state.course ? `${state.course.code} · ` : "";
  document.getElementById("count-badge").textContent =
    `${scope}${state.problems.length} exercises in ${state.assignments.length} assignments`;
  if (state.course) document.title = `Practice — ${state.course.code}`;
}

main();
