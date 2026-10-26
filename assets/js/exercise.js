/**
 * The exercise engine: one page (practice/exercise.html?id=…) that renders any
 * of the four exercise types, runs the learner's code in Pyodide and gives
 * immediate feedback.
 */

import { assignmentForProblem, loadAssignments } from "./assignments.js";
import { siteUrl } from "./config.js";
import { activeCourse, loadCourses, mountCoursePicker } from "./course.js";
import { resolveDataFiles } from "./datasets.js";
import { createEditor } from "./editor.js";
import { fillTemplate, gradeBlanks, gradeRun, gradeText, isAutoGradable, splitTemplate } from "./grade.js";
import { compareOutput, mdToHtml } from "./util.js";
import { loadGlossary, renderTermChips, termsForProblem } from "./glossary.js";
import { loadProblems, problemStatus, savedAttempt } from "./problems.js";
import { onStatus, runPython, statusSnapshot } from "./runner.js";
import {
  TYPE_LABELS,
  el,
  escapeHtml,
  getProgress,
  linkTerms,
  mergeProgress,
  param,
  recordAttempt,
} from "./util.js";

const state = {
  problems: [],
  problem: null,
  course: null,
  glossary: null,
  terms: [],
  // "hidden" on a class whose reference answers are not published (FIN 400).
  // The build strips the solution from the bundle for those, so there is
  // nothing to reveal even if a button were left behind.
  solutions: "shown",
  editor: null,
  blankInputs: [],
  mode: "guided",
  hintsShown: 0,
  solutionLinesShown: 0,
  revealed: false,
  busy: false,
  lastVerdict: null,
};

const nodes = {};

/* --------------------------------------------------------------- helpers --- */

function feedbackArea() {
  return nodes.feedback;
}

