/**
 * practice/index.html — browse, filter and pick exercises.
 *
 * The list is organized the way the course is: by assignment (the notebook the
 * exercise came from), then by topic, with filters for type, topic, difficulty
 * and progress. Everything a learner picked is mirrored in the URL, so a list
 * view can be bookmarked or shared.
 */

import { assignmentForProblem, assignmentsForProblems, groupProblems, loadAssignments } from "./assignments.js";
import { el, escapeHtml, param, TYPE_LABELS, TYPE_ORDER } from "./util.js";
import { filterProblems, loadProblems, problemStats, problemStatus, uniqueValues } from "./problems.js";

const state = {
  problems: [],
  assignments: [],
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

function problemItem(problem) {
  const status = problemStatus(problem);
  const item = el("li");
  const link = el("a", { class: "pitem", href: `exercise.html?id=${encodeURIComponent(problem.id)}` });
  const left = el("div");
  left.append(el("div", { class: "ptitle", html: `${escapeHtml(problem.title)}${problem.draft ? ' <span class="badge">draft</span>' : ""}` }));

  const bits = [
    (problem.topics || []).join(" · "),
    (problem.hints || []).length ? `${problem.hints.length} hints` : "",
  ].filter(Boolean);
  if (state.filters.group !== "assignment") bits.push(assignmentForProblem(problem).label);
  left.append(el("div", { class: "tiny muted", text: bits.join(" · ") }));
  link.append(left);

  const meta = el("div", { class: "pmeta" });
  meta.append(el("span", { class: `badge type-${problem.type}`, text: TYPE_LABELS[problem.type] || problem.type }));
  meta.append(el("span", { class: "badge", text: problem.difficulty || "easy" }));
  if (status !== "new") meta.append(el("span", { class: `badge ${status}`, text: status }));
  link.append(meta);

  item.append(link);
  return item;
}

function problemListElement(problems) {
  const list = el("ul", { class: "problem-list" });
  for (const problem of problems) list.append(problemItem(problem));
  return list;
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
    container.append(problemListElement(filtered));
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
    container.append(problemListElement(ordered));
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
