#!/usr/bin/env python3
"""Assemble the folder GitHub Pages publishes.

    python3 tools/assemble_site.py _site

This copies exactly what the site serves — the pages, assets, manifests,
material folders and class folders — and then removes every path a class lists
under `private_paths` in data/courses.json. That is how a class keeps its answer
keys and model solutions off the website: they stay in the repository (or in a
private one), but they are not part of `_site`, and nothing on the site links to
them.

Never point this at a folder that holds files you want to keep: the output
folder is replaced from scratch on every run.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

#: Folders copied as they are (before private paths are removed).
PUBLIC_DIRS = ("assets", "data", "problems", "materials", "practice", "learning", "fin400")

#: The pages at the repository root, and the Jekyll opt-out file.
PUBLIC_FILES = ("index.html", "flashcards.html", "glossary.html", "upload.html", ".nojekyll")

#: Notebooks and scripts kept at the repository root are served too.
ROOT_SUFFIXES = (".ipynb", ".py")


def read_courses(root: Path) -> list[dict]:
    path = Path(root) / "data" / "courses.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001
        raise SystemExit(f"data/courses.json: invalid JSON ({error})") from error
    return [course for course in data.get("courses") or [] if isinstance(course, dict)]


def course_folders(root: Path) -> list[str]:
    """The top-level folder each class lives in (a new class is copied too)."""
    folders: list[str] = []
    for course in read_courses(root):
        for value in course.get("paths") or []:
            first = str(value or "").replace("\\", "/").strip().strip("/").split("/")[0]
            if first and first not in (".", "..") and first not in folders:
                folders.append(first)
    return folders


def private_paths(root: Path) -> list[str]:
    """Every path data/courses.json says a class keeps private."""
    courses = read_courses(root)
    paths: list[str] = []
    for course in courses:
        for value in course.get("private_paths") or []:
            raw = str(value or "").replace("\\", "/").strip()
            # A path that climbs out of the output folder (or is absolute) is a
            # configuration mistake; ignore it rather than deleting something
            # else on the machine.
            if raw.startswith("/") or (len(raw) > 1 and raw[1] == ":"):
                continue
            rel = raw.strip("/")
            if rel and ".." not in Path(rel).parts:
                paths.append(rel)
    return paths


def assemble(root: Path, out: Path) -> list[str]:
    """Copy the site into `out`; return the private paths that were removed."""
    root = Path(root).resolve()
    out = Path(out)
    if out.resolve() == root:
        raise SystemExit("Refusing to assemble the site into the repository root itself.")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for name in dict.fromkeys(PUBLIC_DIRS + tuple(course_folders(root))):
        source = root / name
        if source.is_dir():
            shutil.copytree(source, out / name)
    for name in PUBLIC_FILES:
        source = root / name
        if source.is_file():
            shutil.copy2(source, out / name)
    for entry in sorted(root.iterdir()):
        if entry.is_file() and entry.suffix in ROOT_SUFFIXES and not entry.name.startswith("."):
            shutil.copy2(entry, out / entry.name)

    removed: list[str] = []
    for rel in private_paths(root):
        target = out / rel
        if not target.exists():
            continue
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        removed.append(rel)
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="Assemble the folder published to GitHub Pages")
    parser.add_argument("output", nargs="?", default="_site", help="output folder (default: _site)")
    parser.add_argument("--root", default=str(REPO_ROOT), help="repository root (default: parent of tools/)")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.output)
    removed = assemble(root, out)
    print(f"Assembled {out} from {root}")
    if removed:
        print("  kept out of the site (private_paths): " + ", ".join(removed))
    else:
        print("  no private paths were configured")
    return 0


if __name__ == "__main__":
    sys.exit(main())
