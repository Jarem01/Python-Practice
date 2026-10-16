/**
 * Shared helpers: a small Markdown renderer, glossary auto-linking, output
 * normalization/comparison, a tiny line diff and localStorage wrappers.
 * No dependencies, no DOM access at import time (so it is unit-testable in Node).
 */

import { CONFIG } from "./config.js";

/* ------------------------------------------------------------ escaping --- */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Terminal color escapes a notebook output may carry (pandas, tqdm, …). */
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_RE, "");
}

export function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Plain text from markdown/HTML: notebook prose uses HTML snippets such as
 * `8<sup>3</sup>`, and titles, slugs and meta descriptions must not show the
 * markup ("Print the Boolean test for 8^3 …").
 */
export function plainText(value) {
  return String(value ?? "")
    // Markdown emphasis first, so the `_` it introduces below is not stripped.
    .replace(/[*`_]/g, "")
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "^$1")
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, "_$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Inline HTML the course notebooks actually use, allowed through the escaper. */
const ALLOWED_INLINE_TAGS = "sup|sub|br|em|strong|i|b|u|small|mark|kbd|abbr|span";
const ALLOWED_TAG_RE = new RegExp(`&lt;(/?)(${ALLOWED_INLINE_TAGS})(\\s*/?)&gt;`, "gi");

/** Undo escaping for whitelisted inline tags only; anything else stays literal text. */
function restoreInlineHtml(escaped) {
  return escaped.replace(ALLOWED_TAG_RE, "<$1$2$3>");
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

/* ------------------------------------------------------------- markdown --- */

/** Inline formatting, applied to already-escaped text pieces. */
function inline(text) {
  let t = text;
  t = t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, label) => {
    const s = slugify(slug);
    return `<a class="term" href="GLOSSARY_BASE#${s}" title="Glossary: ${label || slug}">${label || slug}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])__([^_]+)__(?=[\s).,;:!?]|$)/g, "$1<strong>$2</strong>");
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const external = /^https?:/i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
  });
  return restoreInlineHtml(t);
}

