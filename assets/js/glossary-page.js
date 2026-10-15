/**
 * glossary.html — every term, searchable, in A–Z order or grouped by the
 * assignment it is used in.
 */

import { assignmentForProblem, loadAssignments } from "./assignments.js";
import { focusHash, loadGlossary, renderGlossaryPage } from "./glossary.js";
import { loadProblems } from "./problems.js";
import { escapeHtml, normalizeOutput } from "./util.js";

async function main() {
  const host = document.getElementById("glossary");
  const search = document.getElementById("term-search");
  const sortSelect = document.getElementById("term-sort");
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
  // Knowing which notebook each exercise came from is what makes "sort by
  // assignment" possible; without it the page still works, in A–Z order.
  await loadAssignments();

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

  const applyFilter = () => {
    const needle = search.value.trim().toLowerCase();
    let visible = 0;
    for (const entry of host.querySelectorAll(".term-entry")) {
      const matches = !needle || (haystack.get(entry.id) || "").includes(needle);
      entry.classList.toggle("hidden", !matches);
      if (matches) visible += 1;
    }
    // Hide an assignment heading that has no visible term left under it.
    for (const heading of host.querySelectorAll(".list-group")) {
      let node = heading.nextElementSibling;
      let any = false;
      while (node && !node.classList.contains("list-group")) {
        if (node.classList.contains("term-entry") && !node.classList.contains("hidden")) any = true;
        node = node.nextElementSibling;
      }
      heading.classList.toggle("hidden", !any);
    }
    countBadge.textContent = needle ? `${visible} of ${glossary.entries.length} terms` : `${glossary.entries.length} terms`;
  };

  const render = (groupBy) => {
    renderGlossaryPage(host, glossary, problems, { groupBy, assignmentFor: assignmentForProblem });
    applyFilter();
  };

  search.addEventListener("input", applyFilter);
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      render(sortSelect.value === "assignment" ? "assignment" : "alpha");
      focusHash(host, glossary);
    });
  }

  render(sortSelect && sortSelect.value === "assignment" ? "assignment" : "alpha");

  focusHash(host, glossary);
  window.addEventListener("hashchange", () => {
    search.value = "";
    applyFilter();
    focusHash(host, glossary);
  });
}

main();
