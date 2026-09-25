#!/usr/bin/env python3
"""Fetch + convert all pi.dev docs pages (30) into ../pi-and-omp/pi/*.md"""
import os, re, sys, time, urllib.request, datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import pi_convert

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "pi")   # HERE=pi-and-omp/.tools -> pi-and-omp/pi
os.makedirs(OUT, exist_ok=True)
TODAY = datetime.date.today().isoformat()

def slug(url):
    if url.rstrip("/").endswith("/docs/latest"):
        return "index"
    return url.rstrip("/").rsplit("/", 1)[-1]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            if a == 3:
                return None
            time.sleep(1.5)

def one(url):
    raw = fetch(url)
    if raw is None:
        return url, None
    body = pi_convert.html_to_md(raw)
    name = slug(url)
    header = f"<!--\nsource: {url}\nfetched: {TODAY}\n-->\n\n"
    with open(os.path.join(OUT, name + ".md"), "w", encoding="utf-8") as f:
        f.write(header + body)
    return url, name

urls = [l.strip() for l in open(os.path.join(HERE, "pi_pages.txt")) if l.strip()]
print("pi pages to fetch:", len(urls))
ok, fail = [], []
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(one, u): u for u in urls}
    for fut in as_completed(futs):
        u, name = fut.result()
        if name is None:
            fail.append(u)
        else:
            ok.append(name)
print("OK:", len(ok), " FAIL:", len(fail))
for u in fail:
    print("  MISSING:", u)
