# FIN 400 — where the class material goes

FIN 400 is the second class on this site. It has its own tab: the picker in the header of every
page switches between **ACC 525** and **FIN 400**, and the site remembers the choice. Nothing in
ACC 525 changed to make room for it.

The class has two halves, plus an assignments section:

| Section | Folder | What the student works in |
| --- | --- | --- |
| **First half — Python bootcamp** | `fin400/bootcamp/` | ordinary `.py` files: write, fix and test functions |
| **Second half — DataFrames and regression** | `fin400/notebooks/` | `.ipynb` class notebooks, pandas, and a regression at the end |
| **Assignments** | `fin400/assignments/` | assignment briefs and worked practice, listed after the two halves |

The exercises are now part of the site. **Exercises 1 to 19** live in `fin400/exercises/`, one per assignment, in the wording of the class handout and on stand-in data, and the practice page shows them as their own section ahead of the extra practice. The solutions are the one thing that never ships.

**Three rules for this class:**

1. **No solutions.** The exercise page never shows a reference answer here. Hints are offered one at
   a time, and the reference solution is stripped out of the published bundle by
   `tools/build_index.py` — it is not hidden with CSS, it never reaches the browser.
2. **Exercises run on their own data.** Every exercise gets its own small dataset in
   `fin400/data/`, so a student cannot copy an answer from the assignment's numbers.
3. **Answer keys live in `fin400/solutions/`.** That folder is listed under `private_paths` in
   `data/courses.json`: the build never indexes it, and `tools/assemble_site.py` removes it from the
   published site. It is still in the repository, so a **public** GitHub repository shows it to
   anyone who browses there — keep the repository private (or keep keys off GitHub) if students
   must not see them.

---

## 1. The folders, and exactly what goes in each

```
fin400/
├── bootcamp/     .py files from the first half — one file per class session
├── notebooks/    .ipynb files from the second half — one notebook per class session
├── assignments/  assignment briefs and worked practice
├── exercises/    Exercises 1 … 19, one per assignment — solutions removed by the build
├── practice/     the extra practice: Practice 1–19, the drills and the lecture exercises
├── lectures/     one notebook per class meeting
├── data/         the datasets the notebooks and exercises read (csv, xlsx, …)
├── solutions/    answer keys — never published by the site
└── README.md     this file
```

Anything you drop in `bootcamp/`, `notebooks/` or `assignments/` is picked up automatically:

- the **class** comes from the path (`fin400/…` → FIN 400),
- the **section** comes from the folder (`bootcamp` → first half, `notebooks` → second half,
  `assignments` → Assignments),
- the **group title** shown on the site comes from `data/courses.json`.

`data/flashcards.json` is the other file you will edit here: one card per method, with what it does,
how it is called and what it prints (see section 5).

You never edit an index by hand. `tools/build_index.py` rebuilds `data/notebooks.json` and
`problems/index.json` from whatever is in the folders, and the GitHub Action runs it on every push.

If you want another folder later (say `fin400/capstone/`), add it to `data/courses.json` under the
`fin400` course — one entry in `groups` and its name in the `groups` list of a phase — and it
appears as its own section.

---

## 2. Uploading from github.com (no clone, no terminal)

You do not need Git installed for this. Everything below happens in the browser.

### Upload whole files or a whole folder

1. Open the folder you are uploading into, for example
   <https://github.com/Jarem01/Python-Practice/tree/main/fin400/bootcamp>
2. Click **Add file → Upload files**.
3. Drag the `.py` files onto the page. Dragging a *folder* also works: the relative paths inside it
   are kept, so `week03/loops.py` stays in a subfolder.
4. Type a short commit message, for example `FIN 400 bootcamp week 3`, and click **Commit changes**.

The GitHub web uploader takes up to **100 files and 25 MB per file** in one commit. For a batch
bigger than that, commit it in two passes — no other step changes.

### Create a single file (this is also how you make a folder)

