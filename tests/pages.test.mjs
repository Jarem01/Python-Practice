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
const coursesFile = JSON.parse(await readFile(path.join(root, "data", "courses.json"), "utf8"));
// Every page shows one class at a time, and the class it opens with is the one
// data/courses.json names as the default — not a name hard-coded in the test.
const defaultCourse = coursesFile.courses.find((course) => course.id === coursesFile.default);
const courseProblems = bundle.problems.filter((problem) => problem.course === defaultCourse.id);
const courseNotebooks = manifest.notebooks.filter((entry) => entry.course === defaultCourse.id);
// The class notebooks are the learning content now; tests use the first one.
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

/**
 * Load one page in a fresh window and run its real module against it.
 * @param {string} search    query string for the page URL
 * @param {Function} [seed]  runs with the fresh window before the page module is
 *   imported, for state the page expects to find in localStorage
 */
async function loadPage(htmlPath, modulePath, search = "", seed = null) {
  const html = await readFile(path.join(root, htmlPath), "utf8");
  const dom = new JSDOM(html, {
    url: `http://localhost/${htmlPath}${search}`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  if (seed) seed(window);
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
    const stats = await waitFor(() => document.querySelectorAll("#stats .tile").length && document.getElementById("stats"));
    assert.ok(stats, "the stats tiles should render");
    const numbers = [...page.document.querySelectorAll("#stats .tile-value")]
      .filter((n) => /^\d+$/.test(n.textContent))
      .map((n) => Number(n.textContent));
    assert.ok(
      numbers.includes(courseProblems.length),
      `the default class's problem count ${courseProblems.length} should appear in the stats`,
    );
    assert.ok(numbers.includes(glossary.entries.length), "the glossary term count should appear");

    assert.equal(page.document.querySelectorAll("#type-cards .tile").length, 4, "one card per exercise type");
    assert.match(page.document.getElementById("recommended").textContent, /Start here|Continue where you left off|Revisit/);

    // Practice coverage: one row per class section, in course order.
    const coverage = page.document.getElementById("coverage");
    const rows = [...coverage.querySelectorAll("tbody tr")];
    assert.equal(rows.length, courseNotebooks.length, "every section of the class is listed in the coverage table");
    assert.match(rows[0].textContent, /Intro 1/, "Intro comes first");
    assert.match(rows[rows.length - 1].textContent, /Data Analysis 6/, "Data Analysis comes last");
    assert.ok(
      rows.every((row) => !/none yet/.test(row.textContent)),
      "every section has practice exercises",
    );

    const notebooks = page.document.getElementById("notebooks");
    assert.ok(part1, "the class notebooks are indexed");
    assert.match(notebooks.textContent, /Intro 1 — Values, strings and lists/, "notebooks are listed by title");
    assert.match(notebooks.textContent, /Intro 4/, "the Intro sections are labeled 1–4");
    assert.match(notebooks.textContent, /Data Analysis 6/, "the Data Analysis sections are labeled too");
    assert.ok(
      notebooks.textContent.indexOf("Intro 1") < notebooks.textContent.indexOf("Data Analysis 1"),
      "Intro is listed before Data Analysis",
    );
    assert.match(
      notebooks.innerHTML,
      new RegExp(`learning/view\\.html\\?nb=${encodeURIComponent(part1.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "each notebook links to the in-browser viewer",
    );
    assert.ok(notebooks.textContent.includes(part1.exercises[0].title), "the notebook's exercises are listed");
    assert.match(notebooks.innerHTML, new RegExp(`#${part1.exercises[0].anchor}`), "links jump to the exercise anchor");

    // Tiles or table — the learner picks, and the choice sticks.
    const tableButton = [...page.document.querySelectorAll("#view-bar .view-toggle button")].find((b) => b.textContent === "Table");
    assert.ok(tableButton, "the tile/table switch is offered");
    click(page.window, tableButton);
    assert.ok(page.document.querySelector("#notebooks .data-table"), "the table view renders a table");
    assert.equal(page.document.querySelectorAll("#notebooks .tile").length, 0, "the tiles are replaced by the table");
    assert.equal(page.window.localStorage.getItem("pypractice:view:learning"), "\"table\"");
    const tileButton = [...page.document.querySelectorAll("#view-bar .view-toggle button")].find((b) => b.textContent === "Tiles");
    click(page.window, tileButton);
    assert.ok(page.document.querySelector("#notebooks .tile"), "switching back restores the tiles");

    // The four exercise types are a tile grid too, with the same choice.
    const typeTableButton = [...page.document.querySelectorAll("#type-view-bar .view-toggle button")].find((b) => b.textContent === "Table");
    assert.ok(typeTableButton, "the type cards offer a table view as well");
    click(page.window, typeTableButton);
    const typeTable = page.document.querySelector("#type-cards .data-table");
    assert.ok(typeTable, "the type table renders");
    assert.equal(typeTable.querySelectorAll("tbody tr").length, 4, "one row per exercise type");
    assert.equal(page.document.querySelectorAll("#type-cards .tile").length, 0, "the tiles are replaced");
  } finally {
    page.restore();
  }
});

/** README.md is not part of the published site — the workflow copies the pages and
 *  the material, not the Markdown — so a relative link to it 404s on the deployed
 *  site. With a repository configured the link has to leave the site. */
test("index.html points the README link at the rendered copy on GitHub", { skip }, async () => {
  const { CONFIG } = await import(`${pathToFileURL(path.join(root, "assets/js/config.js")).href}?t=${pageCounter++}`);
  const page = await loadPage("index.html", "assets/js/home.js");
  try {
    const link = page.document.getElementById("readme-link");
    assert.ok(link, "the home page links the README");
    assert.match(link.textContent, /README/, "the link says what it opens");
    const href = link.getAttribute("href");
    if (CONFIG.githubRepo) {
      assert.equal(
        href,
        `https://github.com/${CONFIG.githubRepo}#readme`,
        "the link must leave the site: README.md is not published with it",
      );
    } else {
      assert.equal(href, "README.md", "without a repository the local file is still the best target");
    }
  } finally {
    page.restore();
  }
});

/** Every tile grid on the site is a grid, so a neighbor's caption cannot make
 *  one tile taller than the next — the first-tile-is-bigger bug. */
test("no page keeps its tiles outside a grid", { skip }, async () => {
  const pages = [
    ["index.html", "assets/js/home.js", "#stats .tile"],
    ["index.html", "assets/js/home.js", "#type-cards .tile"],
    ["index.html", "assets/js/home.js", "#notebooks .tile"],
    ["learning/index.html", "assets/js/learning-index.js", "#notebooks .tile"],
    ["practice/index.html", "assets/js/practice-list.js", "#problem-list .tile"],
  ];
  for (const [html, modulePath, selector] of pages) {
    const page = await loadPage(html, modulePath);
    try {
      await waitFor(() => page.document.querySelector(selector), { timeout: 3000 });
      const tiles = [...page.document.querySelectorAll(selector)];
      assert.ok(tiles.length, `${selector} should render on ${html}`);
      for (const tile of tiles) {
        assert.ok(
          tile.parentElement.classList.contains("grid"),
          `every tile in ${selector} on ${html} must be a grid item, so they share one row height`,
        );
      }
    } finally {
      page.restore();
    }
  }
});

/** Every list can be read as tiles or as a table. The switch has to be on the
 *  page, and it has to really swap the markup — not just remember a setting. */
test("every list switches between tiles and a table", { skip }, async () => {
  const surfaces = [
    { html: "index.html", module: "assets/js/home.js", list: "#type-cards", bar: "#type-view-bar", card: ".tile" },
    { html: "index.html", module: "assets/js/home.js", list: "#notebooks", bar: "#view-bar", card: ".tile" },
    { html: "learning/index.html", module: "assets/js/learning-index.js", list: "#notebooks", bar: "#view-bar", card: ".tile" },
    { html: "practice/index.html", module: "assets/js/practice-list.js", list: "#problem-list", bar: "#filters", card: ".tile" },
    // A term's table row also carries .term-entry, on purpose: #slug links must keep
    // working in both views, so the card is the <section> and the row is the <tr>.
    { html: "glossary.html", module: "assets/js/glossary-page.js", list: "#glossary", bar: "#view-bar", card: "section.term-entry" },
  ];

  for (const surface of surfaces) {
    const { html, module: modulePath, list, bar, card } = surface;
    const where = `${list} on ${html}`;
    const page = await loadPage(html, modulePath);
    try {
      const host = await waitFor(() => {
        const node = page.document.querySelector(list);
        return node && node.querySelector(card) ? node : null;
      });
      assert.ok(host, `${where} should show ${card} cards to begin with`);

      const button = (value) => {
        const found = page.document.querySelector(`${bar} .view-toggle button[data-value="${value}"]`);
        assert.ok(found, `a "${value}" switch must be offered for ${where}`);
        return found;
      };

      click(page.window, button("table"));
      const table = await waitFor(() => host.querySelector(".data-table"));
      assert.ok(table, `${where} should show a table after choosing Table`);
      assert.ok(table.querySelectorAll("tbody tr").length > 0, `the table for ${where} must have rows`);
      assert.equal(host.querySelectorAll(card).length, 0, `${where} must not still show cards in table view`);
      assert.equal(button("table").getAttribute("aria-pressed"), "true", `the Table switch should read as selected on ${where}`);
      assert.equal(button("tiles").getAttribute("aria-pressed"), "false", `the Tiles switch should read as unselected on ${where}`);

      click(page.window, button("tiles"));
      assert.ok(await waitFor(() => host.querySelector(card)), `${where} should go back to cards`);
      assert.equal(host.querySelectorAll(".data-table").length, 0, `${where} must not still show a table in tiles view`);
      assert.equal(button("tiles").getAttribute("aria-pressed"), "true", `the Tiles switch should read as selected on ${where}`);
    } finally {
      page.restore();
    }
  }
});

/** The notebooks are the lesson: a code cell with no saved output can only ever
 *  show the code, which is the "it is just commented lines" problem. */
test("every notebook ships with saved outputs for its cells", { skip }, async () => {
  for (const entry of manifest.notebooks) {
    const notebook = JSON.parse(await readFile(path.join(root, entry.path), "utf8"));
    const code = (notebook.cells || []).filter((c) => c.cell_type === "code" && String(c.source || "").trim());
    const withOutput = code.filter((c) => (c.outputs || []).length);
    if (entry.group === "lectures") {
      // A lecture notebook is an exercise page: one demonstration cell that ran,
      // plus starter cells the student fills in — those have no output until they do.
      assert.ok(withOutput.length >= 1, `${entry.label} needs its demonstration cell to show a result`);
      assert.ok(
        withOutput.every((c) => c.execution_count != null),
        `${entry.label}: a saved output must record when it ran`,
      );
      continue;
    }
    assert.ok(
      withOutput.length >= 4,
      `${entry.label} has only ${withOutput.length} cells with saved output of ${code.length}`,
    );
    assert.ok(
      code.every((c) => c.execution_count != null),
      `${entry.label}: every code cell must record when it ran`,
    );
  }
});

test("a notebook's saved plots are shown under their cells in the run view", { skip }, async () => {
  const entry = manifest.notebooks.find((n) => (n.label || "").startsWith("Data Analysis 5"));
  assert.ok(entry, "Data Analysis 5 is indexed");
  const page = await loadPage("learning/view.html", "assets/js/learning-view.js", `?nb=${encodeURIComponent(entry.path)}`);
  try {
    await waitFor(() => page.document.querySelector("#notebook .cell.out"), { timeout: 5000 });
    const image = page.document.querySelector("#notebook .cell.out img.out-img");
    assert.ok(image, "the figure a plotting cell produced is inlined");
    assert.match(image.getAttribute("src"), /^data:image\/png;base64,/);
    assert.ok(
      page.document.querySelectorAll("#notebook .cell.out").length >= 4,
      "the saved stream and result outputs are shown under their cells",
    );
  } finally {
    page.restore();
  }
});

test("learning/index.html lists notebooks with their exercises and the topic map", { skip }, async () => {
  const page = await loadPage("learning/index.html", "assets/js/learning-index.js");
  try {
    await waitFor(() => page.document.getElementById("notebooks").textContent.includes("Intro to Python"), { timeout: 3000 });
    const summary = page.document.getElementById("learning-summary").textContent;
    assert.match(summary, new RegExp(String(courseNotebooks.length)), "every notebook of the class is counted");
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

test("learning/view.html opens a class notebook ready to run, exercises included", { skip }, async () => {
  const page = await loadPage("learning/view.html", "assets/js/learning-view.js", `?nb=${encodeURIComponent(part1.path)}`);
  const document = page.document;
  try {
    await waitFor(() => document.querySelector("#notebook .cell.code.runnable"), { timeout: 5000 });
    const notebook = document.getElementById("notebook");

    // There is one view of a notebook, and it is the runnable one: no read-only
    // cells and no Read/Run switch are left.
    assert.equal(document.querySelectorAll("#notebook .cell.code").length, part1.code_cell_count, "every code cell is rendered");
    assert.equal(
      document.querySelectorAll("#notebook .cell.code.runnable").length,
      part1.code_cell_count,
      "every code cell is runnable",
    );
    assert.equal(document.querySelectorAll("#notebook .cell.code:not(.runnable)").length, 0, "nothing renders read-only");
    assert.equal(
      document.querySelectorAll("#notebook .cell.code.runnable textarea").length,
      part1.code_cell_count,
      "each runnable cell has an editor",
    );
    assert.equal(document.getElementById("mode-bar"), null, "the Read/Run switch is gone");
    const bar = document.querySelector(".notebook-bar");
    assert.match(bar.textContent, /Run all cells/);
    assert.match(bar.textContent, /Restart kernel/);

    // The notebook's own title cell is rendered as written; the page header uses
    // the course label from data/curriculum.json.
    assert.match(notebook.querySelector("h1").textContent, /Introduction to Python \(Part 1\)/i);
    const header = document.getElementById("notebook-header");
    assert.match(header.textContent, /Intro 1 — Values, strings and lists/);
    assert.ok(!notebook.textContent.includes("\u001b["), "ANSI escapes are stripped from outputs");

    // The notebook writes `8<sup>3</sup>` in its markdown: it must render as a
    // superscript, never as visible "<sup>" text.
    const sup = notebook.querySelector("sup");
    assert.ok(sup, "inline HTML in notebook markdown renders");
    assert.equal(sup.textContent, "3");
    assert.ok(!notebook.textContent.includes("<sup>"), "raw markup never leaks into the page");

    // Every exercise is boxed, grouped with the cells that belong to it, and
    // reachable from the list in the header.
    assert.match(header.textContent, /Exercises in this notebook/);
    const callouts = [...document.querySelectorAll("#notebook .exercise-callout")];
    assert.equal(callouts.length, part1.exercises.length, "each exercise heading is boxed");
    assert.match(callouts[0].textContent, /Exercise/, "the boxed section is an exercise");
    assert.equal(
      notebook.querySelector(".cell.md h1").closest(".exercise-callout"),
      null,
      "the notebook title is not boxed as an exercise",
    );
    const groups = [...document.querySelectorAll("#notebook .exercise-group")];
    assert.equal(groups.length, part1.exercises.length, "each exercise has its own group");
    assert.deepEqual(
      groups.map((group) => group.id),
      part1.exercises.map((exercise) => exercise.anchor),
      "each group carries its exercise anchor",
    );
    for (const group of groups) {
      assert.ok(group.querySelector(".cell.code.runnable"), "an exercise group holds the cells that belong to it");
    }

    const links = [...header.querySelectorAll('a[href^="#"]')];
    assert.equal(links.length, part1.exercises.length, "the header lists every exercise");
    for (const link of links) {
      assert.ok(document.getElementById(link.getAttribute("href").slice(1)), `${link.getAttribute("href")} resolves`);
    }
    assert.ok(document.querySelectorAll("#toc a").length >= 2, "the table of contents lists the headings");
    assert.equal(
      document.querySelectorAll("#toc .toc-exercise").length,
      part1.exercises.length,
      "the contents marks the exercises",
    );

    // Edits are kept per notebook, in this browser.
    const textarea = document.querySelector("#notebook .cell.code.runnable textarea");
    type(page.window, textarea, "print('edited')");
    const saved = JSON.parse(page.window.localStorage.getItem("pypractice:notebook-edit"));
    assert.ok(Object.values(saved[part1.path]).includes("print('edited')"), "the edited cell is remembered");
  } finally {
    page.restore();
  }
});

/**
 * The upload page promises that material saved in this browser shows up in the
 * learning section right away. This drives that whole path: the record the
 * upload page stores, the learning index that lists it, and the viewer that opens
 * it — with the data files and packages its code needs read out of the code.
 */
test("a notebook saved in this browser is listed and opens ready to run", { skip }, async () => {
  const { analyzeNotebook } = await import("../assets/js/analyze.js");
  const uploadPath = "materials/Uploaded track/pending-lesson.ipynb";
  const csvPath = "materials/Uploaded track/insurance.csv";
  const notebook = {
    metadata: { kernelspec: { display_name: "Python 3" } },
    cells: [
      { cell_type: "markdown", source: "# A lesson I uploaded\n\n#### Exercise 1\n\nRead the file and show its first rows." },
      {
        cell_type: "code",
        source: 'import pandas as pd\ndata = pd.read_csv("insurance.csv")\ndata.head()',
        execution_count: 1,
        outputs: [],
      },
    ],
  };
  const text = JSON.stringify(notebook);
  const records = [
    {
      path: uploadPath,
      name: "pending-lesson.ipynb",
      kind: "notebook",
      text,
      entry: analyzeNotebook(notebook, uploadPath),
      size: text.length,
      addedAt: "2026-01-01T00:00:00.000Z",
      source: "browser",
    },
    {
      path: csvPath,
      name: "insurance.csv",
      kind: "text",
      text: "age,charges\n18,16884\n",
      entry: { path: csvPath, title: "insurance.csv" },
      size: 21,
      addedAt: "2026-01-01T00:00:00.000Z",
      source: "browser",
    },
  ];
  const seed = (window) => window.localStorage.setItem("pypractice:uploads", JSON.stringify(records));

  const index = await loadPage("learning/index.html", "assets/js/learning-index.js", "", seed);
  try {
    await waitFor(() => index.document.getElementById("notebooks").textContent.includes("A lesson I uploaded"), { timeout: 3000 });
    const listed = index.document.getElementById("notebooks");
    assert.match(listed.textContent, /A lesson I uploaded/, "the upload is listed with the generated notebooks");
    assert.match(listed.textContent, /in this browser/, "the upload is marked as stored here, not in the repository");
    assert.match(listed.innerHTML, /Uploaded track \(uploaded\)/, "the upload gets its own group");
    assert.match(
      listed.innerHTML,
      new RegExp(encodeURIComponent(uploadPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "its Run link points at the viewer",
    );
    assert.match(listed.textContent, /Intro 1/, "the repository notebooks are still listed");
  } finally {
    index.restore();
  }

  const view = await loadPage("learning/view.html", "assets/js/learning-view.js", `?nb=${encodeURIComponent(uploadPath)}`, seed);
  try {
    await waitFor(() => view.document.querySelector("#notebook .cell.code.runnable"), { timeout: 5000 });
    assert.match(
      view.document.getElementById("notebook-header").textContent,
      /saved in this browser and is not in the repository yet/,
      "the page says where the notebook lives",
    );
    assert.ok(view.document.querySelector("#notebook .exercise-callout"), "its exercise is boxed in the run view");
    assert.equal(
      view.document.querySelectorAll('#notebook-header a[target="_blank"]').length,
      0,
      "there is no repository file to link to yet",
    );
    const bar = view.document.querySelector(".notebook-bar").textContent;
    assert.match(bar, /insurance.csv/, "the data file its code opens is found among the uploads");
    assert.match(bar, /pandas/, "the packages its imports need are loaded");
  } finally {
    view.restore();
  }
});

test("practice/index.html lists every exercise and the filters work", { skip }, async () => {
  const page = await loadPage("practice/index.html", "assets/js/practice-list.js");
  try {
    await waitFor(() => page.document.querySelectorAll("#problem-list .tile").length, { timeout: 3000 });
    const items = () => [...page.document.querySelectorAll("#problem-list .tile")];
    assert.equal(items().length, courseProblems.length, "the list shows the default class only");

    // Every filter is a labeled dropdown, and each one changes the list.
    const field = (label) =>
      [...page.document.querySelectorAll("#filters .filter-field")].find(
        (wrap) => wrap.querySelector(".lbl").textContent === label,
      );
    assert.deepEqual(
      [...page.document.querySelectorAll("#filters .filter-field .lbl")].map((l) => l.textContent),
      ["Search", "Section", "Topic", "Type", "Level", "Progress", "Group by", "Sort"],
      "the filter bar is one labeled row",
    );

    type(page.window, field("Type").querySelector("select"), "fix_the_code");
    assert.equal(items().length, courseProblems.filter((p) => p.type === "fix_the_code").length);
    assert.equal(field("Type").querySelector("select").value, "fix_the_code");

    const search = page.document.querySelector('#filters input[type="search"]');
    type(page.window, search, "dictionary");
    const found = items().length;
    assert.ok(found > 0 && found < courseProblems.length, `search should narrow the list (got ${found})`);

    click(page.window, page.document.querySelector("#filters .btn.ghost"));
    assert.equal(items().length, courseProblems.length, "clear filters restores the full list");

    const solved = courseProblems[0].id;
    page.window.localStorage.setItem("pypractice:progress", JSON.stringify({ [solved]: { status: "solved", attempts: 2 } }));
    type(page.window, field("Progress").querySelector("select"), "solved");
    assert.equal(items().length, 1);
    assert.match(items()[0].textContent, /solved/);

    // Sections are the larger tracks; picking one keeps that track only.
    click(page.window, page.document.querySelector("#filters .btn.ghost"));
    const headings = [...page.document.querySelectorAll("#problem-list .list-group h3")].map((h) => h.textContent);
    assert.ok(headings.length >= 2, `exercises are grouped into sections (got ${headings.length})`);
    const sectionSelect = field("Section").querySelector("select");
    assert.ok(sectionSelect.options.length > 2, "the section filter lists the sections");
    const firstSection = [...sectionSelect.options].find((option) => option.value);
    type(page.window, sectionSelect, firstSection.value);
    const inSection = items().length;
    assert.ok(inSection > 0 && inSection < courseProblems.length, "the section filter keeps one section");
    assert.equal(page.document.querySelectorAll("#problem-list .list-group h3").length, 1, "one section at a time");

    // The same exercises are available as a table, in course order.
    click(page.window, page.document.querySelector("#filters .btn.ghost"));
    const tableButton = [...page.document.querySelectorAll("#filters .view-toggle button")].find((b) => b.textContent === "Table");
    click(page.window, tableButton);
    const tables = [...page.document.querySelectorAll("#problem-list .data-table")];
    assert.ok(tables.length, "the table view renders tables");
    const rowCount = tables.reduce((total, table) => total + table.querySelectorAll("tbody tr").length, 0);
    assert.equal(rowCount, courseProblems.length, "every exercise of the class is a row");
    const tilesButton = [...page.document.querySelectorAll("#filters .view-toggle button")].find((b) => b.textContent === "Tiles");
    click(page.window, tilesButton);
    assert.equal(items().length, courseProblems.length, "switching back restores the tiles");

    // "Group by" rebuilds the same exercises the other way round.
    type(page.window, field("Group by").querySelector("select"), "topic");
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
    await waitFor(() => page.document.querySelectorAll("#problem-list .tile").length, { timeout: 3000 });
    assert.equal(
      page.document.querySelectorAll("#problem-list .tile").length,
      courseProblems.filter((p) => p.type === "predict_output").length,
    );
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

    // The answer they typed is shown directly under the code, above the buttons …
    let output = page.document.querySelector("#exercise .card .run-output");
    assert.ok(output, "the answer panel appears under the code");
    assert.equal(output.textContent.trim(), "definitely wrong");
    assert.ok(
      textarea.compareDocumentPosition(output) & page.window.Node.DOCUMENT_POSITION_FOLLOWING,
      "it sits below the code box",
    );
    assert.ok(
      output.compareDocumentPosition(page.document.querySelector(".btn.primary")) &
        page.window.Node.DOCUMENT_POSITION_FOLLOWING,
      "and above the Check answer button",
    );
    // … then the expected output and the comparison.
    assert.match(feedback.querySelector(".verdict.info h4").textContent, /Expected output/);
    assert.ok(feedback.querySelector(".match-badge.bad"), "the mismatch is labeled");
    assert.ok(feedback.querySelector(".diff-line"), "a line diff is shown");
    assert.equal(feedback.querySelectorAll(".out-pane").length, 0, "the answer is not printed twice");

    type(page.window, textarea, problem.expected_output);
    click(page.window, page.document.querySelector(".btn.primary"));
    feedback = page.document.getElementById("feedback");
    assert.match(feedback.textContent, /Correct!/);
    // A correct answer still shows the output, now matching.
    output = page.document.querySelector("#exercise .card .run-output");
    assert.equal(output.textContent.trim(), problem.expected_output.trim(), "the output is shown when correct too");
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
    const textarea = page.document.querySelector("textarea");
    type(page.window, textarea, problem.solution);
    click(page.window, page.document.querySelector(".btn.primary"));
    // The run goes under the code, whether it worked or not.
    const output = await waitFor(() => page.document.querySelector("#exercise .card .run-output"), { timeout: 5000 });
    assert.ok(output, "checking the answer shows the run directly under the code");
    assert.ok(
      textarea.compareDocumentPosition(output) & page.window.Node.DOCUMENT_POSITION_FOLLOWING,
      "the run sits below the code box",
    );
    // Below that, the expected output and the comparison.
    const feedback = await waitFor(
      () => (page.document.querySelector("#feedback .match-badge") ? page.document.getElementById("feedback") : null),
      { timeout: 5000 },
    );
    assert.ok(feedback, "checking the answer shows the comparison");
    assert.match(feedback.textContent, /Expected output/);
    assert.ok(feedback.querySelector(".match-badge"), "the comparison is labeled");
    assert.equal(feedback.querySelectorAll(".run-output").length, 0, "the run is not repeated in the comparison panel");
  } finally {
    page.restore();
  }
});

test("the code box is one row per line tall and shrinks again", { skip }, async () => {
  // Regression: the height used to come from textarea.scrollHeight, which on a
  // stretched grid cell reports the cell — a full screen of empty box for six
  // lines, and it never shrank when lines were deleted.
  const problem = bundle.problems.find((p) => p.type === "fix_the_code");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    // The editor sizes itself on the next animation frame, so wait for the height.
    const textarea = await waitFor(() => {
      const box = page.document.querySelector("textarea");
      return box && box.style.height ? box : null;
    }, { timeout: 3000 });
    assert.ok(textarea, "the editor rendered");
    const lines = () => textarea.value.split("\n").length;
    const height = () => parseFloat(textarea.style.height);

    assert.ok(Number.isFinite(height()) && height() > 0, "the box has a measured height");
    const perLine = height() / Math.max(lines(), 6);
    assert.ok(perLine > 8 && perLine < 40, `one line measures ${perLine}px`);

    textarea.value = `${textarea.value}\nprint(1)\nprint(2)`;
    textarea.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    assert.equal(height(), Math.round(Math.max(lines(), 6) * perLine), "two new lines add two rows, not a screenful");

    const taller = height();
    textarea.value = problem.starter_code;
    textarea.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    assert.equal(height(), Math.round(Math.max(lines(), 6) * perLine));
    assert.ok(height() < taller, "deleting those lines shrinks the box again");
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

    const termEntries = () => [...page.document.querySelectorAll("#glossary .term-entry")];
    const search = page.document.getElementById("term-search");
    type(page.window, search, "list comprehension");
    const visible = termEntries().filter((e) => !e.classList.contains("hidden"));
    assert.ok(visible.length >= 1 && visible.length < entries.length);
    assert.ok(visible.some((e) => e.id === "list-comprehension"));
    assert.equal(page.document.querySelectorAll("#glossary .list-group").length, 0, "no groups in A–Z order");

    // Sorting by section groups the terms under the notebook that uses them,
    // and each entry says which section it belongs to.
    type(page.window, search, "");
    const sort = page.document.getElementById("term-sort");
    type(page.window, sort, "assignment");
    const groupHeadings = [...page.document.querySelectorAll("#glossary .list-group h3")].map((h) => h.textContent);
    assert.ok(groupHeadings.length >= 2, `terms are grouped by section (got ${groupHeadings.length})`);
    assert.ok(groupHeadings.some((h) => /Intro \d|Data Analysis \d/.test(h)), "the groups name the course section");
    assert.ok(groupHeadings.includes("Not used in an exercise yet"), "unused terms are listed last");
    assert.equal(page.document.querySelectorAll("#glossary .glossary-index").length, 0, "the A–Z index is only for A–Z order");
    assert.equal(page.document.querySelectorAll("#glossary .term-entry").length, entries.length, "every term is still listed");
    assert.match(page.document.getElementById("glossary").textContent, /Used in: /, "each term names its section");

    // One section at a time: pick "Data Analysis 1" and only its terms remain.
    type(page.window, sort, "alpha");
    const section = page.document.getElementById("term-section");
    assert.ok(section.options.length > 5, "the section filter lists every course section");
    const option = [...section.options].find((o) => /^Data Analysis 1/.test(o.textContent));
    assert.ok(option, "Data Analysis 1 is offered as a section");
    type(page.window, section, option.value);
    const inSection = termEntries().filter((e) => !e.classList.contains("hidden"));
    assert.ok(inSection.length > 0, "the section filter keeps the terms that section uses");
    assert.ok(inSection.length < entries.length, `and hides the rest (kept ${inSection.length})`);
    assert.match(page.document.getElementById("term-count").textContent, /in Data Analysis 1/);
    type(page.window, section, "");
    assert.equal(termEntries().filter((e) => !e.classList.contains("hidden")).length, entries.length);

    // Table view lists the same terms as rows.
    const tableButton = [...page.document.querySelectorAll("#view-bar .view-toggle button")].find((b) => b.textContent === "Table");
    click(page.window, tableButton);
    const table = page.document.querySelector("#glossary .data-table");
    assert.ok(table, "the table view renders a table");
    assert.equal(table.querySelectorAll("tbody tr").length, entries.length, "every term is a row");
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

/* --------------------------------------------------------------- classes --- */

const fin400Problems = bundle.problems.filter((problem) => problem.course === "fin400");

test("every page offers the class picker and opens on the default class", { skip }, async () => {
  const pages = [
    ["index.html", "assets/js/home.js"],
    ["glossary.html", "assets/js/glossary-page.js"],
    ["learning/index.html", "assets/js/learning-index.js"],
    ["practice/index.html", "assets/js/practice-list.js"],
    ["upload.html", "assets/js/upload.js"],
    ["practice/create.html", "assets/js/create.js"],
  ];
  for (const [html, modulePath] of pages) {
    const page = await loadPage(html, modulePath);
    try {
      const select = await waitFor(() => page.document.querySelector("#course-picker select"));
      assert.ok(select, `${html} should show the class picker in its header`);
      assert.deepEqual(
        [...select.options].map((option) => option.value),
        coursesFile.courses.map((course) => course.id),
        `${html}: the picker lists every class`,
      );
      assert.equal(select.value, coursesFile.default, `${html} opens on the default class`);
      assert.match(select.options[0].textContent, /ACC 525|FIN 400/, "the options name the class");
      assert.equal(
        page.document.querySelectorAll("#course-picker .class-switch").length,
        coursesFile.courses.length > 1 ? 1 : 0,
        `${html}: a one-click link to the other class is offered`,
      );
    } finally {
      page.restore();
    }
  }
});

test("?course=fin400 separates the exercises from the extra practice", { skip }, async () => {
  const page = await loadPage("practice/index.html", "assets/js/practice-list.js", "?course=fin400");
  try {
    await waitFor(() => page.document.querySelectorAll("#problem-list .tile").length, { timeout: 3000 });
    const items = () => [...page.document.querySelectorAll("#problem-list .tile")];
    assert.equal(items().length, fin400Problems.length, "only FIN 400 exercises are listed");
    assert.equal(page.document.querySelector("#course-picker select").value, "fin400");
    assert.match(page.document.getElementById("count-badge").textContent, /FIN 400/);

    // Three sections, in course order: exercises, extra practice, lectures.
    const headings = [...page.document.querySelectorAll("#problem-list .list-group h3")].map((h) => h.textContent);
    assert.deepEqual(headings, ["Exercises 1–19", "Extra practice", "Lecture notebooks"]);

    const exercises = fin400Problems.filter((p) => p.assignment && p.assignment.group === "Exercises 1–19");
    assert.equal(exercises.length, 19, "all nineteen handout exercises ship as exercises");

    // Sequential: Exercise 10 may never precede Exercise 2.
    const numbers = [...page.document.querySelectorAll("#problem-list .tile h3")]
      .map((h) => /^Exercise (\d+)/.exec(h.textContent))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    assert.equal(numbers.length, 19, "every exercise in the handout is listed");
    for (let i = 1; i < numbers.length; i += 1) {
      assert.equal(numbers[i], numbers[i - 1] + 1, `Exercise ${numbers[i]} must follow Exercise ${numbers[i - 1]}`);
    }

    // The section dropdown narrows the list to one track.
    const sectionSelect = [...page.document.querySelectorAll("#filters select")]
      .find((select) => select.closest(".filter-field").querySelector(".lbl").textContent === "Section");
    assert.ok(sectionSelect.options.length >= 4, "every section is listed");
    type(page.window, sectionSelect, "Extra practice");
    assert.equal(
      items().length,
      fin400Problems.filter((p) => p.assignment && p.assignment.group === "Extra practice").length,
      "the extra practice section holds the practice sets",
    );

    // Grouping by set names every exercise and every practice set.
    const page2 = await loadPage("practice/index.html", "assets/js/practice-list.js", "?course=fin400&group=assignment");
    try {
      await waitFor(() => page2.document.querySelectorAll("#problem-list .tile").length, { timeout: 3000 });
      const sets = [...page2.document.querySelectorAll("#problem-list .list-group h3")].map((h) => h.textContent);
      assert.ok(sets.includes("Exercise 1 — mean of a list"), "each exercise is its own set");
      assert.ok(sets.includes("Practice 10–19"), "each practice set is its own set");
      assert.ok(sets.indexOf("Exercise 1 — mean of a list") < sets.indexOf("Practice 10–19"), "the exercises read before the practice");
    } finally {
      page2.restore();
    }

    // A half of the course can still be deep-linked.
    const page3 = await loadPage("practice/index.html", "assets/js/practice-list.js", "?course=fin400&phase=analysis");
    try {
      await waitFor(() => page3.document.querySelectorAll("#problem-list .tile").length, { timeout: 3000 });
      assert.equal(
        page3.document.querySelectorAll("#problem-list .tile").length,
        fin400Problems.filter((p) => p.phase === "analysis").length,
        "?phase= shows one half only",
      );
    } finally {
      page3.restore();
    }
  } finally {
    page.restore();
  }
});

test("a FIN 400 exercise offers hints but never reveals a solution", { skip }, async () => {
  const problem = fin400Problems.find((p) => p.type === "write_from_scratch");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelector("h1"), { timeout: 3000 });
    const labels = [...page.document.querySelectorAll(".btn")].map((b) => b.textContent);
    assert.ok(labels.some((label) => /^Hint/.test(label)), "the hint button is there");
    assert.ok(!labels.includes("Show solution"), "there is no Show solution button");
    assert.ok(!labels.includes("Show next solution line"), "guided mode reveals no solution lines");
    assert.match(page.document.getElementById("exercise").textContent, /solutions hidden|Solutions are not shown/);
    assert.match(page.document.getElementById("exercise").textContent, /FIN 400/);

    click(page.window, [...page.document.querySelectorAll(".btn")].find((b) => /^Hint/.test(b.textContent)));
    assert.match(page.document.getElementById("feedback").textContent, /Hint 1/);
  } finally {
    page.restore();
  }
});

test("ACC 525 keeps its reference solutions", { skip }, async () => {
  const problem = courseProblems.find((p) => p.type === "write_from_scratch" && p.solution);
  assert.ok(problem, "ACC 525 still ships a worked answer");
  const page = await loadPage("practice/exercise.html", "assets/js/exercise.js", `?id=${problem.id}`);
  try {
    await waitFor(() => page.document.querySelector("h1"), { timeout: 3000 });
    const labels = [...page.document.querySelectorAll(".btn")].map((b) => b.textContent);
    assert.ok(labels.includes("Show solution"), "the other class still shows one");
  } finally {
    page.restore();
  }
});

test("the home page describes the class it is showing, both halves included", { skip }, async () => {
  const page = await loadPage("index.html", "assets/js/home.js", "?course=fin400");
  try {
    await waitFor(() => page.document.querySelector("#course-hero .tile"), { timeout: 3000 });
    const hero = page.document.getElementById("course-hero");
    assert.match(hero.textContent, /FIN 400/);
    assert.match(hero.textContent, /First half — Python foundations/);
    assert.match(hero.textContent, /Second half — Notebooks/);
    assert.match(hero.textContent, /solutions hidden/);

    const stats = [...page.document.querySelectorAll("#stats .tile-value")].map((n) => n.textContent);
    assert.ok(stats.includes(String(fin400Problems.length)), "the class's exercise count is shown");

    const listed = page.document.getElementById("notebooks").textContent;
    assert.match(listed, /Module 1 — Values, strings, lists and loops/, "the class's modules are listed");
    assert.doesNotMatch(listed, /Intro 1 —/, "the other class's notebooks are not listed");
    assert.equal(page.document.querySelector("#course-picker select").value, "fin400");
  } finally {
    page.restore();
  }
});

test("learning/index.html shows a class its own modules", { skip }, async () => {
  const page = await loadPage("learning/index.html", "assets/js/learning-index.js", "?course=fin400");
  try {
    await waitFor(() => page.document.getElementById("learning-summary").textContent.length, { timeout: 3000 });
    const listed = page.document.getElementById("notebooks").textContent;
    assert.match(listed, /Module 1 — Values, strings, lists and loops/);
    assert.match(listed, /Module 5 — Portfolios and a regression/);
    assert.match(page.document.getElementById("learning-summary").textContent, /5/, "the five modules are counted");
    assert.doesNotMatch(listed, /Intro 1 —/, "the other class's notebooks are not listed");
  } finally {
    page.restore();
  }
});

/* ------------------------------------------------------------ flashcards --- */

const flashcardDeck = JSON.parse(await readFile(path.join(root, "data", "flashcards.json"), "utf8"));
const fin400Cards = flashcardDeck.cards.filter((card) => !card.courses || card.courses.includes("fin400"));

test("flashcards.html shows the deck by assignment and a card flips to its three parts", { skip }, async () => {
  const page = await loadPage("flashcards.html", "assets/js/flashcards-page.js", "?course=fin400");
  try {
    const cards = await waitFor(() => {
      const found = page.document.querySelectorAll("#flashcards .flashcard");
      return found.length ? [...found] : null;
    }, { timeout: 3000 });
    assert.ok(cards, "the deck renders");
    assert.equal(cards.length, fin400Cards.length, "every FIN 400 card is listed");
    assert.equal(page.document.querySelector("#course-picker select").value, "fin400");
    assert.equal(page.document.getElementById("flashcard-count").textContent, `${fin400Cards.length} cards`);

    const headings = [...page.document.querySelectorAll("#flashcards .list-group h3")].map((h) => h.textContent);
    assert.deepEqual(headings, ["Part 1 — Python bootcamp", "Part 2 — Notebooks, DataFrames & regression"]);

    const first = cards[0];
    const front = first.querySelector(".flashcard-front");
    const back = first.querySelector(".flashcard-back");
    assert.match(front.textContent, new RegExp(fin400Cards[0].method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(back.hidden, true, "the answer starts hidden");
    assert.equal(front.getAttribute("aria-expanded"), "false");

    click(page.window, front);
    assert.equal(back.hidden, false, "clicking the front reveals the back");
    assert.equal(front.getAttribute("aria-expanded"), "true");
    assert.match(back.textContent, /What it does/);
    assert.match(back.textContent, /In practice/);
    assert.match(back.textContent, /Output/);
    assert.equal(back.querySelector(".flashcard-code").textContent, fin400Cards[0].call);
    assert.equal(back.querySelector(".flashcard-output").textContent, fin400Cards[0].output);

    click(page.window, front);
    assert.equal(back.hidden, true, "clicking again hides the answer");
  } finally {
    page.restore();
  }
});

test("flashcards.html filters by library, topic and search, and groups three ways", { skip }, async () => {
  const page = await loadPage("flashcards.html", "assets/js/flashcards-page.js", "?course=fin400");
  try {
    const count = () => page.document.querySelectorAll("#flashcards .flashcard").length;
    await waitFor(() => count(), { timeout: 3000 });

    const group = page.document.getElementById("flashcard-group");
    type(page.window, group, "library");
    await waitFor(() => page.document.querySelector("#flashcards .list-group"), { timeout: 3000 });
    const libraries = [...page.document.querySelectorAll("#flashcards .list-group h3")].map((h) => h.textContent);
    assert.deepEqual(libraries, ["numpy", "pandas", "python", "statsmodels"], "grouping by library separates the libraries");

    const pandasCards = fin400Cards.filter((card) => card.library === "pandas");
    const library = page.document.getElementById("flashcard-library");
    type(page.window, library, "pandas");
    await waitFor(() => count() === pandasCards.length, { timeout: 3000 });
    assert.equal(count(), pandasCards.length, "the library filter keeps one library");
    assert.match(page.document.getElementById("flashcard-count").textContent, new RegExp(`^${pandasCards.length} of ${fin400Cards.length} cards$`));

    const topic = page.document.getElementById("flashcard-topic");
    type(page.window, topic, "Grouping");
    await waitFor(() => count() === 1, { timeout: 3000 });
    assert.equal(count(), 1, "one topic filter narrows the deck");
    assert.match(page.document.querySelector("#flashcards .flashcard").textContent, /groupby/);

    // Clear the selections, then search across the whole deck.
    type(page.window, library, "");
    type(page.window, topic, "");
    type(page.window, group, "alpha");
    await waitFor(() => count() === fin400Cards.length, { timeout: 3000 });
    assert.equal(count(), fin400Cards.length);
    const methods = [...page.document.querySelectorAll("#flashcards .flashcard-method")].map((n) => n.textContent);
    assert.deepEqual(methods, [...methods].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), "A–Z orders by method");

    type(page.window, page.document.getElementById("flashcard-search"), "read_csv");
    await waitFor(() => count() === 1, { timeout: 3000 });
    assert.equal(count(), 1, "the search looks inside the code too");
    assert.match(page.document.querySelector("#flashcards .flashcard").textContent, /read_csv/);
  } finally {
    page.restore();
  }
});

test("flashcards.html study deck shows one card at a time and pages with the arrow keys", { skip }, async () => {
  const page = await loadPage("flashcards.html", "assets/js/flashcards-page.js", "?course=fin400&mode=study");
  try {
    const deck = await waitFor(() => page.document.querySelector(".study-deck"), { timeout: 3000 });
    assert.ok(deck, "?mode=study opens the study deck");
    assert.equal(page.document.querySelectorAll(".study-deck .flashcard").length, 1, "only one card is shown");
    assert.match(deck.querySelector(".deck-meta").textContent, new RegExp(`Card 1 of ${fin400Cards.length}`));
    assert.equal(page.document.querySelector('#mode-bar button[data-value="study"]').getAttribute("aria-pressed"), "true");

    const back = deck.querySelector(".flashcard-back");
    assert.equal(back.hidden, true);
    const flip = [...deck.querySelectorAll(".deck-controls button")].find((b) => /Show answer/.test(b.textContent));
    click(page.window, flip);
    assert.equal(back.hidden, false, "the study deck can reveal the answer");
    assert.equal(flip.textContent, "Hide answer");

    const next = [...deck.querySelectorAll(".deck-controls button")].find((b) => /Next/.test(b.textContent));
    click(page.window, next);
    const second = page.document.querySelector(".study-deck");
    assert.match(second.querySelector(".deck-meta").textContent, new RegExp(`Card 2 of ${fin400Cards.length}`));
    assert.equal(second.querySelector(".flashcard-back").hidden, true, "a new card starts face down");
    assert.match(second.textContent, new RegExp(fin400Cards[1].method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    // Arrow keys work anywhere on the page, as long as a control is not focused.
    page.document.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await waitFor(() => /Card 1 of/.test(page.document.querySelector(".study-deck").textContent), { timeout: 3000 });
    assert.match(page.document.querySelector(".study-deck .deck-meta").textContent, new RegExp(`Card 1 of ${fin400Cards.length}`));
  } finally {
    page.restore();
  }
});

test("flashcards.html keeps known / review marks in the browser and filters by them", { skip }, async () => {
  const knownCard = fin400Cards[0];
  const reviewCard = fin400Cards[1];
  const seed = (window) =>
    window.localStorage.setItem(
      "pypractice:flashcards",
      JSON.stringify({
        [knownCard.id]: { status: "known", updatedAt: "2026-01-01T00:00:00.000Z" },
        [reviewCard.id]: { status: "review", updatedAt: "2026-01-02T00:00:00.000Z" },
      }),
    );

  const page = await loadPage("flashcards.html", "assets/js/flashcards-page.js", "?course=fin400", seed);
  try {
    const count = () => page.document.querySelectorAll("#flashcards .flashcard").length;
    await waitFor(() => count(), { timeout: 3000 });

    const summary = page.document.getElementById("flashcard-progress");
    assert.match(summary.textContent, new RegExp(`1 of ${fin400Cards.length} cards known`));
    assert.match(summary.textContent, /1 to review/);
    assert.equal(summary.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), String(Math.round((1 / fin400Cards.length) * 100)));
    // The marks survive a reload: they came from localStorage, not from this page.
    assert.match(page.document.querySelector(`[data-card="${knownCard.id}"] .flashcard-status`).textContent, /known/);
    assert.match(page.document.querySelector(`[data-card="${reviewCard.id}"] .flashcard-status`).textContent, /review/);

    const status = page.document.getElementById("flashcard-status");
    type(page.window, status, "known");
    await waitFor(() => count() === 1, { timeout: 3000 });
    assert.equal(count(), 1, "the progress filter keeps only known cards");
    assert.match(page.document.querySelector("#flashcards .flashcard").textContent, new RegExp(knownCard.method.slice(0, 4)));
    assert.match(page.document.getElementById("flashcard-count").textContent, new RegExp(`^1 of ${fin400Cards.length} cards$`));

    type(page.window, status, "unseen");
    await waitFor(() => count() === fin400Cards.length - 2, { timeout: 3000 });
    assert.equal(count(), fin400Cards.length - 2, "the unseen filter drops the marked cards");

    // The choice travels in the URL, so a shared link opens the same slice.
    assert.equal(new URL(page.window.location.href).searchParams.get("status"), "unseen");
  } finally {
    page.restore();
  }
});

test("flashcards.html marks a card from its back and can reset every mark", { skip }, async () => {
  const page = await loadPage("flashcards.html", "assets/js/flashcards-page.js", "?course=fin400");
  try {
    const first = await waitFor(() => page.document.querySelector("#flashcards .flashcard"), { timeout: 3000 });
    assert.ok(first, "the deck renders");
    const cardId = first.dataset.card;
    click(page.window, first.querySelector(".flashcard-front"));

    const known = first.querySelector('.flashcard-back button[data-status="known"]');
    assert.ok(known, "the back offers a Known button");
    click(page.window, known);
    const stored = JSON.parse(page.window.localStorage.getItem("pypractice:flashcards"));
    assert.equal(stored[cardId].status, "known", "the mark is written to localStorage");
    assert.ok(stored[cardId].updatedAt, "the mark records when it was set");
    assert.equal(known.getAttribute("aria-pressed"), "true");
    assert.match(page.document.getElementById("flashcard-progress").textContent, new RegExp(`1 of ${fin400Cards.length} cards known`));

    // Clicking the same button again takes the mark back off.
    click(page.window, known);
    assert.deepEqual(JSON.parse(page.window.localStorage.getItem("pypractice:flashcards")), {});
    assert.equal(known.getAttribute("aria-pressed"), "false");

    click(page.window, known);
    page.window.confirm = () => true;
    click(page.window, page.document.getElementById("flashcard-reset"));
    assert.deepEqual(JSON.parse(page.window.localStorage.getItem("pypractice:flashcards")), {});
    assert.match(page.document.getElementById("flashcard-progress").textContent, new RegExp(`0 of ${fin400Cards.length} cards known`));
  } finally {
    page.restore();
  }
});

test("flashcards.html says where a class without cards gets them", { skip }, async () => {
  const page = await loadPage("flashcards.html", "assets/js/flashcards-page.js", "?course=acc525");
  try {
    const notice = await waitFor(() => page.document.querySelector("#flashcards .notice"), { timeout: 3000 });
    assert.ok(notice, "an empty class explains itself instead of showing a blank page");
    assert.match(notice.textContent, /No flashcards for ACC 525/);
    assert.match(notice.textContent, /data\/flashcards\.json/);
    const link = notice.querySelector('a[href="?course=fin400"]');
    assert.ok(link, "the empty state points at the class that has cards");
    assert.match(link.textContent, /FIN 400/);
  } finally {
    page.restore();
  }
});
