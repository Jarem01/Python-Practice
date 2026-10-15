/**
 * Page-level smoke tests: load each real HTML file in jsdom, run the real page
 * module against it and assert the rendered DOM. fetch is served from disk, so
 * the tests exercise the same code paths the browser uses (minus Pyodide, which
 * tests/pyodide.test.mjs covers separately).
 *
 *   npm install --no-save jsdom && node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  JSDOM = null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bundle = JSON.parse(await readFile(path.join(root, "problems", "index.json"), "utf8"));
const glossary = JSON.parse(await readFile(path.join(root, "data", "glossary.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "data", "notebooks.json"), "utf8"));
// The class notebooks are the teaching content now; tests use the first one.
const part1 = manifest.notebooks.find((n) => n.path.includes("Intro to Python (Part 1)"));
const skip = JSDOM ? false : "jsdom is not installed (npm install --no-save jsdom)";

let pageCounter = 0;

/** Serve a URL from the repository (file: URLs come from the page modules). */
async function fetchFromDisk(url) {
  let filePath = null;
  const parsed = new URL(url);
  if (parsed.protocol === "file:") filePath = fileURLToPath(parsed);
  else if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    filePath = path.join(root, decodeURIComponent(parsed.pathname));
  }
  if (!filePath) {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
  try {
    const text = await readFile(filePath, "utf8");
    return {
      ok: true,
      status: 200,
      url,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
}

async function loadPage(htmlPath, modulePath, search = "") {
  const html = await readFile(path.join(root, htmlPath), "utf8");
  const dom = new JSDOM(html, {
    url: `http://localhost/${htmlPath}${search}`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.scrollTo = () => {};
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  if (!window.CSS) window.CSS = {};
  if (!window.CSS.escape) window.CSS.escape = (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`);
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => "blob:stub";

  const names = [
    "window", "document", "location", "history", "localStorage", "navigator",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "CSS",
    "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "Blob",
  ];
  const saved = new Map();
  for (const name of names) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    try {
      Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
    } catch {
      /* read-only globals are fine to leave alone */
    }
  }
  globalThis.fetch = fetchFromDisk;

  const moduleUrl = `${pathToFileURL(path.join(root, modulePath)).href}?page=${pageCounter++}`;
  await import(moduleUrl);
  return { dom, window, document: window.document, restore: () => { for (const [name, desc] of saved) { try { if (desc) Object.defineProperty(globalThis, name, desc); } catch {} } } };
}

async function waitFor(check, { timeout = 3000, interval = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) return null;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

function click(window, element) {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function type(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("index.html renders stats, type cards and the notebook overview", { skip }, async () => {
  const page = await loadPage("index.html", "assets/js/home.js");
  try {
    const stats = await waitFor(() => document.querySelectorAll("#stats .card").length && document.getElementById("stats"));
    assert.ok(stats, "the stats cards should render");
    const numbers = [...page.document.querySelectorAll("#stats .card div")]
      .filter((n) => /^\d+$/.test(n.textContent))
      .map((n) => Number(n.textContent));
    assert.ok(numbers.includes(bundle.count), `problem count ${bundle.count} should appear in the stats`);
    assert.ok(numbers.includes(glossary.entries.length), "the glossary term count should appear");

    assert.equal(page.document.querySelectorAll("#type-cards .card").length, 4, "one card per exercise type");
    assert.match(page.document.getElementById("recommended").textContent, /Start here|Continue where you left off|Revisit/);

    const notebooks = page.document.getElementById("notebooks");
    assert.ok(part1, "the class notebooks are indexed");
    assert.match(notebooks.textContent, /Introduction to Python \(Part 1\)/, "notebooks are listed by title");
    assert.match(
      notebooks.innerHTML,
      new RegExp(`teaching/view\\.html\\?nb=${encodeURIComponent(part1.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "each notebook links to the in-browser viewer",
    );
    assert.ok(notebooks.textContent.includes(part1.exercises[0].title), "the notebook's exercises are listed");
    assert.match(notebooks.innerHTML, new RegExp(`#${part1.exercises[0].anchor}`), "links jump to the exercise anchor");
  } finally {
    page.restore();
  }
});

test("teaching/index.html lists notebooks with their exercises and the topic map", { skip }, async () => {
  const page = await loadPage("teaching/index.html", "assets/js/teaching-index.js");
  try {
    await waitFor(() => page.document.getElementById("notebooks").textContent.includes("Intro to Python"), { timeout: 3000 });
    const summary = page.document.getElementById("teaching-summary").textContent;
    assert.match(summary, new RegExp(String(manifest.notebooks.length)), "every notebook is counted");
    const listed = page.document.getElementById("notebooks").textContent;
    assert.match(listed, /Data Analysis/);
    assert.match(listed, /exercises?/i, "each notebook shows how many exercises it holds");
    const topics = page.document.getElementById("topics").textContent;
    assert.match(topics, /Python Basics/);
    assert.match(page.document.getElementById("topics").innerHTML, /practice\/index\.html\?topic=/);
  } finally {
    page.restore();
  }
});

test("teaching/view.html renders a class notebook, its headings and the inline HTML", { skip }, async () => {
  const page = await loadPage("teaching/view.html", "assets/js/teaching-view.js", `?nb=${encodeURIComponent(part1.path)}`);
  try {
    await waitFor(() => page.document.querySelector("#notebook .cell.md"), { timeout: 5000 });
    const notebook = page.document.getElementById("notebook");
    assert.equal(
      page.document.querySelectorAll("#notebook .cell.code").length,
      part1.code_cell_count,
      "every code cell is rendered",
    );
    assert.match(notebook.querySelector("h1").textContent, /Introduction to Python \(Part 1\)/i);
    assert.ok(!notebook.textContent.includes("\u001b["), "ANSI escapes are stripped from outputs");

    // The notebook writes `8<sup>3</sup>` in its markdown: it must render as a
    // superscript, never as visible "<sup>" text.
    const sup = notebook.querySelector("sup");
    assert.ok(sup, "inline HTML in notebook markdown renders");
    assert.equal(sup.textContent, "3");
    assert.ok(!notebook.textContent.includes("<sup>"), "raw markup never leaks into the page");

    assert.match(page.document.getElementById("notebook-header").textContent, /Exercises in this notebook/);
    const tocLinks = [...page.document.querySelectorAll("#toc a")].map((a) => a.getAttribute("href"));
    assert.ok(tocLinks.length >= 2, "the table of contents lists the headings");
    const callouts = page.document.querySelectorAll("#notebook .exercise-callout");
    assert.ok(callouts.length >= 1, "exercise sections are highlighted in the notebook view");
    assert.match(callouts[0].textContent, /Exercise/, "the highlighted section is an exercise");
  } finally {
    page.restore();
  }
});

test("practice/index.html lists every exercise and the filters work", { skip }, async () => {
  const page = await loadPage("practice/index.html", "assets/js/practice-list.js");
  try {
    await waitFor(() => page.document.querySelectorAll("#problem-list li").length, { timeout: 3000 });
    const items = () => [...page.document.querySelectorAll("#problem-list li")];
    assert.equal(items().length, bundle.count);

    const typePill = [...page.document.querySelectorAll("#filters .pill")].find((p) => p.textContent === "Fix the code");
    click(page.window, typePill);
    assert.equal(items().length, bundle.by_type.fix_the_code);
    assert.equal(typePill.getAttribute("aria-pressed"), "true");

    const search = page.document.querySelector('#filters input[type="search"]');
    type(page.window, search, "dictionary");
    const found = items().length;
    assert.ok(found > 0 && found < bundle.count, `search should narrow the list (got ${found})`);

    click(page.window, page.document.querySelector("#filters .btn.ghost"));
    assert.equal(items().length, bundle.count, "clear filters restores the full list");

    const solved = bundle.problems[0].id;
    page.window.localStorage.setItem("pypractice:progress", JSON.stringify({ [solved]: { status: "solved", attempts: 2 } }));
    const solvedPill = [...page.document.querySelectorAll("#filters .pill")].find((p) => p.textContent.startsWith("solved"));
    click(page.window, solvedPill);
    assert.equal(items().length, 1);
    assert.match(items()[0].textContent, /solved/);

    // The list is organized by assignment: headed groups, in course order.
    click(page.window, page.document.querySelector("#filters .btn.ghost"));
    const headings = [...page.document.querySelectorAll("#problem-list .list-group h3")].map((h) => h.textContent);
    assert.ok(headings.length >= 2, `exercises are grouped by assignment (got ${headings.length} groups)`);
    assert.ok(headings.some((h) => /Part \d/.test(h)), "the group labels name the part");
    const assignmentSelect = [...page.document.querySelectorAll("#filters select")][0];
    assert.ok(assignmentSelect.options.length > 2, "the assignment filter lists the assignments");

    // "by topic" groups the same exercises the other way round.
    const topicPill = [...page.document.querySelectorAll("#filters .pill")].find((p) => p.textContent === "by topic");
    click(page.window, topicPill);
    const topicHeadings = [...page.document.querySelectorAll("#problem-list .list-group h3")].map((h) => h.textContent);
    assert.ok(topicHeadings.length >= 2, "groups are rebuilt when grouping by topic");
    assert.notDeepEqual(topicHeadings, headings, "the two groupings differ");
  } finally {
    page.restore();
  }
});

test("practice/index.html honours ?type= deep links", { skip }, async () => {
  const page = await loadPage("practice/index.html", "assets/js/practice-list.js", "?type=predict_output");
  try {
    await waitFor(() => page.document.querySelectorAll("#problem-list li").length, { timeout: 3000 });
    assert.equal(page.document.querySelectorAll("#problem-list li").length, bundle.by_type.predict_output);
  } finally {
    page.restore();
  }
});

test("exercise.html grades a predict-the-output answer without Python", { skip }, async () => {
  const problem = bundle.problems.find((p) => p.type === "predict_output");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelector("h1"), { timeout: 3000 });
    assert.equal(page.document.querySelector("h1").textContent, problem.title);
    assert.match(page.document.querySelector(".badge").textContent, /Predict the output/i);

    const textarea = page.document.querySelector("textarea");
    assert.ok(textarea, "predict-the-output shows a textarea for the answer");
    type(page.window, textarea, "definitely wrong");
    click(page.window, page.document.querySelector(".btn.primary"));
    let feedback = page.document.getElementById("feedback");
    assert.match(feedback.textContent, /Not quite yet/);
    // What the learner typed and what was expected are both shown, in red
    // because they do not line up.
    assert.equal(feedback.querySelectorAll(".out-pane").length, 2, "got and expected are both shown");
    assert.ok(feedback.querySelector(".out-pane.bad"), "a mismatch is marked red");
    assert.ok(feedback.querySelector(".match-badge.bad"), "the mismatch is labeled");
    assert.ok(feedback.querySelector(".diff-line"), "a line diff is shown");

    type(page.window, textarea, problem.expected_output);
    click(page.window, page.document.querySelector(".btn.primary"));
    feedback = page.document.getElementById("feedback");
    assert.match(feedback.textContent, /Correct!/);
    // A correct answer still shows the output, now in green.
    assert.equal(feedback.querySelectorAll(".out-pane").length, 2, "the output is shown when correct too");
    assert.equal(feedback.querySelectorAll(".out-pane.bad").length, 0, "nothing is red when it matches");
    assert.ok(feedback.querySelector(".out-pane.ok"), "a match is marked green");
    assert.match(feedback.querySelector(".match-badge").textContent, /Matches/);
    const progress = JSON.parse(page.window.localStorage.getItem("pypractice:progress"));
    assert.equal(progress[problem.id].status, "solved");
    assert.equal(progress[problem.id].attempts, 2);
  } finally {
    page.restore();
  }
});

test("exercise.html renders one blank input per ___ and checks them per blank", { skip }, async () => {
  const problem = bundle.problems.find((p) => p.type === "fill_in_blank");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelectorAll("input.blank").length, { timeout: 3000 });
    const blanks = [...page.document.querySelectorAll("input.blank")];
    assert.equal(blanks.length, problem.blanks.length, "one input per declared blank");
    const literalPrefix = problem.starter_code.split("___")[0].split("\n").pop().trim();
    assert.ok(
      page.document.querySelector(".fillcode").textContent.includes(literalPrefix),
      `the template text (${literalPrefix}) is shown around the inputs`,
    );

    click(page.window, page.document.querySelector(".btn.primary"));
    const feedback = page.document.getElementById("feedback");
    assert.match(feedback.textContent, /Check the highlighted blanks/);
    assert.ok(blanks.every((blank) => blank.classList.contains("bad")), "empty blanks are highlighted");

    // The reference solution fills the blanks and shows the code.
    click(page.window, [...page.document.querySelectorAll(".btn")].find((b) => b.textContent === "Show solution"));
    assert.equal(blanks[0].value, problem.blanks[0].accepted[0]);
    assert.match(page.document.getElementById("feedback").textContent, /One way to solve it/);
  } finally {
    page.restore();
  }
});

