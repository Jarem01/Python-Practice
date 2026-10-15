#!/usr/bin/env python3
"""Check a running copy of the site: pages, local assets and manifests.

    python3 -m http.server 8000 &
    python3 tools/check_site.py http://localhost:8000

Exits 1 if any page, asset or manifest fails to load, or if a manifest cannot be
parsed. Used as a smoke test after deploying to GitHub Pages or a preview.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PAGES = [
    "index.html",
    "glossary.html",
    "teaching/index.html",
    "teaching/view.html",
    "practice/index.html",
    "practice/exercise.html",
    "practice/create.html",
]

MANIFESTS = ["data/notebooks.json", "problems/index.json", "data/glossary.json"]

LINK_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)


def fetch(url: str) -> tuple[int, str, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "check_site.py"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), b""
    except Exception as error:  # noqa: BLE001
        print(f"  ! {url}: {error}")
        return 0, "", b""


def local_targets(page_url: str, html: str) -> list[str]:
    targets = []
    for match in LINK_RE.findall(html):
        if match.startswith(("http://", "https://", "mailto:", "data:", "#", "javascript:")):
            continue
        if match.endswith(".md"):
            continue  # e.g. the README link: not served as a web page here
        targets.append(urllib.parse.urljoin(page_url, match))
    return sorted(set(targets))


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
    failures = 0
    checked = 0

    for page in PAGES:
        url = f"{base}/{page}"
        status, content_type, body = fetch(url)
        checked += 1
        ok = status == 200 and b"<html" in body.lower()
        print(f"{'ok  ' if ok else 'FAIL'} {status:>3} {content_type:<24} {page}")
        if not ok:
            failures += 1
            continue

        html = body.decode("utf-8", "replace")
        for target in local_targets(url, html):
            status, content_type, body = fetch(target)
            checked += 1
            ok = status == 200 and (b"<html" in body.lower() or len(body) > 0)
            if target.endswith(".js") and "javascript" not in content_type:
                ok = False
                print(f"  ! {target} served as {content_type!r}; module scripts need a JS content type")
            if not ok:
                failures += 1
                print(f"FAIL {status:>3} {content_type:<24} {target}")
            else:
                print(f"  ok {status:>3} {content_type:<24} {target[len(base) + 1:]}")

    for manifest in MANIFESTS:
        url = f"{base}/{manifest}"
        status, content_type, body = fetch(url)
        checked += 1
        try:
            data = json.loads(body)
            ok = status == 200
            detail = f"{len(body)} bytes"
            if manifest == "problems/index.json":
                detail += f", {data.get('count')} problems"
            if manifest == "data/notebooks.json":
                detail += f", {data.get('totals', {}).get('notebooks')} notebooks"
        except Exception as error:  # noqa: BLE001
            ok = False
            detail = f"not JSON: {error}"
        print(f"{'ok  ' if ok else 'FAIL'} {status:>3} {content_type:<24} {manifest} ({detail})")
        if not ok:
            failures += 1

    # every notebook referenced by the manifest must be fetchable
    status, _, body = fetch(f"{base}/data/notebooks.json")
    if status == 200:
        manifest = json.loads(body)
        for notebook in manifest.get("notebooks", []):
            path = notebook["path"]
            status, content_type, body = fetch(f"{base}/{urllib.parse.quote(path)}")
            checked += 1
            try:
                json.loads(body)
                parses = True
            except Exception:  # noqa: BLE001
                parses = False
            ok = status == 200 and parses
            print(f"{'ok  ' if ok else 'FAIL'} {status:>3} {content_type:<24} {path}")
            if not ok:
                failures += 1

    print(f"\n{checked - failures}/{checked} URLs loaded" + (f", {failures} failure(s)" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
