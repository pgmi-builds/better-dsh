#!/usr/bin/env python3
"""Makeup pass: verify URLs that the link-BFS crawl could not discover.

Some live pages are orphans — present in the docs tree (and most also in llms.txt) but
never linked from any crawled page's HTML, so a pure link-follow crawl never sees them.
This script takes the reverse-check misses (LOCAL-ONLY entries), fetches each politely
(serial, 0.5 s apart), and records the result in src/site-pages.json with provenance:
    "source": "verify_orphans"  (plus "llms": true when llms.txt lists it)
Re-run gen_mapping.py afterwards to refresh site-pages-map.txt.
"""
import json, os, time, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
ORIGIN = "https://hermes-agent.nousresearch.com"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (doc crawl)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None

def main():
    # 1) normalize seed-variant collisions: '/docs/' vs '/docs', '/docs/zh-Hans/' vs '/docs/zh-Hans'
    pages = json.load(open(os.path.join(SRC, "site-pages.json")))
    for slash, bare in ((ORIGIN + "/docs/", ORIGIN + "/docs"),
                        (ORIGIN + "/docs/zh-Hans/", ORIGIN + "/docs/zh-Hans")):
        if slash in pages:
            rec = pages.pop(slash)
            pages.setdefault(bare, rec)
    # 2) reverse-check misses, recomputed here (same rules as gen_mapping.resolve)
    sys_path = os.path
    miss_urls = []
    map_txt = open(os.path.join(SRC, "site-pages-map.txt")).read()
    miss_urls = re.findall(r"(" + re.escape(ORIGIN) + r"\S+)\tLOCAL-ONLY", map_txt)
    llms = open(os.path.join(SRC, "llms.txt")).read()
    for u in miss_urls:
        if u in pages and pages[u]["status"] == 200:
            continue
        s = fetch(u)
        time.sleep(0.5)
        pages[u] = {"status": s, "lang": "zh-Hans" if "/zh-Hans" in u else "en",
                    "source": "verify_orphans", "llms": u in llms}
        print(s, u, flush=True)
    json.dump(pages, open(os.path.join(SRC, "site-pages.json"), "w"), indent=1)
    print("updated", os.path.join(SRC, "site-pages.json"))

if __name__ == "__main__":
    main()
