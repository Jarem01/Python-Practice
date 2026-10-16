/**
 * Uploaded course material, kept in this browser until it is committed to the
 * repository (see github.js / tools/import_materials.py).
 *
 * Uploads are visible in the learning section immediately: the notebook viewer
 * and the index read from here first, so material can be reviewed before it is
 * pushed. Everything is stored as text, so notebooks, scripts and CSV files all
 * work; very large files are refused with a clear message.
 */

import { lsGet, lsSet } from "./util.js";

const KEY = "uploads";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

export function listUploads() {
  const uploads = lsGet(KEY, []);
  return Array.isArray(uploads) ? uploads : [];
}

export function getUpload(path) {
  const wanted = String(path).replace(/\\/g, "/");
  return listUploads().find((upload) => upload.path === wanted) || null;
}

export function totalUploadBytes() {
  return listUploads().reduce((sum, upload) => sum + (upload.size || 0), 0);
}

export function uploadLimits() {
  return { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES };
}

/**
 * Store one analyzed upload.
 * @returns {{ok: true, upload: object} | {ok: false, error: string}}
 */
export function addUpload({ path, name, kind, text, entry, replace = true }) {
  const size = byteLength(text);
  if (size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `${name} is ${(size / 1024 / 1024).toFixed(1)} MB; this browser store holds up to ${MAX_FILE_BYTES / 1024 / 1024} MB per file. Use “Save to GitHub” for large files.`,
    };
  }
  const uploads = listUploads();
  const index = uploads.findIndex((upload) => upload.path === path);
  const others = index >= 0 ? uploads.reduce((sum, upload) => (upload.path === path ? sum : sum + (upload.size || 0)), 0) : totalUploadBytes();
  if (others + size > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Adding ${name} would exceed the ${MAX_TOTAL_BYTES / 1024 / 1024} MB browser store. Remove an upload or use “Save to GitHub”.`,
    };
  }

  const record = { path, name, kind, text, entry, size, addedAt: new Date().toISOString(), source: "browser" };
  if (index >= 0 && replace) uploads[index] = record;
  else if (index < 0) uploads.push(record);
  if (!lsSet(KEY, uploads)) {
    return { ok: false, error: "This browser refused to store the file (storage full or blocked)." };
  }
  return { ok: true, upload: record };
}

export function removeUpload(path) {
  lsSet(
    KEY,
    listUploads().filter((upload) => upload.path !== path),
  );
}

export function clearUploads() {
  lsSet(KEY, []);
}

/** Entries shaped like data/notebooks.json entries, for the learning section. */
export function uploadsAsEntries() {
  return listUploads().map((upload) => ({
    ...upload.entry,
    pending: true,
    uploadedAt: upload.addedAt,
    bytes: upload.size,
  }));
}

/**
 * A manifest-shaped fragment so the learning pages can show what was saved in
 * this browser but is not in the repository yet.
 *
 * @param {string[]} knownPaths  entries the built manifest already describes;
 *   they are skipped, because the repository is the source of truth once a file
 *   has been pushed.
 */
export function uploadsGroup(knownPaths = []) {
  const known = new Set(knownPaths);
  const entries = uploadsAsEntries().filter((entry) => !known.has(entry.path));
  if (!entries.length) return null;
  const byGroup = new Map();
  for (const entry of entries) {
    const name = entry.group || "Your uploads";
    if (!byGroup.has(name)) byGroup.set(name, { name, notebooks: [], scripts: [] });
    const bucket = byGroup.get(name);
    if (entry.kind === "script") bucket.scripts.push(entry.path);
    else bucket.notebooks.push(entry.path);
  }
  return {
    entries,
    groups: [...byGroup.values()].map((group) => ({
      name: group.name,
      title: group.name === "Your uploads" ? "Uploaded in this browser" : `${group.name} (uploaded)`,
      order: -1,
      pending: true,
      notebooks: group.notebooks,
      scripts: group.scripts,
    })),
  };
}
