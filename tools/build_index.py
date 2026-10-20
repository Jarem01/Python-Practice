#!/usr/bin/env python3
"""Build the manifests the static site reads.

    python3 tools/build_index.py            # write the manifests
    python3 tools/build_index.py --check    # validate only, exit 1 on errors

What it does
------------
1. Walks the repository for *.ipynb files, extracts titles, sizes, output cells
   and the exercises embedded in the notebook, then groups everything into
   parts (inferred from folder names / "Part N" prefixes, overridable in
   data/curriculum.json).
2. Reads every problem in problems/**/*.json and problems/**/*.md (hand checks
   next to problems/generated/, the exercises the upload page produces),
   validates them and bundles them into problems/index.json (one fetch for the
   practice app).
3. Cross-links problems and notebooks by topic.

Pure standard library, so it runs anywhere Python 3.8+ is available.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

#: The classes the site teaches, and which folders belong to each one. Editing
#: this file is how a second class is added: the build reads it, and the pages
#: fetch it to fill the class picker in the header.
COURSES_FILE = "data/courses.json"

#: Hand-written revision deck shown on flashcards.html.
FLASHCARDS_FILE = "data/flashcards.json"

#: Folder that collects the source study material, including files uploaded
#: from the website. Keep in sync with CONFIG.materialsDir in assets/js/config.js.
MATERIALS_DIR = "materials"

SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".ipynb_checkpoints",
    ".venv", "venv", "env", "site-packages", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", "dist", "build",
}

PROBLEM_TYPES = ("fix_the_code", "fill_in_blank", "predict_output", "write_from_scratch")
DIFFICULTIES = ("easy", "medium", "hard")
SOLUTION_POLICIES = ("shown", "hidden")

#: Short names used for the course labels on cards ("Intro 1", "Data Analysis 3").
#: Override per notebook with a "label" in data/curriculum.json.
SHORT_TRACK = {
    "Intro to Python": "Intro",
    "Introduction to Python": "Intro",
    "Python": "Intro",
    "Data Analysis": "Data Analysis",
}
EXERCISE_WORDS = re.compile(
    r"\b(exercise|exercises|task|tasks|assignment|practice|challenge|question|"
    r"probl[eè]me|aufgabe|übung|opgave|oppgave|teht[aä]v[aä]|"
    r"练习|习题|練習|問題|課題|연습)\b",
    re.IGNORECASE,
)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$", re.MULTILINE)
PART_RE = re.compile(
    r"(?:part|del|chapter|chap|lesson|week|module|lektion|kapitel|kapittel|"
    r"del|tema|主題|主题|章|課|课|第)\s*[-_ ]*(\d{1,2})",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def slugify(value: str) -> str:
    """Same algorithm as slugify() in assets/js/util.js — keep them in sync."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(value or "").lower().strip())).strip("-") or "section"


#: Course notebooks write inline HTML such as `8<sup>3</sup>` in markdown.
#: Titles and meta text must read as plain text ("8^3"), never as markup.
SUP_RE = re.compile(r"<sup[^>]*>(.*?)</sup>", re.IGNORECASE | re.DOTALL)
SUB_RE = re.compile(r"<sub[^>]*>(.*?)</sub>", re.IGNORECASE | re.DOTALL)
BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]*>")


def plain_text(value: str) -> str:
    """Markdown/HTML -> plain text, the same way plainText() does in assets/js/util.js."""
    # Markdown emphasis first, so the `_` that <sub> introduces is kept.
    text = re.sub(r"[*`_]", "", str(value or ""))
    text = SUP_RE.sub(r"^\1", text)
    text = SUB_RE.sub(r"_\1", text)
    text = BR_RE.sub(" ", text)
    text = TAG_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def cell_source(cell: dict) -> str:
    source = cell.get("source", "")
    if isinstance(source, list):
        return "".join(source)
    return str(source or "")


def text_outputs(cell: dict) -> list[str]:
    """Human-readable output blocks of a code cell (streams, results, errors)."""
    blocks: list[str] = []
    for output in cell.get("outputs") or []:
        kind = output.get("output_type")
        if kind == "stream":
            text = output.get("text", "")
            blocks.append("".join(text) if isinstance(text, list) else str(text))
        elif kind in ("execute_result", "display_data"):
            data = output.get("data") or {}
            if "text/plain" in data:
                text = data["text/plain"]
                blocks.append("".join(text) if isinstance(text, list) else str(text))
            elif "image/png" in data:
                blocks.append("[image output]")
        elif kind == "error":
            blocks.append("\n".join(output.get("traceback") or []))
    return [b for b in blocks if b and b.strip()]


def first_paragraph(markdown_text: str) -> str:
    for chunk in re.split(r"\n\s*\n", markdown_text):
        line = chunk.strip()
        if not line or line.startswith(("#", "!", "|", "```", "---")):
            continue
        cleaned = re.sub(r"[`*_>#\[\]]", "", line)
        cleaned = re.sub(r"\([^)]*\)", "", cleaned).strip()
        if len(cleaned) > 20:
            return cleaned[:220]
    return ""


def looks_like_exercise(heading_text: str, cell: dict, title: str = "") -> bool:
    """True for headings such as "Exercise 3", false for a notebook headline like
    "Data Analysis (Part 1) - ... - EXERCISE SOLUTIONS" or the notebook title."""
    tags = [str(t).lower() for t in ((cell.get("metadata") or {}).get("tags") or [])]
    if any("exercise" in t or "task" in t for t in tags):
        return True
    text = heading_text.strip()
    if title and text == title:
        return False
    if not EXERCISE_WORDS.search(text):
        return False
    # "Exercise 3" / "Übung 2" are exercises; long descriptive headlines are not.
    return bool(re.search(r"\d", text)) or len(text) <= 30


