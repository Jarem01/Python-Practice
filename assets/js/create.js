/**
 * practice/create.html — build a new exercise in the browser.
 *
 * Two ways to keep it:
 *   • "Save draft" writes to localStorage, so it shows up in the exercise list
 *     immediately (marked as a draft) for testing.
 *   • "Download JSON" gives you a file to drop into problems/, after which
 *     `python3 tools/build_index.py` makes it permanent for everyone.
 */

import { el, escapeHtml, slugify, TYPE_LABELS, TYPE_ORDER } from "./util.js";
import { clearDrafts, deleteDraft, loadDrafts, saveDraft } from "./problems.js";
import { countBlanks, fillTemplate } from "./grade.js";

const FIELDS = [
  ["id", "text", "Id (leave empty to derive from the title)"],
  ["title", "text", "Title *"],
  ["prompt", "textarea", "Problem text (Markdown) *"],
  ["starter_code", "textarea", "Starter code (use ___ for blanks)"],
  ["expected_output", "textarea", "Expected output (exact, as printed)"],
  ["tests", "textarea", "Hidden checks (Python, runs after the learner's code)"],
  ["setup", "textarea", "Setup code (Python, runs before the learner's code)"],
  ["stdin", "textarea", "Input() lines (one per line)"],
  ["hints", "textarea", "Hints (one per line)"],
  ["solution", "textarea", "Reference solution (Python)"],
  ["topics", "text", "Topics (comma separated)"],
  ["glossary", "text", "Glossary slugs (comma separated)"],
  ["packages", "text", "Extra Python packages (e.g. numpy, pandas)"],
  ["test_summary", "text", "What the hidden checks verify (shown to the learner)"],
];

const form = {};

function buildForm() {
  const host = document.getElementById("form-fields");
  host.innerHTML = "";

  const typeField = el("label", { class: "field" });
  typeField.append(el("span", { class: "lbl", text: "Exercise type *" }));
  const typeSelect = el("select", { id: "f-type" });
  for (const type of TYPE_ORDER) typeSelect.append(el("option", { value: type, text: TYPE_LABELS[type] }));
  typeField.append(typeSelect, el("span", { class: "hint", text: "Type-specific rules are validated as you type." }));
  host.append(typeField);
  form.type = typeSelect;

  const row = el("div", { class: "grid cols-3" });
  const difficulty = el("select", { id: "f-difficulty" });
  for (const value of ["easy", "medium", "hard"]) difficulty.append(el("option", { value, text: value }));
  row.append(field("difficulty", difficulty, "Difficulty"));
  form.difficulty = difficulty;

  const mode = el("select", { id: "f-mode" });
  for (const value of ["both", "guided", "lines"]) mode.append(el("option", { value, text: value }));
  row.append(field("mode", mode, "Write-from-scratch mode"));
  form.mode = mode;

  const lineCount = el("input", { type: "number", min: "1", max: "80", value: "6", id: "f-line_count" });
  row.append(field("line_count", lineCount, "Suggested line count"));
  form.line_count = lineCount;
  host.append(row);

  for (const [key, kind, label] of FIELDS) {
    let control;
    if (kind === "textarea") {
      control = el("textarea", { rows: key === "prompt" ? 6 : 4, id: `f-${key}`, spellcheck: "false" });
    } else {
      control = el("input", { type: "text", id: `f-${key}`, spellcheck: "false" });
    }
    control.addEventListener("input", updatePreview);
    control.addEventListener("change", updatePreview);
    form[key] = control;
    host.append(field(key, control, label));
  }

  typeSelect.addEventListener("change", () => {
    updatePreview();
    applyTypeVisibility();
  });
  applyTypeVisibility();
}

function field(key, control, label) {
  const wrapper = el("label", { class: "field" });
  wrapper.append(el("span", { class: "lbl", text: label }));
  wrapper.append(control);
  wrapper.dataset.key = key;
  return wrapper;
}

function applyTypeVisibility() {
  const isFill = form.type.value === "fill_in_blank";
  const isPredict = form.type.value === "predict_output";
  const isWrite = form.type.value === "write_from_scratch";
  const show = (key, visible) => {
    const wrapper = document.querySelector(`label.field[data-key="${key}"]`);
    if (wrapper) wrapper.classList.toggle("hidden", !visible);
  };
  show("starter_code", true);
  show("expected_output", true);
  show("tests", !isPredict);
  show("test_summary", isWrite);
  show("mode", isWrite);
  show("line_count", isWrite);
  const starterLabel = document.querySelector('label.field[data-key="starter_code"] .lbl');
  if (starterLabel) starterLabel.textContent = isFill ? "Template with ___ blanks *" : "Starter code *";
}

