/**
 * Grading logic — pure functions, no DOM, no Pyodide.
 * Kept separate so it can be unit-tested in Node (see tests/grade.test.mjs).
 */

import { compareOutput, diffLines, normalizeOutput } from "./util.js";

/** Split a template on ___ placeholders. Returns the literal chunks between blanks. */
export function splitTemplate(template) {
  return String(template ?? "").split(/_{3,}/);
}

/** How many blanks a fill-in-the-blank template has. */
export function countBlanks(template) {
  const parts = splitTemplate(template);
  return Math.max(0, parts.length - 1);
}

/** Substitute the learner's values into a template, padding missing values. */
export function fillTemplate(template, values) {
  const parts = splitTemplate(template);
  let out = parts[0] ?? "";
  for (let i = 1; i < parts.length; i++) out += (values[i - 1] ?? "") + parts[i];
  return out;
}

function verdict(checks, extra = {}) {
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  return { ok, correct: ok, checks, ...extra };
}

/**
 * Grade a *run* (fix the code, fill in the blank, write from scratch).
 * @param {object} problem
 * @param {{stdout:string, stderr:string, error:object|null}} run
 */
export function gradeRun(problem, run) {
  const checks = [];
  const error = run.error || null;

  checks.push({
    name: "The code runs without errors",
    ok: !error,
    detail: error ? formatError(error) : "",
  });

  if (error && error.where === "setup") {
    // A broken exercise file, not the learner's fault — say so plainly.
    checks.push({
      name: "Exercise setup is available",
      ok: false,
      detail: "This exercise's setup code failed. Please report it — it is not your code at fault.",
    });
    return verdict(checks, { actual: run.stdout, error });
  }

  if (problem.tests) {
    const testsRan = !error || error.where !== "user";
    checks.push({
      name: "Passes the checks",
      ok: testsRan && !error,
      detail: !testsRan
        ? "Your code stopped before the checks could run."
        : error
          ? formatError(error, { hideWhere: true })
          : "",
    });
  }

  if (problem.expected_output != null) {
    const cmp = compareOutput(run.stdout, problem.expected_output, {
      ignoreWhitespace: Boolean(problem.ignore_whitespace),
      ignoreCase: Boolean(problem.ignore_case),
    });
    checks.push({
      name: "Printed output matches",
      ok: cmp.ok,
      detail: cmp.ok ? "" : "Compare your output with the expected output below.",
    });
    return verdict(checks, {
      actual: run.stdout,
      expected: cmp.expected,
      diff: cmp.ok ? null : diffLines(run.stdout, problem.expected_output, {
        ignoreWhitespace: Boolean(problem.ignore_whitespace),
        ignoreCase: Boolean(problem.ignore_case),
      }),
      error,
    });
  }

  return verdict(checks, { actual: run.stdout, error });
}

/** Grade a typed answer (predict the output). */
export function gradeText(problem, typed) {
  const expected = problem.expected_output ?? "";
  const cmp = compareOutput(typed, expected, {
    ignoreWhitespace: Boolean(problem.ignore_whitespace),
    ignoreCase: Boolean(problem.ignore_case),
  });
  const checks = [
    {
      name: "Matches the expected output",
      ok: cmp.ok,
      detail: cmp.ok ? "" : "Not quite — the diff below shows where it drifts.",
    },
  ];
  return verdict(checks, {
    actual: typed,
    expected: cmp.expected,
    diff: cmp.ok
      ? null
      : diffLines(typed, expected, {
          ignoreWhitespace: Boolean(problem.ignore_whitespace),
          ignoreCase: Boolean(problem.ignore_case),
        }),
  });
}

/** Grade the individual blanks of a fill-in-the-blank exercise. */
export function gradeBlanks(problem, values) {
  const blanks = problem.blanks || [];
  const checks = blanks.map((blank, index) => {
    const accepted = blank.accepted || blank.answers || [];
    const value = String(values[index] ?? "");
    if (!accepted.length) {
      return { name: `Blank ${index + 1}`, ok: true, detail: "" };
    }
    const ok = accepted.some((a) => {
      const left = normalizeOutput(value, { ignoreWhitespace: true }).toLowerCase();
      const right = normalizeOutput(a, { ignoreWhitespace: true }).toLowerCase();
      return left === right;
    });
    return {
      name: `Blank ${index + 1}`,
      ok,
      detail: ok ? "" : blank.hint ? `Hint: ${blank.hint}` : "Not one of the expected answers.",
      index,
    };
  });
  return verdict(checks, { blankChecks: checks });
}

export function formatError(error, { hideWhere = false } = {}) {
  if (!error) return "";
  const parts = [];
  if (error.line && !hideWhere && error.where !== "tests") {
    parts.push(`Line ${error.line}${error.source ? `:  ${error.source.trim()}` : ""}`);
  }
  parts.push(error.message || `${error.type} (no message)`);
  return parts.join("\n");
}

/** One-line human summary of a verdict, used in the feedback banner. */
export function summarize(verdictResult) {
  if (verdictResult.ok) return "Correct — nice work!";
  const failed = verdictResult.checks.filter((c) => !c.ok);
  if (!failed.length) return "Incorrect.";
  return failed.map((c) => c.name).join(" · ");
}

/** Does this problem need the Python runtime to be graded? */
export function needsPython(problem) {
  if (!problem) return false;
  if (problem.type === "predict_output") return false;
  return true;
}

/** Can this problem be graded automatically at all? */
export function isAutoGradable(problem) {
  if (!problem) return false;
  if (problem.type === "predict_output") return problem.expected_output != null;
  return Boolean(problem.expected_output != null || problem.tests);
}