function setFeedback(html) {
  feedbackArea().innerHTML = html;
  feedbackArea().classList.remove("hidden");
  feedbackArea().scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderMarkdown(text) {
  return mdToHtml(linkTerms(text, state.terms), { glossaryBase: siteUrl("glossary.html") }).html;
}

function setBusy(busy, label = "Checking…") {
  state.busy = busy;
  if (!nodes.checkButton) return;
  nodes.checkButton.disabled = busy;
  nodes.checkButton.innerHTML = busy ? `<span class="spinner"></span> ${escapeHtml(label)}` : "Check answer";
}

function updateRuntimeStatus(status) {
  if (!nodes.runtime) return;
  if (status.state === "ready") {
    nodes.runtime.className = "tiny muted";
    nodes.runtime.textContent = "Python ready";
  } else if (status.state === "error") {
    nodes.runtime.className = "tiny";
    nodes.runtime.style.color = "var(--bad)";
    nodes.runtime.textContent = `Python failed to start: ${status.message}`;
  } else {
    nodes.runtime.className = "tiny muted";
    nodes.runtime.textContent = status.message || "Starting Python…";
  }
}

function currentCode() {
  if (state.editor) return state.editor.getValue();
  if (state.problem?.type === "fill_in_blank") {
    return fillTemplate(state.problem.starter_code, state.blankInputs.map((input) => input.value));
  }
  return "";
}

function persist(patch = {}, { countAttempt = false } = {}) {
  const id = state.problem.id;
  if (countAttempt) recordAttempt(id, patch);
  else mergeProgress(id, patch);
  renderProgressLine();
}

function renderProgressLine() {
  const record = getProgress()[state.problem.id] || {};
  if (!nodes.progress) return;
  const bits = [];
  if (record.status === "solved") bits.push('<span class="badge solved">solved</span>');
  else if (record.status === "attempted") bits.push('<span class="badge attempted">in progress</span>');
  if (record.attempts) bits.push(`attempts: ${record.attempts}`);
  if (record.hintsUsed) bits.push(`hints used: ${record.hintsUsed}`);
  nodes.progress.innerHTML = bits.join(" ");
}

/* -------------------------------------------------------------- feedback --- */

function checkIcon(ok) {
  return ok ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✗</span>';
}

function diffBlock(diff) {
  if (!diff) return "";
  const lines = diff
    .map((op) => {
      const prefix = op.type === "same" ? "  " : op.type === "extra" ? "- " : "+ ";
      return `<div class="diff-line ${op.type}">${escapeHtml(prefix + op.text) || "&nbsp;"}</div>`;
    })
    .join("");
  return `<div style="margin-top:.5rem"><h5 style="margin:.2rem 0;font-size:.85rem;text-transform:uppercase;letter-spacing:.03em;color:var(--fg-muted)">Line by line ( - yours / + expected )</h5>${lines}</div>`;
}

function errorBlock(error) {
  if (!error) return "";
  const where =
    error.where === "tests"
      ? "The hidden checks reported:"
      : error.line
        ? `Error on line ${error.line}${error.source ? ` — <code>${escapeHtml(error.source.trim())}</code>` : ""}:`
        : "Error:";
  const trace = error.traceback && error.traceback !== error.message
    ? `<details><summary class="small muted">Full traceback</summary><pre class="trace"><code>${escapeHtml(error.traceback)}</code></pre></details>`
    : "";
  return `<div class="verdict bad"><h4>${where}</h4><pre><code>${escapeHtml(error.message)}</code></pre>${trace}</div>`;
}

/**
 * The output panel: what the program printed, side by side with what the
 * exercise expects. Green when the two line up, red when they do not — so the
 * learner always sees the run, not just a verdict.
 */
function expectedCompare({ actual = null, expected = null, verdict, diff = null }) {
  const actualText = actual == null ? "" : String(actual).replace(/\s+$/, "");
  const expectedText = expected == null ? "" : String(expected).replace(/\s+$/, "");
  const hasExpected = expectedText !== "";

  // Use the same comparison the grader uses, so the badge can never disagree
  // with the checks above it (whitespace/case tolerance included).
  const problem = state.problem || {};
  const aligned = hasExpected
    ? compareOutput(actualText, expectedText, {
        ignoreWhitespace: Boolean(problem.ignore_whitespace),
        ignoreCase: Boolean(problem.ignore_case),
      }).ok
    : verdict.ok;
  const badge = hasExpected
    ? aligned
      ? '<span class="match-badge ok">✓ Matches the expected output</span>'
      : '<span class="match-badge bad">✗ Does not match the expected output</span>'
    : verdict.ok
      ? '<span class="match-badge ok">✓ Checks passed</span>'
      : '<span class="match-badge bad">✗ Checks failed</span>';

  if (!hasExpected) {
    // No fixed output to compare with; the assertions above are the yardstick.
    return (
      `<div class="verdict info" style="margin-top:.6rem"><div class="row-between">` +
      `<h4 style="margin:0">Expected</h4>${badge}</div>` +
      `<p class="small muted" style="margin:.35rem 0 0">This exercise is checked by assertions rather than by a fixed printed output.</p></div>`
    );
  }

  const parts = [
    `<div class="verdict info" style="margin-top:.6rem"><div class="row-between">` +
      `<h4 style="margin:0">Expected output</h4>${badge}</div>`,
    `<pre style="margin:.45rem 0 0"><code>${escapeHtml(expectedText)}</code></pre>`,
  ];
  if (diff && !aligned) parts.push(diffBlock(diff));
  parts.push("</div>");
  return parts.join("");
}

/**
 * The run panel. It sits directly under the code box and is written on every
 * check, right or wrong: the output is the first thing to read, so it never has
 * to be hunted for below a verdict.
 */
function renderOutput({ actual = null, stderr = "", error = null, label = "Output" } = {}) {
  if (!nodes.output) return;
  const text = actual == null ? "" : String(actual).replace(/\s+$/, "");
  const parts = [
    `<div class="cell-tag" style="margin:0 0 .3rem">${escapeHtml(label)}</div>`,
    text
      ? `<pre class="run-output"><code>${escapeHtml(text)}</code></pre>`
      : '<p class="small muted run-output empty">It printed nothing.</p>',
  ];
  const errText = String(stderr || "").replace(/\s+$/, "");
  if (errText) parts.push(`<pre class="run-output stderr"><code>${escapeHtml(errText)}</code></pre>`);
  if (error) {
    parts.push(
      `<div class="notice bad small" style="margin:.45rem 0 0">` +
        `<strong>${escapeHtml(error.type || "Error")}</strong>` +
        `${error.line ? ` on line ${error.line}` : ""}: ${escapeHtml(error.message)}</div>`,
    );
  }
  nodes.output.innerHTML = parts.join("");
  nodes.output.classList.remove("hidden");
}

function clearOutput() {
  if (!nodes.output) return;
  nodes.output.innerHTML = "";
  nodes.output.classList.add("hidden");
}

function showVerdict(verdict, { expected = null, actual = null, error = null, stderr = "", diff = null, extra = "" } = {}) {
  const parts = [];
  if (extra) parts.push(extra);
  const title = verdict.ok ? "Correct!" : "Not quite yet";
  parts.push(
    `<div class="verdict ${verdict.ok ? "ok" : "bad"}"><h4>${title}</h4>` +
      `<ul class="small" style="margin:.2rem 0 .4rem;padding-left:1.1rem">` +
      verdict.checks.map((c) => `<li>${checkIcon(c.ok)} ${escapeHtml(c.name)}${c.detail ? ` — <span class="muted">${escapeHtml(c.detail)}</span>` : ""}</li>`).join("") +
      `</ul></div>`,
  );

  // The run itself is already shown above, directly under the code. What belongs
  // here is the yardstick: what was expected, and how the two compare.
  parts.push(expectedCompare({ actual, expected, verdict, diff }));

  setFeedback(parts.join(""));
  state.lastVerdict = verdict;
}

/* ------------------------------------------------------------- type: fix --- */

function setupEditorTask(problem, { value, minLines = 6, readOnly = false, plain = false, placeholder = "" } = {}) {
  const host = el("div", { class: "stack" });
  const editorHost = el("div");
  host.append(editorHost);
  state.editor = createEditor(editorHost, {
    value: value ?? "",
    minLines,
    readOnly,
    plain,
    placeholder,
    onRun: () => check(),
    onChange: debouncedSave,
  });
  return host;
}

let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.problem) return;
    persist({ code: currentCode(), mode: state.mode, hintsUsed: state.hintsShown });
  }, 700);
}