GENERIC_FOLDERS = {
    "notebooks", "notebook", "jupyter", "src", "python", "scripts", "code",
    "exercises", "lessons", "labs", "course", "class",
}


def norm_path(value: str) -> str:
    """Repository path the way the manifests spell them: forward slashes, no
    leading './' and no trailing slash. Empty means the repository root."""
    return str(value or "").replace("\\", "/").strip().strip("/").removeprefix("./")


# --------------------------------------------------------------------------- #
# courses
# --------------------------------------------------------------------------- #

def load_courses(root: Path) -> tuple[dict, list[str]]:
    """Read data/courses.json.

    Returns ({"default": id, "courses": [...]}, errors). The file is optional: a
    repository without it teaches one unnamed course, which is what this site
    was before a second class was added.
    """
    errors: list[str] = []
    path = root / COURSES_FILE
    if not path.exists():
        fallback = {
            "id": "default",
            "code": "Course",
            "title": "",
            "summary": "",
            "paths": [],
            "solutions": "shown",
            "phases": [],
            "groups": {},
        }
        return {"default": "default", "courses": [fallback], "helpers": []}, errors

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001
        return {"default": "default", "courses": [], "helpers": []}, [f"{COURSES_FILE}: invalid JSON ({error})"]

    courses: list[dict] = []
    seen: set[str] = set()
    for raw in data.get("courses") or []:
        if not isinstance(raw, dict):
            errors.append(f"{COURSES_FILE}: every course must be an object")
            continue
        course_id = slugify(raw.get("id") or raw.get("code") or "")
        if not course_id:
            errors.append(f"{COURSES_FILE}: a course is missing its id")
            continue
        if course_id in seen:
            errors.append(f"{COURSES_FILE}: duplicate course id '{course_id}'")
            continue
        seen.add(course_id)

        phases = []
        for phase in raw.get("phases") or []:
            if not isinstance(phase, dict):
                continue
            phases.append({
                "id": slugify(phase.get("id") or phase.get("title") or ""),
                "title": str(phase.get("title") or phase.get("id") or "").strip(),
                "summary": str(phase.get("summary") or "").strip(),
                "groups": [str(g) for g in (phase.get("groups") or [])],
            })

        policy = str(raw.get("solutions") or "shown").strip().lower()
        if policy not in SOLUTION_POLICIES:
            errors.append(
                f"{COURSES_FILE}: course '{course_id}' has solutions '{policy}' "
                f"(expected one of {', '.join(SOLUTION_POLICIES)})"
            )
            policy = "shown"

        groups = {}
        for name, config in (raw.get("groups") or {}).items():
            config = config if isinstance(config, dict) else {}
            groups[str(name)] = {
                "title": str(config.get("title") or name).strip(),
                "label": str(config.get("label") or "").strip(),
                "order": int(config.get("order") or 100),
            }

        private_paths = [norm_path(p) for p in (raw.get("private_paths") or []) if norm_path(p)]
        for path in private_paths:
            roots = [norm_path(p) for p in (raw.get("paths") or [])]
            if path in roots:
                errors.append(f"{COURSES_FILE}: course '{course_id}' marks its own root '{path}' private; name a subfolder instead")

        courses.append({
            "id": course_id,
            "code": str(raw.get("code") or course_id).strip(),
            "title": str(raw.get("title") or "").strip(),
            "summary": str(raw.get("summary") or "").strip(),
            "paths": [norm_path(p) for p in (raw.get("paths") or [])],
            "private_paths": private_paths,
            "solutions": policy,
            "phases": phases,
            "groups": groups,
            # Helper modules a class's files import (not material to teach from).
            "helpers": [str(name).strip() for name in (raw.get("helpers") or []) if str(name).strip()],
        })

    if not courses:
        errors.append(f"{COURSES_FILE}: no courses defined")
        return {"default": "default", "courses": [], "helpers": []}, errors

    roots = [c for c in courses if "" in c["paths"]]
    if len(roots) > 1:
        errors.append(
            f"{COURSES_FILE}: more than one course claims the repository root "
            f"({', '.join(c['id'] for c in roots)}); only one may leave 'paths' empty"
        )

    default = slugify(data.get("default") or courses[0]["id"])
    if default not in {c["id"] for c in courses}:
        errors.append(f"{COURSES_FILE}: default course '{default}' is not defined")
        default = courses[0]["id"]

    helpers = sorted({name for course in courses for name in course.get("helpers", [])})
    return {"default": default, "courses": courses, "helpers": helpers}, errors


def course_match(rel_path: str, courses: list[dict], default_id: str) -> tuple[str, str]:
    """The course a repository path belongs to, and the folder prefix that
    decided it. The longest matching prefix wins, so 'fin400/notebooks/x.ipynb'
    stays in FIN 400 even when another course claims the whole root."""
    text = norm_path(rel_path)
    best_id, best_prefix, best_len = default_id, "", -1
    for course in courses:
        for prefix in course["paths"]:
            if prefix == "":
                candidate = 0
            elif text == prefix or text.startswith(prefix + "/"):
                candidate = len(prefix)
            else:
                continue
            if candidate > best_len:
                best_id, best_prefix, best_len = course["id"], prefix, candidate
    return best_id, best_prefix


def course_folder(rel_path: str, prefix: str) -> str:
    """The folder just inside a course root ('fin400/bootcamp/loops.py' from the
    prefix 'fin400' -> 'bootcamp'). This is the group the file is listed under,
    so dropping a file into the right folder is all it takes to place it."""
    text = norm_path(rel_path)
    if prefix:
        text = text[len(prefix):].lstrip("/")
    parts = [part for part in text.split("/") if part]
    # parts[-1] is the file name; a file directly inside the course root has no
    # folder of its own.
    return parts[0] if len(parts) > 1 else ""


