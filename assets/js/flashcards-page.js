/**
 * flashcards.html — the revision deck for the class in the header.
 *
 * Cards are grouped by assignment (the default), topic or library, filtered to
 * one assignment / topic / library, and searched across the method, the
 * explanation and the code. The study view shows one card at a time with the
 * arrow keys. The state is kept in the URL, so a link can carry a filter:
 *   flashcards.html?course=fin400&topic=Grouping
 */

import { activeCourse, loadCourses, mountCoursePicker } from "./course.js";
import {
  GROUP_MODES,
  cardCountLabel,
  clearCardProgress,
  createFlashcard,
  filterCards,
  filterFlashcards,
  flashcardFacets,
  groupFlashcards,
  loadCardProgress,
  loadFlashcards,
  progressLabel,
  progressSummary,
  renderFlashcardGroups,
  saveCardStatus,
} from "./flashcards.js";
import { el, escapeHtml, lsGet, lsSet } from "./util.js";

const MODE_KEY = "flashcards:mode";
const GROUP_KEY = "flashcards:group";
const params = new URLSearchParams(location.search);

const state = {
  mode: params.get("mode") === "study" ? "study" : "cards",
  group: GROUP_MODES.some(([value]) => value === params.get("group"))
    ? params.get("group")
    : GROUP_MODES.some(([value]) => value === lsGet(GROUP_KEY, ""))
      ? lsGet(GROUP_KEY, "assignment")
      : "assignment",
  library: params.get("library") || "",
  topic: params.get("topic") || "",
  assignment: params.get("assignment") || "",
  status: params.get("status") || "",
  query: params.get("q") || "",
  index: 0,
  cards: [],
  progress: {},
};

let deck = null;
let course = null;
let catalog = null;

const $ = (id) => document.getElementById(id);

/** Write the current filters back to the address bar (shareable links). */
function syncUrl() {
  const url = new URL(location.href);
  const write = (key, value, fallback = "") => {
    if (value && value !== fallback) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };
  write("mode", state.mode, "cards");
  write("group", state.group, "assignment");
  write("library", state.library);
  write("topic", state.topic);
  write("assignment", state.assignment);
  write("status", state.status);
  write("q", state.query);
  history.replaceState(null, "", url);
}

function fillSelect(select, first, items, current) {
  select.innerHTML = "";
  select.append(el("option", { value: "", text: first }));
  for (const item of items) {
    select.append(el("option", { value: item.value, text: `${item.value} (${item.count})` }));
  }
  select.value = items.some((item) => item.value === current) ? current : "";
  return select.value;
}

function buildModeBar(host) {
  host.innerHTML = "";
  const wrap = el("span", { class: "group" });
  wrap.append(el("span", { class: "lbl", text: "Show" }));
  const group = el("span", { class: "view-toggle", role: "group" });
  for (const [value, text] of [
    ["cards", "Cards"],
    ["study", "Study deck"],
  ]) {
    const button = el("button", {
      type: "button",
      text,
      "aria-pressed": String(state.mode === value),
      "data-value": value,
    });
    button.addEventListener("click", () => {
      state.mode = value;
      state.index = 0;
      lsSet(MODE_KEY, value);
      for (const other of group.children) other.setAttribute("aria-pressed", String(other.dataset.value === value));
      syncUrl();
      render();
    });
    group.append(button);
  }
  wrap.append(group);
  host.append(wrap);
}

function emptyState({ message, clear = false, other = null }) {
  const host = $("flashcards");
  host.innerHTML = "";
  const notice = el("div", { class: "notice" });
  notice.append(el("p", { text: message }));
  if (clear) {
    const row = el("div", { class: "btn-row" });
    const button = el("button", { type: "button", class: "btn small", text: "Clear the filters" });
    button.addEventListener("click", () => {
      state.library = "";
      state.topic = "";
      state.assignment = "";
      state.status = "";
      state.query = "";
      state.index = 0;
      $("flashcard-search").value = "";
      $("flashcard-library").value = "";
      $("flashcard-topic").value = "";
      $("flashcard-assignment").value = "";
      $("flashcard-status").value = "";
      syncUrl();
      render();
    });
    row.append(button);
    notice.append(row);
  }
  if (other) {
    const row = el("div", { class: "btn-row" });
    row.append(
      el("a", {
        class: "btn small primary",
        href: `?course=${encodeURIComponent(other.id)}`,
        text: `Open the ${other.code} flashcards`,
      }),
    );
    notice.append(row);
  }
  host.append(notice);
}

