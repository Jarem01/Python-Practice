#!/usr/bin/env python3
"""Run every notebook's code cells, in order, against the bundled datasets.

This is the check that the Learning section's "Run" mode will succeed: it copies
the data files a notebook declares (data/curriculum.json → data_files) into a
temporary working directory, then executes the notebook's code cells in one
shared namespace, exactly like a Jupyter kernel (and like assets/js/runner.js
with `persist: true`).

    python3 -m pip install pandas numpy matplotlib statsmodels openpyxl
    python3 tools/check_notebooks.py            # every notebook
    python3 tools/check_notebooks.py --nb "Intro to Python (Part 3)*"

Cells that call a GUI host (`display()`, `plt.show()`) are given harmless
stand-ins. Exits non-zero if any cell raises.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def source_of(cell: dict) -> str:
    source = cell.get("source") or ""
    return "".join(source) if isinstance(source, list) else str(source)


def load_manifest() -> dict:
    return json.loads((ROOT / "data" / "notebooks.json").read_text(encoding="utf-8"))


def make_globals() -> dict:
    namespace = {"__name__": "__main__", "display": print, "get_ipython": lambda: None}

    def show(*_args, **_kwargs):
        return None

    namespace["display"] = show
    return namespace


#: Some cells raise on purpose — the notebook asks the learner to read the
#: traceback ("What is the error you receive?"). Those are not failures.
EXPECTED_ERROR_RE = re.compile(
    r"what is the error|error you (?:get|receive)|read the .{0,20}traceback|traceback|exception",
    re.IGNORECASE,
)


def run_notebook(entry: dict, verbose: bool) -> tuple[int, list[str]]:
    notebook_path = ROOT / entry["path"]
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    directory = Path(tempfile.mkdtemp())
    failures: list[str] = []
    cells = 0
    previous_directory = Path.cwd()
    try:
        for name, repo_path in (entry.get("data_files") or {}).items():
            shutil.copy(ROOT / repo_path, directory / name)
        # The notebook opens its data by bare file name, so run it from there.
        os.chdir(directory)
        sys.path.insert(0, str(directory))
        namespace = make_globals()
        last_markdown = ""
        for index, cell in enumerate(notebook.get("cells") or []):
            if cell.get("cell_type") == "markdown":
                last_markdown = source_of(cell)
                continue
            if cell.get("cell_type") != "code":
                continue
            code = source_of(cell)
            if not code.strip():
                continue
            cells += 1
            buffer = io.StringIO()
            try:
                with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
                    exec(compile(code, f"{entry['path']}#cell{index}", "exec"), namespace)
            except BaseException as error:  # noqa: BLE001 - report every failure
                if verbose:
                    traceback.print_exc()
                if EXPECTED_ERROR_RE.search(last_markdown):
                    # The prompt asks the learner to produce this error.
                    continue
                failures.append(f"cell {index}: {type(error).__name__}: {error}")
    finally:
        os.chdir(previous_directory)
        if str(directory) in sys.path:
            sys.path.remove(str(directory))
        shutil.rmtree(directory, ignore_errors=True)
    return cells, failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nb", default="*", help="shell-style pattern matched against the notebook path")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    import fnmatch

    manifest = load_manifest()
    selected = [entry for entry in manifest["notebooks"] if fnmatch.fnmatch(entry["path"], args.nb)]
    if not selected:
        print(f"No notebook matches {args.nb!r}")
        return 1

    bad = 0
    for entry in selected:
        cells, failures = run_notebook(entry, args.verbose)
        label = entry.get("label") or entry["path"]
        if failures:
            bad += 1
            print(f"  FAIL {label}: {cells} cell(s) ran, then {failures[0]}")
        else:
            print(f"  ok   {label}: {cells} code cell(s) ran against the bundled data")
    print(f"\n{len(selected) - bad} of {len(selected)} notebook(s) run cleanly.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
