/**
 * A small code editor: a textarea with line numbers, tab-safety for Python
 * (Tab indents, Shift+Tab dedents, Enter keeps/extends indentation) and
 * Ctrl/Cmd+Enter to check the answer. No dependencies.
 */

const INDENT = "    ";

/** Tallest the box ever gets; past this the text scrolls inside it. */
const MAX_LINES = 40;

export function createEditor(container, options = {}) {
  const {
    value = "",
    minLines = 6,
    readOnly = false,
    plain = false,
    placeholder = "",
    lineTarget: initialLineTarget = 0,
    onChange = null,
    onRun = null,
    onLineCount = null,
  } = options;

  // `lineTarget` is reassigned by setLineTarget(), so it cannot be a const binding.
  let lineTarget = initialLineTarget;

  container.classList.add("editor");
  container.classList.toggle("plain", plain);
  container.dataset.readonly = readOnly ? "true" : "false";

  const gutter = document.createElement("div");
  gutter.className = "gutter";
  gutter.setAttribute("aria-hidden", "true");

  const textarea = document.createElement("textarea");
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.setAttribute("wrap", "off");
  textarea.setAttribute("aria-label", "Python code");
  textarea.placeholder = placeholder;
  textarea.readOnly = readOnly;
  textarea.value = value;

  container.append(gutter, textarea);

  let lineHeight = 0;
  let padTop = 0;
  let padBottom = 0;
  function measure() {
    const styles = getComputedStyle(textarea);
    const parsed = parseFloat(styles.lineHeight);
    const fontSize = parseFloat(styles.fontSize);
    lineHeight = Number.isFinite(parsed) ? parsed : Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
    padTop = parseFloat(styles.paddingTop) || 0;
    padBottom = parseFloat(styles.paddingBottom) || 0;
  }

  function lineCount() {
    return textarea.value.split("\n").length;
  }

  /**
   * The box is exactly as tall as the lines it holds: one line per row, a floor
   * of `minLines`, and it shrinks again when lines are deleted.
   *
   * The height is computed from the line count and never from
   * `textarea.scrollHeight`: the textarea is a stretched grid cell, so its
   * scrollHeight reports the height of the cell (a full screen on a tall
   * window) instead of the text inside it — which is what made the box huge.
   */
  function sync() {
    if (!lineHeight) measure();
    const lines = lineCount();
    const wanted = Math.max(lines, minLines, lineTarget);
    const shown = Math.min(wanted, MAX_LINES);
    const numbers = [];
    for (let i = 1; i <= shown; i++) {
      if (lineTarget && i > lineTarget) numbers.push("·");
      else numbers.push(String(i));
    }
    gutter.textContent = numbers.join("\n");
    const height = Math.round(shown * lineHeight + padTop + padBottom);
    textarea.style.height = `${height}px`;
    gutter.style.minHeight = `${height}px`;
    // Past the cap the box stops growing and the text scrolls instead.
    textarea.style.overflowY = wanted > MAX_LINES ? "auto" : "hidden";
  }

  function emitChange() {
    sync();
    if (onChange) onChange(textarea.value);
    if (onLineCount) onLineCount(lineCount());
  }

  function replaceSelection(text, selectionStart, selectionEnd) {
    const before = textarea.value.slice(0, selectionStart);
    const after = textarea.value.slice(selectionEnd);
    textarea.value = before + text + after;
    const caret = selectionStart + text.length;
    textarea.setSelectionRange(caret, caret);
    emitChange();
  }

  function indentSelection(shiftKey) {
    const { selectionStart, selectionEnd, value: text } = textarea;
    const multiLine = text.slice(selectionStart, selectionEnd).includes("\n");
    if (multiLine) {
      const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
      const block = text.slice(lineStart, selectionEnd);
      const updated = block
        .split("\n")
        .map((line) => {
          if (shiftKey) {
            if (line.startsWith(INDENT)) return line.slice(INDENT.length);
            return line.replace(/^[ \t]{1,4}/, "");
          }
          return INDENT + line;
        })
        .join("\n");
      textarea.value = text.slice(0, lineStart) + updated + text.slice(selectionEnd);
      textarea.setSelectionRange(lineStart, lineStart + updated.length);
      emitChange();
      return;
    }
    if (shiftKey) {
      const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
      const line = text.slice(lineStart, selectionStart);
      const remove = Math.min(INDENT.length - ((line.length || INDENT.length) % INDENT.length || 0) || 1, 4);
      const stripped = text.slice(lineStart).replace(/^[ ]{1,4}/, "");
      const removed = text.slice(lineStart).length - stripped.length;
      textarea.value = text.slice(0, lineStart) + stripped;
      const caret = Math.max(lineStart, selectionStart - removed);
      textarea.setSelectionRange(caret, caret);
      emitChange();
      return;
    }
    replaceSelection(INDENT, selectionStart, selectionEnd);
  }

  function handleEnter(event) {
    const { selectionStart, selectionEnd, value: text } = textarea;
    if (selectionStart !== selectionEnd) return false;
    const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const line = text.slice(lineStart, selectionStart);
    const indent = /^[ \t]*/.exec(line)[0];
    const trimmed = line.trimEnd();
    const extra = /[:(\[{]$/.test(trimmed) ? INDENT : "";
    event.preventDefault();
    const insertion = `\n${indent}${extra}`;
    replaceSelection(insertion, selectionStart, selectionEnd);
    return true;
  }

  function handleBackspace(event) {
    const { selectionStart, selectionEnd, value: text } = textarea;
    if (selectionStart !== selectionEnd) return false;
    const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const line = text.slice(lineStart, selectionStart);
    if (!/^[ ]+$/.test(line) || line.length % INDENT.length !== 0) return false;
    const remove = INDENT.length;
    event.preventDefault();
    textarea.value = text.slice(0, selectionStart - remove) + text.slice(selectionStart);
    const caret = selectionStart - remove;
    textarea.setSelectionRange(caret, caret);
    emitChange();
    return true;
  }

  textarea.addEventListener("keydown", (event) => {
    if (readOnly) return;
    if (event.key === "Tab") {
      event.preventDefault();
      indentSelection(event.shiftKey);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (onRun) onRun();
      return;
    }
    if (event.key === "Enter") {
      handleEnter(event);
      return;
    }
    if (event.key === "Backspace") {
      handleBackspace(event);
    }
  });

  textarea.addEventListener("input", emitChange);
  textarea.addEventListener("scroll", () => {
    gutter.scrollTop = textarea.scrollTop;
  });

  window.addEventListener("resize", sync);
  // Fonts can arrive after first paint; re-measure once when they do.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync).catch(() => {});
  requestAnimationFrame(sync);

  return {
    element: container,
    textarea,
    getValue: () => textarea.value,
    setValue(next, { silent = false } = {}) {
      textarea.value = next ?? "";
      if (silent) sync();
      else emitChange();
    },
    /** Insert text at the caret (used by "reveal a line" helpers). */
    insert(text) {
      replaceSelection(text, textarea.selectionStart, textarea.selectionEnd);
      textarea.focus();
    },
    /** Focus the caret at the end of a given line number (1-based). */
    focusLine(line) {
      const lines = textarea.value.split("\n");
      const target = Math.max(1, Math.min(line || 1, lines.length));
      const offset = lines.slice(0, target - 1).reduce((sum, l) => sum + l.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      const relative = (target - 1) * lineHeight;
      textarea.scrollTop = Math.max(0, relative - textarea.clientHeight / 2);
    },
    lineCount,
    setLineTarget(count) {
      lineTarget = count || 0;
      sync();
    },
    focus: () => textarea.focus(),
    sync,
  };
}
