/**
 * The upload page is where the whole system is fed, so it gets its own test:
 * the real page HTML, the real module, and the real storage layer are driven
 * here (media files and Pyodide are not involved — they are covered elsewhere).
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
const skip = JSDOM ? false : "jsdom is not installed (npm install --no-save jsdom)";
// A real class notebook, fetched the way the page's URL box does it.
const notebookName = "Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb";
const notebookFile = path.join(root, "acc525", "Intro to Python", notebookName);

async function fetchFromDisk(url) {
  const parsed = new URL(String(url));
  let filePath = null;
  if (parsed.protocol === "file:") filePath = fileURLToPath(parsed);
  else if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    filePath = path.join(root, decodeURIComponent(parsed.pathname));
  }
  if (!filePath) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  try {
    const text = await readFile(filePath, "utf8");
    return { ok: true, status: 200, url: String(url), json: async () => JSON.parse(text), text: async () => text };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
}

async function loadUploadPage() {
  const html = await readFile(path.join(root, "upload.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/upload.html", pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.scrollTo = () => {};
  if (!window.CSS) window.CSS = {};
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => "blob:stub";

  const names = [
    "window", "document", "location", "history", "localStorage", "navigator",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CSS",
    "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "Blob",
  ];
  const saved = new Map();
  for (const name of names) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    try {
      Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
    } catch {
      /* read-only globals stay as they are */
    }
  }
  const savedFetch = globalThis.fetch;
  globalThis.fetch = fetchFromDisk;

  await import(`${pathToFileURL(path.join(root, "assets/js/upload.js")).href}?page=${Date.now()}${Math.random()}`);
  return {
    window,
    document: window.document,
    restore() {
      globalThis.fetch = savedFetch;
      for (const [name, desc] of saved) {
        try {
          if (desc) Object.defineProperty(globalThis, name, desc);
        } catch {
          /* ignore */
        }
      }
    },
  };
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

test("upload.html analyzes a fetched notebook and stores it in the browser", { skip }, async () => {
  const page = await loadUploadPage();
  try {
    const { document } = page;
    assert.ok(document.getElementById("drop"), "the drop zone is there");
    assert.equal(document.querySelectorAll("nav.main a").length, 7, "every page carries the same navigation");
    assert.match(document.querySelector('nav.main a[href="upload.html"]').textContent, /Add material/);
    assert.match(document.body.textContent, /materials\//, "the page says where uploads are stored");

    // Fetch a notebook the way the page's URL box does, so the whole add → analyze
    // path runs without needing a real file picker.
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("Intro to Python (Part 1)")) {
        const text = await readFile(notebookFile, "utf8");
        return { ok: true, status: 200, url: String(url), text: async () => text, json: async () => JSON.parse(text) };
      }
      return fetchFromDisk(url, options);
    };
    // Pin the destination: the page would otherwise start in the class folder
    // once data/courses.json has loaded, which races with this fetch.
    document.getElementById("folder").value = "acc525";
    const urlInput = document.getElementById("url-input");
    urlInput.value = `http://localhost/acc525/${encodeURIComponent("Intro to Python")}/${encodeURIComponent(notebookName)}`;
    click(page.window, document.getElementById("fetch-url"));

    const rows = await waitFor(() => {
      const found = document.querySelectorAll("#files table tbody tr");
      return found.length ? found : null;
    });
    assert.equal(rows.length, 1, "the fetched notebook is listed");
    assert.match(document.getElementById("files").textContent, /Intro to Python \(Part 1\)/);
    assert.match(document.getElementById("files").textContent, /notebook/, "its kind is detected");

    // Analysis without exercise generation (Python is not started in this test).
    const generate = document.getElementById("generate");
    generate.checked = false;
    click(page.window, document.getElementById("analyze"));
    const status = await waitFor(() =>
      /Analysis finished/.test(document.getElementById("status").textContent) ? document.getElementById("status").textContent : null,
    );
    assert.ok(status, "the page reports that analysis finished");
    assert.match(status, /Build practice exercises/);

    // Save the analyzed file to this browser: real storage layer, real payload.
    click(page.window, document.getElementById("save-browser"));
    const saved = await waitFor(() =>
      /stored in this browser/.test(document.getElementById("status").textContent) ? document.getElementById("status").textContent : null,
    );
    assert.ok(saved, "the browser store confirms the save");
    const stored = JSON.parse(page.window.localStorage.getItem("pypractice:uploads"));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].path, `acc525/${notebookName}`);
    assert.equal(stored[0].kind, "notebook");
    assert.match(stored[0].entry.title, /Introduction to Python \(Part 1\)/, "the analyzed title travels with the file");
    assert.ok(stored[0].entry.exercises.length >= 1, "the exercises inside the file were detected");
    assert.match(document.getElementById("save-hint").textContent, /Already in this browser: 1 file/);

    // A second save updates in place instead of duplicating.
    click(page.window, document.getElementById("save-browser"));
    await waitFor(() => /stored in this browser/.test(document.getElementById("status").textContent));
    const again = JSON.parse(page.window.localStorage.getItem("pypractice:uploads"));
    assert.equal(again.length, 1, "re-saving the same path replaces the record");
  } finally {
    page.restore();
  }
});

