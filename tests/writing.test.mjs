/**
 * The site's copy is written in American English. This test keeps it that way:
 * it scans the pages, styles and scripts for British spellings and reports the
 * exact file and line, so "organised"/"normalisation"/"practise" cannot creep
 * back in through a later change.
 *
 *   node --test tests/
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

//: British spellings that would show up in this project's vocabulary.
const BRITISH = [
  "analyse", "analysed", "analyser", "analysing",
  "normalise", "normalised", "normalises", "normalising", "normalisation",
  "organise", "organised", "organises", "organising", "organisation",
  "recognise", "recognised", "recognises", "recognising",
  "initialise", "initialised", "initialising", "initialisation",
  "customise", "customised", "utilise", "utilised", "authorise", "authorised",
  "serialise", "serialised", "summarise", "summarised", "emphasise", "emphasised",
  "realise", "realised", "catalogue",
  "colour", "colours", "coloured", "behaviour", "behaviours", "flavour", "favourite",
  "honour", "labour", "neighbour", "rumour", "humour", "savour", "vapour", "vigour",
  "centre", "centres", "fibre", "litre", "metre", "metres", "theatre",
  "licence", "licences", "defence", "offence", "pretence",
  "labelled", "labelling", "cancelled", "cancelling", "travelled", "travelling", "traveller",
  "modelling", "jewellery", "grey", "storey", "plough", "draught", "cheque",
  "whilst", "learnt", "practise", "practised", "practising", "enrolment",
  "towards", "amongst", "per cent",
];

const SCANNED_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", "problems", "materials"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }
    if (entry.name === "writing.test.mjs") continue; // this file lists the spellings on purpose
    if (SCANNED_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.startsWith(".")) {
      yield path.join(dir, entry.name);
    }
  }
}

const patterns = BRITISH.map((word) => ({ word, re: new RegExp(`\\b${word}\\b`, "i") }));

test("the site's copy uses American English spellings", async () => {
  const offences = [];
  for await (const file of walk(root)) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { word, re } of patterns) {
        const match = re.exec(line);
        if (match) offences.push(`${path.relative(root, file)}:${index + 1}: "${match[0]}" (${word})`);
      }
    });
  }
  assert.deepEqual(offences, [], `British spellings found:\n${offences.join("\n")}`);
});
