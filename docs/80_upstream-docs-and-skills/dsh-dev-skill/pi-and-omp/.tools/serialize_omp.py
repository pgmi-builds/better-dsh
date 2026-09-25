#!/usr/bin/env python3
"""Serialize omp extracted element trees (omp_extracted.json) to markdown files."""
import json, os, re, datetime, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "omp")   # HERE=pi-and-omp/.tools -> pi-and-omp/omp
os.makedirs(OUT, exist_ok=True)
TODAY = "2026-09-06"

WS_RE = re.compile(r"^\s*$")

def children_of(node):
    """Return list of child tokens (strings/elements) with whitespace-only separators dropped."""
    ch = node.get("p", {}).get("children") if isinstance(node, dict) else None
    if ch is None:
        return []
    if not isinstance(ch, list):
        ch = [ch]
    out = []
    for x in ch:
        if isinstance(x, str):
            if WS_RE.match(x):
                continue
            out.append(x)
        elif isinstance(x, (int, float)):
            out.append(str(x))
        elif isinstance(x, dict):
            out.append(x)
        else:
            out.append(str(x))
    return out

def is_elem(x):
    return isinstance(x, dict) and "t" in x

def tag(x):
    return x.get("t") if is_elem(x) else None

def text_of(x):
    """Plain text of a token or subtree."""
    if isinstance(x, str):
        return x
    if isinstance(x, (int, float)):
        return str(x)
    if not is_elem(x):
        return ""
    t = tag(x)
    if t == "br":
        return "\n"
    return "".join(text_of(c) for c in children_of(x))

def inline(x):
    """Markdown inline rendering of a token or subtree."""
    if isinstance(x, str):
        return x
    if isinstance(x, (int, float)):
        return str(x)
    if not is_elem(x):
        return ""
    t = tag(x)
    props = x.get("p", {})
    if t == "br":
        return "\n"
    if t == "code":
        return "`%s`" % text_of(children_of(x)[0]) if children_of(x) else "``"
    if t == "kbd":
        return "<kbd>%s</kbd>" % text_of(x)
    if t == "strong":
        return "**%s**" % "".join(inline(c) for c in children_of(x))
    if t == "em":
        return "*%s*" % "".join(inline(c) for c in children_of(x))
    if t == "a":
        href = props.get("href", "")
        inner = "".join(inline(c) for c in children_of(x))
        return "[%s](%s)" % (inner, href)
    # default: recurse inline for unknown inline-ish tags
    return "".join(inline(c) for c in children_of(x))

def text_of_list(tokens):
    return "".join(text_of(t) for t in tokens)

def render_table(node):
    rows = []  # list of list of str (inline cell md)
    for child in children_of(node):  # thead/tbody/tr
        ctag = tag(child)
        if ctag == "thead":
            for tr in children_of(child):
                if tag(tr) == "tr":
                    cells = [inline(c) for c in children_of(tr) if tag(c) == "th"]
                    rows.append(cells)
        elif ctag == "tbody":
            for tr in children_of(child):
                if tag(tr) == "tr":
                    cells = [inline(c) for c in children_of(tr) if tag(c) == "td"]
                    rows.append(cells)
        elif ctag == "tr":  # loose table without thead
            cells = [inline(c) for c in children_of(child) if tag(c) in ("td", "th")]
            rows.append(cells)
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    # escape pipes inside cells
    esc = lambda s: s.replace("|", "\\|").replace("\n", " ")
    lines = ["| " + " | ".join(esc(c) for c in rows[0]) + " |"]
    lines.append("| " + " | ".join("---" for _ in range(ncol)) + " |")
    for r in rows[1:]:
        lines.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(lines)