test("exercise.html offers both write-from-scratch modes", { skip }, async () => {
  const problem = bundle.problems.find((p) => p.type === "write_from_scratch" && p.mode === "both");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelector("textarea"), { timeout: 3000 });
    const pills = [...page.document.querySelectorAll(".pill")].filter((p) => /Step-by-step|Line-count/.test(p.textContent));
    assert.equal(pills.length, 2, "guided and line-count modes are offered");

    const hintButton = [...page.document.querySelectorAll(".btn")].find((b) => /^Hint/.test(b.textContent));
    click(page.window, hintButton);
    assert.match(page.document.getElementById("feedback").textContent, /Hint 1/);

    click(page.window, pills[1]);
    const boxes = [...page.document.querySelectorAll(".card")];
    const linesBox = boxes.find((b) => b.textContent.includes("Decide how many lines you need"));
    assert.ok(linesBox && !linesBox.classList.contains("hidden"), "line-count mode reveals its controls");
    assert.match(linesBox.textContent, /0 of \d+ lines written/);
    const number = linesBox.querySelector('input[type="number"]');
    type(page.window, number, "3");
    assert.match(linesBox.textContent, /0 of 3 lines written/);

    const solutionLine = [...page.document.querySelectorAll(".btn")].find((b) => b.textContent === "Show next solution line");
    assert.ok(solutionLine, "guided mode can reveal the solution line by line");
  } finally {
    page.restore();
  }
});

