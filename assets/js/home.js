/**
 * index.html — landing page: overall counts, the teaching overview (notebooks
 * with their exercises) and a recommended next exercise.
 */

import { CONFIG } from "./config.js";
import { el, escapeHtml, TYPE_LABELS, TYPE_ORDER } from "./util.js";
import { loadGlossary } from "./glossary.js";
import { loadNotebookManifest, renderNotebookList } from "./notebooks.js";
import { loadProblems, problemStats, problemStatus } from "./problems.js";

function renderStats(problems, manifest, glossary) {
  const host = document.getElementById("stats");
  const stats = problemStats(problems);
  const totals = manifest?.totals || {};
  const cards = [
    ["Notebooks", totals.notebooks ?? 0, "teaching/"],
    ["Notebook exercises", totals.exercises ?? 0, "teaching/"],
    ["Practice exercises", stats.total, "practice/"],
    ["Glossary terms", glossary?.entries?.length ?? 0, "glossary.html"],
  ];
  host.innerHTML = cards
    .map(
      ([label, value, href]) =>
        `<a class="card" style="text-align:center;text-decoration:none;color:inherit" href="${href}">` +
        `<div style="font-size:1.6rem;font-weight:700">${value}</div><div class="small muted">${escapeHtml(label)}</div></a>`,
    )
    .join("");
}

function renderProgress(problems) {
  const host = document.getElementById("progress");
  const stats = problemStats(problems);
  host.innerHTML =
    `<div class="row-between"><strong>${stats.solved} of ${stats.total} exercises solved</strong><span class="small muted">${stats.percent}%</span></div>` +
    `<div class="progressbar" style="margin-top:.5rem"><span style="width:${stats.percent}%"></span></div>` +
    (stats.attempted ? `<p class="small muted" style="margin:.5rem 0 0">${stats.attempted} in progress</p>` : "");
}

function renderTypeCards(problems) {
  const host = document.getElementById("type-cards");
  const descriptions = {
    fix_the_code: "Broken code that must be repaired — run it, read the error, fix it.",
    fill_in_blank: "Code with gaps; each blank is checked and the finished program is run.",
    predict_output: "Read a program and type the output it will produce.",
    write_from_scratch: "Write the whole solution, with step-by-step hints or a line budget.",
  };
  host.innerHTML = "";
  for (const type of TYPE_ORDER) {
    const list = problems.filter((p) => p.type === type);
    const solved = list.filter((p) => problemStatus(p) === "solved").length;
    const card = el("a", { class: "card", href: `practice/index.html?type=${type}`, style: "text-decoration:none;color:inherit" });
    card.innerHTML =
      `<div class="row-between"><h3 style="margin:0;font-size:1.02rem">${TYPE_LABELS[type]}</h3><span class="badge type-${type}">${list.length}</span></div>` +
      `<p class="small muted" style="margin:.4rem 0 .3rem">${escapeHtml(descriptions[type])}</p>` +
      `<div class="tiny muted">${solved} solved</div>`;
    host.append(card);
  }
}

function renderRecommendation(problems) {
  const host = document.getElementById("recommended");
  const inProgress = problems.filter((p) => problemStatus(p) === "attempted");
  const fresh = problems.filter((p) => problemStatus(p) === "new");
  const pick = inProgress[0] || fresh[0] || problems[0];
  if (!pick) {
    host.textContent = "No exercises yet — run tools/build_index.py after adding problems/ files.";
    return;
  }
  host.innerHTML =
    `<p class="small muted" style="margin:0 0 .3rem">${inProgress.length ? "Continue where you left off" : fresh.length ? "Start here" : "Revisit"}</p>` +
    `<p style="margin:0 0 .5rem"><a href="practice/exercise.html?id=${encodeURIComponent(pick.id)}"><strong>${escapeHtml(pick.title)}</strong></a> ` +
    `<span class="badge type-${pick.type}">${TYPE_LABELS[pick.type]}</span></p>` +
    `<p class="small muted" style="margin:0">${escapeHtml((pick.topics || []).join(" · "))}</p>`;
}

async function main() {
  const problemsHost = document.getElementById("problem-count");
  let problems = [];
  let manifest = null;
  let glossary = null;

  try {
    problems = await loadProblems();
  } catch (error) {
    document.getElementById("warnings").innerHTML = `<div class="notice bad"><p>${escapeHtml(error.message)}</p></div>`;
  }
  try {
    manifest = await loadNotebookManifest();
  } catch (error) {
    document.getElementById("warnings").insertAdjacentHTML("beforeend", `<div class="notice warn"><p>${escapeHtml(error.message)}</p></div>`);
  }
  try {
    glossary = await loadGlossary();
  } catch (error) {
    document.getElementById("warnings").insertAdjacentHTML("beforeend", `<div class="notice warn"><p>${escapeHtml(error.message)}</p></div>`);
  }

  if (problems.length) {
    if (problemsHost) problemsHost.textContent = `${problems.length} exercises`;
    renderStats(problems, manifest, glossary);
    renderProgress(problems);
    renderTypeCards(problems);
    renderRecommendation(problems);
  } else {
    document.getElementById("main-cards").classList.add("hidden");
  }

  const notebookHost = document.getElementById("notebooks");
  if (manifest) {
    renderNotebookList(notebookHost, manifest, {
      base: "",
      problems,
      config: CONFIG,
    });
  } else {
    notebookHost.innerHTML =
      '<div class="notice warn"><p>The notebook index could not be loaded. Run <code>python3 tools/build_index.py</code> and serve this folder over HTTP.</p></div>';
  }
}

main();
