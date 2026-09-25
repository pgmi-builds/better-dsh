#!/usr/bin/env python3
"""pi.dev docs: convert fetched raw HTML pages to markdown (pi-and-omp/pi/)."""
import os, re, sys, html
from bs4 import BeautifulSoup
from markdownify import markdownify as md


def html_to_md(raw: str) -> str:
    soup = BeautifulSoup(raw, "html.parser")
    # content container: the article card holds title + prose (pi.dev)
    main = soup.select_one("section.docs-article-card")
    if main is None:
        main = soup.select_one(".docs-main-column")
    if main is None:
        main = soup.find("main")
    if main is None:
        main = soup.body
    for sel in ("nav", "aside", "footer", "script", "style", "svg", "button"):
        for el in main.find_all(sel):
            el.decompose()
    # drop decorative leaves: copy-widget text, version badge, page chrome bits
    for el in main.find_all(True):
        if el.find_all(True):
            continue  # only leaves
        t = el.get_text(strip=True)
        if t in ("Copied", "copied", "Latest", "Latest·", "·", "Search documentation"):
            el.decompose()
    # unwrap syntax-highlight spans inside <pre>; keep plain text lines
    for pre in main.find_all("pre"):
        for sp in pre.find_all("span"):
            sp.unwrap()
        code = pre.find("code")
        if code:
            code.unwrap()
    out = md(str(main), heading_style="ATX", bullets="-", code_language="")
    # targeted cleanups for leftover chrome artifacts
    out = re.sub(r"\[Copied\]\(#[^)]*\)", "", out)
    out = re.sub(r"^Latest\s*·?\s*$", "", out, flags=re.M)
    out = re.sub(r"^·\s*$", "", out, flags=re.M)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip() + "\n"

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    raw = open(src, encoding="utf-8", errors="replace").read()
    out = html_to_md(raw)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(out)
    print("wrote", dst, len(out), "chars")
