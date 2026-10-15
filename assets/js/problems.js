/**
 * Problem store: loads the generated bundle (problems/index.json), merges any
 * drafts kept in localStorage, and offers filtering/statistics helpers.
 */

import { PATHS } from "./config.js";
import { getProgress, lsDel, lsGet, lsSet, normalizeOutput } from "./util.js";

const DRAFTS_KEY = "drafts";

let bundleCache = null;
let loadError = null;

export function lastLoadError() {
  return loadError;
}

/** Load the generated bundle. Throws with a helpful message when unavailable. */
export async function loadBundle({ force = false } = {}) {
  if (bundleCache && !force) return bundleCache;
  loadError = null;
  try {
    const response = await fetch(PATHS.problems, { cache: force ? "reload" : "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    bundleCache = data;
    return data;
  } catch (error) {
    loadError = error;
    throw new Error(
      `Could not read ${PATHS.problems} (${(error && error.message) || error}).\n` +
        `If you opened this page straight from disk, start a local server first: python3 -m http.server 8000`,
    );
  }
}

/** All problems: the generated ones plus local drafts (drafts win on id clashes). */
export async function loadProblems({ includeDrafts = true, force = false } = {}) {
  const bundle = await loadBundle({ force });
  const problems = [...(bundle.problems || [])];
  if (!includeDrafts) return problems;
  for (const draft of loadDrafts()) {
    const index = problems.findIndex((p) => p.id === draft.id);
    if (index >= 0) problems[index] = draft;
    else problems.push(draft);
  }
  return problems;
}

export async function getProblem(id) {
  const problems = await loadProblems();
  return problems.find((p) => p.id === id) || null;
}

/* ----------------------------------------------------------------- drafts -- */

export function loadDrafts() {
  const drafts = lsGet(DRAFTS_KEY, []);
  return Array.isArray(drafts) ? drafts : [];
}

export function saveDraft(problem) {
  const drafts = loadDrafts();
  const index = drafts.findIndex((d) => d.id === problem.id);
  const record = { ...problem, draft: true };
  if (index >= 0) drafts[index] = record;
  else drafts.push(record);
  lsSet(DRAFTS_KEY, drafts);
  return record;
}

export function deleteDraft(id) {
  lsSet(DRAFTS_KEY, loadDrafts().filter((d) => d.id !== id));
}

export function clearDrafts() {
  lsDel(DRAFTS_KEY);
}

export function isDraft(problem) {
  return Boolean(problem && problem.draft);
}

/* -------------------------------------------------------------- filtering -- */

export function problemStatus(problem) {
  const record = getProgress()[problem.id];
  if (!record) return "new";
  return record.status === "solved" ? "solved" : "attempted";
}

export function uniqueValues(problems, key) {
  if (key === "topics") {
    const set = new Set();
    problems.forEach((p) => (p.topics || []).forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }
  return [...new Set(problems.map((p) => p[key]).filter(Boolean))].sort();
}

export function filterProblems(problems, filters = {}) {
  const { type = "", topic = "", difficulty = "", status = "", query = "" } = filters;
  const needle = normalizeOutput(query, { ignoreWhitespace: true }).toLowerCase();
  return problems.filter((problem) => {
    if (type && problem.type !== type) return false;
    if (difficulty && (problem.difficulty || "easy") !== difficulty) return false;
    if (topic && !(problem.topics || []).includes(topic)) return false;
    if (status && problemStatus(problem) !== status) return false;
    if (needle) {
      const haystack = [
        problem.title,
        problem.id,
        problem.prompt,
        (problem.topics || []).join(" "),
        (problem.hints || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function problemStats(problems) {
  const progress = getProgress();
  const solved = problems.filter((p) => (progress[p.id] || {}).status === "solved").length;
  const attempted = problems.filter((p) => (progress[p.id] || {}).status === "attempted").length;
  return {
    total: problems.length,
    solved,
    attempted,
    remaining: problems.length - solved,
    percent: problems.length ? Math.round((solved / problems.length) * 100) : 0,
  };
}

export function problemsByIds(problems, ids) {
  const wanted = new Set(ids || []);
  return problems.filter((p) => wanted.has(p.id));
}

/** Last-attempt metadata stored while solving (kept in the shared progress record). */
export function savedAttempt(id) {
  return getProgress()[id] || null;
}
