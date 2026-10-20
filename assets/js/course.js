/**
 * Classes: this site teaches more than one course, one at a time.
 *
 * `data/courses.json` is the single source of truth — the build reads it to put
 * every notebook and exercise in a class, and the pages read it to fill the
 * picker in the header. The choice lives in localStorage (`pypractice:course`),
 * and `?course=fin400` overrides it for one page (that is what shared links use).
 */

import { PATHS } from "./config.js";
import { el, lsGet, lsSet, param } from "./util.js";

const KEY = "course";

let cache = null;

/** Load the class list once. Throws with a readable message when it is missing. */
export async function loadCourses({ force = false } = {}) {
  if (cache && !force) return cache;
  let response;
  try {
    response = await fetch(PATHS.courses, { cache: "no-cache" });
  } catch (error) {
    throw new Error(`Could not read the class list (${(error && error.message) || error}).`);
  }
  if (!response.ok) {
    throw new Error(
      `Could not read ${PATHS.courses} (HTTP ${response.status}). Run "python3 tools/build_index.py".`,
    );
  }
  const data = await response.json();
  const courses = (data.courses || []).map((course) => ({
    id: String(course.id),
    code: String(course.code || course.id),
    title: String(course.title || ""),
    summary: String(course.summary || ""),
    paths: course.paths || [],
    // Folders the class keeps off the site (answer keys, model solutions).
    privatePaths: (course.private_paths || []).map(String),
    solutions: course.solutions === "hidden" ? "hidden" : "shown",
    phases: (course.phases || []).map((phase) => ({
      id: String(phase.id),
      title: String(phase.title || phase.id),
      summary: String(phase.summary || ""),
      groups: phase.groups || [],
    })),
    groups: course.groups || {},
    totals: course.totals || {},
  }));
  cache = { default: String(data.default || (courses[0] || {}).id || "default"), courses };
  return cache;
}

/** The class a page should show: ?course= first, then the remembered choice. */
export function activeCourseId(catalog) {
  const requested = param("course");
  if (requested && catalog.courses.some((course) => course.id === requested)) return requested;
  const remembered = lsGet(KEY, "");
  if (remembered && catalog.courses.some((course) => course.id === remembered)) return remembered;
  return catalog.default;
}

/** The course object a page shows. */
export async function activeCourse(catalog) {
  const id = activeCourseId(catalog);
  return catalog.courses.find((course) => course.id === id) || catalog.courses[0];
}

export function courseById(catalog, id) {
  return catalog.courses.find((course) => course.id === id) || null;
}

export function setActiveCourse(id) {
  lsSet(KEY, id);
}

/** Pick a class and reload the page with it, so every list starts clean. */
export function switchCourse(id) {
  setActiveCourse(id);
  const url = new URL(location.href);
  url.searchParams.set("course", id);
  location.assign(url.href);
}

/** "ACC 525 · Python for accounting", or just the code when it has no name. */
export function courseLabel(course) {
  return course && course.title ? `${course.code} · ${course.title}` : (course || {}).code || "Class";
}

/**
 * Everything that belongs to one class. An uploaded-but-not-yet-pushed notebook
 * has no class in the index yet, so it is shown in every class: it sits in this
 * browser, waiting to be filed.
 */
export function matchesCourse(item, courseId) {
  if (!item || !item.course) return true;
  return item.course === courseId;
}

/** The notebook manifest narrowed to one class, groups and all. */
export function filterManifest(manifest, courseId) {
  const notebooks = (manifest.notebooks || []).filter((entry) => matchesCourse(entry, courseId));
  const scripts = (manifest.scripts || []).filter((entry) => matchesCourse(entry, courseId));
  const keep = new Set([...notebooks.map((n) => n.path), ...scripts.map((s) => s.path)]);
  const groups = (manifest.groups || [])
    .map((group) => ({
      ...group,
      notebooks: (group.notebooks || []).filter((path) => keep.has(path)),
      scripts: (group.scripts || []).filter((path) => keep.has(path)),
    }))
    .filter((group) => group.notebooks.length || group.scripts.length);
  return { ...manifest, notebooks, scripts, groups };
}

/** The exercises of one class. */
export function filterProblems(problems, courseId) {
  return (problems || []).filter((problem) => matchesCourse(problem, courseId));
}

