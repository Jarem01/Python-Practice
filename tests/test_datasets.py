#!/usr/bin/env python3
"""The guarantees behind the Learning and Practice sections.

1. Every class section has practice exercises of its own.
2. Every dataset a notebook opens exists and is registered in data/curriculum.json.
3. The numbers the notebooks quote (68,841 violations rows, a $1,949.87 median
   invoice, 274 smokers, …) are really in the files the site serves.

The file-level checks are standard library only; the numeric ones need pandas
(and openpyxl for the workbook) and report SKIP when those are missing:

    python3 -m pip install pandas openpyxl
    python3 -m unittest discover -s tests
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(ROOT / "tools"))
try:
    import build_index  # noqa: E402  (shares the slugify algorithm)
except Exception:  # pragma: no cover - the module is always present in this repo
    build_index = None

try:
    import pandas as pd
except ImportError:  # pragma: no cover - CI installs it
    pd = None

try:
    import openpyxl  # noqa: F401  (imported for its side effect on read_excel)
    HAVE_EXCEL = True
except ImportError:  # pragma: no cover
    HAVE_EXCEL = False


def load(name: str):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def slugify(value: str) -> str:
    if build_index is not None:
        return build_index.slugify(value)
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(value).lower().strip())).strip("-")


class SectionCoverageTest(unittest.TestCase):
    """Every notebook in the course must have exercises to practise with."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = load("data/notebooks.json")
        cls.bundle = load("problems/index.json")

    def test_every_notebook_has_practice_exercises(self):
        by_notebook: dict[str, int] = {}
        for problem in self.bundle["problems"]:
            path = problem.get("notebook")
            if path:
                by_notebook[path] = by_notebook.get(path, 0) + 1
        missing = [entry["path"] for entry in self.manifest["notebooks"] if not by_notebook.get(entry["path"])]
        self.assertEqual(missing, [], f"these sections have no practice exercises: {missing}")

    def test_every_notebook_has_a_short_label_and_part(self):
        for entry in self.manifest["notebooks"]:
            self.assertTrue(entry.get("label"), f"{entry['path']} has no label")
            self.assertIsInstance(entry.get("part"), int, f"{entry['path']} has no part number")

    def test_sections_are_ordered_intro_first_then_data_analysis(self):
        order = [entry["path"] for entry in self.manifest["notebooks"]]
        intro = [i for i, path in enumerate(order) if path.startswith("Intro to Python")]
        analysis = [i for i, path in enumerate(order) if path.startswith("Data Analysis")]
        self.assertTrue(intro, "the Intro notebooks are missing")
        self.assertTrue(analysis, "the Data Analysis notebooks are missing")
        self.assertLess(max(intro), min(analysis), "Intro must come before Data Analysis")
        parts = [self.manifest["notebooks"][i]["part"] for i in analysis]
        self.assertEqual(parts, sorted(parts), "the Data Analysis sections must sort by part number")

    def test_glossary_links_in_problems_resolve(self):
        glossary = load("data/glossary.json")
        known = set()
        for entry in glossary["entries"]:
            known.add(slugify(entry["term"]))
            for alias in entry.get("aliases") or []:
                known.add(slugify(alias))
        unknown = set()
        for problem in self.bundle["problems"]:
            for slug in problem.get("glossary") or []:
                if slug not in known:
                    unknown.add(slug)
        self.assertEqual(unknown, set(), f"problems link to unknown glossary terms: {sorted(unknown)}")