/* ------------------------------------------------------------ type: fill --- */

function setupFillInBlank(problem) {
  const wrapper = el("div", { class: "stack" });
  const codeBox = el("div", { class: "fillcode" });
  const lines = String(problem.starter_code ?? "").split("\n");
  state.blankInputs = [];

  lines.forEach((line, lineIndex) => {
    const chunks = splitTemplate(line);
    chunks.forEach((chunk, chunkIndex) => {
      codeBox.append(document.createTextNode(chunk));
      if (chunkIndex < chunks.length - 1) {
        const blank = el("input", {
          class: "blank",
          type: "text",
          spellcheck: "false",
          autocomplete: "off",
          "aria-label": `blank ${state.blankInputs.length + 1}`,
        });
        blank.size = Math.max(6, Math.min(24, (problem.blanks?.[state.blankInputs.length]?.accepted?.[0] || "").length + 4 || 8));
        blank.addEventListener("input", () => {
          blank.classList.remove("ok", "bad");
          debouncedSave();
        });
        blank.addEventListener("keydown", (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            check();
          }
        });
        state.blankInputs.push(blank);
        codeBox.append(blank);
      }
    });
    if (lineIndex < lines.length - 1) codeBox.append(document.createTextNode("\n"));
  });

  wrapper.append(codeBox);
  const hint = el("p", {
    class: "tiny muted",
    text: `${state.blankInputs.length} blank${state.blankInputs.length === 1 ? "" : "s"} · press Tab to move on, Ctrl/Cmd+Enter to check`,
  });
  wrapper.append(hint);
  return wrapper;
}

/* ------------------------------------------------- type: predict output --- */

function setupPredictOutput(problem) {
  const wrapper = el("div", { class: "stack" });
  wrapper.append(el("div", { class: "cell-tag", text: "Code to read" }));
  wrapper.append(el("pre", { html: `<code>${escapeHtml(String(problem.starter_code ?? "").replace(/\n$/, ""))}</code>` }));
  const saved = savedAttempt(problem.id);
  const host = el("div");
  wrapper.append(el("div", { class: "cell-tag", text: "What does it print? (one line per printed line)" }));
  wrapper.append(host);
  state.editor = createEditor(host, {
    value: (saved && saved.typedOutput) || "",
    minLines: 4,
    plain: true,
    placeholder: "type the exact output here…",
    onRun: () => check(),
    onChange: () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => persist({ typedOutput: currentCode() }), 700);
    },
  });
  return wrapper;
}

