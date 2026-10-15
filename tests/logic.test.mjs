/**
 * Unit tests for the DOM-free logic: markdown rendering, glossary linking,
 * output normalization, diffing and the graders.
 *
 *   node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  compareOutput,
  diffLines,
  escapeHtml,
  linkTerms,
  mdToHtml,
  normalizeOutput,
  slugify,
} from "../assets/js/util.js";
import { countBlanks, fillTemplate, gradeBlanks, gradeRun, gradeText, splitTemplate, summarize } from "../assets/js/grade.js";
import { buildDraftProblem, dataFileHints, importedModules, packageHints } from "../assets/js/analyze.js";

test("slugify matches the Python builder", () => {
  assert.equal(slugify("Part 1 — Python Basics"), "part-1-python-basics");
  assert.equal(slugify("Exercise 2 — a small function"), "exercise-2-a-small-function");
  assert.equal(slugify("for loop"), "for-loop");
  assert.equal(slugify("!!!"), "section");
  assert.equal(slugify("  Trim  me  "), "trim-me");
});

test("normalizeOutput ignores trailing spaces, tabs and blank-line padding", () => {
  assert.equal(normalizeOutput("\n15  \n\n"), "15");
  assert.equal(normalizeOutput("a\tb\n"), "a    b");
  assert.equal(normalizeOutput("1\n2\n\n"), "1\n2");
  assert.equal(normalizeOutput(""), "");
  // Leading spaces are meaningful: numpy and pandas indent wrapped output.
  assert.equal(normalizeOutput("[[1 2]\n [3 4]]"), "[[1 2]\n [3 4]]");
  assert.equal(normalizeOutput("  15"), "  15");
});

test("compareOutput reports mismatches with and without whitespace tolerance", () => {
  assert.equal(compareOutput("15\n", "15").ok, true);
  assert.equal(compareOutput(" a  b ", "a b").ok, false);
  assert.equal(compareOutput(" a  b ", "a b", { ignoreWhitespace: true }).ok, true);
  assert.equal(compareOutput("YES", "yes").ok, false);
  assert.equal(compareOutput("YES", "yes", { ignoreCase: true }).ok, true);
});

test("diffLines marks extra and missing lines", () => {
  const ops = diffLines("a\nb\nd", "a\nc\nd");
  assert.deepEqual(
    ops.map((op) => op.type),
    ["same", "extra", "missing", "same"],
  );
  assert.equal(diffLines("x", "x").every((op) => op.type === "same"), true);
});

test("mdToHtml renders the markdown subset and escapes HTML", () => {
  const { html, headings } = mdToHtml("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n```python\nprint(1)\n```");
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-python">print\(1\)<\/code><\/pre>/);
  assert.equal(headings[0].id, "title");

  const nasty = mdToHtml('<script>alert("x")</script>').html;
  assert.ok(!nasty.includes("<script>"), "raw HTML must be escaped, not executed");
  assert.match(nasty, /&lt;script&gt;/);
});

test("mdToHtml renders tables and nested lists", () => {
  const table = mdToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |\n").html;
  assert.match(table, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/);
  assert.match(table, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/);

  const nested = mdToHtml("- top\n  - inner\n").html;
  assert.match(nested, /^<ul><li>/, "the outer list is a list");
  assert.match(nested, /<ul><li>inner<\/li><\/ul>/, "the second level becomes its own list");
  assert.ok(!nested.includes("[object Object]"), "rendering must not leak raw objects");
});

test("mdToHtml turns [[term]] markup into glossary links", () => {
  const html = mdToHtml("Use [[for-loop|a for loop]] here.").html;
  assert.match(html, /<a class="term" href="glossary.html#for-loop"/);
  assert.match(html, /a for loop<\/a>/);
});

test("linkTerms links the first occurrence outside code and existing links", () => {
  const entries = [
    { term: "for loop", aliases: ["for"], slug: "for-loop" },
    { term: "list", slug: "list" },
  ];
  const source = "A `for loop` in code, then a for loop in prose and another for loop after.\n\nSee [for loop](https://x) and [[list]].";
  const linked = linkTerms(source, entries);
  assert.equal(linked.match(/\[\[for-loop\|/g).length, 1, "only the first prose occurrence is linked");
  assert.ok(linked.includes("`for loop`"), "code spans stay untouched");
  assert.ok(linked.includes("[for loop](https://x)"), "markdown links stay untouched");
  assert.ok(linked.includes("[[list]]"), "existing glossary markup is left alone");
});

test("splitTemplate/fillTemplate round-trip blanks", () => {
  const template = "evens = [n ___ n in numbers if n ___ 2 == 0]";
  assert.equal(countBlanks(template), 2);
  assert.deepEqual(splitTemplate(template), ["evens = [n ", " n in numbers if n ", " 2 == 0]"]);
  assert.equal(fillTemplate(template, ["for", "%"]), "evens = [n for n in numbers if n % 2 == 0]");
  assert.equal(fillTemplate(template, ["for"]), "evens = [n for n in numbers if n  2 == 0]", "missing values become empty text");
});

test("gradeRun requires error-free execution, matching output and passing tests", () => {
  const problem = { type: "fix_the_code", expected_output: "15", tests: "assert total == 15" };

  const good = gradeRun(problem, { stdout: "15\n", stderr: "", error: null });
  assert.equal(good.ok, true);
  assert.equal(summarize(good), "Correct — nice work!");

  const wrongOutput = gradeRun(problem, { stdout: "10\n", stderr: "", error: null });
  assert.equal(wrongOutput.ok, false);
  assert.deepEqual(
    wrongOutput.checks.map((c) => c.ok),
    [true, true, false],
  );

  const crashed = gradeRun(problem, {
    stdout: "",
    stderr: "",
    error: { type: "NameError", message: "NameError: name 'total' is not defined", where: "user", line: 1, source: "print(total)" },
  });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.checks[0].ok, false);
  assert.equal(crashed.checks[1].ok, false, "the hidden tests cannot pass when the code crashes");
});

test("gradeRun reports a broken exercise setup as not the learner's fault", () => {
  const verdict = gradeRun(
    { type: "write_from_scratch", tests: "assert f(1)" },
    { stdout: "", stderr: "", error: { type: "ImportError", message: "ImportError: no module named x", where: "setup" } },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.checks.at(-1).name, /setup/i);
});

test("gradeText and gradeBlanks give per-item feedback", () => {
  const predict = gradeText({ type: "predict_output", expected_output: "1\n2\n3" }, "1\n2\n3\n");
  assert.equal(predict.ok, true);

  const partial = gradeBlanks(
    { type: "fill_in_blank", blanks: [{ accepted: ["for"] }, { accepted: ["%"] }] },
    ["for", "//"],
  );
  assert.equal(partial.ok, false);
  assert.deepEqual(
    partial.blankChecks.map((c) => c.ok),
    [true, false],
  );
  assert.equal(partial.blankChecks[1].detail, "Not one of the expected answers.");

  const hinted = gradeBlanks({ type: "fill_in_blank", blanks: [{ accepted: ["for"], hint: "use the for keyword" }] }, ["while"]);
  assert.match(hinted.blankChecks[0].detail, /Hint: use the for keyword/);

  const noExpectations = gradeBlanks({ type: "fill_in_blank", blanks: [{ hint: "x" }] }, ["anything"]);
  assert.equal(noExpectations.ok, true, "a blank without accepted answers is not judged statically");
});

test("site URLs resolve against the module location, so a path prefix keeps working", async () => {
  const { PATHS, SITE_ROOT, siteUrl } = await import("../assets/js/config.js");
  const configUrl = new URL("../assets/js/config.js", import.meta.url);
  assert.equal(SITE_ROOT.href, new URL("../../", configUrl).href, "the site root is two levels above config.js");
  assert.equal(PATHS.problems, siteUrl("problems/index.json"));
  assert.ok(PATHS.problems.endsWith("/problems/index.json"));
  assert.ok(PATHS.notebooks.endsWith("/data/notebooks.json"));
  assert.ok(PATHS.glossary.endsWith("/data/glossary.json"));
  assert.equal(siteUrl("notebooks/x.ipynb"), new URL("notebooks/x.ipynb", SITE_ROOT).href);
  assert.ok(new URL(SITE_ROOT).pathname.length > 1, "the site root must be a folder, not the origin root (GitHub Pages serves under /repo/)");
});

test("generated exercises carry the setup and data files they need to run", () => {
  const unit = {
    title: "Append 10 to list1",
    prompt: "3. Append 10 to list1.\n",
    codeCells: ["list1.append(10)", "list1"],
    setupCells: ["list1 = [1, 2]"],
    index: 7,
    itemNumber: 3,
  };
  const run = { ok: true, stdout: "[1, 2, 10]\n", error: null };
  const drafts = buildDraftProblem(unit, run, {
    idPrefix: "auto",
    withPredictVariant: true,
    setupUsable: true,
    dataFiles: { "helpers.py": "materials/helpers.py" },
  });

  const exercise = drafts.find((d) => d.type === "write_from_scratch");
  assert.match(exercise.setup, /list1 = \[1, 2\]/, "the notebook state runs before the answer");
  assert.deepEqual(exercise.data_files, { "helpers.py": "materials/helpers.py" });
  assert.equal(exercise.expected_output, "[1, 2, 10]");

  const predict = drafts.find((d) => d.type === "predict_output");
  assert.ok(predict, "a short checked exercise also gets a predict variant");
  assert.match(predict.setup, /list1 = \[1, 2\]/, "without the setup the code raises NameError");
  assert.deepEqual(predict.data_files, { "helpers.py": "materials/helpers.py" });
  assert.equal(predict.expected_output, "[1, 2, 10]");
  assert.equal(predict.capture_last_expression, true);
});


test("importedModules finds the modules code imports, so uploaded .py helpers can be copied in", () => {
  assert.deepEqual(importedModules("import pandas as pd\nimport os\n"), ["pandas", "os"]);
  assert.deepEqual(importedModules("from analyticskit import total, median\n"), ["analyticskit"]);
  assert.deepEqual(importedModules("import matplotlib.pyplot as plt\n"), ["matplotlib"]);
  assert.deepEqual(importedModules("from __future__ import annotations\nimport x\n"), ["x"], "__future__ is not a file to look for");
  assert.deepEqual(importedModules("# import nothing\nprint('import nope')\n"), [], "only real import statements count");
});

test("dataFileHints lists the data files notebook code reads", () => {
  assert.deepEqual(dataFileHints("data = pd.read_csv('materials/datasets/sales.csv')\n"), ["sales.csv"]);
  assert.deepEqual(dataFileHints("open('avocados.txt')\n"), ["avocados.txt"]);
  assert.deepEqual(dataFileHints("x = 1\n"), []);
});

test("packageHints maps imports to the packages the sandbox must load", () => {
  assert.deepEqual(packageHints("import numpy as np\n"), ["numpy"]);
  assert.deepEqual(packageHints("import pandas as pd\ndf = pd.DataFrame()\n"), ["pandas"]);
  assert.deepEqual(packageHints("print('plain python')\n"), []);
});

test("escapeHtml covers the five dangerous characters", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