1. Open <https://github.com/Jarem01/Python-Practice/tree/main/fin400>
2. **Add file → Create new file**.
3. In the name box type the full path, for example `bootcamp/week05_functions.py`. Typing a `/`
   creates the folder for you.
4. Paste the code, then **Commit changes**.

### The same thing from a clone, if you have one

```bash
git add fin400 && git commit -m "FIN 400: bootcamp week 5" && git push
```

A push to `main` triggers **Build index and publish**: it rebuilds the two manifests, runs the
tests, commits the rebuilt manifests back, and republishes the site. You do not press anything
else. The site is at **https://jarem01.github.io/Python-Practice/**.

---

## 3. What happens to each kind of file

| You drop in | The site does this |
| --- | --- |
| `.py` in `bootcamp/` | Lists it under **Part 1 — Python bootcamp**, with any `# Exercise 1` comments found in it |
| `.ipynb` in `notebooks/` | Lists it under **Part 2 — Notebooks, DataFrames & regression**, and opens it as a runnable notebook |
| `.csv`, `.xlsx`, … in `data/` | Stays a file the notebooks and exercises read (link it with `data_files`, see below) |
| Anything in `assignments/` | Listed under **Assignments** in the learning section |
| Anything in `solutions/` | **Never published.** Not indexed, not copied to `_site`, not linked |

One thing worth knowing about `solutions/`: the site keeps it out, but a public GitHub repository
still shows the files to anyone who opens the repository. If an answer key must stay private, keep
the repository private (GitHub Pages from a private repository needs a paid plan) or keep the key
**out of this repository** and put only the assignment here. The exercise page itself never needs a
key either: FIN 400 hides solutions and the grading uses `tests` on the exercise's own data.

### Notebooks need one registry line each

A notebook is shown with a nicer title, a label and the data files it opens, all set in
`data/curriculum.json`. This is the entry for a FIN 400 notebook:

```json
"fin400/notebooks/week09_pandas_intro.ipynb": {
  "title": "Week 9 — Loading and cleaning fund data",
  "label": "Week 9",
  "group": "notebooks",
  "group_order": 20,
  "order": 3,
  "topics": ["FIN 400", "pandas", "Cleaning Data"],
  "data_files": {
    "fund_returns.csv": "fin400/data/fund_returns.csv"
  },
  "packages": ["pandas"]
}
```

- `data_files` maps **the name the notebook opens** (`pd.read_csv("fund_returns.csv")`) to the file
  in the repository. The site copies it into the browser sandbox under that name.
- `packages` lists what the in-browser Python must load first. Pyodide ships `pandas`, `numpy`,
  `matplotlib`, `scipy` and `statsmodels`; anything else will not run in the browser.
- If a notebook imports a helper module of yours (like `analyticskit.py` in ACC 525), put the
  module in `fin400/bootcamp/` (or next to the notebook) and add it to `data_files` as well.
  A module that should **not** be listed as a lesson goes under the class's `"helpers"` in
  `data/courses.json`:

  ```json
  "helpers": ["financekit.py"]
  ```

  The build then treats it as a support file and leaves it out of the learning list.

Without a `curriculum.json` entry the notebook still appears — it is just titled with its file name
and has no data files attached.

---

## 4. Writing the exercises

Exercises live in `problems/` or in `fin400/practice/`, one JSON file per topic or week; the build
reads both. The class's own practice sets are in `fin400/practice/` (see section 7), and the two seed
files (`problems/fin400-bootcamp.json`, `problems/fin400-analysis.json`) are complete working examples —
copy one and change the content.

```json
{
  "problems": [
    {
      "id": "fin400-week03-loan-payment",
      "course": "fin400",
      "phase": "bootcamp",
      "type": "write_from_scratch",
      "title": "Monthly payment on a fixed-rate loan",
      "difficulty": "medium",
      "topics": ["FIN 400", "Functions", "Loans"],
      "line_count": 6,
      "prompt": "Write `monthly_payment(principal, annual_rate, months)` …",
      "hints": [
        "The monthly rate is the annual rate divided by 12.",
        "Compute the growth factor once, then use it twice: in the numerator and the denominator.",
        "Return the number rounded to 2 decimals."
      ],
      "tests": "assert monthly_payment(250000, 0.06, 360) == 1498.88",
      "test_summary": "the payment matches the standard amortization formula, rounded to 2 decimals"
    }
  ]
}
```