/* --------------------------------------------- type: write from scratch --- */

function setupWriteFromScratch(problem) {
  const wrapper = el("div", { class: "stack" });
  const allowed = problem.mode === "guided" || problem.mode === "lines" ? problem.mode : "both";

  if (allowed === "both") {
    const pills = el("div", { class: "pill-row" });
    const modes = [
      ["guided", "Step-by-step hints"],
      ["lines", `Line-count mode${problem.line_count ? ` (${problem.line_count} lines)` : ""}`],
    ];
    for (const [value, label] of modes) {
      const pill = el("button", { class: "pill", type: "button", text: label });
      pill.addEventListener("click", () => setMode(value, pills));
      pill.dataset.mode = value;
      pills.append(pill);
    }
    wrapper.append(el("div", { class: "small muted", text: "Choose how much scaffolding you want:" }));
    wrapper.append(pills);
    state.mode = allowed === "both" ? "guided" : allowed;
  } else {
    state.mode = allowed;
  }

  const guidedBox = el("div", { class: "card hidden" });
  const linesBox = el("div", { class: "card hidden" });
  wrapper.append(guidedBox, linesBox);

  // Guided mode
  const hintList = el("ul", { class: "hint-list small" });
  const guidedActions = el("div", { class: "btn-row" });
  const showHint = el("button", { class: "btn small", type: "button", text: "Show hint 1" });
  const showLine = el("button", {
    class: "btn small ghost",
    type: "button",
    text: "Show next solution line",
  });
  // A class that hides solutions gets no line-by-line reveal either: hints are
  // the only scaffolding on offer.
  showHint.addEventListener("click", () => {
    const hints = problem.hints || [];
    if (state.hintsShown >= hints.length) return;
    state.hintsShown += 1;
    const item = el("li", { html: renderMarkdown(hints[state.hintsShown - 1]) });
    item.prepend(el("span", { class: "hint-num", text: `${state.hintsShown}.` }));
    hintList.append(item);
    showHint.textContent = state.hintsShown >= hints.length ? "No more hints" : `Show hint ${state.hintsShown + 1}`;
    showHint.disabled = state.hintsShown >= hints.length;
    persist({ hintsUsed: state.hintsShown, status: "attempted" });
  });
  showLine.addEventListener("click", () => {
    const solutionLines = String(problem.solution ?? "").split("\n").filter((l) => l.trim());
    if (state.solutionLinesShown >= solutionLines.length) return;
    const line = solutionLines[state.solutionLinesShown];
    state.solutionLinesShown += 1;
    state.editor.insert((state.editor.getValue().endsWith("\n") || !state.editor.getValue() ? "" : "\n") + line + "\n");
    showLine.textContent =
      state.solutionLinesShown >= solutionLines.length
        ? "Solution shown"
        : `Show next solution line (${state.solutionLinesShown}/${solutionLines.length})`;
    showLine.disabled = state.solutionLinesShown >= solutionLines.length;
    persist({ hintsUsed: state.hintsShown, status: "attempted" });
  });
  guidedActions.append(showHint);
  if (state.solutions !== "hidden") guidedActions.append(showLine);
  guidedBox.append(el("h4", { text: "Hints, one step at a time" }));
  guidedBox.append(hintList, guidedActions);
  if (!(problem.hints || []).length) {
    guidedBox.append(el("p", { class: "small muted", text: "This exercise has no hints — try the line-count mode instead." }));
  }
  if (state.solutions === "hidden") {
    guidedBox.append(
      el("p", {
        class: "tiny muted",
        text: "Solutions are not shown in this class: work through the hints, run your code, and compare the output with what is expected.",
      }),
    );
  }

  // Line-count mode
  const target = Number(problem.line_count) || 6;
  const counter = el("span", { class: "tiny muted" });
  const numberInput = el("input", { type: "number", min: "1", max: "80", value: String(target), style: "width:5em" });
  const applyLines = () => {
    const value = Math.max(1, Math.min(80, Number(numberInput.value) || target));
    numberInput.value = String(value);
    state.lineCount = value;
    if (state.editor) state.editor.setLineTarget(value);
    updateCounter();
    persist({ lineCount: value });
  };
  numberInput.addEventListener("change", applyLines);
  numberInput.addEventListener("input", applyLines);
  linesBox.append(el("h4", { text: "Decide how many lines you need" }));
  linesBox.append(
    el("p", { class: "small muted", text: "Write exactly that many lines. The ruler on the left marks your target — `·` means you went past it." }),
  );
  linesBox.append(el("div", { class: "btn-row" }, [el("span", { class: "small", text: "Lines:" }), numberInput, counter]));

  const updateCounter = () => {
    if (!state.editor) return;
    const written = state.editor.lineCount();
    const filled = state.editor.getValue().split("\n").filter((l) => l.trim()).length;
    const targetNow = Number(numberInput.value) || target;
    counter.textContent = `${filled} of ${targetNow} lines written`;
    counter.style.color = filled === targetNow ? "var(--ok)" : filled > targetNow ? "var(--warn)" : "";
  };

  wrapper.append(el("div", { class: "cell-tag", text: "Your code" }));
  const editorHost = el("div");
  wrapper.append(editorHost);
  const saved = savedAttempt(problem.id);
  state.editor = createEditor(editorHost, {
    value: (saved && saved.code) || problem.starter_code || "",
    minLines: Math.max(6, target),
    lineTarget: target,
    placeholder: "# write your solution here",
    onRun: () => check(),
    onChange: () => {
      debouncedSave();
      updateCounter();
    },
    onLineCount: updateCounter,
  });
  state.editor.setLineTarget(target);
  state.lineCount = target;

  state.setModeBoxes = (mode) => {
    guidedBox.classList.toggle("hidden", mode !== "guided");
    linesBox.classList.toggle("hidden", mode !== "lines");
    if (mode === "lines") updateCounter();
  };
  state.setModeBoxes(state.mode);
  updateCounter();
  return wrapper;
}