def infer_group(rel_path: Path) -> tuple[str, int]:
    """Guess which part/track a file belongs to. Returns (group, order).

    Rules, in order:
      1. A folder that names a part wins:  "Part 2 - Data/x.ipynb" -> ("Part 2", 2)
      2. A track name in front of "(Part N)":  "Intro to Python (Part 3) - x.ipynb"
         -> ("Intro to Python", 3)
      3. Files under materials/<track>/ group by that track.
      4. Otherwise the top folder (unless it is a generic container name).
    """
    parts = rel_path.parts

    if parts[0] == MATERIALS_DIR:
        return (parts[1], 100) if len(parts) > 2 else ("Course material", 100)

    for folder in parts[:-1]:
        match = PART_RE.search(folder)
        if match:
            return f"Part {int(match.group(1))}", int(match.group(1))

    stem = rel_path.stem
    match = PART_RE.search(stem)
    if match:
        number = int(match.group(1))
        prefix = re.sub(r"\s+", " ", stem[: match.start()].strip(" -_–—(.·|:")).strip()
        return (prefix, number) if prefix else (f"Part {number}", number)

    if len(parts) > 1 and parts[0].lower() not in GENERIC_FOLDERS:
        return parts[0], 100
    return "Notebooks", 999


# --------------------------------------------------------------------------- #
# notebooks
# --------------------------------------------------------------------------- #

NOTEBOOK_SKIP_DIRS = SKIP_DIRS | {"tools", "tests", "assets", ".github", "docs"}


def scan_notebooks(root: Path) -> list[dict]:
    notebooks = []
    for path in sorted(root.rglob("*.ipynb")):
        if any(part in NOTEBOOK_SKIP_DIRS or part.startswith(".") for part in path.relative_to(root).parts[:-1]):
            continue
        if path.name.startswith("."):
            continue
        rel = path.relative_to(root)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001 - report, do not crash the build
            print(f"  ! could not parse {rel}: {error}")
            continue

        cells = data.get("cells") or []
        markdown_cells = [c for c in cells if c.get("cell_type") == "markdown"]
        code_cells = [c for c in cells if c.get("cell_type") == "code"]

        title = ""
        for cell in markdown_cells:
            match = HEADING_RE.search(cell_source(cell))
            if match and match.group(1) == "#":
                title = plain_text(match.group(2))
                break

        # The notebook headline ("... - EXERCISE SOLUTIONS") is not an exercise.
        title_headings = {title} if title else set()

        exercises = []
        for index, cell in enumerate(cells):
            if cell.get("cell_type") != "markdown":
                continue
            source = cell_source(cell)
            for match in HEADING_RE.finditer(source):
                heading = plain_text(match.group(2))
                if looks_like_exercise(heading, cell, title) and heading not in title_headings:
                    exercises.append({
                        "index": index,
                        "title": heading,
                        "anchor": slugify(heading),
                    })

        summary = ""
        if markdown_cells:
            summary = plain_text(first_paragraph(cell_source(markdown_cells[0])))

        group, order = infer_group(rel)
        kind = "material" if rel.parts[0] == MATERIALS_DIR else "notebook"
        kernel = (((data.get("metadata") or {}).get("kernelspec") or {}).get("display_name")
                  or ((data.get("metadata") or {}).get("language_info") or {}).get("name")
                  or "")

        notebooks.append({
            "id": slugify(str(rel.with_suffix(""))),
            "path": str(rel).replace("\\", "/"),
            "filename": rel.name,
            "kind": kind,
            "title": title or rel.stem.replace("_", " ").replace("-", " ").strip(),
            "group": group,
            "group_order": order,
            "kernel": kernel,
            "summary": summary,
            "cell_count": len(cells),
            "code_cell_count": len(code_cells),
            "markdown_cell_count": len(markdown_cells),
            "output_cell_count": sum(1 for c in code_cells if text_outputs(c)),
            "exercises": exercises,
            "inferred_topics": [],
            "matched_topics": [],
            "bytes": path.stat().st_size,
        })
    return notebooks


PY_SKIP_DIRS = SKIP_DIRS | {"tools", "tests", "assets", ".github", "docs"}

#: Helper modules that ship with the notebooks (Data Analysis 5 does
#: `from analyticskit import *`). They are support files, not course material, so
#: they are never listed as a script to teach from.
PY_HELPER_FILES = {"analyticskit.py"}

DOCSTRING_RE = re.compile(r'^\s*("""|\'\'\')(.*?)\1', re.DOTALL)
DEF_RE = re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+(\w+)", re.MULTILINE)
EXERCISE_COMMENT_RE = re.compile(
    r"^\s*#\s*-*\s*(exercise|task|practice|challenge|question|aufgabe|übung|opgave|"
    r"ödev|练习|习题|練習|問題|課題)\s*(\d+)?",
    re.IGNORECASE | re.MULTILINE,
)


