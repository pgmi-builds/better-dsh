#!/usr/bin/env python3
"""Crawl the Hermes Agent Docusaurus docs to enumerate all doc pages (en + zh-Hans).

Strategy: BFS discovery from the two seeds (/docs/, /docs/zh-Hans/) with a worker pool,
following every same-site /docs/ page link. Output: src/site-pages.json {url: {status, lang}}.
"""
import urllib.request, urllib.parse, re, time, json, os, sys
from collections import deque
from concurrent.futures import ThreadPoolExecutor

BASE = "https://hermes-agent.nousresearch.com"
ROOT_PATH = "/docs/"
SKIP_PATTERNS = [r"/assets/", r"/favicon", r"/img/", r"opensearch"]
SKIP_EXT = (".css",".js",".svg",".png",".jpg",".jpeg",".gif",".webp",".woff",".woff2",
            ".ttf",".map",".ico",".txt",".xml",".mp4",".webmanifest")
WORKERS = 16

def is_page_link(path):
    if not path.startswith(ROOT_PATH): return False
    for p in SKIP_PATTERNS:
        if re.search(p, path): return False
    return not path.endswith(SKIP_EXT)

def normalize(url):
    u = url.split("#")[0].split("?")[0]
    return u.rstrip("/") if len(u) > len(ROOT_PATH.rstrip("/")) + 1 else u

def lang_of(url):
    return "zh-Hans" if "/zh-Hans" in url else "en"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (doc crawl)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except Exception:
            if attempt == 2: return None, ""
            time.sleep(1.0)

def main(seeds, outfile):
    seen = set(normalize(s) for s in seeds)
    queue = deque(seeds)
    pages, fails = {}, []
    pool = ThreadPoolExecutor(WORKERS)

    def batch(urls):
        futs = {pool.submit(fetch, u): u for u in urls}
        return {futs[f]: f.result() for f in futs}

    while queue:
        wave, n = {}, min(len(queue), WORKERS * 2)
        for _ in range(n):
            wave[queue.popleft()] = True
        results = batch(list(wave))
        nxt = []
        for url, (status, html) in results.items():
            pages[url] = {"status": status, "lang": lang_of(url)}
            if status != 200:
                fails.append(url); continue
            for h in re.findall(r'href="([^"]+)"', html):
                resolved = urllib.parse.urljoin(url, h)
                p = urllib.parse.urlparse(resolved)
                if p.netloc != urllib.parse.urlparse(BASE).netloc: continue
                if not is_page_link(p.path): continue
                nn = normalize(resolved)
                if nn not in seen:
                    seen.add(nn); nxt.append(nn)
        queue.extend(nxt)
        print(f"crawled={len(pages)} queue={len(queue)} fails={len(fails)}", flush=True)

    pool.shutdown()
    os.makedirs(os.path.dirname(outfile), exist_ok=True)
    with open(outfile, "w") as f:
        json.dump(dict(sorted(pages.items())), f, indent=1)
    print(f"DONE total={len(pages)} en={sum(1 for v in pages.values() if v['lang']=='en')} "
          f"zh-Hans={sum(1 for v in pages.values() if v['lang']=='zh-Hans')} non200={len(fails)}")
    for u in fails: print("FAIL:", u)

if __name__ == "__main__":
    main([BASE + "/docs/", BASE + "/docs/zh-Hans/"],
         os.path.join(os.path.dirname(__file__), "..", "src", "site-pages.json"))