/** The glossary terms of one class (`courses: ["fin400"]` opts a term out elsewhere). */
export function filterGlossary(glossary, courseId) {
  if (!glossary) return glossary;
  return {
    ...glossary,
    entries: (glossary.entries || []).filter((entry) => !entry.courses || entry.courses.includes(courseId)),
  };
}

/** The phases (halves) of a class, in the order data/courses.json lists them. */
export function phasesOf(course) {
  return (course && course.phases) || [];
}

export function phaseOf(course, phaseId) {
  return phasesOf(course).find((phase) => phase.id === phaseId) || null;
}

/** The phase title a problem's badge should show. */
export function phaseLabel(course, phaseId) {
  const phase = phaseOf(course, phaseId);
  return phase ? phase.title : "";
}

/** The display title of a notebook group ("Part 2 — Notebooks, …"). */
export function groupTitle(course, name) {
  const groups = (course && course.groups) || {};
  if (groups[name] && groups[name].title) return groups[name].title;
  return name;
}

/**
 * Group exercises by the half of the course they belong to. Fallbacks keep an
 * exercise visible even when it is not filed under any phase yet.
 */
export function groupProblemsByPhase(problems, course) {
  const phases = phasesOf(course);
  const buckets = new Map();
  phases.forEach((phase, index) => {
    buckets.set(phase.id, { key: phase.id, label: phase.title, summary: phase.summary, order: index, problems: [] });
  });
  const rest = [];
  for (const problem of problems) {
    const bucket = problem.phase ? buckets.get(problem.phase) : null;
    if (bucket) bucket.problems.push(problem);
    else rest.push(problem);
  }
  if (rest.length) {
    const fallback = { key: "__other__", label: "Not filed under a half yet", summary: "", order: 900, problems: rest };
    buckets.set(fallback.key, fallback);
  }
  return [...buckets.values()].filter((bucket) => bucket.problems.length > 0);
}

/** What to say when a class has no material yet, instead of an empty list. */
export function emptyMaterialNotice(course) {
  if (!course) return "No material yet.";
  const folders = (course.paths || []).filter(Boolean).join("/, ") + (course.paths && course.paths.length ? "/" : "");
  return folders
    ? `No notebooks for ${course.code} yet. Put them in the repository under ${folders} and run "python3 tools/build_index.py".`
    : `No notebooks for ${course.code} yet. Add .ipynb files to the repository and run "python3 tools/build_index.py".`;
}

/* ---------------------------------------------------------------- picker --- */

/**
 * Fill the class picker in the header (every page has `#course-picker`).
 * Choosing a class stores it and reloads the page with `?course=`, so no stale
 * filter from the other class can survive the switch.
 */
export function mountCoursePicker(catalog, { active = null } = {}) {
  const host = document.getElementById("course-picker");
  if (!host || !catalog || !catalog.courses.length) return null;
  const current = active || activeCourseId(catalog);

  host.innerHTML = "";
  const label = el("label", { class: "class-picker" });
  label.append(el("span", { class: "lbl", text: "Class" }));
  const select = el("select", { "aria-label": "Which class are you working in?" });
  for (const course of catalog.courses) {
    select.append(
      el("option", {
        value: course.id,
        text: courseLabel(course),
        selected: course.id === current,
      }),
    );
  }
  select.addEventListener("change", () => switchCourse(select.value));
  label.append(select);
  host.append(label);

  if (catalog.courses.length > 1) {
    const other = catalog.courses.find((course) => course.id !== current);
    if (other) {
      // Keep the page and its parameters (a notebook, an exercise), only change
      // the class: a plain "?course=…" link would drop them.
      const url = new URL(location.href);
      url.searchParams.set("course", other.id);
      host.append(
        el("a", {
          class: "class-switch",
          href: `?${url.searchParams.toString()}`,
          text: `Switch to ${other.code}`,
          title: `Open this page for ${courseLabel(other)}`,
        }),
      );
    }
  }
  return { select, active: current };
}

/** A one-line banner naming the class, used at the top of the content pages. */
export function courseChip(course) {
  if (!course) return null;
  const wrap = el("div", { class: "course-chip" });
  wrap.append(el("span", { class: "badge", text: course.code }));
  if (course.title) wrap.append(el("span", { class: "small muted", text: course.title }));
  if (course.solutions === "hidden") {
    wrap.append(
      el("span", {
        class: "badge warned",
        text: "solutions hidden",
        title: "This class shows hints only; reference answers are not published.",
      }),
    );
  }
  return wrap;
}