test("exercise.html shows the output beside the expected output when code is checked", { skip }, async () => {
  // Python itself is covered by tests/pyodide.test.mjs; here we only check the
  // panel every run ends in. jsdom cannot start the runtime, which is exactly
  // the case a learner hits offline: the comparison must still appear.
  const problem = bundle.problems.find((p) => p.type === "write_from_scratch" && p.expected_output != null);
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelector("textarea"), { timeout: 3000 });
    type(page.window, page.document.querySelector("textarea"), problem.solution);
    click(page.window, page.document.querySelector(".btn.primary"));
    const feedback = await waitFor(
      () => (page.document.querySelector("#feedback .out-compare") ? page.document.getElementById("feedback") : null),
      { timeout: 5000 },
    );
    assert.ok(feedback, "checking the answer shows the output panel");
    assert.equal(feedback.querySelectorAll(".out-pane").length, 2, "the run's output and the expected output are both shown");
    assert.match(feedback.querySelector(".out-pane h5").textContent, /Got/i);
    assert.match(feedback.textContent, /Expected/);
    assert.ok(feedback.querySelector(".out-pane.bad"), "output that does not line up is marked red");
    assert.ok(feedback.querySelector(".match-badge"), "the comparison is labeled");
  } finally {
    page.restore();
  }
});

