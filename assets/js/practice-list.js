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
  view: getViewMode(VIEW_KEY),
  filters: { assignment: "", type: "", topic: "", difficulty: "", status: "", query: "", group: "assignment", sort: "curated" },
};

const DIFFICULTIES = ["easy", "medium", "hard"];
const STATUSES = [
  ["", "all"],
  ["new", "not started"],
  ["attempted", "in progress"],
  ["solved", "solved"],
];
const GROUPINGS = [
  ["assignment", "by assignment"],
  ["topic", "by topic"],
  ["none", "one list"],
];

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
      pillRow(GROUPINGS, state.filters.group, (value) => {
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
    ["curated", "assignment order"],
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
    state.filters = { assignment: "", type: "", topic: "", difficulty: "", status: "", query: "", group: "assignment", sort: "curated" };
    setQueryParams();
    renderFilters(container);
    renderList();
  });
  container.append(clear);
}

function sortedProblems(problems) {
  const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
  const list = [...problems];
  switch (state.filters.sort) {
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case "difficulty":
      return list.sort(
        (a, b) => (difficultyOrder[a.difficulty] ?? 9) - (difficultyOrder[b.difficulty] ?? 9) || a.title.localeCompare(b.title),
      );
    case "type":
      return list.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.title.localeCompare(b.title));
    case "progress":
      return list.sort((a, b) => {
        const rank = { new: 0, attempted: 1, solved: 2 };
        return rank[problemStatus(a)] - rank[problemStatus(b)] || a.title.localeCompare(b.title);
      });
    default:
      // "Assignment order": the notebook the exercise came from, then its topic,
      // then the order it appears in inside that notebook.
      return list.sort((a, b) => {
        const left = assignmentForProblem(a);
        const right = assignmentForProblem(b);
        return (
          left.order - right.order ||
          left.label.localeCompare(right.label) ||
          (a.topics || []).join().localeCompare((b.topics || []).join()) ||
          a.title.localeCompare(b.title)
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
  const filtered = sortedProblems(filterProblems(state.problems, state.filters));
  const stats = problemStats(state.problems);

  summary.innerHTML =
    `<div class="row-between"><span class="small muted">${filtered.length} of ${stats.total} exercises shown</span>` +
    `<span class="small muted">${stats.solved} solved · ${stats.attempted} in progress</span></div>` +
    `<div class="progressbar" style="margin-top:.4rem"><span style="width:${stats.percent}%"></span></div>`;

  container.innerHTML = "";
  if (!filtered.length) {
    container.append(el("p", { class: "muted", text: "No exercise matches these filters." }));
    return;
  }

  if (state.filters.group === "none") {
    container.append(problemsView(filtered));
    return;
  }

  for (const bucket of groupProblems(filtered, state.filters.group)) {
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
    const ordered =
      state.filters.sort === "curated"
        ? [...bucket.problems].sort(
            (a, b) => (a.topics || []).join().localeCompare((b.topics || []).join()) || a.title.localeCompare(b.title),
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

  await loadAssignments();
  state.assignments = assignmentsForProblems(state.problems);

  for (const key of ["assignment", "type", "topic", "difficulty", "status", "query", "group", "sort"]) {
    const value = param(key);
    if (value) state.filters[key] = value;
  }
  renderFilters(filtersHost);
  renderList();
  document.getElementById("count-badge").textContent = `${state.problems.length} exercises in ${state.assignments.length} assignments`;
}

main();
