# Python Practice

A lightweight learning system for two Python / data-analysis classes: **ACC 525** (Python for
accounting) and **FIN 400** (Python for finance). One site, one exercise engine, a class picker in
the header.

The Jupyter notebooks in this repository stay **exactly as they are** and become the learning
material. On top of them sits a small practice engine that runs real Python in the browser
(Pyodide / WebAssembly) and checks four kinds of exercises immediately.

| Exercise type | What the learner does | How it is checked |
| --- | --- | --- |
| **Fix the code** | Repairs a broken program | Runs it: no errors, hidden checks pass, printed output matches |
| **Fill in the blank** | Fills `___` gaps in a template | Each blank against its accepted answers **and** the finished program is run |
| **Predict the output** | Types what a program prints | Compared line by line with the expected output (no runtime needed) |
| **Write from scratch** | Writes the whole solution | Runs hidden checks and/or compares printed output |

Feedback is immediate: **correct**, **incorrect** (with a line-by-line diff, the traceback and the
line number), or **hint** (revealed one step at a time).

Nothing is compiled and nothing is installed for the site itself — it is plain HTML, CSS and
JavaScript. Python comes from a CDN (Pyodide) and lives in an in-browser sandbox.

---

## Use the site

Nothing to install and nothing to sign in to. The site is published on GitHub Pages:

**https://jarem01.github.io/Python-Practice/**

Open that link, or send it to a class, and it works: Python runs in the browser through Pyodide, so
whoever uses it needs no server, no Python install and no account. Progress is kept per browser.

---

## Two classes on one site

The picker next to the site name switches classes, and the choice is remembered per browser;
`?course=fin400` works as a shareable link to the other class. Everything else — the exercise
engine, the notebook viewer, progress, the glossary — is the same code for both.

| Class | Material | Solutions |
| --- | --- | --- |
| **ACC 525** — Python for accounting | `acc525/Intro to Python/` and `acc525/Data Analysis/` (notebooks), data in `acc525/data/`; exercises in `problems/*.json` | shown — this class works through them together |
| **FIN 400** — Python for finance | `fin400/bootcamp/` (`.py`, first half), `fin400/notebooks/` (`.ipynb`, second half), `fin400/assignments/` (briefs and worked practice), data in `fin400/data/`, cards in `data/flashcards.json`, exercises in `problems/fin400-*.json` | **hidden** — hints only, and every exercise runs on data that is not the assignment's |

`data/courses.json` is the registry that makes this work: it names the classes, says which folders
belong to each, lists the halves of each course, and sets whether solutions may be shown. The build
files every notebook and exercise from the path it lives at, so adding material is dropping a file
in the right folder.

**Where FIN 400 files go, and how to upload them through github.com without a clone:
[fin400/README.md](fin400/README.md).**

"Hidden" means the reference answer is removed from `problems/index.json` by the build — the
exercise page cannot show what it never received. It does not mean the *checks* are invisible: a
student who reads the page source can read the `tests` of any exercise, which is why the exercises
use their own data rather than the assignment's.

A class can also keep whole folders off the site with `private_paths` in `data/courses.json`.
FIN 400 lists `fin400/solutions` there: the build never indexes those files, and
`tools/assemble_site.py` removes the folder from the published site, so no page links to an answer
key. The files are still in the repository — a public GitHub repository shows them to anyone who
browses there, so keep the repository private (or keep keys off GitHub entirely) if students must
not see them.

---

## Quick start (running the repository locally)

This is only needed to **change** the site. A local web server is required, because browsers refuse
to `fetch()` the manifests and notebooks from `file://` — double-clicking `index.html` will not
work:

```bash
python3 -m http.server 8000     # or: npm run serve
# then open http://localhost:8000/
```

Any static server works — `npx serve`, `php -S localhost:8000`, VS Code Live Server, …