The fields that matter here:

| Field | What it does |
| --- | --- |
| `id` | lowercase letters, digits and dashes; must be unique across the whole site |
| `course` | `"fin400"` — without it the exercise would be filed under the default class |
| `phase` | `"bootcamp"` (first half) or `"analysis"` (second half) |
| `type` | `write_from_scratch` or `fix_the_code` for this class (see the warning below) |
| `hints` | 2–4 progressive hints; this is the only help a student gets |
| `tests` | Python that runs after the student's code; `assert` what must be true |
| `test_summary` | one line telling the student what the checks verify |
| `data_files` | for a pandas exercise: `{"fund_returns.csv": "fin400/data/fund_returns.csv"}` |
| `packages` | `["pandas"]`, or `["pandas", "statsmodels"]` for a regression |

**Do not add a `solution` field.** It is removed for this class anyway, and writing one invites the
habit of relying on it. If you keep a worked answer for yourself, put the file in `fin400/solutions/`,
which the site never publishes.

**Avoid `fill_in_blank` and `predict_output` for FIN 400.** Those two types are graded in the
browser without running the answer, so the accepted blanks / expected output have to be sent to the
page — a student who opens the page source can read the answer. `write_from_scratch` and
`fix_the_code` keep the answer in `tests`, which is also readable by a determined student, but the
data they are graded on belongs to the exercise, not to the assignment.

**Give every exercise its own data.** Make a small dataset in `fin400/data/` with the same columns
as the assignment's data but different numbers (different funds, different months, different
firm). Then copying the assignment's answer produces the wrong numbers — which is the point.

---

## 5. Flashcards — one card per method

`data/flashcards.json` is the revision deck. Every card has exactly the three things a student needs:

| Field | What it is |
| --- | --- |
| `method` | the method on the front of the card, e.g. `df.groupby()` |
| `does` | what it does, in plain words — no code |
| `call` | a snippet the student can paste and run |
| `output` | exactly what that snippet prints |
| `setup` | optional lines that build the little example the call uses |
| `assignment` | the label the deck is grouped under (use your assignment names) |
| `library` | `python`, `pandas`, `numpy`, `statsmodels`, … — the library filter |
| `topics` | the ideas the card belongs to, e.g. `["Grouping"]` |
| `courses` | `["fin400"]` to keep it in this class; leave it out to share a card |

```json
{
  "id": "pandas-groupby-mean",
  "method": "df.groupby()",
  "library": "pandas",
  "topics": ["Grouping"],
  "assignment": "Assignment 3 — fund performance",
  "courses": ["fin400"],
  "does": "Splits the rows into one group per value of a column, then aggregates each group.",
  "setup": "import pandas as pd\n\nfunds = pd.DataFrame({...})",
  "call": "print(funds.groupby(\"sector\")[\"return\"].mean())",
  "output": "sector\nBond      0.03\nEquity    0.09\nName: return, dtype: float64"
}
```

- **Only use what the class teaches.** Write the call the way it was taught — no chained one-liners,
  no methods from outside the course, no clever shortcuts. A student should be able to paste it into
  the notebook and get that output. The twenty seed cards use only the basics (functions, loops,
  dictionaries, pandas loading / cleaning / grouping / merging, NumPy, OLS); delete or rewrite any
  card that goes past your syllabus.
- **Cards are grouped in the order they appear in the file**, using `assignment` as the heading. Put
  the cards in course order and the deck reads like the class.
- `data/flashcards.json` is read directly by the page: adding a card needs no rebuild, only a reload.
  Run `python3 tools/build_index.py --check` to catch a missing field, and `npm test` runs
  `tests/test_flashcards.py`, which executes **every card's `setup` + `call`** and fails if the
  printed output differs from `output`.
