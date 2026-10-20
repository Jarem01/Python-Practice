/**
 * Flashcards: one card per method, in the student's own words.
 *
 * `data/flashcards.json` is hand-written (no build step): every card says what
 * the method does, shows a call a student can paste and run, and prints the
 * output that call produces. This module loads the deck, and groups it by
 * assignment, topic or library — the three ways a student revises.
 *
 * The helpers here have no DOM side effects, so they can be unit-tested in Node
 * (tests/flashcards.test.mjs).
 */

import { PATHS } from "./config.js";
import { el, escapeHtml, lsGet, lsSet, md, normalizeOutput, pluralize, slugify } from "./util.js";

let cache = null;

/** The orders the deck can be listed in. The first is the course order. */
export const GROUP_MODES = [
  ["assignment", "Assignment"],
  ["topic", "Topic"],
  ["library", "Library"],
  ["alpha", "A–Z"],
];

/**
 * Load `data/flashcards.json` once.
 * @returns {Promise<{cards: Array, libraries: Array, topics: Array, assignments: Array}>}
 */
export async function loadFlashcards({ force = false } = {}) {
  if (cache && !force) return cache;
  let response;
  try {
    response = await fetch(PATHS.flashcards, { cache: "no-cache" });
  } catch (error) {
    throw new Error(`Could not read the flashcards (${(error && error.message) || error}).`);
  }
  if (!response.ok) {
    throw new Error(
      `Could not read ${PATHS.flashcards} (HTTP ${response.status}). Serve the folder over HTTP, e.g. "python3 -m http.server 8000".`,
    );
  }
  const data = await response.json();
  const cards = (data.cards || []).map((raw, index) => normalizeCard(raw, index)).filter(Boolean);
  cache = { ...data, cards, ...flashcardFacets(cards) };
  return cache;
}

/** One card with every field present and trimmed, or null when it has no method. */
export function normalizeCard(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const method = String(raw.method || raw.term || "").trim();
  if (!method) return null;
  const topics = [...new Set((raw.topics || []).map((topic) => String(topic).trim()).filter(Boolean))];
  return {
    id: String(raw.id || slugify(method) || `card-${index + 1}`),
    method,
    library: String(raw.library || "other").trim(),
    topics,
    assignment: String(raw.assignment || "Not filed under an assignment yet").trim(),
    courses: Array.isArray(raw.courses) && raw.courses.length ? raw.courses.map(String) : null,
    does: String(raw.does || "").trim(),
    call: String(raw.call || "").trim(),
    // Only line endings and trailing blank lines are normalized: the output is
    // what the code prints, spaces and all.
    output: String(raw.output ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, ""),
    setup: raw.setup ? String(raw.setup).trim() : "",
    order: index,
  };
}

/** A card is in a class when it names no class (shared) or names this one. */
export function matchesCourse(card, courseId) {
  if (!card || !card.courses) return true;
  return card.courses.includes(courseId);
}

/** The cards of one class, in file order. */
export function filterFlashcards(deck, courseId) {
  return (deck.cards || []).filter((card) => matchesCourse(card, courseId));
}

/**
 * Count the values a deck can be filtered by:
 * libraries alphabetically, topics alphabetically, assignments in the order the
 * cards appear (which is the order the teacher wrote them in).
 */
export function flashcardFacets(cards = []) {
  const libraries = new Map();
  const topics = new Map();
  const assignments = new Map();
  for (const card of cards) {
    libraries.set(card.library, (libraries.get(card.library) || 0) + 1);
    for (const topic of card.topics) topics.set(topic, (topics.get(topic) || 0) + 1);
    if (!assignments.has(card.assignment)) assignments.set(card.assignment, { value: card.assignment, count: 0, order: assignments.size });
    assignments.get(card.assignment).count += 1;
  }
  const alphabetical = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  return {
    libraries: alphabetical(libraries),
    topics: alphabetical(topics),
    assignments: [...assignments.values()],
  };
}

/** The two states a student can put a card in, plus "not seen yet". */
export const CARD_STATUSES = [
  ["review", "Need to review"],
  ["known", "Known"],
  ["unseen", "Not seen yet"],
];

const PROGRESS_KEY = "flashcards";

/**
 * The known/review marks, kept per browser: `{ cardId: { status, updatedAt } }`.
 * A card that was never marked has no entry, which is "not seen yet".
 */