test("exercise.html explains an unknown exercise id", { skip }, async () => {
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", "?id=does-not-exist");
  try {
    await waitFor(() => page.document.getElementById("exercise").textContent.includes("Exercise not found"), { timeout: 3000 });
    assert.match(page.document.getElementById("exercise").innerHTML, /index\.html/);
  } finally {
    page.restore();
  }
});

test("glossary.html lists terms, links exercises and filters", { skip }, async () => {
  const page = await loadPage("glossary.html", "assets/js/glossary-page.js");
  try {
    await waitFor(() => page.document.querySelectorAll(".term-entry").length, { timeout: 3000 });
    const entries = page.document.querySelectorAll(".term-entry");
    assert.equal(entries.length, glossary.entries.length);
    assert.match(page.document.getElementById("for-loop").textContent, /for loop/);
    assert.match(page.document.querySelector("#dictionary").innerHTML, /practice\/exercise\.html\?id=/);

    const search = page.document.getElementById("term-search");
    type(page.window, search, "list comprehension");
    const visible = [...entries].filter((e) => !e.classList.contains("hidden"));
    assert.ok(visible.length >= 1 && visible.length < entries.length);
    assert.ok(visible.some((e) => e.id === "list-comprehension"));
    assert.equal(page.document.querySelectorAll("#glossary .list-group").length, 0, "no groups in A–Z order");

    // Sorting by assignment groups the terms under the notebook that uses them,
    // and each entry says which assignment it belongs to.
    type(page.window, search, "");
    const sort = page.document.getElementById("term-sort");
    type(page.window, sort, "assignment");
    const groupHeadings = [...page.document.querySelectorAll("#glossary .list-group h3")].map((h) => h.textContent);
    assert.ok(groupHeadings.length >= 2, `terms are grouped by assignment (got ${groupHeadings.length})`);
    assert.ok(groupHeadings.some((h) => /Part \d/.test(h)), "the groups name the course part");
    assert.ok(groupHeadings.includes("Not used in an exercise yet"), "unused terms are listed last");
    assert.equal(page.document.querySelectorAll("#glossary .glossary-index").length, 0, "the A–Z index is only for A–Z order");
    assert.equal(page.document.querySelectorAll("#glossary .term-entry").length, entries.length, "every term is still listed");
    assert.match(page.document.getElementById("glossary").textContent, /Used in: /, "each term names its assignment");
  } finally {
    page.restore();
  }
});