def render_list(node, depth=0):
    ordered = tag(node) == "ol"
    lines = []
    items = [c for c in children_of(node) if tag(c) == "li"]
    num = 1
    indent = "  " * depth
    for li in items:
        marker = ("%d. " % num) if ordered else "- "
        num += 1
        toks = children_of(li)
        # split: leading inline text then optional nested blocks
        first = ""
        rest = []
        for tk in toks:
            if is_elem(tk) and tag(tk) in ("ul", "ol", "p", "pre", "table"):
                rest.append(tk)
            else:
                first += inline(tk)
        if first:
            lines.append(indent + marker + first)
            # content after a list item paragraph stays aligned
            for r in rest:
                if tag(r) in ("ul", "ol"):
                    lines.append(render_list(r, depth + 1).rstrip("\n"))
                elif tag(r) == "p":
                    for sub in children_of(r):
                        lines.append(indent + "  " + inline(sub))
                elif tag(r) == "pre":
                    lines.append(indent + "  " + render_pre(r).replace("\n", "\n" + indent + "  "))
                elif tag(r) == "table":
                    lines.append(indent + "  " + render_table(r).replace("\n", "\n" + indent + "  "))
        else:
            # li whose content starts with nested list
            firstmd = "".join(render_list(r, depth + 1).rstrip("\n") for r in rest if tag(r) in ("ul", "ol"))
            if firstmd:
                lines.append(indent + marker.rstrip())
                lines.append(firstmd)
            else:
                lines.append(indent + marker)
    return "\n".join(lines) + "\n"

def render_pre(node):
    lang = ""
    code_txt = ""
    for c in children_of(node):
        if tag(c) == "code":
            cls = c.get("p", {}).get("className", "")
            m = re.match(r"language-([\w+-]+)", cls or "")
            if m:
                lang = m.group(1)
            code_txt = text_of(c)
            break
    fence = "```"
    return "%s%s\n%s\n%s" % (fence, lang, code_txt.rstrip("\n"), fence)
def render_dl(node):
    """dt/dd description list -> bold label paragraph + content paragraphs."""
    out = []
    cur_label = None
    for child in children_of(node):
        if isinstance(child, str):
            continue
        t = tag(child)
        if t == "dt":
            cur_label = "**" + text_of(child).strip() + "**"
        elif t == "dd" and cur_label:
            out.append(cur_label)
            for c in children_of(child):
                if isinstance(c, str):
                    continue
                ct = tag(c)
                if ct == "p":
                    out.append("".join(inline(k) for k in children_of(c)).strip())
                elif ct == "ul" or ct == "ol":
                    out.append(render_list(c).rstrip("\n"))
                elif ct == "pre":
                    out.append(render_pre(c))
                else:
                    out.append(render_block(c).rstrip("\n"))
            cur_label = None
    return "\n\n".join(x for x in out if x)


def render_block(node):
    t = tag(node)
    if t is None:
        return inline(node)
    if t == "@@FRAGMENT@@":
        return "\n\n".join(render_block(c).rstrip("\n") for c in children_of(node))
    if t in ("h2", "h3", "h4"):
        return "%s %s" % ("#" * int(t[1]), "".join(inline(c) for c in children_of(node)).strip())
    if t == "dl":
        return render_dl(node)
    if t == "p":
        return "".join(inline(c) for c in children_of(node)).strip()
    if t == "pre":
        return render_pre(node)
    if t == "ul" or t == "ol":
        return render_list(node).rstrip("\n")
    if t == "table":
        return render_table(node)
    if t == "blockquote":
        body = "".join(render_block(c) for c in children_of(node)).strip()
        return "\n".join("> " + ln for ln in body.split("\n"))
    if t == "hr":
        return "---"
    if t == "li":
        return inline(node)
    return "".join(inline(c) for c in children_of(node))

def page_markdown(entry):
    title = entry.get("title") or ""
    lede = entry.get("lede") or ""
    tree = entry.get("tree")
    parts = []
    if title:
        parts.append("# " + title.strip())
    if lede:
        parts.append("> " + lede.strip())
    body = ""
    if tree:
        body = render_block(tree)  # tree root is the @@FRAGMENT@@ element
    parts.append(body)
    md = "\n\n".join(p.strip("\n") for p in parts if p and p.strip())
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"

def slug_to_url(slug):
    return "https://omp.sh/docs" if slug == "Overview" else "https://omp.sh/docs/" + slug

if __name__ == "__main__":
    data = json.load(open(os.path.join(HERE, "omp_extracted.json"), encoding="utf-8"))
    n = 0
    for slug, entry in sorted(data.items()):
        url = slug_to_url(slug)
        md = page_markdown(entry)
        header = "<!--\nsource: %s\nfetched: %s\n-->\n\n" % (url, TODAY)
        with open(os.path.join(OUT, slug + ".md"), "w", encoding="utf-8") as f:
            f.write(header + md)
        n += 1
    print("wrote", n, "markdown files to", OUT)