/** Escape, then apply inline rules, protecting code spans and [[term]] markup. */
function renderInline(raw) {
  const parts = String(raw).split(/(\[\[[^\]]+\]\]|`[^`]*`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      if (part.startsWith("[[") && part.endsWith("]]")) return inline(escapeHtml(part));
      return inline(escapeHtml(part));
    })
    .join("");
}

/**
 * Render a useful Markdown subset to HTML:
 * headings, paragraphs, fenced + indented code, lists (nested), tables,
 * blockquotes, horizontal rules, images and links.
 *
 * Deliberately small — the notebooks' markdown comes from a course, and this
 * covers what courses actually use. Raw HTML is escaped, except for a whitelist
 * of inline tags the class notebooks really use (`<sup>`, `<sub>`, `<br>`);
 * everything else stays visible as text instead of becoming markup.
 */
export function mdToHtml(src, { glossaryBase = "glossary.html", headingIds = true } = {}) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  const headings = [];

  const isBlank = (l) => /^\s*$/.test(l);
  const fence = (l) => /^\s*(```|~~~)/.exec(l);
  const heading = (l) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
  const hr = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const ulItem = (l) => /^(\s*)([-*+])\s+(.*)$/.exec(l);
  const olItem = (l) => /^(\s*)(\d{1,3})[.)]\s+(.*)$/.exec(l);
  const quote = (l) => /^\s*>\s?(.*)$/.exec(l);
  const tableRow = (l) => /\|/.test(l) && /^\s*\|?/.test(l);
  const tableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && /\|/.test(l);

  function renderList(startIdx, ordered) {
    const baseIndent = (ordered ? olItem(lines[startIdx]) : ulItem(lines[startIdx]))[1].length;
    const items = [];
    let idx = startIdx;
    let current = null;
    while (idx < lines.length) {
      const line = lines[idx];
      if (isBlank(line)) {
        // a blank line only ends the list if the next non-blank line is not a list item
        let peek = idx + 1;
        while (peek < lines.length && isBlank(lines[peek])) peek++;
        const next = lines[peek];
        const nextItem = next ? (olItem(next) || ulItem(next)) : null;
        if (!nextItem || nextItem[1].length < baseIndent) break;
        idx = peek;
        continue;
      }
      const m = ordered ? olItem(line) : ulItem(line);
      if (m && m[1].length <= baseIndent + 1) {
        if (current) items.push(current);
        current = [m[3]];
        idx++;
        continue;
      }
      const other = ordered ? ulItem(line) : olItem(line);
      if (other && other[1].length <= baseIndent + 1) break;
      if (current) {
        // continuation line or nested list
        const indented = /^\s{2,}/.test(line) && (ulItem(line) || olItem(line));
        if (indented) {
          current.nested = true;
          current.push(line);
        } else {
          current.push(line.trim());
        }
        idx++;
        continue;
      }
      break;
    }
    if (current) items.push(current);
    const tag = ordered ? "ol" : "ul";
    const body = items
      .map((item) => {
        const nested = item.nested;
        const text = nested ? item.join("\n") : item.join(" ");
        return `<li>${nested ? mdToHtml(text, { glossaryBase, headingIds: false }).html : renderInline(text)}</li>`;
      })
      .join("");
    return { html: `<${tag}>${body}</${tag}>`, next: idx };
  }

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    const f = fence(line);
    if (f) {
      const marker = f[1];
      const lang = line.slice(line.indexOf(marker) + marker.length).trim();
      i++;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang.split(/[\s,{]/)[0])}"` : "";
      html.push(`<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const h = heading(line);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = slugify(plainText(text));
      if (headingIds) headings.push({ level, text: plainText(text), id });
      html.push(`<h${level}${headingIds ? ` id="${id}"` : ""}>${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (hr(line)) {
      html.push("<hr>");
      i++;
      continue;
    }

    const q = quote(line);
    if (q) {
      const buf = [];
      while (i < lines.length && quote(lines[i])) {
        buf.push(quote(lines[i])[1]);
        i++;
      }
      html.push(`<blockquote>${mdToHtml(buf.join("\n"), { glossaryBase, headingIds: false }).html}</blockquote>`);
      continue;
    }

    if (ulItem(line) || olItem(line)) {
      const res = renderList(i, Boolean(olItem(line)));
      html.push(res.html);
      i = res.next;
      continue;
    }

    if (tableRow(line) && i + 1 < lines.length && tableSep(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && tableRow(lines[i]) && !isBlank(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      html.push(
        `<table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }

    // Indented code block (4 spaces) — only when not part of a list.
    if (/^ {4,}\S/.test(line) && !ulItem(line) && !olItem(line)) {
      const code = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || isBlank(lines[i]))) {
        if (isBlank(lines[i]) && !/^ {4,}/.test(lines[i + 1] ?? "")) break;
        code.push(lines[i].replace(/^ {4}/, ""));
        i++;
      }
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // Paragraph
    const buf = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !fence(lines[i]) && !heading(lines[i]) &&
           !hr(lines[i]) && !quote(lines[i]) && !ulItem(lines[i]) && !olItem(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${renderInline(buf.join("\n").replace(/\s*\n\s*/g, " "))}</p>`);
  }

  const out = html.join("\n").replace(/href="GLOSSARY_BASE#/g, `href="${glossaryBase}#`);
  return { html: out, headings };
}

/** Just the HTML string (most call sites). */
export function md(src, opts) {
  return mdToHtml(src, opts).html;
}

/* ----------------------------------------------------- glossary linking --- */

/**
 * Turn the first plain-text occurrence of each glossary term into [[slug|word]]
 * markup, so mdToHtml renders it as a link to the glossary. Skips code spans,
 * fenced blocks, existing markdown links and explicit [[...]] markup.
 */
export function linkTerms(source, entries) {
  const text = String(source ?? "");
  if (!entries || !entries.length) return text;

  const words = [];
  for (const entry of entries) {
    const slug = entry.slug || slugify(entry.term);
    for (const word of [entry.term, ...(entry.aliases || [])]) {
      if (word && /^[A-Za-z][A-Za-z0-9 ._\-'()]*$/.test(word)) words.push({ slug, word: word.trim() });
    }
  }
  words.sort((a, b) => b.word.length - a.word.length);

  const used = new Set();
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`|\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]*\))/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // protected segment
      let segment = part;
      for (const { slug, word } of words) {
        if (used.has(slug)) continue;
        const re = new RegExp(`\\b${escapeRe(word)}\\b`, "i");
        const m = re.exec(segment);
        if (!m) continue;
        used.add(slug);
        segment = segment.slice(0, m.index) + `[[${slug}|${m[0]}]]` + segment.slice(m.index + m[0].length);
      }
      return segment;
    })
    .join("");
}

/* -------------------------------------------------- output normalization --- */

/** Normalize program output: line endings, tabs, trailing spaces, edge blank lines. */
export function normalizeOutput(value, { ignoreWhitespace = false } = {}) {
  let t = String(value ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  if (ignoreWhitespace) {
    t = t
      .split("\n")
      .map((l) => l.trim().replace(/\s+/g, " "))
      .join("\n");
  } else {
    t = t
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n");
  }
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Compare two blocks of output. */
export function compareOutput(actual, expected, opts = {}) {
  const a = normalizeOutput(actual, opts);
  const b = normalizeOutput(expected, opts);
  const equal = opts.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;
  return { ok: equal, actual: a, expected: b };
}

/** Minimal LCS line diff, good enough for short program output. */
export function diffLines(actual, expected, opts = {}) {
  const a = normalizeOutput(actual, opts).split("\n");
  const b = normalizeOutput(expected, opts).split("\n");
  if (a.length === 1 && a[0] === "") a.length = 0;
  if (b.length === 1 && b[0] === "") b.length = 0;

  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "extra", text: a[i] });
      i++;
    } else {
      ops.push({ type: "missing", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "extra", text: a[i++] });
  while (j < m) ops.push({ type: "missing", text: b[j++] });
  return ops;
}

/* ------------------------------------------------------------- storage ---- */

export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(CONFIG.storagePrefix + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function lsSet(key, value) {
  try {
    localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function lsDel(key) {
  try {
    localStorage.removeItem(CONFIG.storagePrefix + key);
  } catch {
    /* ignore */
  }
}

const PROGRESS_KEY = "progress";

export function getProgress() {
  const p = lsGet(PROGRESS_KEY, {});
  return p && typeof p === "object" ? p : {};
}

export function getProgressFor(id) {
  return getProgress()[id] || null;
}

/** status: "solved" | "attempted"; keeps the last code the learner wrote. */
export function recordAttempt(id, patch = {}) {
  const all = getProgress();
  const prev = all[id] || { attempts: 0 };
  const next = {
    ...prev,
    ...patch,
    attempts: (prev.attempts || 0) + (patch.countAttempt === false ? 0 : 1),
    updatedAt: new Date().toISOString(),
  };
  delete next.countAttempt;
  if (prev.status === "solved" && patch.status !== "solved") next.status = "solved";
  all[id] = next;
  lsSet(PROGRESS_KEY, all);
  return next;
}

export function mergeProgress(id, patch) {
  const all = getProgress();
  all[id] = { ...(all[id] || {}), ...patch, updatedAt: new Date().toISOString() };
  lsSet(PROGRESS_KEY, all);
  return all[id];
}

export function resetProgress() {
  lsDel(PROGRESS_KEY);
}

/* ---------------------------------------------------------------- misc ---- */

export function param(name, url = null) {
  const search = url ? new URL(url, location.href).search : location.search;
  return new URLSearchParams(search).get(name);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function pluralize(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/* ------------------------------------------------------------ view mode --- */

/** The two ways a list can be shown anywhere on the site. */
export const VIEW_MODES = [
  ["tiles", "Tiles"],
  ["table", "Table"],
];

/** Remembered per list, so "table" stays table on every visit. */
export function getViewMode(key, fallback = "tiles") {
  const stored = lsGet(`view:${key}`, fallback);
  return stored === "table" ? "table" : fallback;
}

export function setViewMode(key, value) {
  lsSet(`view:${key}`, value === "table" ? "table" : "tiles");
}

/**
 * The Tiles / Table switch shown above a list.
 * @param {string} current  "tiles" or "table"
 * @param {(value: string) => void} onPick
 */
export function viewToggle(current, onPick, { label = "Show as" } = {}) {
  const wrap = el("span", { class: "group" });
  wrap.append(el("span", { class: "lbl", text: label }));
  const group = el("span", { class: "view-toggle", role: "group" });
  for (const [value, text] of VIEW_MODES) {
    const button = el("button", {
      type: "button",
      text,
      "aria-pressed": String(current === value),
      "data-value": value,
    });
    button.addEventListener("click", () => {
      onPick(value);
      for (const other of group.children) other.setAttribute("aria-pressed", String(other.dataset.value === value));
    });
    group.append(button);
  }
  wrap.append(group);
  return wrap;
}

export const TYPE_LABELS = {
  fix_the_code: "Fix the code",
  fill_in_blank: "Fill in the blank",
  predict_output: "Predict the output",
  write_from_scratch: "Write from scratch",
};

export const TYPE_ORDER = ["fix_the_code", "fill_in_blank", "predict_output", "write_from_scratch"];
