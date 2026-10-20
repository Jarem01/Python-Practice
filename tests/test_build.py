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
        part1 = "acc525/Intro to Python/Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb"
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


class CourseTests(unittest.TestCase):
    """Two classes on one site: which folder belongs to which class, which half
    of it a file is in, and whether its solutions may be published."""

    @classmethod
    def setUpClass(cls):
        cls.registry, cls.errors = builder.load_courses(ROOT)

    def test_registry_loads_both_classes(self):
        self.assertEqual(self.errors, [])
        ids = [course["id"] for course in self.registry["courses"]]
        self.assertEqual(ids, ["acc525", "fin400"])
        self.assertEqual(self.registry["default"], "acc525")
        fin400 = next(c for c in self.registry["courses"] if c["id"] == "fin400")
        self.assertEqual(fin400["solutions"], "hidden")
        self.assertEqual([phase["id"] for phase in fin400["phases"]], ["bootcamp", "analysis"])
        self.assertIn("fin400", fin400["paths"])

    def test_a_path_belongs_to_the_longest_matching_class(self):
        courses = self.registry["courses"]
        default = self.registry["default"]
        self.assertEqual(builder.course_match("fin400/bootcamp/loops.py", courses, default), ("fin400", "fin400"))
        self.assertEqual(
            builder.course_match("acc525/Intro to Python/Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb", courses, default),
            ("acc525", "acc525"),
        )
        self.assertEqual(builder.course_match("problems/x.json", courses, default)[0], "acc525")

    def test_the_folder_inside_a_class_decides_the_group(self):
        self.assertEqual(builder.course_folder("fin400/bootcamp/loops.py", "fin400"), "bootcamp")
        self.assertEqual(builder.course_folder("fin400/notebooks/week 9.ipynb", "fin400"), "notebooks")
        # A file directly inside the class folder has no folder of its own.
        self.assertEqual(builder.course_folder("fin400/loose.py", "fin400"), "")

    def test_a_hidden_class_never_ships_the_solution(self):
        entries = [{"path": "fin400/bootcamp/loops.py", "course": "fin400", "phase": "bootcamp", "group": "bootcamp"}]
        problems = [
            {
                "id": "p1",
                "prompt": "x",
                "type": "write_from_scratch",
                "course": "fin400",
                "solution": "print('the answer')",
                "notebook": "fin400/bootcamp/loops.py",
            }
        ]
        errors = builder.apply_course_policy(problems, entries, self.registry)
        self.assertEqual(errors, [])
        self.assertEqual(problems[0]["solutions"], "hidden")
        self.assertNotIn("solution", problems[0])
        self.assertEqual(problems[0]["phase"], "bootcamp")

    def test_a_visible_class_keeps_its_solution(self):
        entries = []
        problems = [
            {
                "id": "p2",
                "prompt": "x",
                "type": "write_from_scratch",
                "solution": "1 + 1",
            }
        ]
        errors = builder.apply_course_policy(problems, entries, self.registry)
        self.assertEqual(errors, [])
        self.assertEqual(problems[0]["solutions"], "shown")
        self.assertEqual(problems[0]["solution"], "1 + 1")
        self.assertEqual(problems[0]["course"], "acc525")

    def test_an_unknown_half_and_a_class_mismatch_are_errors(self):
        entries = [{"path": "fin400/bootcamp/loops.py", "course": "fin400", "phase": "bootcamp", "group": "bootcamp"}]
        problems = [
            {"id": "p3", "prompt": "x", "type": "write_from_scratch", "course": "fin400", "phase": "nonsense"},
            {"id": "p4", "prompt": "x", "type": "write_from_scratch", "course": "fin400", "notebook": "acc525/Intro to Python/Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb"},
        ]
        entries.append({"path": "acc525/Intro to Python/Intro to Python (Part 1) - CLASS EXERCISE SOLUTIONS.ipynb", "course": "acc525", "phase": "intro", "group": "Intro to Python"})
        errors = builder.apply_course_policy(problems, entries, self.registry)
        self.assertTrue(any("does not define" in error for error in errors), errors)
        self.assertTrue(any("belongs to acc525" in error for error in errors), errors)

    def test_the_shipped_bundle_respects_the_policy(self):
        bundle = json.loads((ROOT / "problems" / "index.json").read_text(encoding="utf-8"))
        manifest = json.loads((ROOT / "data" / "notebooks.json").read_text(encoding="utf-8"))
        courses = {course["id"]: course for course in manifest["courses"]}
        self.assertEqual(set(courses), {"acc525", "fin400"})

        for problem in bundle["problems"]:
            course = courses[problem["course"]]
            phases = [phase["id"] for phase in course["phases"]]
            self.assertIn(problem["phase"], phases, problem["id"])
            if course["solutions"] == "hidden":
                self.assertNotIn("solution", problem, problem["id"])
                self.assertTrue(problem.get("hints"), f"{problem['id']} needs hints")

        fin400 = [p for p in bundle["problems"] if p["course"] == "fin400"]
        self.assertGreaterEqual(len(fin400), 8)
        self.assertEqual({p["phase"] for p in fin400}, {"bootcamp", "analysis"})
        self.assertTrue(all(p["solutions"] == "hidden" for p in fin400))
        self.assertEqual(manifest["courses"][1]["totals"]["problems"], len(fin400))


    def test_a_class_can_keep_a_folder_off_the_site(self):
        prefixes = builder.private_prefixes(self.registry)
        self.assertEqual(builder.private_owner("fin400/solutions/week1_key.ipynb", prefixes), "fin400")
        self.assertEqual(builder.private_owner("fin400/solutions/nested/hw2.py", prefixes), "fin400")
        self.assertIsNone(builder.private_owner("fin400/assignments/week1.ipynb", prefixes))
        # A path that merely starts with the same letters is not private.
        self.assertIsNone(builder.private_owner("fin400/solutions-notes/week1.ipynb", prefixes))

    def test_the_manifest_does_not_list_a_private_file(self):
        manifest = json.loads((ROOT / "data" / "notebooks.json").read_text(encoding="utf-8"))
        private = builder.private_prefixes(self.registry)
        for entry in manifest["notebooks"] + manifest["scripts"]:
            self.assertIsNone(builder.private_owner(entry["path"], private), entry["path"])
        self.assertIn("private_paths", manifest["courses"][1])