def analyze_python(path: Path, rel: Path) -> dict:
    """Summarize a .py file the same way a notebook is summarized."""
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    title, summary = "", ""
    doc = DOCSTRING_RE.match(text)
    if doc:
        block = [line.strip() for line in doc.group(2).strip().splitlines() if line.strip()]
        if block:
            title = block[0][:120]
            summary = " ".join(block[1:4])[:220]
    if not title:
        for line in lines[:12]:
            comment = re.match(r"\s*#\s*(.+)", line)
            if comment:
                title = comment.group(1).strip()[:120]
                break

    exercises = []
    for match in EXERCISE_COMMENT_RE.finditer(text):
        label = f"{match.group(1).capitalize()} {match.group(2) or ''}".strip()
        exercises.append({
            "index": text[: match.start()].count("\n") + 1,
            "title": label,
            "anchor": slugify(label),
        })

    group, order = infer_group(rel)
    return {
        "id": slugify(str(rel.with_suffix(""))),
        "path": str(rel).replace("\\", "/"),
        "filename": rel.name,
        "kind": "script",
        "title": title or rel.stem.replace("_", " ").replace("-", " ").strip(),
        "group": group,
        "group_order": order,
        "summary": summary,
        "line_count": len(lines),
        "code_lines": sum(1 for line in lines if line.strip() and not line.strip().startswith("#")),
        "definitions": DEF_RE.findall(text)[:80],
        "exercises": exercises,
        "inferred_topics": [],
        "matched_topics": [],
        "bytes": path.stat().st_size,
    }


def scan_scripts(root: Path, helper_files: set[str] | None = None) -> list[dict]:
    """Every .py file that is course material rather than part of the site itself.

    `helper_files` are modules the class files import (a course can list its own
    in data/courses.json → helpers); they are support files, never lessons.
    """
    helpers = set(PY_HELPER_FILES) | {str(name) for name in (helper_files or set())}
    scripts = []
    for path in sorted(root.rglob("*.py")):
        if path.name in helpers:
            # analyticskit.py and friends are imported by the notebooks: support
            # files, not scripts to teach from.
            continue
        rel = path.relative_to(root)
        if any(part in PY_SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            continue
        if path.name.startswith("."):
            continue
        try:
            scripts.append(analyze_python(path, rel))
        except Exception as error:  # noqa: BLE001
            print(f"  ! could not read {rel}: {error}")
    return scripts


def assign_courses(entries: list[dict], registry: dict) -> None:
    """Put every notebook and script in a class, and in the folder-group the
    course config describes for it.

    Dropping 'fin400/bootcamp/loops.py' into the repository is enough to place
    it: the path decides the class, the first folder inside the class decides
    the group, and data/courses.json decides how that group is titled.
    """
    courses = registry["courses"]
    for entry in entries:
        course_id, prefix = course_match(entry["path"], courses, registry["default"])
        entry["course"] = course_id
        folder = course_folder(entry["path"], prefix)
        entry["course_folder"] = folder
        course = next((c for c in courses if c["id"] == course_id), None)
        if not course or not folder or not course["paths"]:
            continue
        entry["group"] = folder
        described = course["groups"].get(folder)
        entry["group_order"] = described["order"] if described else 100 + len(course["groups"])


def assign_phases(entries: list[dict], registry: dict) -> None:
    """The half of the course each file belongs to ('bootcamp', 'analysis', …).

    A file is put in a phase when its group is listed in that phase; anything a
    course has not described yet lands in the first phase instead of vanishing
    from the practice list.
    """
    courses = {course["id"]: course for course in registry["courses"]}
    for entry in entries:
        course = courses.get(entry.get("course"))
        phase = ""
        if course:
            for candidate in course["phases"]:
                if entry.get("group") in candidate["groups"]:
                    phase = candidate["id"]
                    break
            if not phase and course["phases"]:
                phase = course["phases"][0]["id"]
        entry["phase"] = phase


def course_for_entries(registry: dict) -> dict[str, dict]:
    return {course["id"]: course for course in registry["courses"]}


def apply_course_policy(problems: list[dict], entries: list[dict], registry: dict) -> list[str]:
    """Give every problem its class, its phase and its solution policy.

    A problem belongs to the class of its notebook unless it says otherwise, and
    when a class hides solutions the reference answer is removed from the bundle
    altogether — the exercise page cannot show what it never received.
    """
    errors: list[str] = []
    courses = course_for_entries(registry)
    by_path = {entry["path"]: entry for entry in entries}

    for problem in problems:
        source = problem.get("_source", "?")
        notebook = by_path.get(norm_path(problem.get("notebook"))) if problem.get("notebook") else None
        course_id = slugify(problem.get("course") or (notebook or {}).get("course") or registry["default"])
        course = courses.get(course_id)
        if not course:
            errors.append(f"{source}: problem '{problem.get('id')}' names unknown course '{course_id}'")
            course_id, course = registry["default"], courses.get(registry["default"])
        if notebook and notebook.get("course") != course_id:
            errors.append(
                f"{source}: problem '{problem.get('id')}' is in {course_id} but its notebook "
                f"'{notebook['path']}' belongs to {notebook.get('course')}"
            )
        problem["course"] = course_id

        phase = str(problem.get("phase") or "")
        known = [p["id"] for p in (course or {}).get("phases", [])]
        if phase and known and phase not in known:
            errors.append(
                f"{source}: problem '{problem.get('id')}' has phase '{phase}', "
                f"which {course_id} does not define ({', '.join(known)})"
            )
            phase = ""
        problem["phase"] = phase or (notebook or {}).get("phase") or (known[0] if known else "")

        problem["solutions"] = (course or {}).get("solutions", "shown")
        if problem["solutions"] == "hidden":
            problem.pop("solution", None)
    return errors


def infer_topics(notebook: dict, root: Path, topics: list[str]) -> None:
    """Topics (from the problems) that this file seems to cover."""
    haystack = " ".join([notebook["title"], notebook["path"]]).lower()
    try:
        text = (root / notebook["path"]).read_text(encoding="utf-8")
        if notebook.get("kind") == "script":
            extra = text.lower()
        else:
            data = json.loads(text)
            extra = " ".join(
                cell_source(c)[:2000] for c in (data.get("cells") or [])
                if c.get("cell_type") == "markdown"
            ).lower()
        haystack += " " + extra[:20000]
    except Exception:  # noqa: BLE001
        pass

    matched = [t for t in topics if t and t.lower() in haystack]
    words = {w for w in re.split(r"[^a-z0-9+#]+", " ".join([notebook["title"], notebook["filename"]]).lower()) if len(w) > 3}
    for topic in topics:
        if topic in matched:
            continue
        if any(word in words for word in re.split(r"[^a-z0-9+#]+", topic.lower()) if len(word) > 3):
            matched.append(topic)
    notebook["inferred_topics"] = sorted({t for t in topics if t.lower() in haystack.lower()})
    notebook["matched_topics"] = sorted(set(matched))


# --------------------------------------------------------------------------- #
# problems
# --------------------------------------------------------------------------- #

def parse_front_matter(text: str) -> tuple[dict, str]:
    """Minimal YAML-ish front matter: `key: value`, `key: [a, b]`, `key: |` blocks."""
    if not text.lstrip().startswith("---"):
        return {}, text
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "---")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text

    meta: dict = {}
    key = None
    block: list[str] = []
    for raw in lines[start + 1:end]:
        if key and block is not None and (raw.startswith((" ", "\t")) or not raw.strip()):
            block.append(raw.strip() if raw.strip() else "")
            continue
        if key and block:
            meta[key] = "\n".join(block).rstrip() + "\n"
            block = []
        line = raw.rstrip()
        if not line.strip() or ":" not in line:
            continue
        name, _, value = line.partition(":")
        name = name.strip()
        value = value.strip()
        if value in ("|", ">"):
            key, block = name, [""]
            continue
        key = None
        if value.startswith("[") and value.endswith("]"):
            meta[name] = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
        elif value.lower() in ("true", "false"):
            meta[name] = value.lower() == "true"
        elif value == "":
            meta[name] = []
            key = name
            block = []
        else:
            meta[name] = value.strip("'\"")
    if key and block:
        meta[key] = "\n".join(block).rstrip() + "\n"
    return meta, "\n".join(lines[end + 1:])