function setMode(mode, pills) {
  state.mode = mode;
  for (const child of pills.children) child.setAttribute("aria-pressed", String(child.dataset.mode === mode));
  if (state.setModeBoxes) state.setModeBoxes(mode);
  persist({ mode });
}

/* -------------------------------------------------------------- checking --- */

async function check() {
  const problem = state.problem;
  if (!problem || state.busy) return;

  if (problem.type === "predict_output") {
    const typed = currentCode();
    const verdict = gradeText(problem, typed);
    // Nothing is executed here, so "the output" is what the learner typed.
    renderOutput({ actual: typed, label: "Your answer" });
    showVerdict(verdict, { expected: problem.expected_output, actual: typed, diff: verdict.diff });
    state.lastVerdict = verdict;
    persist(
      {
        status: verdict.ok ? "solved" : "attempted",
        typedOutput: typed,
        revealed: state.revealed,
        lastResult: verdict.ok ? "correct" : "incorrect",
      },
      { countAttempt: true },
    );
    if (verdict.ok) onSolved();
    return;
  }

  const code = currentCode();
  const blankVerdict = problem.type === "fill_in_blank" ? gradeBlanks(problem, state.blankInputs.map((i) => i.value)) : null;
  if (blankVerdict) {
    state.blankInputs.forEach((input, index) => {
      const check = blankVerdict.blankChecks[index];
      if (!check || check.ok) input.classList.add("ok");
      else input.classList.remove("ok");
      input.classList.toggle("bad", Boolean(check) && !check.ok);
    });
    if (!blankVerdict.ok) {
      const wrong = blankVerdict.blankChecks.filter((c) => !c.ok);
      setFeedback(
        `<div class="verdict bad"><h4>Check the highlighted blanks</h4><ul class="small" style="padding-left:1.1rem">` +
          wrong.map((c) => `<li>${escapeHtml(c.name)}: ${escapeHtml(c.detail)}</li>`).join("") +
          `</ul><p class="small">Fix them and check again — the answer is still checked by running the code.</p></div>`,
      );
    }
  }

  // Data the exercise reads (sales.csv and friends) is copied into the sandbox
  // under the name the code uses; anything that could not be found is reported
  // instead of showing the learner a confusing FileNotFoundError.
  let dataWarning = "";
  let files = null;
  if (problem.data_files && Object.keys(problem.data_files).length) {
    const resolved = await resolveDataFiles(problem.data_files);
    files = resolved.files;
    if (resolved.problems.length) {
      dataWarning =
        `<div class="notice warn small">This exercise needs a data file that could not be loaded:<br>` +
        `${resolved.problems.map(escapeHtml).join("<br>")}</div>`;
    }
  }

  setBusy(true, "Running…");
  const run = await runPython(code, {
    tests: problem.tests || "",
    setup: problem.setup || "",
    stdin: problem.stdin || "",
    packages: problem.packages || [],
    // Notebook cells display the value of the last expression, so exercises
    // generated from them are graded the same way: `data.head()` and
    // `print(data.head())` must both work.
    captureLast: problem.capture_last_expression === true,
    files,
  });
  setBusy(false);

  const verdict = gradeRun(problem, run);
  if (blankVerdict) verdict.checks = [...blankVerdict.checks, ...verdict.checks];
  verdict.ok = verdict.checks.every((c) => c.ok);
  // Always shown, right or wrong — the run is the thing to read first.
  renderOutput({ actual: run.stdout, stderr: run.stderr, error: run.error });

  showVerdict(verdict, {
    expected: problem.expected_output,
    actual: run.stdout,
    error: run.error,
    stderr: run.stderr,
    diff: verdict.diff,
    extra: dataWarning,
  });

  persist(
    {
      status: verdict.ok ? "solved" : "attempted",
      code,
      mode: state.mode,
      hintsUsed: state.hintsShown,
      lastResult: verdict.ok ? "correct" : "incorrect",
      lastError: run.error ? run.error.message : null,
    },
    { countAttempt: true },
  );
  if (verdict.ok) onSolved();
}