The pages (every one of them is on the deployed URL above as well):

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: stats, progress, the notebook overview, a suggested next exercise |
| `learning/index.html` | All notebooks grouped by part, with the exercises found inside each one |
| `learning/view.html?nb=…` | Renders one `.ipynb` in the browser (markdown, code, outputs, tracebacks, TOC) |
| `practice/index.html` | All exercises, grouped into sections (homework, extra practice, lecture exercises), with one row of dropdown filters |
| `practice/exercise.html?id=…` | The exercise engine (all four types, with the run output and a colored comparison) |
| `practice/create.html` | Form to author a new exercise, save it as a local draft, download JSON |
| `flashcards.html` | Revision deck: one card per method, flipped to show what it does, a call to run and the output it prints |
| `glossary.html` | Every term with definitions, examples and links, in A–Z order or sorted by assignment |
| `upload.html` | **Add material**: drop notebooks/scripts/data, analyze them, save to GitHub or this browser |

---

## Repository layout

```
index.html                 landing page
flashcards.html            revision deck: one card per method
glossary.html              glossary page
learning/index.html        notebook index
learning/view.html         notebook viewer
practice/index.html        exercise list
practice/exercise.html     exercise engine
practice/create.html       exercise creator
upload.html                add course material (and generate exercises from it)
assets/css/style.css       the only stylesheet (light + dark)
assets/js/                 ES modules, no build step (see "Extending the JavaScript")
data/notebooks.json        GENERATED — notebook index for the learning section
data/courses.json          HAND-WRITTEN — the classes, their folders, halves and solution policy
data/glossary.json         HAND-WRITTEN — glossary terms
data/flashcards.json       HAND-WRITTEN — one card per method: what it does, a call, its output
data/curriculum.json       OPTIONAL — manual grouping/ordering overrides
fin400/                    the FIN 400 class: bootcamp/ (.py), notebooks/ (.ipynb),
                           assignments/ (briefs), data/, solutions/ (never published)
acc525/                    the ACC 525 class: Intro to Python/, Data Analysis/, data/, analyticskit.py
materials/                 uploads that do not belong to a class yet (source study material)
problems/*.json|*.md       HAND-WRITTEN — exercise definitions
problems/generated/*.json  Uploaded/generated exercises, one file each
problems/index.json        GENERATED — the bundle the practice app fetches
tools/build_index.py       regenerates both manifests
tools/run_notebooks.py     executes the notebooks and saves their outputs
tools/check_notebooks.py   runs the notebooks against the bundled data
tools/make_datasets.py     builds acc525/data/ (the files the notebooks open)
tools/generate_problems.mjs turns notebooks into exercises with real Python
tools/import_materials.py  applies a bundle downloaded from the website
tools/assemble_site.py     copies the site to _site, leaving private_paths out
.github/workflows/         rebuild the index + publish to GitHub Pages on every push
tests/                     unit, integration and page tests
```

Files marked **GENERATED** are produced by:

```bash
python3 tools/build_index.py            # write the manifests
python3 tools/build_index.py --check    # validate only, exit 1 on errors
```

Run it after adding or editing notebooks and problems.

---

## The notebooks' outputs

Every notebook in the Learning section opens the same way: as a live notebook. Each code cell is an
editor with a Run button, the cells share one Python kernel, `Run all cells` / `Restart kernel` work
the way Jupyter's do, and the exercises inside the notebook are boxed and grouped — the list in the
page header and the contents sidebar jump straight to them. There is no separate read-only view.

Each cell shows the output the notebook was saved with until you run it yourself, so the notebooks
keep their outputs. They are written by:

```bash
python3 tools/run_notebooks.py            # run every notebook, save its outputs
python3 tools/run_notebooks.py --check    # report only, change nothing
python3 tools/run_notebooks.py --nb "Data Analysis (Part 3)*"
```

It runs each notebook top to bottom in one namespace, in a folder holding exactly the data files
the notebook declares (`data/curriculum.json` → `data_files`), and records what Jupyter records:
stream output, the value of a trailing expression, inline matplotlib figures and tracebacks. Then
run `python3 tools/build_index.py` so the pages pick the new cell counts up.