export function loadCardProgress() {
  const stored = lsGet(PROGRESS_KEY, {});
  const progress = {};
  if (!stored || typeof stored !== "object") return progress;
  for (const [id, record] of Object.entries(stored)) {
    if (record && (record.status === "known" || record.status === "review")) {
      progress[id] = { status: record.status, updatedAt: record.updatedAt || "" };
    }
  }
  return progress;
}

/** Mark a card known / for review, or clear it with status "". */
export function saveCardStatus(cardId, status) {
  const progress = loadCardProgress();
  if (status === "known" || status === "review") {
    progress[cardId] = { status, updatedAt: new Date().toISOString() };
  } else {
    delete progress[cardId];
  }
  lsSet(PROGRESS_KEY, progress);
  return progress;
}

export function clearCardProgress() {
  lsSet(PROGRESS_KEY, {});
  return {};
}

/** "known", "review" or "" (never marked) for one card. */
export function cardStatus(progress, cardId) {
  return (progress && progress[cardId] && progress[cardId].status) || "";
}

/** A short label for the summary bar: "7 of 20 known · 4 to review · 9 unseen". */
export function progressLabel(summary) {
  const { total, known, review, unseen } = summary;
  if (!total) return "Nothing marked yet";
  return `${known} of ${pluralize(total, "card")} known · ${review} to review · ${unseen} not seen`;
}

/** How much of a deck the student has marked, for the summary bar. */
export function progressSummary(cards = [], progress = {}) {
  let known = 0;
  let review = 0;
  for (const card of cards) {
    const status = cardStatus(progress, card.id);
    if (status === "known") known += 1;
    else if (status === "review") review += 1;
  }
  const total = cards.length;
  return {
    total,
    known,
    review,
    unseen: Math.max(0, total - known - review),
    percent: total ? Math.round((known / total) * 100) : 0,
  };
}

