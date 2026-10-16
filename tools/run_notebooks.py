#!/usr/bin/env python3
"""Execute the course notebooks and save their outputs, like "Run All" in Jupyter.

The notebooks that ship with this repository have no saved outputs at all: every
code cell is `"outputs": []`, so the Learning section can only ever show the
code. This tool runs each notebook top to bottom in one namespace, in a
directory holding exactly the data files the notebook declares
(`data/curriculum.json` → `data_files`), and writes back the stream output, the
value of a trailing expression, any matplotlib figure and any traceback — the
same things Jupyter records.

    python3 tools/run_notebooks.py            # run every notebook and save
    python3 tools/run_notebooks.py --check    # run, report, change nothing
    python3 tools/run_notebooks.py --nb "Data Analysis (Part 3)*"

Needs pandas, numpy and matplotlib; statsmodels for Part 6 and python-calamine
(or openpyxl) for Part 3's .xlsx file. Run it after changing a notebook's code
and before `tools/build_index.py`.

Cells that raise on purpose — the notebook tells the learner to read the
traceback — keep the traceback as an `error` output; that is the lesson.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import fnmatch
import io
import json
import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Figures must not open a window while a script is running.
os.environ.setdefault("MPLBACKEND", "Agg")


def source_of(cell: dict) -> str:
    source = cell.get("source") or ""
    return "".join(source) if isinstance(source, list) else str(source)


def as_lines(text: str) -> list[str]:
    """Jupyter stores multi-line text as a list of lines that keep their \\n."""
    if not text:
        return []
    lines = text.split("\n")
    return [line + "\n" for line in lines[:-1]] + ([lines[-1]] if lines[-1] else [])


def load_manifest() -> dict:
    return json.loads((ROOT / "data" / "notebooks.json").read_text(encoding="utf-8"))


EXPECTED_ERROR_RE = (
    r"what is the error|error you (?:get|receive)|read the .{0,20}traceback|traceback|exception"
)


def is_expected_error(markdown: str) -> bool:
    import re

    return bool(re.search(EXPECTED_ERROR_RE, markdown or "", re.IGNORECASE))


def make_namespace(figures: list[dict]) -> dict:
    """The globals a Jupyter kernel provides, so notebook code runs unchanged."""

    def show(*objects, **_kwargs):
        for obj in objects:
            print(obj)

    def close(*_args, **_kwargs):
        return None

    return {
        "__name__": "__main__",
        "display": show,
        "get_ipython": lambda: None,
        "show": show,
        "close": close,
        "_figures": figures,
    }


def run_cell(code: str, namespace: dict, path: str, index: int, figures: list[dict]) -> list[dict]:
    """Execute one cell and return its Jupyter outputs.

    A trailing expression becomes an `execute_result`, the way a notebook shows
    `data.head()` without needing `print()`.
    """
    outputs: list[dict] = []
    stdout = io.StringIO()
    stderr = io.StringIO()

    # A trailing expression is shown the way Jupyter shows it. The test is made
    # on the parse tree, not on the last line of text, so a cell that ends with
    # the closing brace of a literal (`}`) is not mistaken for an expression.
    import ast

    filename = f"{path}#cell{index}"
    head: list[ast.stmt] = []
    tail: ast.expr | None = None
    tree = ast.parse(code, filename, "exec")
    if tree.body:
        last = tree.body[-1]
        if isinstance(last, ast.Expr):
            head, tail = tree.body[:-1], last.value
        else:
            head = tree.body

    figure_count = len(figures)
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            if head:
                exec(compile(ast.Module(body=head, type_ignores=[]), filename, "exec"), namespace)
            if tail is not None:
                ast.fix_missing_locations(tail)
                value = eval(compile(ast.Expression(body=tail), filename, "eval"), namespace)
                if value is not None:
                    outputs.append(
                        {
                            "data": {"text/plain": as_lines(repr(value))},
                            "execution_count": index + 1,
                            "metadata": {},
                            "output_type": "execute_result",
                        }
                    )
    except BaseException as error:  # noqa: BLE001 - every failure is recorded
        outputs.append(
            {
                "ename": type(error).__name__,
                "evalue": str(error),
                "output_type": "error",
                "traceback": [
                    line
                    for line in traceback.format_exception(type(error), error, error.__traceback__)
                    for line in line.rstrip("\n").split("\n")
                ],
            }
        )

    text = stdout.getvalue()
    if text:
        outputs.insert(0, {"name": "stdout", "output_type": "stream", "text": as_lines(text)})
    err = stderr.getvalue()
    if err:
        outputs.insert(0, {"name": "stderr", "output_type": "stream", "text": as_lines(err)})

    # Figures the cell left open are inlined, the way `%matplotlib inline` does.
    capture_figures(figures)
    for figure in figures[figure_count:]:
        outputs.append(
            {
                "data": {"image/png": figure["png"]},
                "metadata": {},
                "output_type": "display_data",
            }
        )
    del figures[figure_count:]
    return outputs


def capture_figures(figures: list[dict]) -> None:
    """Any figure a cell left open becomes a display_data output (like `%matplotlib inline`)."""
    try:
        import matplotlib.pyplot as plt

        for number in plt.get_fignums():
            buffer = io.BytesIO()
            plt.figure(number).savefig(buffer, format="png", bbox_inches="tight", dpi=110)
            figures.append({"png": base64.b64encode(buffer.getvalue()).decode("ascii")})
        plt.close("all")
    except ImportError:
        pass


def run_notebook(entry: dict, verbose: bool) -> tuple[dict, list[str], int]:
    notebook_path = ROOT / entry["path"]
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    directory = Path(tempfile.mkdtemp())
    failures: list[str] = []
    ran = 0
    figures: list[dict] = []
    previous = Path.cwd()
    try:
        for name, repo_path in (entry.get("data_files") or {}).items():
            shutil.copy(ROOT / repo_path, directory / name)
        os.chdir(directory)
        sys.path.insert(0, str(directory))
        namespace = make_namespace(figures)
        last_markdown = ""
        index = -1
        for cell in notebook.get("cells") or []:
            if cell.get("cell_type") == "markdown":
                last_markdown = source_of(cell)
                continue
            if cell.get("cell_type") != "code":
                continue
            index += 1
            code = source_of(cell)
            if not code.strip():
                cell["outputs"] = []
                cell["execution_count"] = None
                continue
            ran += 1
            outputs = run_cell(code, namespace, entry["path"], index, figures)
            cell["outputs"] = outputs
            cell["execution_count"] = index + 1
            errors = [o for o in outputs if o.get("output_type") == "error"]
            if errors and not is_expected_error(last_markdown):
                failures.append(f"cell {index}: {errors[0]['ename']}: {errors[0]['evalue']}")
                if verbose:
                    print("\n".join(errors[0]["traceback"]))
    finally:
        os.chdir(previous)
        if str(directory) in sys.path:
            sys.path.remove(str(directory))
        shutil.rmtree(directory, ignore_errors=True)
    return notebook, failures, ran


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--nb", default="*", help="shell-style pattern matched against the notebook path")
    parser.add_argument("--check", action="store_true", help="report only; do not write the notebooks")
    parser.add_argument("--verbose", action="store_true", help="print full tracebacks for failing cells")
    args = parser.parse_args()

    manifest = load_manifest()
    selected = [entry for entry in manifest["notebooks"] if fnmatch.fnmatch(entry["path"], args.nb)]
    if not selected:
        print(f"No notebook matches {args.nb!r}")
        return 1

    bad = 0
    for entry in selected:
        notebook, failures, ran = run_notebook(entry, args.verbose)
        label = entry.get("label") or entry["path"]
        with_outputs = sum(1 for cell in notebook["cells"] if cell.get("outputs"))
        if failures:
            bad += 1
            print(f"  FAIL {label}: {ran} cell(s) ran, then {failures[0]}")
            continue
        if not args.check:
            (ROOT / entry["path"]).write_text(
                json.dumps(notebook, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        print(f"  ok   {label}: {ran} cell(s) ran, {with_outputs} saved output(s)")

    print(f"\n{len(selected) - bad} of {len(selected)} notebook(s) ran cleanly.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
