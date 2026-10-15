/**
 * Glossary: loading, slug/alias resolution, term linking helpers and the
 * glossary page renderer.
 */

import { PATHS } from "./config.js";
import { el, escapeHtml, md, slugify } from "./util.js";

let cache = null;

export async function loadGlossary() {
  if (cache) return cache;
  const response = await fetch(PATHS.glossary, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not read the glossary (HTTP ${response.status})`);
  const data = await response.json();
  const entries = (data.entries || [])
    .map((entry) => {
      const slug = entry.slug || slugify(entry.term);
      return {
        ...entry,
        slug,
        aliasSlugs: [...new Set((entry.aliases || []).map((a) => slugify(a)))].filter((s) => s !== slug),
      };
    })
    .sort((a, b) => a.term.localeCompare(b.term));
  cache = { ...data, entries };
  return cache;
}

/** Map every canonical slug and alias slug to its entry. */
export function buildIndex(entries) {
  const bySlug = new Map();
  const aliasToSlug = new Map();
  for (const entry of entries) {
    bySlug.set(entry.slug, entry);
    for (const alias of entry.aliasSlugs) aliasToSlug.set(alias, entry.slug);
  }
  return { bySlug, aliasToSlug };
}

/**
 * The glossary entries worth auto-linking inside one problem: the ones the
 * problem explicitly lists, plus any whose tags match the problem's topics.
 * Keeps link density sane instead of linking every term in the document.
 */
export function termsForProblem(glossary, problem) {
  if (!glossary || !problem) return [];
  const wanted = new Set(problem.glossary || []);
  const topics = new Set((problem.topics || []).map((t) => t.toLowerCase()));
  return glossary.entries.filter(
    (entry) =>
      wanted.has(entry.slug) ||
      entry.aliasSlugs.some((alias) => wanted.has(alias)) ||
      (entry.tags || []).some((tag) => topics.has(String(tag).toLowerCase())),
  );
}

export function renderTermChips(glossary, slugs, { base = "glossary.html" } = {}) {
  const { bySlug, aliasToSlug } = buildIndex(glossary.entries);
  const chips = (slugs || [])
    .map((slug) => {
      const canonical = bySlug.has(slug) ? slug : aliasToSlug.get(slug);
      const entry = canonical ? bySlug.get(canonical) : null;
      const label = entry ? entry.term : slug;
      return `<a class="pill" href="${base}#${canonical || slug}" title="${entry ? escapeHtml(entry.definition) : "Glossary term"}">${escapeHtml(label)}</a>`;
    })
    .join("");
  return chips ? `<div class="pill-row">${chips}</div>` : "";
}

/* ----------------------------------------------------------- page render -- */

/**
 * Render the whole glossary into `container`.
 * @param {HTMLElement} container
 * @param {{entries: Array}} glossary
 * @param {Array} problems   used for "where is this used?" links
 */
export function renderGlossaryPage(container, glossary, problems = [], options = {}) {
  const { groupBy = "alpha", assignmentFor = null } = options;
  const { bySlug, aliasToSlug } = buildIndex(glossary.entries);
  const usage = new Map();
  // Which assignment(s) use each term: with this, the glossary can be read in
  // course order ("everything Part 2 needs") as well as A–Z.
  const usedBy = new Map();
  for (const problem of problems) {
    const assignment = assignmentFor ? assignmentFor(problem) : null;
    for (const slug of problem.glossary || []) {
      const canonical = bySlug.has(slug) ? slug : aliasToSlug.get(slug);
      if (!canonical) continue;
      if (!usage.has(canonical)) usage.set(canonical, []);
      usage.get(canonical).push(problem);
      if (assignment) {
        if (!usedBy.has(canonical)) usedBy.set(canonical, new Map());
        usedBy.get(canonical).set(assignment.key, assignment);
      }
    }
  }

  container.innerHTML = "";

  /** The assignments a term is used in, in course order. */
  const usedIn = (entry) => [...(usedBy.get(entry.slug) || new Map()).values()].sort((a, b) => a.order - b.order);
  const termGroup = (entry) => {
    const assignments = usedIn(entry);
    return assignments.length ? assignments[0] : { key: "__none__", label: "Not used in an exercise yet", order: 9999 };
  };
  const groupHeading = (group) => {
    const heading = el("div", { class: "list-group" });
    heading.append(el("h3", { text: group.label }));
    heading.append(el("span", { class: "small muted", text: "from this assignment" }));
    return heading;
  };

  if (groupBy !== "assignment") {
    // A–Z index
    const letters = [...new Set(glossary.entries.map((e) => e.term[0].toUpperCase()))].sort();
    const index = el("div", { class: "glossary-index" });
    for (const letter of letters) {
      const anchor = glossary.entries.find((e) => e.term[0].toUpperCase() === letter);
      index.append(el("a", { href: `#${anchor.slug}`, text: letter }));
    }
    index.append(el("a", { href: "#top", text: "↑" }));
    container.append(index);
  }

  const list = el("div", { class: "stack" });
  let currentGroup = null;
  for (const entry of glossary.entries) {
    if (groupBy === "assignment") {
      const group = termGroup(entry);
      if (group.key !== currentGroup) {
        currentGroup = group.key;
        list.append(groupHeading(group));
      }
    }
    const card = el("section", { class: "card term-entry", id: entry.slug });
    const head = el("div", { class: "row-between" }, [
      el("h3", { html: escapeHtml(entry.term) }),
      el("div", { class: "pill-row", html: (entry.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("") }),
    ]);
    card.append(head);

    if (entry.aliases?.length) {
      card.append(el("p", { class: "aliases tiny", text: `also: ${entry.aliases.join(", ")}` }));
    }
    const assignments = usedIn(entry);
    if (assignments.length) {
      card.append(el("p", { class: "tiny muted", text: `Used in: ${assignments.map((a) => a.label).join(", ")}` }));
    }
    card.append(el("div", { html: md(entry.definition) }));

    if (entry.example) {
      card.append(el("pre", { html: `<code>${escapeHtml(entry.example)}</code>` }));
    }

    const links = el("div", { class: "stack" });
    if (entry.see_also?.length) {
      const related = entry.see_also
        .map((slug) => {
          const canonical = bySlug.has(slug) ? slug : aliasToSlug.get(slug);
          const target = bySlug.get(canonical);
          return target ? `<a class="term" href="#${canonical}">${escapeHtml(target.term)}</a>` : null;
        })
        .filter(Boolean)
        .join(", ");
      if (related) links.append(el("p", { class: "small", html: `See also: ${related}` }));
    }

    const used = usage.get(entry.slug) || [];
    if (used.length) {
      const label = used.length === 1 ? "1 exercise" : `${used.length} exercises`;
      links.append(
        el("p", {
          class: "small",
          html: `Practice it: ${used
            .slice(0, 8)
            .map((p) => `<a href="practice/exercise.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>`)
            .join(", ")}${used.length > 8 ? ` … (${label} in total)` : ""}`,
        }),
      );
    }
    card.append(links);
    list.append(card);
  }
  container.append(list);

  return { bySlug, aliasToSlug };
}

/** Scroll to a term, following alias links such as #mutability. */
export function focusHash(container, glossary, hash = location.hash) {
  const slug = decodeURIComponent(String(hash || "").replace(/^#/, ""));
  if (!slug) return;
  const { bySlug, aliasToSlug } = buildIndex(glossary.entries);
  const canonical = bySlug.has(slug) ? slug : aliasToSlug.get(slug);
  if (!canonical) return;
  const target = container.querySelector(`#${CSS.escape(canonical)}`);
  if (!target) return;
  target.scrollIntoView({ block: "start" });
  if (canonical !== slug) history.replaceState(null, "", `#${canonical}`);
}