function onSolved() {
  if (nodes.next) {
    nodes.next.classList.add("primary");
    nodes.next.focus({ preventScroll: true });
  }
}

/* --------------------------------------------------------- page assembly --- */

function renderPrompt(problem) {
  const card = el("div", { class: "card" });
  const badges = el("div", { class: "row-between" }, [
    el("h1", { text: problem.title, style: "font-size:1.4rem;margin:0" }),
    el("div", { class: "pill-row" }, [
      el("span", { class: `badge type-${problem.type}`, text: TYPE_LABELS[problem.type] || problem.type }),
      el("span", { class: "badge", text: problem.difficulty || "easy" }),
    ]),
  ]);
  card.append(badges);

  const meta = el("p", { class: "tiny muted" });
  const bits = [];
  if ((problem.topics || []).length) bits.push(problem.topics.join(" · "));
  if (problem.notebook) {
    bits.push(
      `<a href="${siteUrl("learning/view.html")}?nb=${encodeURIComponent(problem.notebook)}">from ${escapeHtml(assignmentForProblem(problem).label)}</a>`,
    );
  } else {
    bits.push("general practice");
  }
  if (state.course) bits.push(`<strong>${escapeHtml(state.course.code)}</strong>`);
  bits.push(`id: <code>${escapeHtml(problem.id)}</code>`);
  meta.innerHTML = bits.join(" · ");
  card.append(meta);

  if (state.solutions === "hidden") {
    card.append(
      el("p", {
        class: "small muted",
        html: "This class keeps its solutions hidden: use the hints, and check your own output against the expected output.",
      }),
    );
  }

  // The question sits in the amber block the class study guides use for problems.
  if (problem.prompt) card.append(el("div", { class: "prompt-block", html: renderMarkdown(problem.prompt) }));

  if (problem.expected_output != null && problem.type !== "predict_output") {
    card.append(
      el("details", { class: "small" }, [
        el("summary", { text: "Expected output" }),
        el("pre", { html: `<code>${escapeHtml(String(problem.expected_output).replace(/\n$/, ""))}</code>` }),
      ]),
    );
  }
  if (problem.test_summary) {
    card.append(el("p", { class: "small muted", text: `Hidden checks: ${problem.test_summary}` }));
  }
  if ((problem.glossary || []).length) {
    card.append(el("div", { class: "small" }, [
      el("span", { class: "muted", text: "Glossary: " }),
      el("span", { html: renderTermChips(state.glossary, problem.glossary, { base: siteUrl("glossary.html") }) }),
    ]));
  }
  return card;
}

