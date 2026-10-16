/**
 * "Which assignment is this from?"
 *
 * One place that answers it for every exercise and glossary term: an exercise
 * knows the notebook it came from (`problem.notebook`), and the generated
 * manifest knows that notebook's track and part. Pages use this to sort, group
 * and filter by assignment instead of showing one long unsorted list.
 */

import { loadNotebookManifest } from "./notebooks.js";
import { plainText } from "./util.js";

/** Key used for exercises that are not tied to a notebook. */
export const GENERAL_KEY = "__general__";

const cache = { loaded: false, byPath: new Map() };

/** "Introduction to Python (Part 1) - Class Exercise Solutions" -> "Intro to Python · Part 1" */
function shortLabel(entry) {
  const title = plainText(entry.title || "");
  const group = entry.group || "";
  const part = /\(Part\s*(\d+)\)/i.exec(title);
  if (group && part) return `${group} · Part ${part[1]}`;
  const short = title.replace(/\s*-\s*(class\s+)?exercise\s+solutions?/i, "").trim();
  if (group && short && !short.toLowerCase().startsWith(group.toLowerCase())) return `${group} · ${short.slice(0, 48)}`;
  return (short || group || title || entry.path || "Assignment").slice(0, 60);
}

/** Load the notebook manifest once and remember it. Never throws. */
export async function loadAssignments() {
  if (cache.loaded) return cache;
  let manifest = { notebooks: [] };
  try {
    manifest = await loadNotebookManifest();
  } catch {
    manifest = { notebooks: [] };
  }
  for (const notebook of manifest.notebooks || []) {
    const title = plainText(notebook.title || notebook.path);
    // Course order, not alphabetical: Intro 1–4 first, then Data Analysis 1–6.
    // group_order holds the track (Intro = 1, Data Analysis = 2) and `part` the
    // section number inside it, so multiplying keeps the tracks apart.
    const track = Number(notebook.group_order ?? 900);
    const part = Number(notebook.part ?? 999);
    cache.byPath.set(notebook.path, {
      key: notebook.path,
      path: notebook.path,
      group: notebook.group || "Notebooks",
      order: track * 1000 + part,
      title,
      label: notebook.label || shortLabel({ title, group: notebook.group, path: notebook.path }),
      kind: notebook.kind || "notebook",
      exercises: (notebook.exercises || []).length,
    });
  }
  cache.loaded = true;
  return cache;
}

/** The assignment a notebook path belongs to, or the general bucket. */
export function assignmentForPath(path) {
  if (!path) return generalAssignment();
  const known = cache.byPath.get(String(path).replace(/\\/g, "/"));
  if (known) return known;
  const name = String(path).replace(/\\/g, "/").split("/").pop() || String(path);
  return {
    key: String(path),
    path: String(path),
    group: "Other material",
    order: 900000,
    title: name,
    label: name.replace(/\.ipynb$/i, "").slice(0, 60),
    kind: "unknown",
    exercises: 0,
  };
}

/** The bucket for exercises that came from the site rather than a notebook. */
export function generalAssignment() {
  return {
    key: GENERAL_KEY,
    path: null,
    group: "Site exercises",
    order: 950000,
    title: "Not from a notebook",
    label: "General exercises",
    kind: "general",
    exercises: 0,
  };
}

/** The assignment of one exercise. */
export function assignmentForProblem(problem) {
  return assignmentForPath(problem && problem.notebook);
}

/** Every assignment that the given exercises belong to, in course order. */
export function assignmentsForProblems(problems) {
  const seen = new Map();
  for (const problem of problems) {
    const assignment = assignmentForProblem(problem);
    if (!seen.has(assignment.key)) seen.set(assignment.key, { ...assignment, count: 0, solved: 0 });
    seen.get(assignment.key).count += 1;
  }
  return [...seen.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * Group exercises by assignment (then by topic), which is the default order on
 * the practice page: the list reads like the course does.
 */
export function groupProblems(problems, mode = "assignment") {
  const buckets = new Map();
  const keyOf = (problem) => {
    if (mode === "topic") {
      const topics = problem.topics || [];
      return topics.length ? topics[0] : "No topic";
    }
    return assignmentForProblem(problem).key;
  };
  const metaOf = (problem) => {
    if (mode === "topic") return { key: keyOf(problem), label: keyOf(problem), order: 500000, group: "Topic" };
    return assignmentForProblem(problem);
  };

  for (const problem of problems) {
    const key = keyOf(problem);
    if (!buckets.has(key)) buckets.set(key, { ...metaOf(problem), problems: [] });
    buckets.get(key).problems.push(problem);
  }

  return [...buckets.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}
