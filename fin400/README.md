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

Homework is called an **assignment** (or **practice**) on the site. There is no "HW" label anywhere.

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
├── assignments/  assignment briefs and worked practice (homework, renamed)
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

Exercises live in `problems/`, one JSON file per topic or week. The two seed files
(`problems/fin400-bootcamp.json`, `problems/fin400-analysis.json`) are complete working examples —
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

Twenty seed flashcards (six Python, ten pandas, three NumPy, one statsmodels) and eight seed
exercises, four per half, so the class is not an empty tab while the real assignments are being
added:

| Half | Exercises |
| --- | --- |
| Bootcamp | compound a balance, fix simple interest, a Sharpe ratio, clean a ticker |
| Analysis | average return per fund, fix a fund report, rank funds net of fees, a pooled OLS regression |

Their data is in `fin400/data/` (`fund_returns.csv`, `fund_fees.csv`) and is **not** from any
assignment. Replace or delete them freely — they are ordinary problem files.

### Swapping the placeholders for the real material

The seed material is confined to a few ordinary files; delete them and add yours, and nothing else
needs editing:

```bash
# exercises (all the seed practice questions)
rm problems/fin400-bootcamp.json problems/fin400-analysis.json
# the seed cards (or keep the file and replace its 20 entries)
# data/flashcards.json
# seed data used only by the deleted exercises
rm fin400/data/fund_returns.csv fin400/data/fund_fees.csv
```

Then drop the real `.py` files into `fin400/bootcamp/`, the notebooks into `fin400/notebooks/`, the
briefs into `fin400/assignments/`, data into `fin400/data/` and any answer keys into
`fin400/solutions/` (never published). Run:

```bash
python3 tools/build_index.py        # index the new notebooks and files
python3 tools/build_index.py --check
npm test
```

Give each uploaded notebook a `"FIN 400"`-style topic or a `data/curriculum.json` entry only if you
want a custom label/order; by default its folder decides the section, and its own tasks appear as
learning content. The seed card deck is the only thing with hand-written copy — replace its entries
with the methods your modules actually use, or write a new `data/flashcards.json` with the same
fields.
