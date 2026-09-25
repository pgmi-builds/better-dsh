#!/usr/bin/env python3
"""Download every docs/*.md from deepseek-ai/deepseek-harness master into ./src/docs/, preserving repo-relative layout."""
import json, os, sys, urllib.request, urllib.parse, time
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO = "deepseek-ai/deepseek-harness"
RAW = "https://raw.githubusercontent.com/%s/master/" % REPO
HERE = os.path.dirname(os.path.abspath(__file__))   # this script's dir (src-scripts/)
ROOT = os.path.dirname(HERE)                        # dsh-dev-skill/
DEST = os.path.join(ROOT, "src")   # writes src/docs/<rel> since rel starts with docs/

def load_docs(paths_json="/tmp/dsh_tree.json"):
    d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs-tree.json")))
    paths = [t["path"] for t in d.get("tree", []) if t["type"] == "blob"]
    return sorted(p for p in paths if p.startswith("docs/") and p.endswith(".md"))

def fetch_one(rel):
    url = RAW + urllib.parse.quote(rel)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "docs-fetch"})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            if r.status != 200:
                return rel, None, "HTTP %s" % r.status
            return rel, data, None
        except Exception as e:
            if attempt == 2:
                return rel, None, str(e)
            time.sleep(1)
    return rel, None, "exhausted"

def main():
    rels = load_docs()
    print("total docs md to fetch:", len(rels))
    failures = []
    ok = 0
    with ThreadPoolExecutor(max_workers=20) as ex:
        futs = {ex.submit(fetch_one, r): r for r in rels}
        for fut in as_completed(futs):
            rel, data, err = fut.result()
            if err or data is None:
                failures.append((rel, err))
                print("FAIL", rel, err, flush=True)
                continue
            out = os.path.join(DEST, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(data)
            ok += 1
    print("\nDownloaded OK:", ok, " Failures:", len(failures))
    for rel, err in failures:
        print("  MISSING:", rel, err)

if __name__ == "__main__":
    main()
