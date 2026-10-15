/**
 * Commit uploaded material straight to the repository with the GitHub REST API.
 *
 * The token comes from the user, is kept in this browser's localStorage only
 * (and can be kept for the session only) and is sent to api.github.com and
 * nowhere else. A fine-grained token needs "Contents: Read and write" for this
 * one repository; a classic token needs the `repo` scope.
 */

import { CONFIG } from "./config.js";
import { lsDel, lsGet, lsSet } from "./util.js";
import { toBase64 } from "./datasets.js";

const SETTINGS_KEY = "github";
const API = "https://api.github.com";

export function loadSettings() {
  const stored = lsGet(SETTINGS_KEY, {}) || {};
  return {
    repo: stored.repo || CONFIG.githubRepo || "",
    branch: stored.branch || CONFIG.githubBranch || "main",
    token: stored.token || "",
    remember: stored.remember !== false,
  };
}

export function saveSettings(settings) {
  const { repo, branch, token, remember } = settings;
  lsSet(SETTINGS_KEY, { repo, branch, token: remember ? token : "", remember });
}

export function clearToken() {
  const stored = lsGet(SETTINGS_KEY, {}) || {};
  lsDel(SETTINGS_KEY);
  return { ...stored, token: "" };
}

/** "owner/name" -> { owner, name }; throws a friendly error otherwise. */
export function parseRepo(repo) {
  const match = /^\s*([\w.-]+)\/([\w.-]+?)\s*$/.exec(String(repo || ""));
  if (!match) throw new Error('Repository must look like "owner/repository-name".');
  return { owner: match[1], name: match[2] };
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function request(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...headers(token), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = describeError(response.status, data, method);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function describeError(status, data, method = "GET") {
  const detail = (data && (data.message || (data.errors && data.errors[0] && data.errors[0].message))) || "";
  switch (status) {
    case 401:
      return `GitHub rejected the token (401). Check that it is copied completely and has not expired. ${detail}`;
    case 403:
      return `GitHub refused the request (403). The token needs "Contents: Read and write" for this repository. ${detail}`;
    case 404:
      return `Not found (404). Check the repository name, the branch, and that the token can see this repository. ${detail}`;
    case 409:
    case 422:
      return `Something changed on GitHub while saving (${status}). Reload the page and try again. ${detail}`;
    default:
      return `GitHub request failed (${status} ${method}). ${detail}`;
  }
}

/** Who is this token, and can it see the repository? */
export async function verifyToken({ repo, token }) {
  if (!token) throw new Error("Paste a GitHub token first.");
  const { owner, name } = parseRepo(repo);
  const user = await request(`${API}/user`, { token });
  const target = await request(`${API}/repos/${owner}/${name}`, { token });
  const canWrite = Boolean(target.permissions && (target.permissions.push || target.permissions.admin || target.permissions.maintain));
  return { login: user.login, repo: target.full_name, private: target.private, canWrite };
}

/** The sha of an existing file, or null when the path is new. */
export async function existingSha({ repo, branch, path, token }) {
  const { owner, name } = parseRepo(repo);
  const url = `${API}/repos/${owner}/${name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
  try {
    const data = await request(url, { token });
    return data && data.sha ? data.sha : null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function listDirectory({ repo, branch, path, token }) {
  const { owner, name } = parseRepo(repo);
  const url = `${API}/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  try {
    const data = await request(url, { token });
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

/**
 * Create or update one file in the repository.
 * @param {{repo:string, branch:string, path:string, content:string, message?:string,
 *          token:string, encoding?:"utf-8"|"base64"}} options
 */
export async function commitFile({ repo, branch, path, content, text, message, token, encoding = "utf-8" }) {
  const { owner, name } = parseRepo(repo);
  if (!token) throw new Error("A GitHub token is required to save files.");
  const body = content != null ? content : text;
  const clean = String(path).replace(/^\/+/, "").replace(/\\/g, "/");
  const sha = await existingSha({ repo, branch, path: clean, token });
  const payload = {
    message: message || `Add ${clean} from the Python Practice upload page`,
    content: encoding === "base64" ? body : toBase64(new TextEncoder().encode(body)),
    branch,
    ...(sha ? { sha } : {}),
  };
  const data = await request(`${API}/repos/${owner}/${name}/contents/${clean.split("/").map(encodeURIComponent).join("/")}`, {
    token,
    method: "PUT",
    body: payload,
  });
  return { path: clean, sha: data && data.content ? data.content.sha : null, commit: data && data.commit ? data.commit.sha : null };
}

/** Commit several files one after another, reporting progress. */
export async function commitFiles(files, options = {}) {
  const { onProgress = null, message = null, token, repo, branch } = options;
  const results = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (onProgress) onProgress({ index, total: files.length, path: file.path, state: "start" });
    try {
      const result = await commitFile({ ...file, repo, branch, token, message: message || file.message });
      results.push({ ...result, ok: true });
      if (onProgress) onProgress({ index, total: files.length, path: file.path, state: "done" });
    } catch (error) {
      results.push({ path: file.path, ok: false, error: String((error && error.message) || error) });
      if (onProgress) onProgress({ index, total: files.length, path: file.path, state: "failed", error: error.message });
    }
  }
  return results;
}