Run mode and this tool agree because both execute the same code in Pyodide —
`tests/notebooks.test.mjs` runs every notebook's cells through the real harness and fails if a
cell stops working. Only the packages Pyodide ships can be used; `data/curriculum.json` lists them
per notebook (`pandas`, `matplotlib`, `statsmodels`, `scipy`, `python-calamine`). There is no
`openpyxl`, which is why `analyticskit.read_excel()` picks the engine that is installed and
`analyticskit.to_excel()` writes the workbook itself.

---

## Adding notebooks

1. Put your `.ipynb` files anywhere in the repository (they can live in the root, in
   `notebooks/`, in `Part 1 — Basics/`, …). Nothing is rewritten or duplicated by the site.
2. Run `python3 tools/build_index.py`.
3. The generator reads each notebook and extracts:
   * its title (first `#` heading) and a one-line summary,
   * cell counts, code-cell count and how many cells have saved output,
   * every heading that looks like an exercise (`Exercise 3`, `Übung 2`, `练习 1`, …) with a
     stable anchor, so **index.html** and **learning/index.html** can list "notebooks and their
     exercises",
   * the topics it covers, matched against the topics used by your exercises.

Grouping into **Part 1 / Part 2 / …** is inferred from folder names and file names
(`part 2`, `week 3`, `chapter 4`, …). Anything else falls back to the folder name, and
everything else lands in "Notebooks". To take full control, edit `data/curriculum.json`:

```json
{
  "group_titles": { "Part 1": "Part 1 — Python Fundamentals" },
  "group_order": { "Part 1": 1, "Part 2": 2 },
  "notebook_overrides": {
    "notebooks/lesson-01.ipynb": { "title": "Lesson 1", "group": "Part 1", "group_order": 1,
                                   "topics": ["Python Basics", "Strings"] }
  }
}
```

Notebooks can live anywhere in the repository: the class notebooks sit in the repository
root, and everything you upload from the website lands in `materials/`. `tools/build_index.py`
finds them all, so there is no list to keep up to date.

A class can also ship its own **guided modules** as ordinary notebooks in its folder — FIN 400 keeps two
in `fin400/bootcamp/` and three in `fin400/notebooks/`, each with saved output and a *Try it* list. Add a
`data/curriculum.json` entry so the module gets a title, a short label and its data files, then run
`python3 tools/run_notebooks.py --nb "*fin400-module*"` to execute it and store the outputs. The
Learning tab then lists it next to the accounting sections, grouped by the class folder it lives in.

### Opening notebooks in JupyterLite

