#!/usr/bin/env python3
"""Build src/site-pages-map.txt: every live doc URL (HTTP 200) -> the local file it resolves to.

Resolution rules (Docusaurus, this repo):
  /docs             -> src/docs/index.mdx                 (frontmatter slug: /)
  /docs/<p>         -> src/docs/<p>.md | <p>.mdx | <p>/index.md
  /docs/zh-Hans     -> src/i18n/zh-Hans/index.mdx
  /docs/zh-Hans/<p> -> src/i18n/zh-Hans/<p>.(md|mdx|index.md)
                       if no zh file exists -> the EN source file
                       (Docusaurus serves untranslated pages with EN content)
Known non-markdown live pages (no single md source):
  /docs/plugins, /docs/skills                    -> React pages (website/src/pages/*/index.tsx)
  /docs/api/plugins.json, /docs/api/skills.json  -> JSON catalogs (snapshotted separately)
  /docs/user-guide/skills/.../<slug> present only in repo `optional-skills/`
                                                 -> generated from skill sources
Also reconciles crawl-time connection failures using retry-none.json (if present) and runs a
reverse completeness check: every local md file's expected URL must be a live 200 page.
"""
import json, os, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
EN, ZH = "docs", os.path.join("i18n", "zh-Hans")
SPECIAL = {
    "/docs/plugins": "React page (repo: website/src/pages/plugins/index.tsx)",
    "/docs/skills": "React page (repo: website/src/pages/skills/index.tsx)",
    "/docs/api/plugins.json": "JSON catalog -> snapshotted as src/api-plugins.json",
    "/docs/api/skills.json": "JSON catalog -> snapshotted as src/api-skills.json",
}

def find_file(root, base):
    for cand in (os.path.join(root, base + ".md"), os.path.join(root, base + ".mdx"),
                 os.path.join(root, base, "index.md"), os.path.join(root, base, "index.mdx")):
        if os.path.isfile(os.path.join(SRC, cand)):
            return cand
    return None

def resolve(url):
    """Return (local path relative to src/, note) or (None, note/None) if no file matches."""
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path).rstrip("/")
    if path in SPECIAL:
        return None, SPECIAL[path]
    if path == "/docs": return os.path.join(EN, "index.mdx"), ""
    if path == "/docs/zh-Hans": return os.path.join(ZH, "index.mdx"), ""
    zh = path.startswith("/docs/zh-Hans/")
    base = path[len("/docs/zh-Hans/"):] if zh else path[len("/docs/"):]
    if not base: return None, None
    f = find_file(ZH if zh else EN, base)
    if f: return f, ""
    if zh:  # untranslated -> Docusaurus serves EN content under the zh URL
        f = find_file(EN, base)
        if f: return f, "zh-Hans fallback: no zh translation; content = EN source"
    return None, None

def main():
    pages = json.load(open(os.path.join(SRC, "site-pages.json")))
    # merge retry results (crawl-time connection failures -> true status)
    retryf = os.path.join(HERE, "retry-none.json")
    if os.path.isfile(retryf):
        retry = json.load(open(retryf))
        for u in retry.get("ok", []): pages[u]["status"] = 200
        for u, s in retry.get("bad", []): pages[u]["status"] = s if isinstance(s, int) else None
        json.dump(pages, open(os.path.join(SRC, "site-pages.json"), "w"), indent=1)
    live = {u: v for u, v in pages.items() if v["status"] == 200 and not u.endswith((".md", ".mdx"))}

    mapped, fallback, unresolved, lines = {}, 0, [], []
    for u in sorted(live):
        f, note = resolve(u)
        if f:
            mapped[u] = (f, note)
            if note: fallback += 1
        elif note:
            unresolved.append((u, note))
        else:
            unresolved.append((u, "no source file at HEAD (deploy drift / generated from skill sources)"))
    for u in sorted(mapped):
        f, note = mapped[u]
        lines.append(f"{u}\t-> src/{f}" + (f"   [{note}]" if note else ""))
    with open(os.path.join(SRC, "site-pages-map.txt"), "w") as fh:
        fh.write(f"# Live Hermes docs pages (HTTP 200): {len(live)}\n")
        fh.write(f"# resolved to a local file: {len(mapped)}  (of which zh->EN fallback: {fallback})\n")
        fh.write(f"# no single source file (see tail of this file): {len(unresolved)}\n\n")
        fh.write("\n".join(lines) + "\n")
        if unresolved:
            fh.write("\n# --- live pages with no single website/docs source file ---\n")
            fh.write("\n".join(f"{u}\t-> {note}" for u, note in sorted(unresolved)) + "\n")

    # reverse completeness check: every local md file's expected URL must be live
    expect = {}
    def add_tree(root, prefix):
        base = os.path.join(SRC, root)
        for r, _, names in os.walk(base):
            for n in names:
                if n.endswith((".md", ".mdx")):
                    p = os.path.splitext(os.path.relpath(os.path.join(r, n), base))[0]
                    if p.endswith("/index"): p = p[: -len("/index")]
                    expect[prefix if p == "index" else prefix + "/" + p] = os.path.join(root, p + os.path.splitext(n)[1])
    add_tree(EN, "/docs")
    add_tree(ZH, "/docs/zh-Hans")
    ORIGIN = "https://hermes-agent.nousresearch.com"
    offsite = sorted(u for u in expect if (ORIGIN + u) not in live)
    with open(os.path.join(SRC, "site-pages-map.txt"), "a") as fh:
        fh.write(f"\n# --- reverse check: {len(expect)} local md files; {len(expect)-len(offsite)} of their URLs are live 200 pages ---\n")
        fh.write("\n".join(f"{ORIGIN}{u}\tLOCAL-ONLY (URL not live): src/{expect[u]}" for u in offsite) + "\n")
    print(f"live pages: {len(live)} | mapped: {len(mapped)} (zh->EN fallback: {fallback}) | no-md-source: {len(unresolved)}")
    for u, note in sorted(unresolved):
        if not u.startswith("/docs/zh-Hans"): print(f"  EN-no-source: {u} -> {note}")
    print(f"local md files: {len(expect)} | local-only (URL not live): {len(offsite)}")
    for u in offsite[:10]: print("  LOCAL-ONLY:", u, "->", expect[u])

if __name__ == "__main__":
    main()
