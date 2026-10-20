/**
 * Classes: the registry, the filtering helpers and what the build produced.
 *
 * These are the rules the whole site depends on — one class per page, exercises
 * filed under a half, and no reference solution shipped for a class that hides
 * them — so they are tested against the real generated files, not fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));

const registry = await read("data/courses.json");
const bundle = await read("problems/index.json");
const manifest = await read("data/notebooks.json");

const {
  filterGlossary,
  filterManifest,
  filterProblems,
  groupProblemsByPhase,
  loadCourses,
  matchesCourse,
  phasesOf,
} = await import("../assets/js/course.js");

test("the registry names both classes and a default that exists", () => {
  const ids = registry.courses.map((course) => course.id);
  assert.deepEqual(ids.sort(), ["acc525", "fin400"]);
  assert.ok(ids.includes(registry.default), "the default class must be one of the classes");
  for (const course of registry.courses) {
    assert.ok(course.code, `${course.id} needs a code to show in the picker`);
    assert.ok(["shown", "hidden"].includes(course.solutions), `${course.id} has an unknown solution policy`);
    for (const phase of course.phases || []) {
      assert.ok(phase.id && phase.title, `${course.id} has a phase without an id or title`);
    }
  }
});

test("FIN 400 has two halves and hides its solutions", () => {
  const fin400 = registry.courses.find((course) => course.id === "fin400");
  assert.equal(fin400.solutions, "hidden");
  assert.deepEqual(fin400.phases.map((phase) => phase.id), ["bootcamp", "analysis"]);
  assert.ok(fin400.paths.includes("fin400"), "the class owns the fin400/ folder");
});

test("every exercise belongs to a class and to one of its halves", () => {
  const courses = new Map(registry.courses.map((course) => [course.id, course]));
  for (const problem of bundle.problems) {
    const course = courses.get(problem.course);
    assert.ok(course, `${problem.id} is in unknown class "${problem.course}"`);
    const phaseIds = (course.phases || []).map((phase) => phase.id);
    assert.ok(phaseIds.includes(problem.phase), `${problem.id} is in phase "${problem.phase}", not in ${phaseIds}`);
  }
});

test("no reference solution reaches the browser for FIN 400", () => {
  const fin400 = bundle.problems.filter((problem) => problem.course === "fin400");
  assert.ok(fin400.length >= 8, "the class ships its seed exercises");
  for (const problem of fin400) {
    assert.equal(problem.solutions, "hidden", `${problem.id} must say its solutions are hidden`);
    assert.equal(problem.solution, undefined, `${problem.id} still carries a solution`);
    assert.ok((problem.hints || []).length >= 2, `${problem.id} must offer hints instead of a solution`);
  }
  // ACC 525 is unchanged: its worked answers are part of how that class runs.
  const acc = bundle.problems.filter((problem) => problem.course === "acc525");
  assert.ok(acc.some((problem) => problem.solution), "ACC 525 still ships reference solutions");
  assert.ok(acc.every((problem) => problem.solutions === "shown"));
});

test("the manifest files notebooks per class, and FIN 400 is empty for now", () => {
  const fin400 = manifest.courses.find((course) => course.id === "fin400");
  assert.ok(fin400, "the manifest lists both classes");
  assert.equal(fin400.totals.problems, 8);
  assert.equal(fin400.totals.notebooks, 0);
  assert.ok(manifest.notebooks.every((entry) => entry.course === "acc525"));
});

test("filtering keeps one class and drops the other", () => {
  const fin = filterProblems(bundle.problems, "fin400");
  assert.equal(fin.length, 8);
  assert.ok(fin.every((problem) => problem.course === "fin400"));
  assert.equal(filterProblems(bundle.problems, "acc525").length, bundle.count - 8);

  const scaled = filterManifest(manifest, "fin400");
  assert.equal(scaled.notebooks.length, 0);
  assert.equal(scaled.groups.length, 0, "no empty group is left behind");

  const accManifest = filterManifest(manifest, "acc525");
  assert.equal(accManifest.notebooks.length, manifest.notebooks.length);
  assert.ok(accManifest.groups.every((group) => group.notebooks.length > 0));

  // An uploaded-but-unfiled notebook has no class yet and must stay visible.
  assert.equal(matchesCourse({ path: "materials/new.ipynb" }, "fin400"), true);
  assert.equal(matchesCourse({ course: "acc525" }, "fin400"), false);
});

test("glossary terms can opt out of a class", () => {
  const glossary = { entries: [{ slug: "a" }, { slug: "b", courses: ["fin400"] }] };
  assert.deepEqual(filterGlossary(glossary, "acc525").entries.map((e) => e.slug), ["a"]);
  assert.deepEqual(filterGlossary(glossary, "fin400").entries.map((e) => e.slug), ["a", "b"]);
});

test("exercises group by the half of the course they belong to", () => {
  const fin400 = registry.courses.find((course) => course.id === "fin400");
  const problems = filterProblems(bundle.problems, "fin400");
  const buckets = groupProblemsByPhase(problems, fin400);
  assert.deepEqual(buckets.map((bucket) => bucket.key), ["bootcamp", "analysis"]);
  assert.deepEqual(buckets.map((bucket) => bucket.problems.length), [4, 4]);
  assert.equal(phasesOf(fin400).length, 2);

  // An exercise filed under no known half still appears, at the end.
  const stray = groupProblemsByPhase([{ id: "x", phase: "nonsense" }], fin400);
  assert.equal(stray[stray.length - 1].key, "__other__");
});

test("loadCourses reads the registry over fetch", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = await readFile(path.join(root, "data/courses.json"), "utf8");
    return { ok: String(url).includes("courses.json"), status: 200, json: async () => JSON.parse(text) };
  };
  try {
    const catalog = await loadCourses({ force: true });
    assert.equal(catalog.courses.length, 2);
    assert.equal(catalog.default, registry.default);
    assert.equal(catalog.courses.find((course) => course.id === "fin400").solutions, "hidden");
    assert.equal(catalog.courses[0].phases[0].id, "intro");
  } finally {
    globalThis.fetch = original;
  }
});

test("a missing registry is an error the page can show", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    await assert.rejects(() => loadCourses({ force: true }), /Could not read/);
  } finally {
    globalThis.fetch = original;
  }
});
