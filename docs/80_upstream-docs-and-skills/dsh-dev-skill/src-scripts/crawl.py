#!/usr/bin/env python3
"""BFS crawl of the DeepSeek Harness VitePress docs to enumerate all doc pages (zh + en)."""
import urllib.request, urllib.parse, re, sys, time, os, json

BASE = "https://deepseek-harness.github.io"
ROOT_PATH = "/deepseek-harness/"  # base path of the site

# Exclude static/asset links (not doc pages)
SKIP_PATTERNS = [
    r"/assets/",
    r"/favicon",
    r"/vp-icons",
    r"/\.netlify",
]
SKIP_EXT = (".css",".js",".svg",".png",".jpg",".jpeg",".gif",".webp",".woff",".woff2",".ttf",
            ".map",".ico",".txt",".xml",".mp4",".webmanifest",".json",".md")

def is_page_link(href):
    if not href or not href.startswith(ROOT_PATH):
        return False
    for p in SKIP_PATTERNS:
        if re.search(p, href):
            return False
    path = href
    # strip query/fragment
    path = path.split("?")[0].split("#")[0]
    if not path:
        return False
    if path.endswith(SKIP_EXT):
        return False
    return True

def normalize(url):
    # strip fragment/query for dedup key
    return url.split("#")[0].split("?")[0]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 (doc crawl)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode("utf-8","replace")
        except Exception as e:
            if attempt == 2:
                return None, ""
            time.sleep(1.5)

def extract_hrefs(html):
    return re.findall(r'href="([^"]+)"', html)

def crawl(seeds, outfile):
    pending = list(seeds)
    seen = set()          # normalized URLs fetched/pending
    pages = {}            # url -> {status, html_path}
    queue = []
    for s in seeds:
        n = normalize(s)
        if n not in seen:
            seen.add(n)
            queue.append(n)
    while queue:
        url = queue.pop(0)
        status, html = fetch(url)
        if html is None:
            pages[url] = {"status": None, "html": False}
            continue
        pages[url] = {"status": status, "html": True}
        hrefs = extract_hrefs(html)
        for h in hrefs:
            # resolve against page URL
            resolved = urllib.parse.urljoin(url, h)
            p = urllib.parse.urlparse(resolved)
            if not p.netloc:
                continue
            if p.netloc != urllib.parse.urlparse(BASE).netloc:
                continue
            if not is_page_link(p.path):
                continue
            n = normalize(resolved)
            if n not in seen:
                seen.add(n)
                queue.append(n)
        print(f"[crawled] {url} ({len(pages)} pages, {len(queue)} queued)", flush=True)
    with open(outfile, "w") as f:
        json.dump(sorted(pages.keys()), f, ensure_ascii=False, indent=2)
    return pages

if __name__ == "__main__":
    # Seed from real doc pages (SSR-render full section sidebars), zh + en.
    p = ROOT_PATH  # /deepseek-harness/
    seeds = [
        BASE + p + "guide/quickstart",          # user URL 1 (zh)
        BASE + p + "reference/cordis-primer",   # user URL 2 (zh)
        BASE + p + "develop/basic",
        BASE + p + "reference",
        BASE + p + "en/guide/quickstart",
        BASE + p + "en/reference/cordis-primer",
        BASE + p + "en/develop/basic",
        BASE + p + "en/reference",
    ]
    outfile = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "pages.json")
    pages = crawl(seeds, outfile)
    print(f"\nTOTAL PAGES: {len(pages)}")