def parse_md_problem(text: str, source: Path) -> dict:
    meta, body = parse_front_matter(text)
    problem: dict = dict(meta)

    sections: dict[str, str] = {}
    current = "_prompt"
    buffer: list[str] = []
    for line in body.splitlines():
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match:
            sections[current] = "\n".join(buffer).strip()
            current = match.group(1).strip().lower().replace(" ", "_")
            buffer = []
        else:
            buffer.append(line)
    sections[current] = "\n".join(buffer).strip()

    problem["prompt"] = sections.get("_prompt", "")

    def unfence(text_value: str) -> str:
        match = re.search(r"```(?:python|py)?\s*\n([\s\S]*?)```", text_value)
        return (match.group(1) if match else text_value).rstrip() + ("\n" if (match or text_value) else "")

    for field in ("starter_code", "solution", "tests", "setup", "expected_output"):
        if field in sections:
            value = sections[field]
            problem[field] = unfence(value) if field != "expected_output" else value.strip("\n")

    if "hints" in sections:
        hints = [re.sub(r"^[-*]\s+", "", line).strip()
                 for line in sections["hints"].splitlines() if line.strip()]
        problem["hints"] = [h for h in hints if h]

    problem.setdefault("id", slugify(source.stem))
    problem["_source"] = str(source)
    return problem


def load_problems(root: Path) -> tuple[list[dict], list[str]]:
    problems: list[dict] = []
    errors: list[str] = []

    for path in sorted((root / "problems").rglob("*.json")):
        if path.name == "index.json" or any(part.startswith(".") for part in path.parts):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001
            errors.append(f"{path.name}: invalid JSON ({error})")
            continue
        items = data.get("problems") if isinstance(data, dict) and "problems" in data else data
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            errors.append(f"{path.name}: expected an object, an array or a {{'problems': [...]}} wrapper")
            continue
        for item in items:
            if not isinstance(item, dict):
                errors.append(f"{path.name}: every entry must be an object")
                continue
            item = dict(item)
            item["_source"] = path.name
            problems.append(item)

    for path in sorted((root / "problems").rglob("*.md")):
        try:
            problems.append(parse_md_problem(path.read_text(encoding="utf-8"), path))
        except Exception as error:  # noqa: BLE001
            errors.append(f"{path.name}: could not parse markdown problem ({error})")

    return problems, errors