class DatasetFileTest(unittest.TestCase):
    """The data files the notebooks open must exist where the curriculum says."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = load("data/notebooks.json")

    def test_declared_data_files_exist(self):
        seen = 0
        for entry in self.manifest["notebooks"]:
            for name, repo_path in (entry.get("data_files") or {}).items():
                seen += 1
                self.assertTrue(
                    (ROOT / repo_path).is_file(),
                    f"{entry['label']} wants {name} from {repo_path}, which is missing",
                )
        self.assertGreaterEqual(seen, 10, "the Data Analysis sections should declare their data files")

    def test_every_data_analysis_section_declares_data(self):
        for entry in self.manifest["notebooks"]:
            if entry["path"].startswith("Data Analysis"):
                self.assertTrue(entry.get("data_files"), f"{entry['label']} declares no data files")


class DatasetAnchorTest(unittest.TestCase):
    """The numbers the class notebooks quote, checked in the shipped files."""

    def setUp(self):
        if pd is None:
            self.skipTest("pandas is not installed (python3 -m pip install pandas openpyxl)")

    def test_violations_matches_the_notebook(self):
        data = pd.read_csv(
            ROOT / "materials/datasets/violations.csv",
            parse_dates=["date"],
            dtype={"zip": str, "gvkey": str},
        )
        self.assertEqual(data.shape, (68841, 11), "11 columns and 68,841 rows")
        self.assertEqual(int(data["zip"].notna().sum()), 25337, "25,337 rows have a zip code")
        self.assertEqual(int((data["company"] == "Microsoft").sum()), 5, "five Microsoft rows")
        public_december = data[(data["ownership structure"] == "publicly traded") & (data.date.dt.month == 12)]
        self.assertEqual(len(public_december), 3027, "3,027 publicly traded December rows")
        self.assertEqual(data.loc[107, "penalty"], "$8,800 ", "the 108th row penalty")
        raw = pd.read_csv(ROOT / "materials/datasets/violations.csv", usecols=["penalty"], dtype=str)["penalty"]
        self.assertEqual(raw.iloc[0], "$45,000 ", "the first penalty is the one the cleaning exercise hits")
        cleaned = raw.fillna("0").str.strip().str.replace("$", "", regex=False).str.replace(",", "", regex=False)
        self.assertTrue(cleaned.astype(float).notna().all(), "penalties clean up to floats")

    def test_invoices_matches_the_notebook(self):
        if not HAVE_EXCEL:
            self.skipTest("openpyxl is not installed (python3 -m pip install openpyxl)")
        data = pd.read_excel(ROOT / "materials/datasets/invoices.xlsx")
        self.assertEqual(data.shape, (5000, 8))
        self.assertEqual(round(float(data["Amount"].max()), 2), 1299950.00)
        self.assertEqual(round(float(data["Amount"].median()), 2), 1949.87)
        self.assertEqual(data["PartName"].value_counts().idxmax(), "Mouse")
        self.assertAlmostEqual(float(data["High Price"].mean()), 0.18, places=3)
        self.assertTrue(str(data["Date"].dtype).startswith("datetime"), "Date must be a real date column")
        july = data[data["Date"].dt.month == 7]
        bulk = july[(july["InvoiceID"] == "T13839563") & (july["Quantity"] >= 5000)]
        self.assertGreaterEqual(len(bulk), 4, "the July bulk order is in the data")

    def test_insurance_is_the_public_dataset(self):
        data = pd.read_csv(ROOT / "materials/datasets/insurance.csv")
        self.assertEqual(data.shape, (1338, 7))
        self.assertAlmostEqual(float(data["age"].mean()), 39.2, places=1)
        self.assertAlmostEqual(float((data["sex"] == "male").mean()), 0.505, places=3)
        self.assertAlmostEqual(float((data["smoker"] == "yes").mean()), 0.205, places=3)
        self.assertEqual(int((data["smoker"] == "yes").sum()), 274)

    def test_compustat_covers_the_industries_the_notebook_plots(self):
        data = pd.read_csv(ROOT / "materials/datasets/compustat.csv")
        names = pd.read_csv(ROOT / "materials/datasets/sic_indnames.csv")
        merged = data.merge(names, on="sic", how="left")
        self.assertTrue(merged["industry"].notna().all(), "every row needs an industry name")
        wanted = {3571, 6020, 4924, 1040, 5812, 3760, 5411}
        self.assertTrue(wanted.issubset(set(data["sic"])), "the notebook's industry list must exist")
        self.assertGreater(float(data["mktcap"].max()), 8 * float(data["mktcap"].quantile(0.99)))

    def test_earnings_merge_cleanly(self):
        earnings = pd.read_csv(ROOT / "materials/datasets/earnings.csv", parse_dates=["fpe"])
        exchange = pd.read_csv(ROOT / "materials/datasets/exchange.csv")
        company = pd.read_csv(ROOT / "materials/datasets/company_names.csv").rename(columns={"tic": "ticker"})
        merged = earnings.merge(exchange, on="ticker").merge(company, on="ticker")
        self.assertEqual(len(merged), len(earnings))
        self.assertGreater(len(merged), 0)

    def test_avocados_has_a_full_2017(self):
        lines = (ROOT / "materials/datasets/avocados.txt").read_text(encoding="utf-8").splitlines()
        in_2017 = [line for line in lines[1:] if "/2017" in line]
        self.assertEqual(len(in_2017), 365)
        self.assertTrue(all(len(line.split("|")) == 2 for line in in_2017), "each line is date|price")

    def test_degrees_files_concatenate(self):
        frames = [
            pd.read_csv(ROOT / "materials/datasets/degrees-that-pay-back-a.csv"),
            pd.read_csv(ROOT / "materials/datasets/degrees-that-pay-back-b.csv"),
        ]
        joined = pd.concat(frames, ignore_index=True)
        self.assertEqual(len(joined), 40)
        self.assertEqual(list(joined.index), list(range(40)))


if __name__ == "__main__":
    unittest.main()
