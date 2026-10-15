#!/usr/bin/env python3
"""Tests for tools/build_index.py — parsing, slug parity with the JS side and
validation of the shipped problem/notebook files.

    python3 -m unittest discover -s tests
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import build_index as builder  # noqa: E402


class SlugTests(unittest.TestCase):
    """slugify() must match slugify() in assets/js/util.js exactly."""

    def test_known_values(self):
        cases = {
            "Part 1 — Python Basics": "part-1-python-basics",
            "Exercise 2 — a small function": "exercise-2-a-small-function",
            "for loop": "for-loop",
            "DataFrame": "dataframe",
            "NumPy": "numpy",
            "!!!" : "section",
            "  Trim  me  ": "trim-me",
        }
        for value, expected in cases.items():
            self.assertEqual(builder.slugify(value), expected, value)


class ProblemParsingTests(unittest.TestCase):
    def test_markdown_problem_round_trip(self):
        text = """---
id: demo-problem
type: fill_in_blank
title: A demo
topics: [Python Basics, Strings]
difficulty: medium
---

Fix the loop so it prints 15.

## hints
- start from zero
- add each number

## starter_code
```python
total = ___
print(total)
```

## expected_output
15

## tests
```python
assert total == 15
```
"""
        problem = builder.parse_md_problem(text, Path("demo.md"))
        self.assertEqual(problem["id"], "demo-problem")
        self.assertEqual(problem["topics"], ["Python Basics", "Strings"])
        self.assertEqual(problem["hints"], ["start from zero", "add each number"])
        self.assertIn("total = ___", problem["starter_code"])
        self.assertEqual(problem["expected_output"], "15")
        self.assertIn("assert total == 15", problem["tests"])
        self.assertIn("prints 15", problem["prompt"])

    def test_validation_catches_typical_mistakes(self):
        problems = [
            {"id": "Bad ID", "type": "fix_the_code", "title": "x", "prompt": "y", "starter_code": "a=1"},
            {"id": "ok", "type": "fill_in_blank", "title": "x", "prompt": "y", "starter_code": "no blanks here"},
            {"id": "ok", "type": "predict_output", "title": "x", "prompt": "y"},
            {"id": "dupe", "type": "fix_the_code", "title": "x", "prompt": "y", "starter_code": "a=1", "tests": "assert a==1"},
            {"id": "dupe", "type": "fix_the_code", "title": "x", "prompt": "y", "starter_code": "a=1", "tests": "assert a==1"},
        ]
        errors, warnings = builder.validate_problems(problems, {"for-loop"}, set())
        joined = " | ".join(errors)
        self.assertIn("lowercase letters", joined)
        self.assertIn("no ___ blank", joined)
        self.assertIn("needs 'expected_output'", joined)
        self.assertIn("duplicate id", joined)
        self.assertGreaterEqual(len(errors), 4)

    def test_unknown_glossary_slug_is_a_warning(self):
        problems = [{"id": "p1", "type": "fix_the_code", "title": "t", "prompt": "p", "starter_code": "a=1", "tests": "assert a", "glossary": ["nope"]}]
        errors, warnings = builder.validate_problems(problems, {"for-loop"}, set())
        self.assertEqual(errors, [])
        self.assertTrue(any("unknown glossary term" in w for w in warnings))


class NotebookScanTests(unittest.TestCase):
    def test_class_notebooks_are_indexed_with_their_exercises(self):
        notebooks = builder.scan_notebooks(ROOT)
        paths = {n["path"] for n in notebooks}
        part1 = "Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb"
        self.assertIn(part1, paths)
        entry = next(n for n in notebooks if n["path"] == part1)
        self.assertEqual(entry["title"], "Introduction to Python (Part 1) - Class Exercise Solutions")
        self.assertEqual(entry["group"], "Intro to Python")
        self.assertTrue(entry["exercises"], "the notebook's exercises are listed")
        self.assertTrue(all(e["anchor"] for e in entry["exercises"]), "every exercise gets an anchor")
        self.assertTrue(any("Data Analysis" in p for p in paths), "both tracks are indexed")

    def test_inline_html_becomes_plain_text_in_titles(self):
        # The notebooks write headings like "Print the Boolean test for 8<sup>3</sup>",
        # which must read as "8^3" in titles, anchors and lists — never as markup.
        self.assertEqual(builder.plain_text("the test for 8<sup>3</sup> >= 5,000"), "the test for 8^3 >= 5,000")
        self.assertEqual(builder.plain_text("H<sub>2</sub>O<br>next"), "H_2O next")
        self.assertEqual(builder.plain_text("**bold** and `code`"), "bold and code")

    def test_group_inference(self):
        # A "Part N" folder groups by part number, so several part-folders can share one part.
        self.assertEqual(builder.infer_group(Path("Part 2 - Data/lesson1.ipynb")), ("Part 2", 2))
        self.assertEqual(builder.infer_group(Path("Week 3/intro.ipynb"))[1], 3)
        self.assertEqual(builder.infer_group(Path("notebooks/intro.ipynb")), ("Notebooks", 999))


class GeneratedArtifactTests(unittest.TestCase):
    def test_build_check_passes_on_this_repository(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "build_index.py"), "--check", "--quiet"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, f"build_index.py --check failed:\n{result.stdout}\n{result.stderr}")

    def test_generated_files_exist_and_are_current(self):
        bundle_path = ROOT / "problems" / "index.json"
        manifest_path = ROOT / "data" / "notebooks.json"
        self.assertTrue(bundle_path.exists(), "run tools/build_index.py")
        self.assertTrue(manifest_path.exists(), "run tools/build_index.py")
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(bundle["count"], len(bundle["problems"]))
        self.assertGreater(bundle["count"], 0)
        self.assertTrue(manifest["notebooks"], "the class notebooks must be indexed")
        self.assertEqual(bundle["count"], manifest["totals"]["problems"])

        for problem in bundle["problems"]:
            for key in ("id", "type", "title", "prompt"):
                self.assertTrue(problem.get(key), f"{problem.get('id')} is missing {key}")
            self.assertIn(problem["type"], builder.PROBLEM_TYPES)

    def test_every_problem_is_auto_gradable(self):
        bundle = json.loads((ROOT / "problems" / "index.json").read_text(encoding="utf-8"))
        for problem in bundle["problems"]:
            if problem["type"] == "predict_output":
                self.assertIsNotNone(problem.get("expected_output"), problem["id"])
            else:
                self.assertTrue(
                    problem.get("tests") or problem.get("expected_output") is not None,
                    f"{problem['id']} has nothing to check against",
                )


if __name__ == "__main__":
    unittest.main()