export function filterCards(
  cards = [],
  { query = "", library = "", topic = "", assignment = "", status = "", progress = {} } = {},
) {
  const needle = normalizeOutput(query, { ignoreWhitespace: true }).toLowerCase();
  return cards.filter((card) => {
    if (library && card.library !== library) return false;
    if (topic && !card.topics.includes(topic)) return false;
    if (assignment && card.assignment !== assignment) return false;
    if (status) {
      const current = cardStatus(progress, card.id);
      if (status === "unseen" ? current : current !== status) return false;
    }
    if (!needle) return true;
    const haystack = [
      card.method,
      card.does,
      card.call,
      card.output,
      card.setup,
      card.library,
      card.assignment,
      card.topics.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Group cards for display.
 *
 * "assignment" groups keep the order the cards were written in (so they read
 * like the course); "library" and "topic" group alphabetically; a card with two
 * topics appears under both of them. "alpha" is one list sorted by method.
 */
export function groupFlashcards(cards = [], mode = "assignment") {
  if (mode === "alpha") {
    return [
      {
        key: "__all__",
        label: "All methods, A–Z",
        cards: [...cards].sort((a, b) => a.method.localeCompare(b.method, undefined, { sensitivity: "base" })),
      },
    ];
  }

  const groups = new Map();
  const add = (key, label, card) => {
    if (!groups.has(key)) groups.set(key, { key, label, cards: [] });
    groups.get(key).cards.push(card);
  };

  if (mode === "topic") {
    for (const card of cards) {
      if (!card.topics.length) add("__none__", "No topic yet", card);
      else for (const topic of card.topics) add(topic, topic, card);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  if (mode === "library") {
    for (const card of cards) add(card.library, card.library, card);
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  for (const card of cards) add(card.assignment, card.assignment, card);
  return [...groups.values()];
}

/* ---------------------------------------------------------------- render --- */

let backCount = 0;

function codeBlock(text, className = "") {
  return el("pre", { class: className }, [el("code", { text })]);
}

/**
 * One flippable card.
 * @param {object} card
 * @param {{ open?: boolean, status?: string, onToggle?: Function, onStatus?: Function }} options
 * @returns {{ node: HTMLElement, setOpen: Function, isOpen: Function, setStatus: Function, status: Function }}
 */
export function createFlashcard(card, { open = false, status = "", onToggle = null, onStatus = null } = {}) {
  const article = el("article", { class: "flashcard", "data-card": card.id });
  const backId = `flashcard-back-${++backCount}`;

  const badges = el("div", { class: "pill-row" });
  badges.append(el("span", { class: "badge library", text: card.library }));
  for (const topic of card.topics) badges.append(el("span", { class: "badge", text: topic }));
  const statusBadge = el("span", { class: "badge flashcard-status", hidden: !status });
  badges.append(statusBadge);

  const hint = el("span", { class: "flashcard-reveal", text: "Show answer →" });
  const front = el("div", {
    class: "flashcard-front",
    role: "button",
    tabindex: "0",
    "aria-expanded": "false",
    "aria-controls": backId,
  });
  front.append(
    badges,
    el("h3", { class: "flashcard-method", html: `<code>${escapeHtml(card.method)}</code>` }),
    el("p", { class: "tiny muted flashcard-assignment", text: card.assignment }),
    hint,
  );

  const back = el("div", { class: "flashcard-back", id: backId, hidden: true });
  back.append(
    el("h4", { text: "What it does" }),
    el("div", { class: "flashcard-does", html: md(card.does) }),
    el("h4", { text: "In practice" }),
    codeBlock(card.call, "flashcard-code"),
    el("h4", { text: "Output" }),
    codeBlock(card.output || "(no output)", "flashcard-output"),
  );
  if (card.setup) {
    const details = el("details", { class: "flashcard-setup" });
    details.append(el("summary", { text: "The example data behind it" }), codeBlock(card.setup));
    back.append(details);
  }

  let currentStatus = status;
  const statusButtons = new Map();
  const actions = el("div", { class: "flashcard-actions" });
  for (const [value, label] of CARD_STATUSES.filter(([value]) => value !== "unseen")) {
    const button = el("button", { type: "button", class: "btn small", text: label, "data-status": value });
    button.addEventListener("click", () => {
      const next = currentStatus === value ? "" : value;
      setStatus(next);
      if (onStatus) onStatus(card, next);
    });
    statusButtons.set(value, button);
    actions.append(button);
  }
  back.append(actions);

  const setStatus = (value) => {
    currentStatus = value === "known" || value === "review" ? value : "";
    statusBadge.hidden = !currentStatus;
    statusBadge.textContent = currentStatus === "known" ? "known" : currentStatus === "review" ? "review" : "";
    statusBadge.className = "badge flashcard-status" + (currentStatus ? ` ${currentStatus}` : "");
    for (const [key, button] of statusButtons) button.setAttribute("aria-pressed", String(key === currentStatus));
  };

  let isOpen = false;
  const setOpen = (value) => {
    isOpen = Boolean(value);
    back.hidden = !isOpen;
    front.setAttribute("aria-expanded", String(isOpen));
    article.classList.toggle("open", isOpen);
    hint.textContent = isOpen ? "Hide answer ↑" : "Show answer →";
    if (onToggle) onToggle(card, isOpen);
  };

  front.addEventListener("click", () => {
    setOpen(!isOpen);
    front.focus({ preventScroll: true });
  });
  front.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(!isOpen);
    }
  });

  article.append(front, back);
  setStatus(currentStatus);
  setOpen(open);
  return { node: article, setOpen, isOpen: () => isOpen, setStatus, status: () => currentStatus };
}

/** Render grouped cards into `host`; returns the cards actually shown. */
export function renderFlashcardGroups(host, groups, { emptyMessage = "", progress = {}, onStatus = null } = {}) {
  host.innerHTML = "";
  const shown = groups.reduce((total, group) => total + group.cards.length, 0);
  if (!shown) {
    host.append(
      el("div", {
        class: "notice",
        html: `<p>${escapeHtml(emptyMessage || "No flashcards match these filters.")}</p>`,
      }),
    );
    return 0;
  }
  for (const group of groups) {
    const section = el("section", { class: "flashcard-group" });
    if (group.key !== "__all__") {
      const heading = el("div", { class: "list-group" });
      heading.append(el("h3", { text: group.label }));
      heading.append(el("span", { class: "small muted", text: pluralize(group.cards.length, "card") }));
      section.append(heading);
    }
    const grid = el("div", { class: "grid cols-3 flashcard-grid" });
    for (const card of group.cards) {
      grid.append(createFlashcard(card, { status: cardStatus(progress, card.id), onStatus }).node);
    }
    section.append(grid);
    host.append(section);
  }
  return shown;
}

/** Count label above the deck: "6 of 20 cards". */
export function cardCountLabel(shown, total, { filtered = false } = {}) {
  if (!total) return "No cards";
  return filtered ? `${shown} of ${pluralize(total, "card")}` : pluralize(total, "card");
}
