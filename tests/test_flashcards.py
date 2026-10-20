"""The flashcard deck: the schema, and the claim on every card's back.

A card is only useful if its output is real, so this runs each card's `setup`
and `call` in a throwaway interpreter namespace and compares what it printed
with the `output` stored on the card. A card whose library is not installed
is skipped here (CI installs requirements.txt, so it runs there).
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLASHCARDS = ROOT / "data" / "flashcards.json"
COURSES = ROOT / "data" / "courses.json"

IMPORT_RE = re.compile(r"^\s*(?:import|from)\s+([A-Za-z_][\w.]*)", re.MULTILINE)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def modules_needed(card: dict) -> set[str]:
    text = "\n".join([card.get("setup") or "", card.get("call") or ""])
    return {name.split(".")[0] for name in IMPORT_RE.findall(text)}


def available(module: str) -> bool:
    if module in sys.stdlib_module_names or module in {"__future__"}:
        return True
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def normalise(text: str) -> str:
    """Compare output without depending on column alignment of a DataFrame."""
    text = str(text).replace("\r\n", "\n").strip("\n")
    return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n"))


def run_card(card: dict) -> str:
    buffer = io.StringIO()
    namespace: dict = {}
    with tempfile.TemporaryDirectory() as tmp:
        previous = os.getcwd()
        os.chdir(tmp)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                with contextlib.redirect_stdout(buffer):
                    exec(card.get("setup") or "", namespace)  # noqa: S102 - trusted course file
                    exec(card["call"], namespace)  # noqa: S102 - trusted course file
        finally:
            os.chdir(previous)
    return buffer.getvalue()


class FlashcardDeckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load(FLASHCARDS)
        cls.cards = cls.data.get("cards") or []
        cls.courses = {course["id"] for course in load(COURSES).get("courses", [])}

    def test_the_deck_has_cards(self):
        self.assertGreaterEqual(len(self.cards), 1, "data/flashcards.json has no cards")

    def test_every_card_says_what_it_does_and_shows_a_call_and_an_output(self):
        ids = set()
        for card in self.cards:
            with self.subTest(card=card.get("id")):
                for field in ("id", "method", "library", "assignment", "does", "call"):
                    self.assertIsInstance(card.get(field), str, f"{field} must be a string")
                    self.assertTrue(card.get(field, "").strip(), f"{field} must not be empty")
                self.assertIsInstance(card.get("output"), str, "output must be a string")
                self.assertTrue(card.get("output", "").strip(), "output must not be empty")
                self.assertGreaterEqual(len(card["does"]), 20, "the description is not a sentence")
                self.assertNotIn(card["id"], ids, "card ids must be unique")
                ids.add(card["id"])
                self.assertRegex(card["library"], r"^[a-z0-9][a-z0-9-]*$", "library must be a short id")
                self.assertIsInstance(card.get("topics"), list)
                self.assertTrue(card["topics"], "every card needs at least one topic")
                self.assertTrue(all(isinstance(topic, str) and topic.strip() for topic in card["topics"]))

    def test_cards_name_a_known_class_or_share_themselves_with_every_class(self):
        for card in self.cards:
            with self.subTest(card=card.get("id")):
                courses = card.get("courses")
                if courses is None:
                    continue
                self.assertIsInstance(courses, list)
                for course_id in courses:
                    self.assertIn(course_id, self.courses, f"{card['id']} names an unknown class")

    def test_the_output_on_every_card_is_what_its_code_prints(self):
        for card in self.cards:
            with self.subTest(card=card.get("id")):
                missing = sorted(module for module in modules_needed(card) if not available(module))
                if missing:
                    self.skipTest(f"needs {', '.join(missing)}, which is not installed here")
                actual = run_card(card)
                self.assertEqual(
                    normalise(actual),
                    normalise(card["output"]),
                    f"the output on '{card['id']}' is not what its call prints",
                )

    def test_cards_are_filed_under_a_library_and_a_few_topics(self):
        libraries = {card["library"] for card in self.cards}
        self.assertTrue({"python", "pandas"} <= libraries, "the deck covers the bootcamp and pandas")
        topics = {topic for card in self.cards for topic in card["topics"]}
        self.assertGreaterEqual(len(topics), 3, "topics are what the deck is filtered by")

    def test_every_card_in_the_deck_can_be_grouped_by_assignment(self):
        assignments = {card["assignment"] for card in self.cards}
        self.assertGreaterEqual(len(assignments), 1)
        for assignment in assignments:
            self.assertTrue(assignment.strip(), "an assignment label cannot be blank")


if __name__ == "__main__":
    unittest.main()
