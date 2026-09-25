#!/usr/bin/env python3
"""Build the site->local mapping for the crawled docs pages, plus a readable inventory."""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))   # this script's dir (src-scripts/)
ROOT = os.path.dirname(HERE)                        # dsh-dev-skill/
SRC = os.path.join(ROOT, "src")
SITE = "https://deepseek-harness.github.io/deepseek-harness"

pages = json.load(open(os.path.join(HERE, "pages.json")))  # crawled site URLs

def site_to_repo(path):
    """Map a site path (relative, no lang) to a repo-relative docs path (no ext)."""
    path = path.lstrip("/")
    # normalize trailing slash
    if path.endswith("/"):
        path = path[:-1]
    if path == "":
        return "user/index"  # home -> docs/user/index
    # guide/* -> docs/user/guide/*
    if path.startswith("guide/"):
        if path == "guide/quickstart":
            return "user/guide/index"
        return "user/" + path
    # develop/* -> mostly docs/user/develop/*, with a few re-homed aliases
    if path.startswith("develop/"):
        rest = path[len("develop/"):]
        # develop/cordis-tutorial/* actually lives at docs/cordis-tutorial/*
        if rest.startswith("cordis-tutorial/"):
            return rest
        # develop/config & develop/tool live under basic/
        if rest in ("config", "tool"):
            return "user/develop/basic/" + rest
        if rest == "cordis-tutorial":
            return "cordis-tutorial/index"
        return "user/" + path
    # framework/service flat alias
    if path == "framework/service":
        return "user/develop/framework/service"
    # reference/* section
    if path.startswith("reference/"):
        rest = path[len("reference/"):]
        if rest == "":
            return None  # reference section index (no single md; config-assembled)
        if rest == "subsystems":
            return "subsystems/README"
        if rest.startswith("subsystems/"):
            return rest
        return rest
    if path == "reference":
        return None
    if path == "cordis-tutorial":
        return "cordis-tutorial/index"
    if path.startswith("cordis-tutorial/"):
        return path
    # flat reference-style pages at root map directly into docs/
    return path

def lang_suffix(has_en, has_zh, prefer_zh):
    """Return which file to prefer given the page's language availability."""
    # prefer_zh True -> .zh.md, else .md
    if prefer_zh:
        return ".zh.md" if has_zh else ".md"
    return ".md" if has_en else ".zh.md"

def resolve(rel_noext, lang):
    base = os.path.join(SRC, "docs", rel_noext)
    en = base + ".md"
    zh = base + ".zh.md"
    has_en = os.path.exists(en)
    has_zh = os.path.exists(zh)
    if lang == "en":
        return en if has_en else zh
    return zh if has_zh else en

mapping = {}   # site URL -> {lang, local_file}
missing = []
for url in pages:
    path = url.replace(SITE, "").lstrip("/")
    if path == "":
        lang = "zh"
    else:
        # language is determined by the leading 'en/' segment
        lang = "en" if path.startswith("en/") else "zh"
        # strip lang prefix for repo path resolution
        if lang == "en":
            path = path[len("en/"):]
    rel = site_to_repo(path)
    if rel is None:
        # section index / config-assembled page: content lives across docs/*
        mapping[url] = {"lang": lang, "path": None, "local": None}
        continue
    local = resolve(rel, lang)
    if not os.path.exists(local):
        # try index variant
        for variant in ("index", "README"):
            cand = os.path.join(SRC, "docs", rel, variant + (".zh.md" if lang == "zh" else ".md"))
            if os.path.exists(cand):
                local = cand
                break
        else:
            missing.append(url)
            local = None
    mapping[url] = {"lang": lang, "path": rel, "local": os.path.relpath(local, SRC) if local and os.path.exists(local) else None}

# Write outputs
with open(os.path.join(SRC, "site-pages.json"), "w") as f:
    json.dump(sorted(pages), f, ensure_ascii=False, indent=2)

with open(os.path.join(SRC, "site-pages-map.txt"), "w") as f:
    f.write("# DeepSeek Harness docs — crawled site pages -> local markdown\n")
    f.write("# Base: %s\n" % SITE)
    f.write("# Crawled %d pages (zh + en). Local source under ./docs/\n\n" % len(pages))
    for url in sorted(pages, key=lambda u: (u.count("en/"), u)):
        m = mapping.get(url, {})
        local = m.get("local")
        if local is None:
            local = "(section index / generated page; content in ./docs/)"
        f.write("%-88s ->  %s\n" % (url, local))

print("site pages:", len(pages))
print("mapping entries:", len(mapping))
print("unresolved:", len(missing))
for u in missing[:30]:
    print("  MISS:", u)
