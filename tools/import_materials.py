#!/usr/bin/env python3
"""Apply a bundle downloaded from the website's upload page.

    # on the site: Upload → Add files → Analyze files → Download bundle
    python3 tools/import_materials.py ~/Downloads/materials-bundle.json
    python3 tools/build_index.py
    git add -A && git commit -m "Add course material" && git push

Layout the bundle must follow
-----------------------------
    {
      "version": 1,
      "destination": "materials",
      "files":    [{"path": "materials/.../x.ipynb", "encoding": "utf-8", "content": "..."}],
      "problems": [ { ...one practice exercise... } ]
    }

Source files are written exactly to the paths the page showed you (always inside
materials/). Problems are split into problems/generated/<id>.json, one file each,
so a later upload only adds files instead of rewriting one big bundle.

By default a problem is only written when it can be checked automatically (it has
an expected output or tests): a draft that nothing can grade would fail the
index build. Pass --all to keep those too (they will be reported as warnings).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

#: Where uploaded source material is kept. Keep in sync with MATERIALS_DIR in
#: tools/build_index.py and CONFIG.materialsDir in assets/js/config.js.
MATERIALS_DIR = "materials"
PROBLEMS_DIR = "problems/generated"

#: Folders an import may write into.
ALLOWED_ROOTS = (MATERIALS_DIR, PROBLEMS_DIR)

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class ImportError_(Exception):
    """Raised for anything wrong with the bundle rather than the disk."""


def load_bundle(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ImportError_(f"{path} does not exist.")
    except json.JSONDecodeError as error:
        raise ImportError_(f"{path} is not valid JSON ({error}).")
    if not isinstance(data, dict):
        raise ImportError_(f"{path}: expected a JSON object at the top level.")
    files = data.get("files")
    if files is not None and not isinstance(files, list):
        raise ImportError_(f"{path}: 'files' must be a list.")
    problems = data.get("problems")
    if problems is not None and not isinstance(problems, list):
        raise ImportError_(f"{path}: 'problems' must be a list.")
    return data


def normalize_path(raw: str) -> str:
    """Repo-relative path from a bundle entry, or raise. Never escapes the repo."""
    text = str(raw or "").replace("\\", "/").strip()
    if not text:
        raise ImportError_("a file entry has an empty path")
    if text.startswith("/") or os.path.isabs(text) or re.match(r"^[a-zA-Z]:", text):
        raise ImportError_(
            f"'{raw}' is an absolute path; bundle paths are relative to the repository root "
            "(for example materials/lesson.ipynb)"
        )
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        raise ImportError_(f"'{raw}' tries to leave the repository")
    return "/".join(parts)


def destination_for(rel: str, root: Path, extra_roots=()) -> Path:
    resolved = (root / rel).resolve()
    allowed = tuple((root / allowed_root).resolve() for allowed_root in (ALLOWED_ROOTS + tuple(extra_roots)))
    if not any(resolved == allowed_root or allowed_root in resolved.parents for allowed_root in allowed):
        raise ImportError_(
            f"'{rel}' is outside {'/ and '.join(ALLOWED_ROOTS)}/ — uploads are stored there so the "
            "site keeps finding them"
        )
    return resolved


def write_file(target: Path, content: str, encoding: str) -> bool:
    """Write one file; returns False when the content is already identical."""
    if encoding == "base64":
        try:
            data = base64.b64decode(content, validate=True)
        except Exception as error:  # noqa: BLE001 - report the offending file
            raise ImportError_(f"{target.name}: not valid base64 ({error})")
    else:
        data = content.encode("utf-8")
    if target.exists() and target.read_bytes() == data:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return True


def problem_is_checkable(problem: dict) -> bool:
    """A problem with nothing to compare against cannot be graded, and the index
    build refuses to write manifests while such a problem exists."""
    if str(problem.get("expected_output") or "").strip():
        return True
    return bool(str(problem.get("tests") or "").strip())


def problem_filename(problem: dict) -> str:
    pid = str(problem.get("id", "")).strip()
    if not ID_RE.fullmatch(pid):
        raise ImportError_(
            f"problem id {pid!r} must be lowercase letters, digits and dashes "
            "(the index build rejects anything else)"
        )
    return f"{pid}.json"


def clean_problem(problem: dict) -> dict:
    """Drafts become ordinary problems once they live in the repository."""
    out = dict(problem)
    out.pop("draft", None)
    generated = out.get("generated")
    if isinstance(generated, dict):
        generated = dict(generated)
        generated.pop("autoChecked", None)
        generated["source"] = "upload page"
        out["generated"] = generated
    return out


def apply_bundle(bundle: dict, root: Path, *, keep_unchecked: bool = False, dry_run: bool = False) -> dict:
    """Write the bundle into `root`. Returns a summary dictionary."""
    added: list[str] = []
    unchanged: list[str] = []
    problems_written: list[str] = []
    skipped: list[str] = []

    for entry in bundle.get("files") or []:
        if not isinstance(entry, dict):
            raise ImportError_("every entry in 'files' must be an object")
        rel = normalize_path(entry.get("path"))
        target = destination_for(rel, root)
        encoding = "base64" if str(entry.get("encoding", "utf-8")).lower() == "base64" else "utf-8"
        if dry_run:
            added.append(rel)
            continue
        if write_file(target, entry.get("content", ""), encoding):
            added.append(rel)
        else:
            unchanged.append(rel)

    for problem in bundle.get("problems") or []:
        if not isinstance(problem, dict):
            raise ImportError_("every entry in 'problems' must be an object")
        pid = str(problem.get("id", "")).strip()
        if not problem_is_checkable(problem) and not keep_unchecked:
            skipped.append(pid or "(no id)")
            continue
        filename = problem_filename(problem)
        rel = f"{PROBLEMS_DIR}/{filename}"
        target = destination_for(rel, root)
        payload = json.dumps(clean_problem(problem), indent=2) + "\n"
        if dry_run:
            problems_written.append(rel)
            continue
        if write_file(target, payload, "utf-8"):
            problems_written.append(rel)
        else:
            unchanged.append(rel)

    return {
        "added": added,
        "unchanged": unchanged,
        "problems": problems_written,
        "skipped": skipped,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import a website upload bundle into the repository")
    parser.add_argument("bundle", help="path to materials-bundle.json")
    parser.add_argument("--root", default=str(REPO_ROOT), help="repository root (default: parent of tools/)")
    parser.add_argument("--all", action="store_true", help="also import exercises that cannot be checked yet")
    parser.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    try:
        bundle = load_bundle(Path(args.bundle))
        summary = apply_bundle(bundle, root, keep_unchecked=args.all, dry_run=args.dry_run)
    except ImportError_ as error:
        print(f"ERROR: {error}")
        return 1

    verb = "would be written" if args.dry_run else "written"
    print(f"Source material {verb}: {len(summary['added'])}")
    for path in summary["added"]:
        print(f"  + {path}")
    if summary["unchanged"]:
        print(f"Source material already up to date: {len(summary['unchanged'])}")
    print(f"Practice exercises {verb}: {len(summary['problems'])}")
    for path in summary["problems"]:
        print(f"  + {path}")
    if summary["skipped"]:
        print(f"Skipped {len(summary['skipped'])} exercise(s) with nothing to check automatically:")
        for pid in summary["skipped"]:
            print(f"  - {pid}")

    if not args.dry_run and (summary["added"] or summary["problems"]):
        print("\nNext: python3 tools/build_index.py   (then commit and push)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