- The page groups by assignment, topic, library or A–Z, filters by library / topic / assignment,
  searches all of it, and has a study deck that pages with the arrow keys.
- **Students can track what they have learned.** The back of each card has **Known** and **Need to
  review** buttons; the summary bar counts what is left, and the **Progress** filter shows only
  known, review or unseen cards (`?status=unseen` is bookmarkable). Marks are saved in the student's
  browser (`pypractice:flashcards`), not in the repository, and **Reset my marks** clears them.

---

## 6. Before you push

```bash
python3 tools/build_index.py --check     # validates problems, courses and phases
python3 tools/build_index.py             # rewrites the two manifests
npm test                                 # python + page tests
```

`--check` fails, with the file name, when an exercise names a phase that does not exist, belongs to
the wrong class for its notebook, has a duplicate id, or has nothing to check against.

Then push. The action rebuilds and publishes; the FIN 400 tab shows the new material with the
exercise list grouped by half.

---

## 7. What is in here right now

Four things, and that is the whole class:

* **Five guided modules** — `fin400/bootcamp/fin400-module-1…2` and `fin400/notebooks/fin400-module-3…5`.
  They are the teaching material: explanations, runnable cells with saved output, and a **Try it** list at
  the end of each one. They open in the Learning tab under **Part 1 — Python foundations** and
  **Part 2 — Notebooks, DataFrames & regression**.
* **Ten lecture notebooks** — `fin400/lectures/`, one file per class meeting (Lectures 01–08, 11 and
  12; the compilation has no 09 or 10). Each is its own `.ipynb` with the lecture's agenda, its
  demonstration cell and its exercises, and each opens from the Learning tab under **Part 3 — Lecture
  notebooks**. They carry **20 exercises** — `Lecture 01 · Exercise 1`, `Lecture 01 · Exercise 2`, … —
  which sit after Practice 19 in the practice list.
* **Exercises 1 to 19** — `fin400/exercises/exercises-1-9.json` and `exercises-10-19.json`, one per
  assignment, in the handout's wording (Exercise 1 mean by hand, Exercise 6 winsorize, Exercise 12 lags
  and weighting, Exercise 18 t-tests, …). Every one runs on the stand-in data in `fin400/data/`, never on the assignment's own
  numbers, and every one carries hints plus a worked *similar* example with different names instead of an
  answer.
* **50 extra practice exercises**, numbered **Practice 1 … Practice 19**, plus the drills and the eight
  older seed exercises. Each numbered track repeats one of these skills with different companies, numbers
  and wording, and most tracks have **two or three exercises in different formats** — the full task, then a
  shorter fix / fill-in / predict-the-output version.

Every exercise names the module it belongs to (its `notebook` field), and the *Practice coverage by
section* table on the home page counts them. Each of the five modules now carries a comparable set —
**9 · 9 · 9 · 11 · 12** for Modules 1 to 5 — instead of the old split where Module 1 had a single exercise
and Module 4 had nineteen. A track moves as a unit: the whole of Practice 2 (a list walked by hand) sits in
Module 1, the whole of Practice 13 (portfolio growth) sits in Module 5.
* **Twenty seed flashcards** covering the methods the class actually uses.

The practice page opens **grouped into sections**, in course order: **Exercises 1–19**, then **Extra
practice**, then **Lecture notebooks**. Inside a section the list runs in course order, so Exercise 10
never comes before Exercise 2, and the numbers never sort as text. One compact row of dropdowns does the filtering —
Section, Topic, Type, Level, Progress, Group by and Sort — and `Clear filters` puts it all back.

Both tracks are ordinary problem files: the exercises in `fin400/exercises/` (one per assignment)
and the extra practice in `fin400/practice/` — `practice-1-9.json`, `practice-10-19.json` and
`practice-lectures.json`, in the order the class works through them. `tools/build_index.py` reads those
folders as well as `problems/`, so a set kept next to the class's data still appears in the FIN 400 tab.
Each exercise names its set with an `assignment` object (`key`, `label`, `group`, `order`), which is what
the section headings and the Section dropdown are built from. Each file
is a plain `{ "problems": [...] }` wrapper, and each exercise carries `"order"` so the list reads 1, 2, 3
rather than alphabetically.

