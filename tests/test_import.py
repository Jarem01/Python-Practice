#!/usr/bin/env python3
"""Tests for tools/import_materials.py — the no-token path that takes a bundle
downloaded from the website and turns it into repository files.

    python3 -m unittest discover -s tests
"""

from __future__ import annotations

import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import import_materials as importer  # noqa: E402


def problem(**overrides) -> dict:
    data = {
        "id": "upload-print-the-total",
        "type": "write_from_scratch",
        "title": "Print the total · Introduction to Python (Part 1)",
        "topics": ["Python Basics"],
        "difficulty": "easy",
        "prompt": "Print the total of the numbers.",
        "solution": "print(6)\n",
        "expected_output": "6",
        "draft": True,
        "generated": {"from": "materials/part-1.ipynb", "autoChecked": True},
    }
    data.update(overrides)
    return data


def bundle(**overrides) -> dict:
    data = {
        "version": 1,
        "destination": "materials",
        "files": [
            {"path": "materials/Intro to Python (Part 5)/lesson.ipynb", "encoding": "utf-8", "content": "{}\n"},
            {"path": "materials/datasets/sales.csv", "encoding": "utf-8", "content": "region,total\nnorth,10\n"},
        ],
        "problems": [problem()],
    }
    data.update(overrides)
    return data


class PathSafetyTests(unittest.TestCase):
    def test_rejects_absolute_paths(self):
        with self.assertRaises(importer.ImportError_):
            importer.normalize_path("/etc/passwd")

    def test_rejects_traversal(self):
        with self.assertRaises(importer.ImportError_):
            importer.normalize_path("materials/../../secrets.txt")

    def test_normalizes_windows_separators(self):
        self.assertEqual(importer.normalize_path("materials\\a\\b.py"), "materials/a/b.py")
        self.assertEqual(importer.normalize_path("./materials//a/./b.py"), "materials/a/b.py")

    def test_destination_stays_inside_the_allowed_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            allowed = importer.destination_for("materials/x.ipynb", root)
            self.assertEqual(allowed, (root / "materials/x.ipynb").resolve())
            with self.assertRaises(importer.ImportError_):
                importer.destination_for("index.html", root)
            with self.assertRaises(importer.ImportError_):
                importer.destination_for("problems/../index.html", root)


class ProblemHandlingTests(unittest.TestCase):
    def test_checkable_needs_output_or_tests(self):
        self.assertTrue(importer.problem_is_checkable(problem()))
        self.assertTrue(importer.problem_is_checkable(problem(expected_output="", tests="assert True")))
        self.assertFalse(importer.problem_is_checkable(problem(expected_output="", tests="")))

    def test_ids_must_match_the_index_rule(self):
        self.assertEqual(importer.problem_filename(problem()), "upload-print-the-total.json")
        with self.assertRaises(importer.ImportError_):
            importer.problem_filename(problem(id="Upload Problem!"))

    def test_drafts_become_ordinary_problems(self):
        cleaned = importer.clean_problem(problem())
        self.assertNotIn("draft", cleaned)
        self.assertEqual(cleaned["generated"]["source"], "upload page")
        self.assertNotIn("autoChecked", cleaned["generated"])


class ApplyBundleTests(unittest.TestCase):
    def test_writes_files_and_problems_under_the_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = importer.apply_bundle(bundle(), root)
            self.assertEqual(len(summary["added"]), 2)
            self.assertEqual(summary["problems"], ["problems/generated/upload-print-the-total.json"])
            notebook = root / "materials" / "Intro to Python (Part 5)" / "lesson.ipynb"
            self.assertTrue(notebook.exists(), "subfolders are created")
            written = json.loads((root / "problems/generated/upload-print-the-total.json").read_text(encoding="utf-8"))
            self.assertEqual(written["expected_output"], "6")
            self.assertNotIn("draft", written)

    def test_second_import_is_a_no_op(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            importer.apply_bundle(bundle(), root)
            again = importer.apply_bundle(bundle(), root)
            self.assertEqual(again["added"], [])
            self.assertEqual(again["problems"], [])
            self.assertEqual(len(again["unchanged"]), 3)

    def test_binary_files_are_decoded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = base64.b64encode(b"\x89PNG\r\n").decode("ascii")
            data = bundle(files=[{"path": "materials/datasets/plot.png", "encoding": "base64", "content": payload}])
            importer.apply_bundle(data, root)
            self.assertEqual((root / "materials/datasets/plot.png").read_bytes(), b"\x89PNG\r\n")

    def test_exercises_without_a_check_are_skipped_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = bundle(problems=[problem(), problem(id="upload-needs-review", expected_output="")])
            summary = importer.apply_bundle(data, root)
            self.assertEqual(summary["skipped"], ["upload-needs-review"])
            self.assertFalse((root / "problems/generated/upload-needs-review.json").exists())

            kept = importer.apply_bundle(data, root, keep_unchecked=True)
            self.assertEqual(kept["skipped"], [])
            self.assertTrue((root / "problems/generated/upload-needs-review.json").exists())

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = importer.apply_bundle(bundle(), root, dry_run=True)
            self.assertEqual(len(summary["added"]), 2)
            self.assertFalse((root / "materials").exists())

    def test_rejects_writing_outside_the_allowed_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = bundle(files=[{"path": "index.html", "encoding": "utf-8", "content": "<html>"}])
            with self.assertRaises(importer.ImportError_):
                importer.apply_bundle(data, root)

    def test_bad_base64_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = bundle(files=[{"path": "materials/x.png", "encoding": "base64", "content": "not base64!"}])
            with self.assertRaises(importer.ImportError_):
                importer.apply_bundle(data, root)


class ShippedBundleTests(unittest.TestCase):
    """The upload page exports exactly this shape, so it must satisfy the loader."""

    def test_bundle_loader_accepts_the_document_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "materials-bundle.json"
            path.write_text(json.dumps(bundle()), encoding="utf-8")
            loaded = importer.load_bundle(path)
            self.assertEqual(loaded["version"], 1)
            self.assertEqual(len(loaded["files"]), 2)

    def test_bundle_loader_reports_bad_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(importer.ImportError_):
                importer.load_bundle(path)

    def test_bundle_loader_rejects_wrong_shapes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "wrong.json"
            path.write_text('{"files": {}}', encoding="utf-8")
            with self.assertRaises(importer.ImportError_):
                importer.load_bundle(path)


if __name__ == "__main__":
    unittest.main()