Stock JupyterLite cannot open a notebook from another origin; that needs the
[`jupyterlab-open-url-parameter`](https://jupyterlab-contrib.github.io/jupyterlab-open-url-parameter.html)
extension. If you host a JupyterLite build with that extension, set both values in
`assets/js/config.js` and an **Open in JupyterLite** button appears next to every notebook:

```js
jupyterLiteUrl: "https://your-user.github.io/your-jupyterlite/lab/index.html",
rawBaseUrl: "https://raw.githubusercontent.com/you/Python-Practice/main",
```

Without that, the built-in runnable view (`learning/view.html`) remains the way to open notebooks.

---

## Adding material from the website

`upload.html` is the no-terminal path. Drop in **any and all** files — notebooks (`.ipynb`),
scripts (`.py`, including class helper modules), data (`.csv`, `.xlsx`), markdown, anything else you
want stored — then:

1. **Add files** by dragging them in, choosing them, or pasting a raw URL (raw.githubusercontent
   URLs work). Each file is analyzed in the browser: title, cell counts, the exercises inside a
   notebook, and which library and data files it needs.
2. **Analyze files** to see what was detected and to build practice exercises. Every notebook task
   is run in real Python (Pyodide) with the notebook's earlier cells as setup; the printed output
   becomes the exercise's expected output, so the generated exercise is checked automatically.
3. **Save** the result:

   * **Save to this browser** — the files and exercises live in `localStorage` and appear in the
     learning and practice sections immediately (private to that browser, marked “in this browser”).
     An uploaded notebook can be opened and run there straight away: the page reads the data files
     and Python packages its code needs out of the code itself. Handy for a quick look.
   * **Save to GitHub** — commits each source file into `materials/<track>/` and each automatically
     checked exercise into `problems/generated/<id>.json`, straight into the repository, with a
     fine-grained token that has **Contents: Read and write**. The push triggers the workflow, which
     rebuilds the index and republishes the site, so everyone gets the new material.
   * **Download bundle** — writes `materials-bundle.json`; apply it in your clone with
     `python3 tools/import_materials.py materials-bundle.json` (add `--all` to keep exercises that
     nothing can check yet, `--dry-run` to preview).

Uploads are analyzed locally; the only request that leaves the browser is the GitHub API call you
ask for. `materials/` is the single folder that tracks the source study material, so the base of
class notebooks sits alongside everything added later.

### Exercises need their data files

A notebook task that reads `insurance.csv`, `avocados.txt` or a class module such as
`analyticskit.py`can only become an exercise if that file is in the repository. Upload it (or copy it into the
class folder the notebook lives in) and generate again:

```bash
node tools/generate_problems.mjs --predict-variants   # writes problems/auto-*.json
python3 tools/build_index.py
```

Tasks whose data is missing are reported and skipped rather than turned into an exercise that cannot
run. Class material belongs in the class folder — `acc525/analyticskit.py`, `acc525/data/` — not at the
repository root; that is what keeps the two classes apart and the root tidy.

---

## Adding exercises

Three ways, all landing in the same place:

### 1. The creator form (no file editing)

Open **Add exercise** (`practice/create.html`), fill in the form, and use:

* **Save draft** — stored in `localStorage`, instantly visible in the exercise list marked
  `draft`, so you can try it before committing it;
* **Download .json** — drop the file into `problems/` and run `python3 tools/build_index.py`.

### 2. A JSON file in `problems/` or `fin400/practice/`

Any `problems/*.json` file is read by the generator. It may contain one problem, an array of
problems, or `{ "problems": [...] }`.

A class may keep its own sets beside its data instead: `fin400/practice/*.json` is read too, which is
where the FIN 400 practice sets live. Those are built with no `solution` field and no reference
answer anywhere in the repository — the repository is public, so an "answer file for the tests" would
be a published answer key. `tests/pyodide.test.mjs` reports such a problem as skipped with that reason
unless you point it at a local answers file:

```bash
EXTRA_REFERENCE_ANSWERS=~/fin400-answers.json npm test   # { "problem-id": "python code" }
```

### 3. A Markdown file in `problems/`

Handy when the exercise is mostly prose:

````markdown
---
id: fix-loop-sum
type: fix_the_code
title: The loop that stops one short
topics: [Python Basics, Loops]
difficulty: easy
---

This program should print 15 but prints 10. Fix it.

## hints
- Read the loop header carefully.
- Which numbers does range(1, 5) give you?

## starter_code
```python
total = 0
for i in range(1, 5):
    total = total + i
print(total)
```

## expected_output
15

## solution
```python
total = 0
for i in range(1, 6):
    total = total + i
print(total)
```
````

### Field reference

| Field | Used by | Meaning |
| --- | --- | --- |
| `id` | all | Unique, lowercase, dashes. Appears in the URL (`?id=…`) |
| `type` | all | `fix_the_code`, `fill_in_blank`, `predict_output`, `write_from_scratch` |
| `title`, `prompt` | all | `prompt` is Markdown; glossary terms are linked automatically |
| `topics` | all | Free-form strings; they drive filtering and notebook↔exercise links |
| `difficulty` | all | `easy`, `medium`, `hard` |
| `starter_code` | fix / fill / predict | The code to fix, the `___` template, or the code to read |
| `expected_output` | fix / fill / predict / write | Compared with what the program prints |
| `tests` | fix / fill / write | Python appended **after** the learner's code; it must `assert` |
| `test_summary` | write | One line telling the learner what the hidden checks verify |
| `setup` | all | Python that runs **before** the learner's code (sample data, imports) |
| `stdin` | all | Lines served to `input()`, one per line |
| `blanks` | fill | `[{ "accepted": ["for"], "hint": "…" }]`, in order of the `___` |
| `hints` | all | Revealed one at a time; Markdown allowed |
| `solution` | all | Shown on request (never marks the exercise solved by itself) |
| `mode`, `line_count` | write | `both` (default), `guided` or `lines`; suggested line budget |
| `order` | all | Position inside its group: a numbered track (FIN 400's *HW 1 … 19*, *Practice 1 … 19*) sorts 1, 2, 3 instead of alphabetically |
| `assignment` | all | An object `{key, label, group, order}` naming the set the exercise belongs to, for a class that files exercises by set instead of by notebook (FIN 400: `Homework 1–19`, `Extra practice`, `Lecture notebooks`) |
| `glossary` | all | Glossary slugs to link, e.g. `["for-loop", "dictionary"]` |
| `packages` | all | Extra Pyodide packages loaded on demand, e.g. `["numpy", "pandas"]` |
| `notebook` | all | Optional notebook path, shown as "from the notebook" |
| `ignore_whitespace`, `ignore_case` | all | Loosen the output comparison |

The generator validates all of this. Errors stop the build; warnings do not:

```bash
$ python3 tools/build_index.py
  warning: python-basics.json: problem 'x' links to unknown glossary term 'nope'
  ERROR: data-structures.json: duplicate id 'fix-first-even-return' (already defined in …)
```

---

## How grading works

* The learner's code runs in a **fresh namespace** with stdout/stderr captured inside Python, so
  what you compare is exactly what `print()` wrote.
* If `expected_output` is set, the comparison ignores trailing spaces, tabs, trailing blank
  lines and Windows line endings — but **not** leading indentation (numpy and pandas indent
  wrapped output). Use `ignore_whitespace: true` for a fully whitespace-insensitive compare.
* If `tests` is set, it runs in the same namespace, so it can inspect the learner's variables and
  functions. A failing `assert` is reported as "Passes the checks ✗" with the assertion message;
  a crash in the learner's code is reported separately, with the line number and the source line.
* `setup` failures are reported as *the exercise's* problem, not the learner's.
* `input()` is served from `stdin`; the prompt is echoed into the output, the typed value is not.
* A runaway-loop guard stops a program after `lineLimit` lines **of the learner's own code**
  (2,000,000 by default, roughly a second). Importing numpy does not count toward it, and if a
  run is ever interrupted mid-import the partially imported modules are cleaned up.
* Grading needs no runtime for **predict the output** — that type works even if Python cannot be
  downloaded.

---

## Glossary

`data/glossary.json` holds the terms:

```json
{
  "term": "for loop",
  "aliases": ["for-loop", "for"],
  "definition": "Repeats a block once for every item of a sequence.",
  "example": "for letter in \"abc\":\n    print(letter)",
  "tags": ["Control Flow"],
  "see_also": ["range", "while-loop"]
}
```

* The slug is derived from the term (`for loop` → `for-loop`), and aliases add extra anchors.
* Exercises that list a slug in `glossary`, or whose `topics` match an entry's `tags`, get their
  first mention of that term linked automatically. Explicit `[[for-loop|the for loop]]` markup
  always works too.
* The glossary page lists every term with the assignment and the exercises that use it, and can
  order them A–Z or by assignment.

---

## Flashcards

`data/flashcards.json` is the revision deck — one card per method, written by hand:

```json
{
  "id": "pandas-groupby-mean",
  "method": "df.groupby()",
  "library": "pandas",
  "topics": ["Grouping"],
  "assignment": "Part 2 — Notebooks, DataFrames & regression",
  "courses": ["fin400"],
  "does": "Splits the rows into one group per value of a column, then aggregates each group.",
  "setup": "import pandas as pd\n\nfunds = pd.DataFrame({...})",
  "call": "print(funds.groupby(\"sector\")[\"return\"].mean())",
  "output": "sector\nBond      0.03\nEquity    0.09\nName: return, dtype: float64"
}
```

* `does` is the explanation in plain words, `call` is the snippet to practice, and `output` is exactly
  what that snippet prints. `tests/test_flashcards.py` runs every card's `setup` + `call` in Python
  and fails if the printed output differs from the card.
* `setup` (optional) builds the small example the call uses; the card shows it in a collapsed block.
  `assignment` is the label the deck groups by, and groups keep the order the cards appear in the
  file, so write the file in course order. `library` is the filter for pandas / NumPy / Python /
  statsmodels, and `topics` are the ideas a card belongs to (a card with two topics appears under
  both).
* `courses` limits a card to one class; leave it out to share a card with every class.
* The page groups by assignment, topic, library or A–Z, filters by library / topic / assignment and
  searches the method, the words, the code and the output. **Study deck** shows one card at a time
  and pages with the arrow keys.
* **Progress is tracked per card.** The back of a card has **Known** and **Need to review** buttons;
  clicking the active button again clears the mark. The bar above the deck counts what is left, and
  the **Progress** filter narrows the deck to known, review or unseen cards — so a study session can
  be "only the ones I have not learned yet". The choice is in the URL, e.g.
  `flashcards.html?course=fin400&status=unseen`, so it can be bookmarked.
* Marks live in this browser only, under the localStorage key `pypractice:flashcards` (the same
  per-browser approach as exercise progress). They are not tied to an account, not written to the
  repository, and do not follow a student to another machine; **Reset my marks** clears them.
* Cards are read straight from the file — no rebuild is needed. `build_index.py --check` validates
  the shape, and the FIN 400 cards only use calls the class teaches.

---

## Look and feel

The site follows the class study guides: a white page with deep-blue headings, amber **problem**
blocks, green **answer** blocks and Consolas code, at an 11pt base size. Everything comes from the
tokens at the top of `assets/css/style.css` (`--accent`, `--warn-soft`, `--ok-soft`, `--sans`, …),
so changing the palette in one place changes every page.

Light is the default and dark mode is one click away (the ☀/☾ button in the header, remembered per
browser). Both themes share the same hues.

---

## Configuration

`assets/js/config.js`:

```js
pyodideVersion: "314.0.7",          // Pyodide release used to run Python
pyodideIndexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
lineLimit: 2000000,                 // runaway-loop guard
jupyterLiteUrl: "",                 // optional JupyterLite base URL
rawBaseUrl: "",                     // optional public raw URL of this repository
storagePrefix: "pypractice:",       // localStorage namespace
```

`packages` per exercise are downloaded from the same Pyodide CDN on first use, so the first
numpy/pandas exercise takes a few seconds longer. Nothing is cached between browser sessions
except progress and drafts, which stay in `localStorage` on the learner's machine.

---

## Publishing on GitHub Pages

Already live at **https://jarem01.github.io/Python-Practice/**. Pushing to `main` is the only step
needed to update it — no build, no upload, no extra command.

The included workflow does everything on every push to `main`:

1. `python3 tools/build_index.py` rebuilds `data/notebooks.json` and `problems/index.json` from the
   repository contents (notebooks, `materials/`, every problem file).
2. `build_index.py --check` and the Python tests must pass.
3. The rebuilt manifests are committed back when they changed — that is what happens after material
   is uploaded from the website.
4. The whole site is published.

Done once for this repository; a fork needs the same two steps:

1. Settings → Pages → Source: **GitHub Actions**.
2. Push (or run the workflow by hand from the Actions tab).

Pushing a change to a file under `.github/workflows/` needs a token with the `workflow` scope on
top of `repo` (`Workflows: Read and write` for a fine-grained token), or GitHub rejects the push: a
plain `repo` token cannot add or update a workflow file.

The manifests are still committed to the repository, so the *Deploy from a branch* option also
works: commit them and point Pages at `main` / `(root)`. `.nojekyll` is included, so Jekyll leaves
the folder alone, and the site works under a path prefix such as
`https://user.github.io/Python-Practice/` because every fetch and generated link is resolved
against the module's own location.

Student progress is per-browser; there is no backend and no account.

---

## Extending the JavaScript

Everything is an ES module; no bundler, no dependencies at runtime.

| Module | Responsibility |
| --- | --- |
| `config.js` | Configuration and site-root-relative URLs |
| `util.js` | Markdown renderer, glossary auto-linking, output normalization, diff, storage |
| `grade.js` | **Pure** grading rules (no DOM, no Pyodide) — the place to add new check types |
| `harness.js` | The Python side: stream capture, `input()`, tracebacks, loop guard |
| `runner.js` | Loads Pyodide and calls the harness |
| `editor.js` | The code editor (line numbers, Tab/Shift+Tab, Ctrl+Enter to check) |
| `problems.js` | Loads `problems/index.json`, merges drafts, filtering and stats |
| `assignments.js` | "Which assignment is this from?" — notebook → track/part labels used for sorting |
| `glossary.js` | Glossary loading, slug/alias resolution, term rendering |
| `notebooks.js` | `.ipynb` renderer, notebook lists, table of contents, JupyterLite links |
| `exercise.js` | The exercise engine UI |
| `analyze.js` | Notebook/script analysis and turning a task into a draft exercise (shared with the tools) |
| `uploads.js`, `datasets.js` | Browser-stored uploads and the data files an exercise needs |
| `github.js` | Committing uploaded material with the GitHub REST API |
| `home.js`, `practice-list.js`, `learning-index.js`, `learning-view.js`, `glossary-page.js`, `create.js`, `upload.js` | Page controllers |

To add a fifth exercise type: add it to `TYPE_LABELS`/`TYPE_ORDER` in `util.js`, add a grading
rule in `grade.js`, a renderer + check path in `exercise.js`, and allow the type in
`PROBLEM_TYPES` in `tools/build_index.py`.

---

## The datasets

The class notebooks open their data by bare file name (`violations.csv`, `invoices.xlsx`,
`insurance.csv`, `compustat.csv`, `avocados.txt`, …). Those files live in `acc525/data/` and —
because the browser runs the notebooks too — are copied into the Python sandbox for the notebook
or exercise that declares them.

They are generated, deterministically, by:

```bash
tools/make_datasets.py --verify   # check the committed files
python3 tools/make_datasets.py    # rebuild them (same seed, same bytes)
```

The size is the point: `violations.csv` has 68,841 rows, `invoices.xlsx` 5,000 invoices,
`compustat.csv` 10,647 firms over 30 industries, plus `insurance.csv` (the public 1,338-row
medical-cost dataset), `earnings.csv`, `store_sales.csv` and the small lookup tables the merge
exercises join on.

FIN 400's practice data is built the same way, from a different seed, by
`tools/make_fin400_data.py`: a 900-adult survey, a 2,343-row firm-year panel (plus a copy with
duplicates), a ten-year stock-month panel, four portfolio files and a 600-firm size file. None of it
comes from an assignment — the homework's own files are either linked or not supplied at all — so the
exercises ask the same questions with different companies and different numbers. The generator also writes `acc525/analyticskit.py`, the helper module Data
Analysis 5 imports — keep the two in step by editing the constant in `tools/make_datasets.py` or,
better, re-syncing it from the file the way the tool does now.

---

## Tests

```bash
npm install --no-save pyodide jsdom   # dev-only, for the integration tests
pip install -r requirements.txt       # pandas, numpy, matplotlib, statsmodels, python-calamine
npm test                              # or: python3 -m unittest discover -s tests && node --test tests/
```

`requirements.txt` is deliberately the same set the browser kernel ships, so a notebook that runs
here runs in the browser as well. `tools/run_notebooks.py` runs the notebooks through plain CPython
and needs `statsmodels` for Data Analysis 6; `tests/notebooks.test.mjs` does the same thing through
Pyodide, which is the check that matters.

* `tests/test_build.py` — slug parity with the JS, Markdown problem parsing, validation errors,
  notebook scanning, private class folders, and `build_index.py --check`.
* `tests/test_flashcards.py` — the deck's shape, and **every card's output**: it runs each card's
  `setup` and `call` and compares the printed text with the stored `output`.
* `tests/test_assemble_site.py` — the published folder contains the site but not a class's
  `private_paths` (FIN 400's `solutions/`), and the source repository keeps them.
* `tests/logic.test.mjs` — markdown rendering (including HTML escaping), glossary linking,
  normalization, diffing and the graders.
* `tests/pyodide.test.mjs` — runs the harness in real Python via Pyodide: stream capture,
  tracebacks, `input()`, `setup`, the loop guard, and **every problem in the repository** (its
  reference solution must pass its own checks, and every predict-the-output answer must match
  what the program really prints). A hidden class keeps no answer in the repository, so its problems
  are skipped with that reason unless `EXTRA_REFERENCE_ANSWERS` points at a local, uncommitted
  answers file.
* `tests/pages.test.mjs` — loads each real HTML file in jsdom, runs its real module and asserts
  the rendered DOM: filtering and grouping the exercise list, grading a typed answer (including the
  green/red output comparison), the glossary's search / section filter / order switch, sorting the
  glossary by section, saving a draft, that every notebook ships saved outputs, that every tile
  on the site sits in a grid (so one tile can never be taller than the one beside it), that every
  list — the type cards, both notebook lists, the exercise list and the glossary — really swaps its
  markup when you choose Tiles or Table, and that the flashcards page groups, filters, flips a card
  and pages through the study deck.
* `tests/upload-page.test.mjs` — drives the upload page end to end in jsdom: fetch a notebook,
  analyze it, store it in the browser, re-save without duplicating.
* `tests/test_import.py` — the bundle importer: path safety (absolute paths and `..` are refused),
  binary files, idempotent re-imports, and skipping exercises that nothing can check.
* `tests/notebooks.test.mjs` — runs **every notebook's cells** in Pyodide with the data files the
  page provides, in one kernel per notebook: this is the check that "Run all cells" works.
* `tests/writing.test.mjs` — the whole site's copy is American English.

---

## Limitations and troubleshooting

* **Plots are not graded.** Matplotlib output can be produced in Pyodide but the engine compares
  text; use `tests` (for example asserting a figure's axis labels) if you want to check one.
* **No file system, no network from inside the sandbox.** Exercises must be self-contained; use
  `setup` to supply data.
* **Long computations are cut off** by the loop guard — raise `lineLimit` in `config.js` if a
  legitimate exercise needs more, or move the work into numpy.
* **"Could not read problems/index.json"** — you opened the page from disk instead of the
  published URL. Serve it over HTTP and, if you just added files, re-run
  `python3 tools/build_index.py`. This cannot happen on the deployed site.
* **Python never starts** — the CDN is blocked or offline; notice the status line under the
  exercise. Predict-the-output exercises still work.
* **A notebook renders raw markdown** — the viewer implements a useful subset (headings, lists,
  tables, code, links, images, blockquotes); LaTeX and raw HTML in cells are shown as text.
* **Progress disappeared** — it lives in `localStorage`; private windows and "clear site data"
  reset it (as does the *Clear filters* → nothing; drafts are deleted explicitly).

---

## Credit

Pyodide is © the Pyodide contributors. The notebooks are the course material that was already in
this repository and are displayed unmodified.