### The track map

| Track | Skill | Exercises |
| --- | --- | --- |
| Practice 1 | mean of a list, built by hand | write · fix a loop that skips a reading · fill the accumulator |
| Practice 2 | largest value in a list | write · predict the printed maximum and its index |
| Practice 3 | squared deviations from the mean | write · fix arithmetic that squares the value · predict population vs sample variance |
| Practice 4 | normal CDF for every value | write · predict two CDF values · fill `NormalDist`/`cdf` · fix a distribution built with its arguments swapped |
| Practice 5 | index of the largest value | write · fix a function that returns the value · predict a tie |
| Practice 6 | clip to a floor and a ceiling | write · fill the `if`/`elif`/`else` |
| Practice 7 | BMI: new column, `describe`, percentiles | write · fix a unit conversion · fill `.between()` and `.mean()` |
| Practice 8 | empirical probabilities of a die | write · predict the six-slot count · fix the off-by-one slot and divisor |
| Practice 9 | logical indexing on a survey | write · fix `and` → `&` · count values outside bounds |
| Practice 10 | EPS, leverage, `value_counts` | write · predict the median and the zero rows · fix a ratio built without parentheses |
| Practice 11 | equal-weight portfolio | write · fix a report that counts instead of averaging |
| Practice 12 | stock counts, lagged market cap, weighted portfolio | write · fill the 30/50/20 blend |
| Practice 13 | value-weight portfolio, `cumprod`, wide frame | write · fix a growth factor left as a factor · fill `cumprod` |
| Practice 14 | portfolios split on the lagged return | write · fix a split that uses the same month |
| Practice 15 | merging two tables | write · left vs inner · predict the row counts |
| Practice 16 | duplicate firm-years, median by year | write · fill `duplicated` |
| Practice 17 | regression of market cap on employees | write · predict the fitted numbers |
| Practice 18 | beta portfolio and two t-tests | write · fill `t_test`/`squeeze` |
| Practice 19 | five P/E regressions in a loop | write · fix a loop that keeps only the last fit |

### The lecture map

One notebook per lecture, two exercises each, in `fin400/practice/practice-lectures.json`:

| Lecture | Notebook | Exercises |
| --- | --- | --- |
| 01 | loading the data, parsing dates, counting what landed | load and count · predict the row count and the years |
| 02 | loops, `math.log`, wrapping a loop in a function | `loglist()` · fix a loop that logs the list |
| 03 | the `statistics` library: max by hand, mean, median, quantiles | fix a max primed at zero · predict mean/median/quartiles |
| 04 | squared deviations, `cdf`, `inv_cdf` | `sqdevs()` · fill the percentile lookup |
| 05 | a list of CDF values, looping by index | `listcdf()` · predict three lines from an index loop |
| 06 | empirical probability with `pd.cut` | bucket the equal-weight series · predict the four bucket counts |
| 07 | columns, new columns from old ones, `describe` | build `eps` and `mult` · fill the percentile call |
| 08 | boolean indexing, `&` vs `and` | men aged 40 and over · fix a mask joined with `and` |
| 11 | `head`/`info`/`nunique`, `&` vs `\|`, `.dt` accessors | union of two conditions · predict rows and months in 1926 |
| 12 | `groupby` on one key and on two | median age and BMI by gender · fill a two-key groupby |

The eight original seed exercises stay in `problems/fin400-bootcamp.json` and
`problems/fin400-analysis.json`, with `fin400/data/fund_returns.csv` and `fund_fees.csv`, and appear in the
practice list under **General exercises**. Delete them if you do not want the extra material.

### No solutions, anywhere

The rule for this class: a student gets hints about syntax and methods, never the answer. That is why

- every FIN 400 exercise is built with `"solutions": "hidden"`. `build_index.py` removes the
  `solution` field from the bundle, so the exercise page cannot show what it never received;