function renderNav(problem) {
  const index = state.problems.findIndex((p) => p.id === problem.id);
  const previous = index > 0 ? state.problems[index - 1] : null;
  const next = index >= 0 && index < state.problems.length - 1 ? state.problems[index + 1] : null;
  const bar = el("div", { class: "row-between", style: "margin-top:1.5rem" });
  const left = el("div", { class: "btn-row" });
  if (previous) {
    left.append(el("a", { class: "btn", href: `exercise.html?id=${encodeURIComponent(previous.id)}`, text: `← ${previous.title}` }));
  }
  left.append(el("a", { class: "btn ghost", href: "index.html", text: "All exercises" }));
  bar.append(left);

  const right = el("div", { class: "btn-row" });
  if (next) {
    nodes.next = el("a", { class: "btn", href: `exercise.html?id=${encodeURIComponent(next.id)}`, text: `Next: ${next.title} →` });
    right.append(nodes.next);
  }
  bar.append(right);
  return bar;
}

function renderActions(problem) {
  const row = el("div", { class: "btn-row" });
  nodes.checkButton = el("button", { class: "btn primary", type: "button", text: "Check answer" });
  nodes.checkButton.addEventListener("click", check);
  row.append(nodes.checkButton);

  const hintButton = el("button", { class: "btn", type: "button", text: "Hint" });
  const hintCount = (problem.hints || []).length;
  if (!hintCount) hintButton.disabled = true;
  hintButton.addEventListener("click", () => {
    if (state.hintsShown >= hintCount) {
      setFeedback('<div class="verdict info"><h4>No more hints</h4><p class="small">Every hint for this exercise is already shown.</p></div>');
      return;
    }
    state.hintsShown += 1;
    hintButton.textContent = state.hintsShown >= hintCount ? `Hint (${hintCount}/${hintCount})` : `Hint (${state.hintsShown}/${hintCount})`;
    setFeedback(
      // Hints read like the green "answer / interpretation" blocks in the guides.
      `<div class="answer-block"><h4 style="margin:0 0 .3em">Hint ${state.hintsShown} of ${hintCount}</h4><div>${renderMarkdown(problem.hints[state.hintsShown - 1])}</div></div>`,
    );
    persist({ hintsUsed: state.hintsShown, status: getProgress()[problem.id]?.status || "attempted" });
  });
  row.append(hintButton);

  if (problem.type === "predict_output") {
    const reveal = el("button", { class: "btn", type: "button", text: "Run it and show the output" });
    reveal.addEventListener("click", async () => {
      setBusy(true, "Running…");
      const run = await runPython(problem.starter_code || "", { packages: problem.packages || [] });
      setBusy(false);
      state.revealed = true;
      persist({ revealed: true, status: getProgress()[problem.id]?.status || "attempted", code: currentCode() });
      renderOutput({ actual: run.stdout, stderr: run.stderr, error: run.error });
      setFeedback(
        '<div class="answer-block"><h4 style="margin:0 0 .3em">The program prints</h4>' +
          '<p class="small muted">The output is shown above, under the code. Now type it in yourself to mark this exercise as solved.</p></div>',
      );
    });
    row.append(reveal);
  }

  if (problem.solution && state.solutions !== "hidden") {
    const solution = el("button", { class: "btn ghost", type: "button", text: "Show solution" });
    solution.addEventListener("click", () => {
      if (problem.type === "fill_in_blank") {
        (problem.blanks || []).forEach((blank, index) => {
          const answer = blank.accepted?.[0];
          if (answer != null && state.blankInputs[index]) {
            state.blankInputs[index].value = answer;
            state.blankInputs[index].classList.remove("ok", "bad");
          }
        });
      }
      setFeedback(
        `<div class="verdict info"><h4>One way to solve it</h4><pre><code>${escapeHtml(String(problem.solution).replace(/\n$/, ""))}</code></pre>` +
          `<p class="small muted">Compare it with your version, then check yours — showing the solution does not mark the exercise solved.</p></div>`,
      );
      persist({ status: getProgress()[problem.id]?.status || "attempted", revealed: true, code: currentCode() });
    });
    row.append(solution);
  }

  const reset = el("button", { class: "btn ghost", type: "button", text: "Reset" });
  reset.addEventListener("click", () => {
    if (problem.type === "fill_in_blank") {
      state.blankInputs.forEach((input) => {
        input.value = "";
        input.classList.remove("ok", "bad");
      });
    } else if (state.editor) {
      state.editor.setValue(problem.type === "predict_output" ? "" : problem.starter_code || "");
    }
    feedbackArea().classList.add("hidden");
    clearOutput();
    state.hintsShown = 0;
    persist({ code: "", typedOutput: "", hintsUsed: 0, status: getProgress()[problem.id]?.status || "attempted" });
  });
  row.append(reset);

  return row;
}