/**
 * Keep a mark in this browser and refresh the summary. When the deck is
 * filtered to one status, the card that no longer matches leaves the list, so
 * the page is re-rendered instead of leaving a stale card on screen.
 */
function markStatus(card, status) {
  state.progress = saveCardStatus(card.id, status);
  updateSummary();
  if (state.status) render();
}

/** The "x of y known" line and the progress bar above the deck. */
function updateSummary() {
  const host = $("flashcard-progress");
  if (!host) return;
  const summary = progressSummary(state.totalCards || state.cards, state.progress);
  host.innerHTML = "";
  host.append(
    el("span", { class: "small muted", text: progressLabel(summary) }),
    el("span", {
      class: "progress-track",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(summary.percent),
      "aria-label": "Cards marked known",
    }, [el("span", { class: "progress-fill", style: `width:${summary.percent}%` })]),
  );
}

/** One card at a time, with previous/next and a reveal button. */
function renderStudy(cards) {
  const host = $("flashcards");
  host.innerHTML = "";
  if (!cards.length) return;
  state.index = Math.min(Math.max(0, state.index), cards.length - 1);
  const index = state.index;
  const card = cards[index];

  const wrap = el("div", { class: "study-deck" });
  const meta = el("div", { class: "row-between deck-meta" });
  meta.append(
    el("span", { class: "small muted", text: `Card ${index + 1} of ${cards.length}` }),
    el("span", { class: "small muted", text: card.assignment }),
  );

  const flip = el("button", { type: "button", class: "btn small primary", text: "Show answer" });
  const view = createFlashcard(card, {
    status: state.progress[card.id] ? state.progress[card.id].status : "",
    onStatus: markStatus,
    onToggle: (_card, open) => {
      flip.textContent = open ? "Hide answer" : "Show answer";
    },
  });
  flip.addEventListener("click", () => {
    view.setOpen(!view.isOpen());
  });

  const controls = el("div", { class: "deck-controls" });
  const previous = el("button", { type: "button", class: "btn small", text: "← Previous", disabled: index === 0 });
  const next = el("button", {
    type: "button",
    class: "btn small",
    text: "Next →",
    disabled: index === cards.length - 1,
  });
  const go = (delta) => {
    state.index = Math.min(Math.max(0, index + delta), cards.length - 1);
    renderStudy(cards);
  };
  previous.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  controls.append(previous, flip, next);

  wrap.append(meta, view.node, controls);
  host.append(wrap);
}

function render() {
  if (!deck) return;
  const courseCards = course ? filterFlashcards(deck, course.id) : deck.cards;
  const filtered = Boolean(
    state.library || state.topic || state.assignment || state.status || state.query.trim(),
  );
  const cards = filterCards(courseCards, { ...state, progress: state.progress });
  state.cards = cards;
  state.totalCards = courseCards;

  const count = $("flashcard-count");
  if (count) count.textContent = cardCountLabel(cards.length, courseCards.length, { filtered });
  updateSummary();

  if (!courseCards.length) {
    const others = (catalog ? catalog.courses : []).filter(
      (candidate) => candidate.id !== (course || {}).id && filterFlashcards(deck, candidate.id).length,
    );
    emptyState({
      message: `No flashcards for ${course ? course.code : "this class"} yet. Cards live in data/flashcards.json; give a card "courses": ["${(course || {}).id || "fin400"}"] to file it here.`,
      other: others[0] || null,
    });
    return;
  }

  if (!cards.length) {
    emptyState({ message: "No card matches these filters.", clear: true });
    return;
  }

  if (state.mode === "study") renderStudy(cards);
  else
    renderFlashcardGroups($("flashcards"), groupFlashcards(cards, state.group), {
      progress: state.progress,
      onStatus: markStatus,
    });
}