- **no reference answer for this class is stored in this repository at all** — not in the problem
  files, not in `tests/`. This repository is public, so an answer file committed "just for testing"
  would be a published answer key. Prose answers ("is the average adult obese?") are asked as a
  comment or a class discussion, never as a hidden check;
- the hints stop at the method. They name the tool — `groupby(...).shift(1)`, a six-slot count list,
  `t_test('mkt = 1')` — and leave the line itself to the student;
- `fin400/solutions/` is listed under `private_paths` in `data/courses.json`, so
  `tools/assemble_site.py` keeps it out of `_site`. Treat that as a second lock, not as privacy: if the
  repository is public, do not put an answer key in it at all.
- the lecture notebooks show a **demonstration** cell per lecture — how the data loads, what a summary
  looks like — never the exercise's own solution. The master compilation's Part 1 (the handout's
  worked solutions) was not stored anywhere: no notebook, no problem file, no data file reproduces
  it.

Because no answer is committed, the Pyodide test (`tests/pyodide.test.mjs`) cannot check these
exercises by itself. It reports each one as **skipped with that reason** rather than passing it
silently. To check them for real, keep a local answers file outside the repository and point the suite
at it:

```bash
EXTRA_REFERENCE_ANSWERS=~/fin400-answers.json npm test
```

The file is a flat `{ "problem-id": "python code" }` map; nothing in the repository reads it, and it
must never be committed.

### The practice data

`fin400/data/` now holds ten files, all generated — none of them is from an assignment, and none needs
a download:

| File | Rows | Used by |
| --- | --- | --- |
| `fin400-survey.csv` | 900 adults | BMI, percentile and logical-indexing sets |
| `fin400-stock-panel.csv` | 2,343 firm-years, 1980–2024 | EPS, leverage, yearly medians |
| `fin400-stock-panel-dupes.csv` | the same panel plus 12 repeated firm-years | counting and dropping duplicates |
| `fin400-monthly-stocks.csv` | 5,400 stock-months, 1926–1935 | equal- and value-weight portfolios, lags |
| `fin400-port-mcap.csv` | 120 months | four size portfolios, the blend, the wide frame |
| `fin400-port-beta.csv` | 120 months × 10 portfolios | regressions on the market |
| `fin400-port-pe.csv` | 120 months × 5 portfolios | the loop of five regressions |
| `fin400-factors.csv` | 120 months (`mkt`, `small`) | both regression sets |
| `fin400-mcap-emp.csv` | 600 firms | size versus employees, merges |
| `fin400-firms.csv` | 600 firms | sector and ticker for the merges |

They are written by `tools/make_fin400_data.py` from a fixed seed, so the numbers the checks assert
never drift:

```bash
python3 tools/make_fin400_data.py --verify   # check the committed files
python3 tools/make_fin400_data.py           # rebuild them (same seed, same bytes)
```

The monthly panels cover ten years rather than the fifty in the handout's data, because 50 years × every
stock is a large file to serve to a browser; the exercises say so where it matters. Every set is
self-contained: the page copies the file the exercise declares into the Python sandbox, so the code
reads a bare name such as `fin400-survey.csv`.

### Adding more sets

Drop a new `fin400/practice/<name>.json` file with the fields any other exercise uses, and run:

```bash
python3 tools/build_index.py --check     # validates problems, courses and phases
python3 tools/build_index.py             # rewrites the two manifests
npm test
```

There are three rules for this class: no `solution` field, at least two hints that describe the method
rather than the answer, and something to check against (`tests`, `expected_output`, or `test_summary`
plus tests). A set that reuses an existing dataset needs nothing else; a new dataset should be added to
`tools/make_fin400_data.py` so it can be rebuilt.

### Swapping in the real assignments

The assignments themselves, and their solutions, do not belong in this public repository. If you later
want a private copy, keep it in a private repository and point `private_paths` at the folder; otherwise
the practice sets are the material, and they deliberately never reproduce an assignment's wording,
companies or figures.