/* --------------------------------------------------------------- startup --- */

async function main() {
  nodes.root = document.getElementById("exercise");
  nodes.feedback = document.getElementById("feedback");
  nodes.progress = document.getElementById("progress-line");
  nodes.runtime = document.getElementById("runtime-status");

  const status = statusSnapshot();
  updateRuntimeStatus(status);
  onStatus(updateRuntimeStatus);

  const id = param("id");
  let problems = [];
  try {
    problems = await loadProblems();
    state.glossary = await loadGlossary();
    // Notebook names for the "from <assignment>" line; the page works without it.
    await loadAssignments();
  } catch (error) {
    nodes.root.innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }
  state.problems = problems;

  // Which class is this exercise for? The exercise page must work even when it
  // was opened from a link to the other class, so the class is read from the
  // problem itself and only shown in the header.
  let catalog = null;
  try {
    catalog = await loadCourses();
    await activeCourse(catalog);
  } catch {
    catalog = null;
  }

  const problem = problems.find((p) => p.id === id) || null;
  if (!problem) {
    nodes.root.innerHTML =
      `<div class="notice warn"><p><strong>Exercise not found:</strong> <code>${escapeHtml(id || "(none)")}</code></p>` +
      `<p class="small"><a href="index.html">Browse all ${problems.length} exercises</a></p></div>`;
    return;
  }
  state.problem = problem;
  state.solutions = problem.solutions === "hidden" ? "hidden" : "shown";
  if (catalog) {
    const course =
      catalog.courses.find((entry) => entry.id === problem.course) || (await activeCourse(catalog));
    state.course = course;
    // The picker highlights the class this exercise belongs to, so switching
    // class from here is one click instead of a lost exercise.
    mountCoursePicker(catalog, { active: course.id });
  }
  state.terms = termsForProblem(state.glossary, problem);
  document.title = `${problem.title} · Python Practice`;

  const saved = savedAttempt(problem.id) || {};
  state.hintsShown = saved.hintsUsed || 0;
  state.mode = saved.mode || (problem.mode === "lines" ? "lines" : "guided");
  state.revealed = Boolean(saved.revealed);

  nodes.root.innerHTML = "";
  nodes.root.append(renderPrompt(problem));

  const task = el("div", { class: "card stack" });
  if (problem.type === "fix_the_code") {
    task.append(el("div", { class: "cell-tag", text: "Fix the code below" }));
    task.append(setupEditorTask(problem, { value: saved.code || problem.starter_code, minLines: 6 }));
  } else if (problem.type === "fill_in_blank") {
    task.append(el("div", { class: "cell-tag", text: "Fill in the blanks" }));
    task.append(setupFillInBlank(problem));
  } else if (problem.type === "predict_output") {
    task.append(setupPredictOutput(problem));
  } else {
    task.append(setupWriteFromScratch(problem));
  }
  // The run lives directly under the code, above the buttons: press Check answer
  // and the output appears where the eye already is.
  nodes.output = el("div", { class: "stack hidden", role: "status", "aria-live": "polite" });
  task.append(nodes.output);
  task.append(renderActions(problem));
  nodes.root.append(task);

  const runtimeLine = el("div", { class: "row-between tiny muted", style: "margin-top:.6rem" });
  runtimeLine.append(nodes.progress);
  runtimeLine.append(nodes.runtime);
  nodes.root.append(runtimeLine);

  nodes.feedback.classList.add("hidden");
  nodes.root.append(nodes.feedback);

  if (!isAutoGradable(problem)) {
    nodes.root.append(
      el("div", { class: "notice warn", style: "margin-top:1rem", html: "<p>This exercise tells you what it expects but has no automatic check configured. Compare your output with the expected output above.</p>" }),
    );
  }

  nodes.root.append(renderNav(problem));
  renderProgressLine();
  if (problem.type !== "predict_output") state.editor?.focus();
}

main();