test("a private upload folder never builds exercises", { skip }, async () => {
  const page = await loadUploadPage();
  try {
    const { document } = page;
    await waitFor(() => document.querySelector("#course-picker select"), { timeout: 3000 });

    // Pin the destination: the page would otherwise start in the class folder
    // once data/courses.json has loaded, which races with this fetch.
    document.getElementById("folder").value = "acc525";
    const urlInput = document.getElementById("url-input");
    urlInput.value = `http://localhost/acc525/${encodeURIComponent("Intro to Python")}/${encodeURIComponent(notebookName)}`;
    click(page.window, document.getElementById("fetch-url"));
    await waitFor(() => document.querySelectorAll("#files table tbody tr").length, { timeout: 3000 });

    // FIN 400 keeps fin400/solutions off the site; the page must say so and stop
    // building exercises, because an exercise's expected output is the answer.
    const folder = document.getElementById("folder");
    folder.value = "fin400/solutions";
    folder.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    const warning = document.getElementById("private-warning");
    assert.equal(warning.classList.contains("hidden"), false, "the private destination is explained");
    assert.equal(document.getElementById("generate").disabled, true, "exercise generation is switched off");

    click(page.window, document.getElementById("analyze"));
    const status = await waitFor(() =>
      /private, so no practice exercises/.test(document.getElementById("status").textContent)
        ? document.getElementById("status").textContent
        : null,
    );
    assert.ok(status, "analysis reports that it did not build exercises");
    assert.deepEqual(JSON.parse(page.window.localStorage.getItem("pypractice:drafts") || "[]"), [], "no draft was created");
  } finally {
    page.restore();
  }
});

test("analyzing a notebook that imports a library ends with a message, not silence", { skip }, async () => {
  // Regression: generating exercises looked the helper modules up with
  // `const uploaded = uploaded.has(...)`, so the first notebook that imports
  // anything (pandas, math, …) threw a ReferenceError. The rejection went
  // nowhere and the Analyze button appeared to do nothing at all.
  const page = await loadUploadPage();
  try {
    const { document } = page;
    await waitFor(() => document.querySelector("#course-picker select"), { timeout: 3000 });
    document.getElementById("folder").value = "acc525";

    const importing = "Data Analysis (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb";
    globalThis.fetch = async (url, options) => {
      if (String(url).includes(encodeURIComponent(importing)) || String(url).includes(importing)) {
        const text = await readFile(path.join(root, "acc525", "Data Analysis", importing), "utf8");
        return { ok: true, status: 200, url: String(url), text: async () => text, json: async () => JSON.parse(text) };
      }
      return fetchFromDisk(url, options);
    };
    const urlInput = document.getElementById("url-input");
    urlInput.value = `http://localhost/acc525/${encodeURIComponent("Data Analysis")}/${encodeURIComponent(importing)}`;
    click(page.window, document.getElementById("fetch-url"));
    await waitFor(() => document.querySelectorAll("#files table tbody tr").length, { timeout: 5000 });

    // Generation stays on — the page's default, and the path that used to die.
    assert.equal(document.getElementById("generate").checked, true);
    const analyze = document.getElementById("analyze");
    click(page.window, analyze);
    assert.equal(analyze.disabled, true, "the button locks while it works");
    assert.equal(document.getElementById("progress").classList.contains("hidden"), false, "a progress bar appears");

    const status = await waitFor(() => {
      const text = document.getElementById("status").textContent;
      return /Built \d+ practice exercise|No exercises could be built|Analysis stopped|Analysis failed/.test(text) ? text : null;
    }, { timeout: 30000 });
    assert.ok(status, `the page reports a result, not silence: “${document.getElementById("status").textContent}”`);
    assert.doesNotMatch(status, /Analysis stopped|Analysis failed/, "generation no longer throws on an importing notebook");
    assert.equal(analyze.disabled, false, "the button is usable again");
    assert.equal(analyze.textContent, "Analyze files", "the button keeps its label");
    assert.equal(document.getElementById("progress").classList.contains("hidden"), true, "the progress bar is put away");
  } finally {
    page.restore();
  }
});