function linesToList(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function collect() {
  const problem = {
    type: form.type.value,
    id: form.id.value.trim() || slugify(form.title.value),
    title: form.title.value.trim(),
    prompt: form.prompt.value,
    difficulty: form.difficulty.value,
    topics: form.topics.value.split(",").map((t) => t.trim()).filter(Boolean),
    glossary: form.glossary.value.split(",").map((t) => t.trim()).filter(Boolean),
    packages: form.packages.value.split(",").map((t) => t.trim()).filter(Boolean),
    hints: linesToList(form.hints.value),
  };
  if (problem.type === "write_from_scratch") {
    problem.mode = form.mode.value;
    problem.line_count = Number(form.line_count.value) || 6;
  }
  if (form.starter_code.value.trim()) {
    problem.starter_code = form.starter_code.value.endsWith("\n") ? form.starter_code.value : `${form.starter_code.value}\n`;
  }
  if (form.expected_output.value.trim()) problem.expected_output = `${form.expected_output.value.replace(/\n$/, "")}`;
  if (form.tests.value.trim()) problem.tests = `${form.tests.value.replace(/\n$/, "")}\n`;
  if (form.setup.value.trim()) problem.setup = `${form.setup.value.replace(/\n$/, "")}\n`;
  if (form.stdin.value.trim()) problem.stdin = `${form.stdin.value.replace(/\n$/, "")}\n`;
  if (form.solution.value.trim()) problem.solution = `${form.solution.value.replace(/\n$/, "")}\n`;
  if (form.test_summary.value.trim()) problem.test_summary = form.test_summary.value.trim();
  return problem;
}

function validate(problem) {
  const errors = [];
  const warnings = [];
  if (!problem.title) errors.push("A title is required.");
  if (!problem.prompt.trim()) errors.push("The problem text is required.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(problem.id)) errors.push("The id must be lowercase letters, digits and dashes (it is derived from the title if left empty).");
  if (["fix_the_code", "fill_in_blank"].includes(problem.type) && !problem.starter_code) errors.push("This type needs starter code.");
  if (problem.type === "predict_output" && problem.expected_output == null) errors.push("Predict-the-output needs the expected output.");
  if (problem.type === "write_from_scratch" && !problem.tests && problem.expected_output == null) errors.push("Write-from-scratch needs hidden checks or an expected output.");

  if (problem.type === "fill_in_blank") {
    const blanks = countBlanks(problem.starter_code || "");
    if (!blanks) errors.push("Add at least one ___ blank to the template.");
  }
  if (problem.type === "fix_the_code" && !problem.expected_output && !problem.tests) {
    warnings.push("Without an expected output or hidden checks, any code that runs will be accepted.");
  }
  if (!problem.hints.length) warnings.push("No hints: learners will not get a nudge.");
  if (!problem.topics.length) warnings.push("No topics: this exercise will not be linked from the notebooks.");
  return { errors, warnings };
}

function updatePreview() {
  const problem = collect();
  const { errors, warnings } = validate(problem);
  document.getElementById("preview").textContent = JSON.stringify(problem, null, 2);
  const status = document.getElementById("status");
  status.innerHTML =
    (errors.length ? `<div class="notice bad"><p><strong>${errors.length} problem(s) to fix</strong></p><ul class="small">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></div>` : "") +
    (warnings.length ? `<div class="notice warn"><p><strong>Warnings</strong></p><ul class="small">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>` : "") +
    (!errors.length && !warnings.length ? '<div class="notice ok"><p>Looks good — you can save or download it.</p></div>' : "");
  return { problem, errors, warnings };
}

/* --------------------------------------------------------------- drafts --- */

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function renderDrafts() {
  const host = document.getElementById("drafts");
  const drafts = loadDrafts();
  host.innerHTML = "";
  if (!drafts.length) {
    host.innerHTML = '<p class="small muted">No drafts stored in this browser yet.</p>';
    return;
  }
  for (const draft of drafts) {
    const row = el("div", { class: "row-between", style: "padding:.4rem 0;border-bottom:1px solid var(--border)" });
    row.append(el("span", { html: `<strong>${escapeHtml(draft.title)}</strong> <code class="tiny">${escapeHtml(draft.id)}</code> <span class="badge">${escapeHtml(draft.type)}</span>` }));
    const actions = el("div", { class: "btn-row" });
    const edit = el("button", { class: "btn small", type: "button", text: "Edit" });
    edit.addEventListener("click", () => fillForm(draft));
    const practice = el("a", { class: "btn small", href: `exercise.html?id=${encodeURIComponent(draft.id)}`, text: "Try it" });
    const download1 = el("button", { class: "btn small ghost", type: "button", text: "Download" });
    download1.addEventListener("click", () => download(`${draft.id}.json`, JSON.stringify(draft, null, 2) + "\n"));
    const remove = el("button", { class: "btn small ghost", type: "button", text: "Delete" });
    remove.addEventListener("click", () => {
      deleteDraft(draft.id);
      renderDrafts();
    });
    actions.append(edit, practice, download1, remove);
    row.append(actions);
    host.append(row);
  }
}

function fillForm(problem) {
  form.type.value = problem.type;
  form.difficulty.value = problem.difficulty || "easy";
  form.mode.value = problem.mode || "both";
  form.line_count.value = problem.line_count || 6;
  form.id.value = problem.id || "";
  form.title.value = problem.title || "";
  form.prompt.value = problem.prompt || "";
  form.starter_code.value = problem.starter_code || "";
  form.expected_output.value = problem.expected_output || "";
  form.tests.value = problem.tests || "";
  form.setup.value = problem.setup || "";
  form.stdin.value = problem.stdin || "";
  form.hints.value = (problem.hints || []).join("\n");
  form.solution.value = problem.solution || "";
  form.topics.value = (problem.topics || []).join(", ");
  form.glossary.value = (problem.glossary || []).join(", ");
  form.packages.value = (problem.packages || []).join(", ");
  form.test_summary.value = problem.test_summary || "";
  applyTypeVisibility();
  updatePreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function main() {
  buildForm();
  renderDrafts();

  document.getElementById("save-draft").addEventListener("click", () => {
    const { problem, errors } = updatePreview();
    if (errors.length) return;
    saveDraft(problem);
    renderDrafts();
    document.getElementById("status").insertAdjacentHTML(
      "afterbegin",
      `<div class="notice ok"><p>Saved as a draft in this browser. It now appears in <a href="index.html">the exercise list</a> while you test it.</p></div>`,
    );
  });

  document.getElementById("download").addEventListener("click", () => {
    const { problem, errors } = updatePreview();
    if (errors.length) return;
    download(`${problem.id}.json`, JSON.stringify({ problems: [problem] }, null, 2) + "\n");
  });

  document.getElementById("copy").addEventListener("click", async () => {
    const { problem, errors } = updatePreview();
    if (errors.length) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(problem, null, 2));
      document.getElementById("status").insertAdjacentHTML("afterbegin", '<div class="notice ok"><p>JSON copied to the clipboard.</p></div>');
    } catch {
      document.getElementById("status").insertAdjacentHTML("afterbegin", '<div class="notice warn"><p>Clipboard access was denied — use “Download .json” instead.</p></div>');
    }
  });

  document.getElementById("clear").addEventListener("click", () => {
    document.querySelectorAll("#form-fields input, #form-fields textarea, #form-fields select").forEach((control) => {
      if (control.tagName === "SELECT") control.selectedIndex = 0;
      else control.value = "";
    });
    form.line_count.value = "6";
    applyTypeVisibility();
    updatePreview();
  });

  document.getElementById("import").addEventListener("click", () => {
    const raw = document.getElementById("import-json").value.trim();
    const status = document.getElementById("status");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const problem = Array.isArray(parsed) ? parsed[0] : parsed.problems ? parsed.problems[0] : parsed;
      fillForm(problem);
      status.insertAdjacentHTML("afterbegin", '<div class="notice ok"><p>Imported into the form.</p></div>');
    } catch (error) {
      status.insertAdjacentHTML("afterbegin", `<div class="notice bad"><p>Could not parse that JSON: ${escapeHtml(String(error.message))}</p></div>`);
    }
  });

  document.getElementById("clear-drafts").addEventListener("click", () => {
    if (!confirm("Delete every draft stored in this browser?")) return;
    clearDrafts();
    renderDrafts();
  });

  document.getElementById("preview-starter").addEventListener("click", () => {
    const { problem, errors } = updatePreview();
    if (errors.length) return;
    if (problem.type !== "fill_in_blank") return;
    const filled = fillTemplate(problem.starter_code, new Array(countBlanks(problem.starter_code)).fill("<blank>"));
    document.getElementById("preview").textContent += `\n\n// template with blanks marked:\n${filled}`;
  });

  updatePreview();
}

main();
