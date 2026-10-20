"""tools/assemble_site.py — what GitHub Pages publishes.

The published folder must contain the pages and class material, and must not
contain a class's `private_paths` (answer keys, model solutions). The source
folder itself is left alone.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import assemble_site  # noqa: E402


def write(path: Path, text: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class AssembleSiteTests(unittest.TestCase):
    def make_repo(self, private_paths: list[str]) -> Path:
        tmp = Path(tempfile.mkdtemp())
        root = tmp / "repo"
        write(root / "data" / "courses.json", json.dumps({"default": "c1", "courses": [
            {"id": "c1", "code": "C1", "paths": ["class"], "private_paths": private_paths, "phases": []}
        ]}))
        write(root / "index.html", "<html></html>")
        write(root / ".nojekyll", "")
        write(root / "lesson.ipynb", "{}")
        write(root / "class" / "bootcamp" / "loops.py", "print('loops')")
        write(root / "class" / "notebooks" / "week1.ipynb", "{}")
        write(root / "class" / "solutions" / "week1_key.ipynb", "{}")
        write(root / "class" / "solutions" / "nested" / "key.py", "print('answer')")
        write(root / "assets" / "js" / "app.js", "// app")
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        return root

    def test_private_folders_stay_out_of_the_published_site(self):
        root = self.make_repo(["class/solutions"])
        out = root.parent / "_site"
        removed = assemble_site.assemble(root, out)

        self.assertEqual(removed, ["class/solutions"])
        self.assertFalse((out / "class" / "solutions").exists(), "the answer key was published")
        self.assertTrue((out / "class" / "bootcamp" / "loops.py").exists())
        self.assertTrue((out / "class" / "notebooks" / "week1.ipynb").exists())
        self.assertTrue((out / "index.html").exists())
        self.assertTrue((out / "lesson.ipynb").exists())
        self.assertTrue((out / "assets" / "js" / "app.js").exists())

        # The answer key is still in the repository; only the site leaves it out.
        self.assertTrue((root / "class" / "solutions" / "week1_key.ipynb").exists())

    def test_a_public_class_publishes_everything(self):
        root = self.make_repo([])
        out = root.parent / "_site"
        self.assertEqual(assemble_site.assemble(root, out), [])
        self.assertTrue((out / "class" / "solutions" / "week1_key.ipynb").exists())

    def test_a_private_path_cannot_reach_outside_the_output_folder(self):
        root = self.make_repo(["../outside", "/etc", "class/../../outside"])
        outside = root.parent / "outside"
        write(outside, "keep me")
        out = root.parent / "_site"
        assemble_site.assemble(root, out)
        self.assertTrue(outside.exists(), "assembly deleted a file outside its output folder")

    def test_the_real_repository_keeps_fin400_solutions_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "_site"
            removed = assemble_site.assemble(ROOT, out)
            self.assertIn("fin400/solutions", removed)
            self.assertFalse((out / "fin400" / "solutions").exists())
            self.assertTrue((out / "flashcards.html").exists(), "the flashcards page is published")
            self.assertTrue((out / "data" / "flashcards.json").exists())
            self.assertTrue((out / "fin400" / "assignments").exists())
            # The repository keeps its solution folder.
            self.assertTrue((ROOT / "fin400" / "solutions").is_dir())


if __name__ == "__main__":
    unittest.main()