async function main() {
  const host = $("flashcards");
  try {
    deck = await loadFlashcards();
  } catch (error) {
    host.innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  try {
    catalog = await loadCourses();
    course = await activeCourse(catalog);
    mountCoursePicker(catalog, { active: course.id });
    if (course) document.title = `Flashcards — ${course.code}`;
  } catch (error) {
    console.warn(error.message);
  }

  const facets = flashcardFacets(course ? filterFlashcards(deck, course.id) : deck.cards);
  // A link may name a filter that this class does not have; drop it rather
  // than showing an empty deck with no obvious way out.
  if (state.library && !facets.libraries.some((item) => item.value === state.library)) state.library = "";
  if (state.topic && !facets.topics.some((item) => item.value === state.topic)) state.topic = "";
  if (state.assignment && !facets.assignments.some((item) => item.value === state.assignment)) state.assignment = "";

  fillSelect($("flashcard-library"), "all libraries", facets.libraries, state.library);
  state.library = $("flashcard-library").value;
  fillSelect($("flashcard-topic"), "all topics", facets.topics, state.topic);
  state.topic = $("flashcard-topic").value;
  fillSelect($("flashcard-assignment"), "all assignments", facets.assignments, state.assignment);
  state.assignment = $("flashcard-assignment").value;

  const groupSelect = $("flashcard-group");
  groupSelect.innerHTML = "";
  for (const [value, label] of GROUP_MODES) {
    groupSelect.append(el("option", { value, text: `By ${label.toLowerCase()}` }));
  }
  groupSelect.value = state.group;

  // The status filter is fixed (there are only three states); the deck decides
  // whether a card is in each one.
  const statusSelect = $("flashcard-status");
  if (statusSelect) {
    statusSelect.innerHTML = "";
    for (const [value, label] of [
      ["", "all cards"],
      ["known", "Known"],
      ["review", "Need to review"],
      ["unseen", "Not seen yet"],
    ]) {
      statusSelect.append(el("option", { value, text: label }));
    }
    statusSelect.value = state.status;
    statusSelect.addEventListener("change", (event) => {
      state.status = event.target.value;
      state.index = 0;
      syncUrl();
      render();
    });
  }

  state.progress = loadCardProgress();

  const reset = $("flashcard-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      if (!window.confirm("Clear every known / review mark for the flashcards in this browser?")) return;
      state.progress = clearCardProgress();
      state.index = 0;
      render();
    });
  }

  $("flashcard-search").value = state.query;
  buildModeBar($("mode-bar"));

  $("flashcard-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    state.index = 0;
    syncUrl();
    render();
  });
  $("flashcard-library").addEventListener("change", (event) => {
    state.library = event.target.value;
    state.index = 0;
    syncUrl();
    render();
  });
  $("flashcard-topic").addEventListener("change", (event) => {
    state.topic = event.target.value;
    state.index = 0;
    syncUrl();
    render();
  });
  $("flashcard-assignment").addEventListener("change", (event) => {
    state.assignment = event.target.value;
    state.index = 0;
    syncUrl();
    render();
  });
  groupSelect.addEventListener("change", (event) => {
    state.group = event.target.value;
    lsSet(GROUP_KEY, state.group);
    syncUrl();
    render();
  });

  // Arrow keys page through the study deck, except while typing in a control.
  document.addEventListener("keydown", (event) => {
    if (state.mode !== "study" || !state.cards.length) return;
    const tag = ((event.target && event.target.tagName) || "").toLowerCase();
    if (["input", "select", "textarea"].includes(tag)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      state.index = Math.min(Math.max(0, state.index + delta), state.cards.length - 1);
      renderStudy(state.cards);
    }
  });

  syncUrl();
  render();
}

main();