class FlashcardValidationTests(unittest.TestCase):
    def test_the_shipped_deck_validates(self):
        registry, errors = builder.load_courses(ROOT)
        self.assertEqual(errors, [])
        count, card_errors, card_warnings = builder.validate_flashcards(
            ROOT, {course["id"] for course in registry["courses"]}
        )
        self.assertGreaterEqual(count, 1)
        self.assertEqual(card_errors, [])
        self.assertEqual(card_warnings, [])
        deck = json.loads((ROOT / "data" / "flashcards.json").read_text(encoding="utf-8"))
        self.assertEqual(count, len(deck["cards"]))

    def test_a_card_missing_a_part_is_an_error(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data").mkdir()
            (root / "data" / "flashcards.json").write_text(
                json.dumps({"cards": [{"id": "x", "method": "x()", "library": "python"}]}),
                encoding="utf-8",
            )
            count, errors, _ = builder.validate_flashcards(root, {"fin400"})
            self.assertEqual(count, 1)
            for field in ("assignment", "does", "call", "output", "topics"):
                self.assertTrue(any(field in error for error in errors), (field, errors))

    def test_a_card_cannot_name_an_unknown_class(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data").mkdir()
            (root / "data" / "flashcards.json").write_text(
                json.dumps(
                    {
                        "cards": [
                            {
                                "id": "x",
                                "method": "x()",
                                "library": "python",
                                "assignment": "Week 1",
                                "topics": ["Functions"],
                                "does": "Does a thing in plain words.",
                                "call": "print(1)",
                                "output": "1",
                                "courses": ["fin999"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            _, errors, _ = builder.validate_flashcards(root, {"fin400"})
            self.assertTrue(any("fin999" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
