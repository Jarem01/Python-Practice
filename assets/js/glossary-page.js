/**
 * glossary.html — every term in one place. Terms can be searched, filtered to a
 * single class section ("Data Analysis 3"), ordered A–Z or by assignment, and
 * shown as cards or as a table.
 */

import { assignmentForProblem, assignmentsForProblems, loadAssignments } from "./assignments.js";
import { focusHash, loadGlossary, renderGlossaryPage } from "./glossary.js";
import { loadProblems } from "./problems.js";
import { el, escapeHtml, getViewMode, normalizeOutput, setViewMode, viewToggle } from "./util.js";

const VIEW_KEY = "glossary";

async function main() {
  const host = document.getElementById("glossary");
  const search = document.getElementById("term-search");
  const sortSelect = document.getElementById("term-sort");
  const sectionSelect = document.getElementById("term-section");
  const viewBar = document.getElementById("view-bar");
  const countBadge = document.getElementById("term-count");

  let glossary;
  try {
    glossary = await loadGlossary();
  } catch (error) {
    host.innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p><p class="small">Serve the folder over HTTP, e.g. <code>python3 -m http.server 8000</code>.</p></div>`;
    return;
  }

  let problems = [];
  try {
    problems = await loadProblems();
  } catch {
    /* "practice it" links are optional */
  }
  await loadAssignments();

  // Which section does each term belong to? An exercise lists the terms it puts
  // to work, and it knows the notebook it came from — so a term belongs to the
  // same section as the exercises that use it.
  const sectionOf = new Map();
  const addTo = (slug, key) => {
    if (!slug || !key) return;
    if (!sectionOf.has(slug)) sectionOf.set(slug, new Set());
    sectionOf.get(slug).add(key);
  };
  for (const problem of problems) {
    const key = assignmentForProblem(problem).key;
    for (const slug of problem.glossary || []) addTo(slug, key);
  }
  const sections = assignmentsForProblems(problems);
  const sectionFor = (entry) => sectionOf.get(entry.slug) || new Set();

  const haystack = new Map();
  for (const entry of glossary.entries) {
    const slug = entry.slug || entry.term;
    haystack.set(
      slug,
      normalizeOutput(
        [entry.term, (entry.aliases || []).join(" "), entry.definition, entry.example, (entry.tags || []).join(" ")].join(" "),
        { ignoreWhitespace: true },
      ).toLowerCase(),
    );
  }

  const sectionLabel = new Map(sections.map((section) => [section.key, section.label]));
  sections.forEach((section) => sectionLabel.set(section.key, section.label));

  const applyFilter = () => {
    const needle = search.value.trim().toLowerCase();
    const section = sectionSelect ? sectionSelect.value : "";
    let visible = 0;
    // Group headings are hidden when everything under them is filtered out.
    const headingState = new Map();
    for (const entry of host.querySelectorAll(".term-entry")) {
      const bySearch = !needle || (haystack.get(entry.id) || "").includes(needle);
      const bySection = !section || sectionFor({ slug: entry.id }).has(section);
      const matches = bySearch && bySection;
      entry.classList.toggle("hidden", !matches);
      if (matches) visible += 1;
    }
    for (const heading of host.querySelectorAll(".list-group")) {
      let node = heading.nextElementSibling;
      let any = false;
      while (node && !node.classList.contains("list-group")) {
        if (
          (node.classList.contains("term-entry") && !node.classList.contains("hidden")) ||
          (node.tagName === "TABLE" &&
            [...node.querySelectorAll(".term-row")].some((row) => !row.classList.contains("hidden")))
        ) {
          any = true;
        }
        node = node.nextElementSibling;
      }
      headingState.set(heading, any);
      heading.classList.toggle("hidden", !any);
    }
    countBadge.textContent = (
      needle || section
        ? `${visible} of ${glossary.entries.length} terms`
        : `${glossary.entries.length} terms`
    ) + (section ? ` in ${sectionLabel.get(section) || "this section"}` : "");
  };

  const order = () => (sortSelect && sortSelect.value === "assignment" ? "assignment" : "alpha");
  const render = () => {
    renderGlossaryPage(host, glossary, problems, {
      groupBy: order(),
      view: getViewMode(VIEW_KEY),
      assignmentFor: assignmentForProblem,
    });
    applyFilter();
  };

  // Section dropdown: all terms, or the terms of one section of the course.
  if (sectionSelect) {
    sectionSelect.innerHTML = "";
    sectionSelect.append(el("option", { value: "", text: "all sections" }));
    for (const section of sections) {
      const count = glossary.entries.filter((entry) => sectionFor(entry).has(section.key)).length;
      sectionSelect.append(el("option", { value: section.key, text: `${section.label} (${count})` }));
    }
    sectionSelect.addEventListener("change", applyFilter);
  }

  search.addEventListener("input", applyFilter);
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      render();
      focusHash(host, glossary);
    });
  }

  if (viewBar) {
    viewBar.innerHTML = "";
    viewBar.append(
      viewToggle(getViewMode(VIEW_KEY), (value) => {
        setViewMode(VIEW_KEY, value);
        render();
      }),
    );
  }

  render();
  focusHash(host, glossary);
  window.addEventListener("hashchange", () => {
    search.value = "";
    if (sectionSelect) sectionSelect.value = "";
    applyFilter();
    focusHash(host, glossary);
  });
}

main();
