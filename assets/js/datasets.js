/**
 * Data files for exercises.
 *
 * A problem can declare:
 *     "data_files": { "sales.csv": "acc525/data/sales.csv" }
 * The file is then copied into the Python sandbox under the name the notebook's
 * code expects (`sales.csv`), so notebook code runs unchanged. Binary formats
 * (xlsx, parquet) are passed as base64 and written as bytes.
 *
 * Files already uploaded in this browser (see uploads.js) are preferred, so a
 * freshly uploaded dataset works before it is committed to the repository.
 */

import { siteUrl } from "./config.js";
import { getUpload } from "./uploads.js";

const BINARY_RE = /\.(xlsx|xls|parquet|zip|png|jpg|jpeg|gif|pdf)$/i;

export function isBinaryPath(path) {
  return BINARY_RE.test(String(path));
}

/** Bytes -> base64, chunked so large files do not blow the argument limit. */
export function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Resolve `data_files` into what the harness expects: { name: text } or
 * { name: { base64 } }.
 * @param {Record<string,string>} dataFiles  sandbox name -> repo path
 */
export async function resolveDataFiles(dataFiles) {
  const out = {};
  const problems = [];
  for (const [name, repoPath] of Object.entries(dataFiles || {})) {
    try {
      const local = getUpload(repoPath);
      if (local) {
        if (isBinaryPath(repoPath)) {
          throw new Error("a binary file that is still only in this browser cannot be replayed — commit it or re-upload it with “Save to GitHub”");
        }
        out[name] = local.text;
        continue;
      }
      const response = await fetch(siteUrl(repoPath), { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (isBinaryPath(repoPath)) {
        out[name] = { base64: toBase64(new Uint8Array(await response.arrayBuffer())) };
      } else {
        out[name] = await response.text();
      }
    } catch (error) {
      problems.push(`${name} (from ${repoPath}): ${String((error && error.message) || error)}`);
    }
  }
  return { files: out, problems };
}