test("create.html builds JSON, validates it and stores drafts", { skip }, async () => {
  const page = await loadPage("practice/create.html", "assets/js/create.js");
  try {
    const id = (name) => page.document.getElementById(`f-${name}`);
    type(page.window, id("title"), "My new exercise");
    type(page.window, id("prompt"), "Print the number 7.");
    type(page.window, id("expected_output"), "7");
    let preview = JSON.parse(page.document.getElementById("preview").textContent);
    assert.equal(preview.id, "my-new-exercise", "the id is derived from the title");
    assert.equal(preview.type, "fix_the_code");
    assert.match(page.document.getElementById("status").textContent, /problem\(s\) to fix|starter code/);

    type(page.window, id("starter_code"), "print(6)\n");
    preview = JSON.parse(page.document.getElementById("preview").textContent);
    assert.equal(preview.expected_output, "7");

    click(page.window, page.document.getElementById("save-draft"));
    const drafts = JSON.parse(page.window.localStorage.getItem("pypractice:drafts"));
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].id, "my-new-exercise");
    assert.match(page.document.getElementById("drafts").textContent, /My new exercise/);

    // switching the type swaps the field labels and visibility rules
    const typeSelect = id("type");
    type(page.window, typeSelect, "fill_in_blank");
    assert.match(page.document.querySelector('label.field[data-key="starter_code"] .lbl').textContent, /___ blanks/);

    const lineCount = page.document.querySelector('label.field[data-key="line_count"]');
    type(page.window, typeSelect, "write_from_scratch");
    assert.ok(!lineCount.classList.contains("hidden"), "line count is relevant for write-from-scratch");
  } finally {
    page.restore();
  }
});

test("exercise.html loads the fix-the-code starter into an editor", { skip }, async () => {
  const problem = bundle.problems.find((p) => p.type === "fix_the_code");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelector("textarea"), { timeout: 3000 });
    const textarea = page.document.querySelector("textarea");
    assert.equal(textarea.value, problem.starter_code, "the starter code is loaded into the editor");
    // The gutter is filled on the next animation frame, so wait for it.
    const gutter = await waitFor(() => {
      const node = page.document.querySelector(".editor .gutter");
      return node && node.textContent.trim() ? node : null;
    }, { timeout: 3000 });
    assert.ok(gutter, "line numbers are shown next to the editor");
    assert.equal(gutter.textContent.split("\n")[0], "1");
    assert.match(page.document.getElementById("exercise").textContent, /Expected output/);
    assert.equal([...page.document.querySelectorAll(".btn")].filter((b) => /^Hint/.test(b.textContent)).length, 1);
  } finally {
    page.restore();
  }
});
