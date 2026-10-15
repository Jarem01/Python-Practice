/**
 * Site-wide configuration.
 *
 * Everything here is safe to edit by hand — there is no build step for it.
 * After changing notebook/problem files, re-run:  python3 tools/build_index.py
 */

export const CONFIG = {
  /** Pyodide version used to run Python in the browser. */
  pyodideVersion: "314.0.7",

  /** CDN directory that holds pyodide.mjs + the Python runtime files. */
  pyodideIndexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",

  /**
   * Extra packages that are pre-loaded together with the runtime.
   * Keep this empty for the fastest start; exercises declare their own
   * `packages` and those are loaded on demand.
   */
  defaultPackages: [],

  /**
   * Runaway-loop guard: how many lines of the learner's own code a single run
   * may execute. Only frames from the submitted code are counted, so importing
   * numpy or pandas is never mistaken for an infinite loop. Roughly a second of
   * work in the browser.
   */
  lineLimit: 2000000,

  /**
   * Optional: base URL of a hosted JupyterLite instance, e.g.
   *   "https://my-user.github.io/my-jupyterlite/lab/index.html"
   * Leave empty ("") to hide the "Open in JupyterLite" buttons.
   * Requires the `jupyterlab-open-url-parameter` extension, which is what
   * implements the ?fromURL= parameter used to open a notebook from another
   * origin. See README.md → "Opening notebooks in JupyterLite".
   */
  jupyterLiteUrl: "",

  /**
   * Optional: public raw base URL of this repository, used to build the
   * ?fromURL= links for the JupyterLite button, e.g.
   *   "https://raw.githubusercontent.com/you/Python-Practice/main"
   * Leave empty if you only use the built-in notebook viewer.
   */
  rawBaseUrl: "",

  /** Storage namespace for localStorage (progress, drafts, uploads, token). */
  storagePrefix: "pypractice:",

  /**
   * Folder that collects source study material, including files uploaded from
   * the website. Keep in sync with MATERIALS_DIR in tools/build_index.py.
   */
  materialsDir: "materials",

  /** Default destination for uploads, and the GitHub repository they are saved to. */
  uploadFolder: "materials",
  githubRepo: "Jarem01/Python-Practice",
  githubBranch: "main",
};

/**
 * Absolute URL of the site root, derived from this module's own location
 * (assets/js/config.js). That keeps every fetch and generated link working no
 * matter which subfolder the current page lives in, and also works when the
 * site is published under a path prefix such as /Python-Practice/ on GitHub
 * Pages.
 */
export const SITE_ROOT = new URL("../../", import.meta.url);

/** Turn a repo-relative path into a URL that works from any page. */
export function siteUrl(path) {
  return new URL(String(path).replace(/^\//, ""), SITE_ROOT).href;
}

/** Where the generated manifests live. */
export const PATHS = {
  notebooks: siteUrl("data/notebooks.json"),
  problems: siteUrl("problems/index.json"),
  glossary: siteUrl("data/glossary.json"),
  curriculum: siteUrl("data/curriculum.json"),
};