def validate_problems(problems: list[dict], glossary_slugs: set[str], notebook_paths: set[str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    seen: dict[str, str] = {}

    for problem in problems:
        where = problem.get("_source", "?")
        pid = str(problem.get("id", "")).strip()
        if not pid:
            errors.append(f"{where}: a problem is missing its 'id'")
            continue
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", pid):
            errors.append(f"{where}: id '{pid}' must be lowercase letters, digits and dashes")
        if pid in seen:
            errors.append(f"{where}: duplicate id '{pid}' (already defined in {seen[pid]})")
        seen[pid] = where

        ptype = problem.get("type")
        if ptype not in PROBLEM_TYPES:
            errors.append(f"{where}: problem '{pid}' has unknown type '{ptype}' (expected one of {', '.join(PROBLEM_TYPES)})")
            continue

        if not problem.get("title"):
            warnings.append(f"{where}: problem '{pid}' has no title")
        if not str(problem.get("prompt", "")).strip():
            errors.append(f"{where}: problem '{pid}' has an empty prompt")

        difficulty = problem.get("difficulty", "easy")
        if difficulty not in DIFFICULTIES:
            warnings.append(f"{where}: problem '{pid}' has difficulty '{difficulty}' (expected {'/'.join(DIFFICULTIES)})")

        if ptype in ("fix_the_code", "fill_in_blank") and not str(problem.get("starter_code", "")).strip():
            errors.append(f"{where}: problem '{pid}' ({ptype}) needs 'starter_code'")

        if ptype == "fill_in_blank":
            blanks = len(re.findall(r"_{3,}", str(problem.get("starter_code", ""))))
            declared = len(problem.get("blanks") or [])
            if blanks == 0:
                errors.append(f"{where}: problem '{pid}' has no ___ blank in starter_code")
            if declared and declared != blanks:
                warnings.append(f"{where}: problem '{pid}' declares {declared} blanks but starter_code has {blanks}")

        if ptype == "predict_output" and problem.get("expected_output") is None:
            errors.append(f"{where}: problem '{pid}' (predict_output) needs 'expected_output'")

        if ptype == "write_from_scratch" and not (problem.get("tests") or problem.get("expected_output")):
            errors.append(f"{where}: problem '{pid}' (write_from_scratch) needs 'tests' or 'expected_output'")

        if ptype in ("fix_the_code", "write_from_scratch") and not (problem.get("tests") or problem.get("expected_output")):
            warnings.append(f"{where}: problem '{pid}' has nothing to check against (no tests, no expected_output)")

        notebook = problem.get("notebook")
        if notebook and notebook not in notebook_paths:
            warnings.append(f"{where}: problem '{pid}' references notebook '{notebook}' which was not found")

        for slug in problem.get("glossary") or []:
            if slug not in glossary_slugs:
                warnings.append(f"{where}: problem '{pid}' links to unknown glossary term '{slug}'")

    return errors, warnings


def validate_flashcards(root: Path, course_ids: set[str]) -> tuple[int, list[str], list[str]]:
    """Check data/flashcards.json: every card needs a method, a description, a
    call and the output that call prints.

    The output itself is proved by tests/test_flashcards.py, which runs each
    card's code; here we only make sure the shape is right, so `--check` catches
    a missing field before the page does.
    """
    errors: list[str] = []
    warnings: list[str] = []
    path = root / FLASHCARDS_FILE
    if not path.exists():
        return 0, errors, warnings
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001
        return 0, [f"{FLASHCARDS_FILE}: invalid JSON ({error})"], warnings

    cards = data.get("cards")
    if not isinstance(cards, list):
        return 0, [f"{FLASHCARDS_FILE}: 'cards' must be a list"], warnings

    seen_ids: set[str] = set()
    seen_methods: dict[str, str] = {}
    for index, card in enumerate(cards, start=1):
        where = f"{FLASHCARDS_FILE} card {index}"
        if not isinstance(card, dict):
            errors.append(f"{where}: every card must be an object")
            continue
        cid = str(card.get("id") or "").strip()
        if not cid:
            errors.append(f"{where}: a card is missing its 'id'")
        else:
            if cid in seen_ids:
                errors.append(f"{where}: duplicate card id '{cid}'")
            seen_ids.add(cid)
        where = f"{FLASHCARDS_FILE} card '{cid or index}'"
        for field in ("method", "library", "assignment", "does", "call"):
            if not str(card.get(field) or "").strip():
                errors.append(f"{where}: missing '{field}'")
        if not isinstance(card.get("output"), str):
            errors.append(f"{where}: 'output' must be a string (the text the call prints)")
        if card.get("setup") is not None and not isinstance(card.get("setup"), str):
            errors.append(f"{where}: 'setup' must be a string of code")
        if not isinstance(card.get("topics"), list) or not card.get("topics"):
            errors.append(f"{where}: 'topics' must be a non-empty list")
        courses = card.get("courses")
        if courses is not None:
            if not isinstance(courses, list) or not courses:
                errors.append(f"{where}: 'courses' must be a list of course ids (or left out)")
            else:
                for course_id in courses:
                    if course_id not in course_ids:
                        errors.append(f"{where}: names unknown class '{course_id}'")
        method = str(card.get("method") or "").strip()
        if method:
            key = method.lower()
            if key in seen_methods:
                warnings.append(f"{where}: the same method already has a card ('{seen_methods[key]}')")
            seen_methods[key] = cid or method

    libraries = {str(card.get("library")) for card in cards if isinstance(card, dict) and card.get("library")}
    if cards and not libraries:
        warnings.append(f"{FLASHCARDS_FILE}: no card names a library, so the library filter has nothing to show")
    return len(cards), errors, warnings


def private_prefixes(registry: dict) -> list[tuple[str, str]]:
    """(class id, path) for every folder a class keeps off the site."""
    return [
        (course["id"], path)
        for course in registry["courses"]
        for path in course.get("private_paths", [])
    ]


def private_owner(rel_path: str, prefixes: list[tuple[str, str]]) -> str | None:
    """The class hiding this repository path, or None when it is published."""
    path = norm_path(rel_path)
    if not path:
        return None
    for owner, prefix in prefixes:
        if path == prefix or path.startswith(prefix + "/"):
            return owner
    return None


def normalize_problem(problem: dict) -> dict:
    """Fill defaults and drop build-only keys."""
    out = dict(problem)
    out.pop("_source", None)
    out.setdefault("difficulty", "easy")
    out.setdefault("topics", [])
    out.setdefault("hints", [])
    out.setdefault("glossary", [])
    out.setdefault("packages", [])
    if out.get("type") == "write_from_scratch":
        out.setdefault("mode", "both")
    if isinstance(out.get("topics"), str):
        out["topics"] = [out["topics"]]
    for key in ("hints", "topics", "glossary", "packages"):
        if not isinstance(out[key], list):
            out[key] = [out[key]]
    return out


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser(description="Build data/notebooks.json and problems/index.json")
    parser.add_argument("--root", default=str(REPO_ROOT), help="repository root (default: parent of tools/)")
    parser.add_argument("--check", action="store_true", help="validate only, do not write files")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    log = (lambda *a: None) if args.quiet else print

    log(f"Scanning {root} …")
    registry, course_errors = load_courses(root)
    hidden_prefixes = private_prefixes(registry)
    scanned_notebooks = scan_notebooks(root)
    scanned_scripts = scan_scripts(root, set(registry.get("helpers") or []))
    # A class can keep folders off the site (answer keys, model solutions).
    # Those files stay in the repository but never reach a manifest, a page or
    # the published folder — tools/assemble_site.py removes them from _site too.
    notebooks = [entry for entry in scanned_notebooks if not private_owner(entry["path"], hidden_prefixes)]
    scripts = [entry for entry in scanned_scripts if not private_owner(entry["path"], hidden_prefixes)]
    held_back = (len(scanned_notebooks) + len(scanned_scripts)) - (len(notebooks) + len(scripts))
    entries = notebooks + scripts
    assign_courses(entries, registry)
    log(f"  {len(notebooks)} notebook(s), {len(scripts)} python script(s)")
    if held_back:
        log(f"  {held_back} file(s) in a private folder are kept out of the site")
    log("  classes: " + ", ".join(f"{course['code']} ({course['id']})" for course in registry["courses"]))

    glossary = {"entries": []}
    glossary_path = root / "data" / "glossary.json"
    if glossary_path.exists():
        glossary = json.loads(glossary_path.read_text(encoding="utf-8"))
    glossary_slugs = set()
    for entry in glossary.get("entries", []):
        glossary_slugs.add(slugify(entry["term"]))
        for alias in entry.get("aliases", []) or []:
            glossary_slugs.add(slugify(alias))

    flashcard_count, flashcard_errors, flashcard_warnings = validate_flashcards(
        root, {course["id"] for course in registry["courses"]}
    )
    log(f"  {flashcard_count} flashcard(s)")

    raw_problems, load_errors = load_problems(root)
    log(f"  {len(raw_problems)} problem definition(s)")

    all_topics = sorted({topic for problem in raw_problems for topic in (problem.get("topics") or [])})
    for entry in entries:
        infer_topics(entry, root, all_topics)

    errors, warnings = validate_problems(raw_problems, glossary_slugs, {entry["path"] for entry in entries})
    problems_from_private = [
        problem
        for problem in raw_problems
        if private_owner(problem.get("notebook") or "", hidden_prefixes)
    ]
    for problem in problems_from_private:
        errors.append(
            f"{problem.get('_source', '?')}: problem '{problem.get('id')}' is built from "
            f"private material '{problem.get('notebook')}', which the class keeps off the site"
        )
    errors = course_errors + load_errors + flashcard_errors + errors
    warnings = flashcard_warnings + warnings

    # Every notebook in the course should have practice exercises of its own:
    # the site tells the learner when a section is missing them instead of
    # silently showing nothing to do.
    problem_notebooks = {str(p.get("notebook") or "") for p in raw_problems}
    for entry in entries:
        if entry.get("kind") == "script":
            continue
        if entry["path"] not in problem_notebooks:
            warnings.append(
                f"{entry['path']}: no practice exercises reference this notebook yet "
                f"(add them under problems/ with \"notebook\": \"{entry['path']}\")"
            )

    problems = [normalize_problem(p) for p in raw_problems]

    # Which class is this exercise for, which half of it, and may its solution
    # be shown? This also strips the reference answer of a class that hides
    # solutions, so it can never reach the browser.
    assign_phases(entries, registry)
    errors += apply_course_policy(problems, entries, registry)
    courses_by_id = course_for_entries(registry)
    for entry in entries:
        course = courses_by_id.get(entry.get("course")) or {}
        known = [phase["id"] for phase in course.get("phases", [])]
        if known and entry.get("group") not in {
            group for phase in course.get("phases", []) for group in phase.get("groups", [])
        }:
            warnings.append(
                f"{entry['path']}: group '{entry.get('group')}' is not listed in any phase of "
                f"{course.get('code', entry.get('course'))} — add it to data/courses.json "
                f"(phases → groups) to place this file in a half of the course"
            )

    # topic -> problem ids, and topic -> notebook paths (for cross-linking)
    topic_index: dict[str, dict[str, list[str]]] = {}
    for problem in problems:
        for topic in problem.get("topics", []):
            bucket = topic_index.setdefault(topic, {"problems": [], "notebooks": []})
            bucket["problems"].append(problem["id"])
    for entry in entries:
        for topic in entry.get("matched_topics", []):
            bucket = topic_index.setdefault(topic, {"problems": [], "notebooks": []})
            bucket["notebooks"].append(entry["path"])

    # groups
    curriculum_path = root / "data" / "curriculum.json"
    curriculum = {}
    if curriculum_path.exists():
        try:
            curriculum = json.loads(curriculum_path.read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001
            errors.append(f"data/curriculum.json: invalid JSON ({error})")

    overrides = curriculum.get("notebook_overrides", {}) if isinstance(curriculum, dict) else {}
    for entry in entries:
        override = overrides.get(entry["path"]) or {}
        for key in ("title", "group", "group_order"):
            if override.get(key) is not None:
                entry[key] = override[key]
        if override.get("topics"):
            entry["matched_topics"] = sorted(set(override["topics"]))
        # Part number: an explicit "order" wins, otherwise it is read from the
        # file name ("... (Part 5) ...") so parts always sort 1, 2, 3 …
        part = override.get("order")
        if part is None:
            match = PART_RE.search(entry["filename"]) or PART_RE.search(entry["title"])
            part = int(match.group(1)) if match else 999
        entry["part"] = int(part)
        # Short course label shown on cards and used to group exercises
        # ("Intro 1", "Data Analysis 3") — derived from the group when absent.
        # A class that describes its own folders in data/courses.json names the
        # group itself, because 'bootcamp' is a folder name, not a label.
        label = override.get("label")
        course_group = (courses_by_id.get(entry.get("course")) or {}).get("groups", {}).get(entry.get("course_folder", ""))
        if not label and course_group:
            label = course_group.get("label") or course_group.get("title") or str(entry["group"])
        if not label:
            group_name = str(entry["group"])
            short = SHORT_TRACK.get(group_name, group_name)
            label = f"{short} {entry['part']}" if entry["part"] != 999 else short
        entry["label"] = str(label)
        if override.get("packages"):
            packages = override["packages"]
            entry["packages"] = [str(p) for p in packages] if isinstance(packages, list) else [str(packages)]
        else:
            entry["packages"] = []
        data_files = override.get("data_files") or {}
        if not isinstance(data_files, dict):
            errors.append(f"data/curriculum.json: data_files for '{entry['path']}' must be an object")
            data_files = {}
        entry["data_files"] = {str(k): str(v) for k, v in data_files.items()}
        for name, repo_path in entry["data_files"].items():
            if not (root / repo_path).exists():
                warnings.append(f"data/curriculum.json: '{entry['path']}' wants {name} from '{repo_path}', which does not exist yet")

    # A curriculum override may move a file into another group, so the phase is
    # decided after the overrides have been applied.
    assign_phases(entries, registry)

    group_order: dict[str, int] = {}
    for entry in entries:
        order = entry.get("group_order", 999)
        group = entry["group"]
        group_order[group] = min(group_order.get(group, order), order)
    for group in (curriculum.get("group_titles", {}) if isinstance(curriculum, dict) else {}):
        group_order.setdefault(group, 100)

    def by_order(items):
        # Course order: group first (Intro before Data Analysis), then the part
        # number, so "Part 10" never sorts before "Part 2".
        return sorted(
            items,
            key=lambda item: (item.get("group_order", 999), item.get("part", 999), item["filename"].lower()),
        )

    course_titles = {
        name: config["title"]
        for course in registry["courses"]
        for name, config in course["groups"].items()
    }
    groups: list[dict] = []
    for group in sorted(group_order, key=lambda g: (group_order[g], g)):
        members = by_order([entry for entry in entries if entry["group"] == group])
        groups.append({
            "name": group,
            "title": (curriculum.get("group_titles", {}) or {}).get(group) or course_titles.get(group, group),
            "order": group_order[group],
            "notebooks": [n["path"] for n in members if n.get("kind") != "script"],
            "scripts": [n["path"] for n in members if n.get("kind") == "script"],
        })

    manifest = {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "root": root.name,
        "totals": {
            "notebooks": len(notebooks),
            "scripts": len(scripts),
            "cells": sum(n["cell_count"] for n in notebooks),
            "exercises": sum(len(n["exercises"]) for n in entries),
            "problems": len(problems),
            "topics": len(topic_index),
        },
        "courses": [
            {
                "id": course["id"],
                "code": course["code"],
                "title": course["title"],
                "paths": course["paths"],
                "private_paths": course["private_paths"],
                "solutions": course["solutions"],
                "phases": course["phases"],
                "groups": course["groups"],
                "totals": {
                    "notebooks": sum(1 for e in notebooks if e.get("course") == course["id"]),
                    "scripts": sum(1 for e in scripts if e.get("course") == course["id"]),
                    "exercises": sum(len(e.get("exercises", [])) for e in entries if e.get("course") == course["id"]),
                    "problems": sum(1 for p in problems if p.get("course") == course["id"]),
                },
            }
            for course in registry["courses"]
        ],
        "groups": groups,
        "notebooks": by_order(notebooks),
        "scripts": by_order(scripts),
        "topics": {name: bucket for name, bucket in sorted(topic_index.items())},
    }

    bundle = {
        "generated_at": manifest["generated_at"],
        "count": len(problems),
        "courses": [
            {
                "id": course["id"],
                "code": course["code"],
                "count": sum(1 for p in problems if p.get("course") == course["id"]),
                "solutions": course["solutions"],
            }
            for course in registry["courses"]
        ],
        "by_type": {t: sum(1 for p in problems if p.get("type") == t) for t in PROBLEM_TYPES},
        "topics": sorted({t for p in problems for t in p.get("topics", [])}),
        "difficulties": {d: sum(1 for p in problems if p.get("difficulty") == d) for d in DIFFICULTIES},
        "problems": problems,
    }

    for warning in warnings:
        print(f"  warning: {warning}")
    for error in errors:
        print(f"  ERROR: {error}")

    if args.check:
        print(f"\nCheck finished: {len(errors)} error(s), {len(warnings)} warning(s).")
        return 1 if errors else 0

    if errors:
        print(f"\nNot writing manifests: {len(errors)} error(s) must be fixed first.")
        return 1

    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "notebooks.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (root / "problems" / "index.json").write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")

    if not curriculum_path.exists():
        template = {
            "_comment": "Optional manual overrides for the generated index. Re-run tools/build_index.py after editing.",
            "group_titles": {group["name"]: group["title"] for group in groups},
            "group_order": {group["name"]: group["order"] for group in groups},
            "notebook_overrides": {
                entry["path"]: {"title": entry["title"], "group": entry["group"], "group_order": entry["group_order"]}
                for entry in entries
            },
        }
        curriculum_path.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")
        log("  wrote data/curriculum.json (starter file for manual grouping)")

    log(f"  wrote data/notebooks.json  ({len(notebooks)} notebooks, {len(scripts)} scripts, {len(groups)} groups)")
    log(f"  wrote problems/index.json  ({len(problems)} problems)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
