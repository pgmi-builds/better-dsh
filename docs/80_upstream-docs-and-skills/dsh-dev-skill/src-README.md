# dsh-dev-skill — DeepSeek Harness dev docs (fetch stage)

This directory holds the **complete official DeepSeek Harness developer documentation**, fetched
locally so it can later be distilled into skills. This stage only does the **fetching**; distillation
is a separate follow-up.

## What was fetched

The official docs live in the source repo and are what the public docs site is generated from:

- **Source repo:** `deepseek-ai/deepseek-harness` (`master` branch)
- **Source directory:** `docs/` (241 Markdown files)
- **Rendered site (referenced by the user):**
  - https://deepseek-harness.github.io/deepseek-harness/guide/quickstart
  - https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer

## Layout

```
dsh-dev-skill/
├── src-README.md                  # this file (fetch manifest)
├── src-scripts/                   # fetch tooling (provenance; one-shot)
│   ├── crawl.py                    # BFS crawler -> pages.json (site URL inventory)
│   ├── download.py                 # downloads docs/*.md from the repo -> src/docs/
│   ├── gen_mapping.py              # builds site-pages.json + site-pages-map.txt
│   └── docs-tree.json, pages.json  # intermediate data
└── src/
    ├── docs/                     # THE COMPLETE DOCS — 241 Markdown files, repo-relative layout
    │   ├── user/guide/*            # 使用 Web UI / guide (zh + en)
    │   ├── user/develop/*          # 开发 (basic / framework / practice)
    │   ├── cordis-primer.md(.zh)   # Cordis 入门 (starting page 2)
    │   ├── cordis-tutorial/        # Cordis 教程 (01-07 + index)
    │   ├── cordis-api/             # Cordis API (context/events/fiber/registry/service)
    │   ├── subsystems/             # 子系统 reference (web, core, session, tools, …)
    │   ├── cookbook/               # how-to recipes
    │   ├── i18n/, postmortem/,     # contributor + postmortem docs (kept for completeness)
    │   └── *.md                    # top-level references (config-catalog, tool-catalog, …)
    ├── site-pages.json           # 230 URLs crawled from the site (the "starting page + linked pages" set)
    └── site-pages-map.txt        # each crawled URL -> local markdown file it resolves to
```

## Completeness proof

From the two starting URLs, the live site was BFS-crawled following every internal page link:

- **230 pages discovered** (115 zh + 115 en), recorded in `src/site-pages.json`
- **`src/site-pages-map.txt`** maps each of those 230 URLs to its local Markdown file
  - 226 resolve to an exact file in `./src/docs/`
  - 4 are the `/reference` **section index** page (a config-assembled landing with no single
    source file); all of its child pages are present under `./src/docs/`

Verified that `master` `docs/` matches the published site (the zh quickstart and cordis-primer
source match the rendered pages verbatim), so the Markdown source is a faithful, complete copy.

## Language duality

Both languages are included, named per repo convention:

- English: `*.md` (123 files)
- 简体中文: `*.zh.md` (118 files)

The two user-provided URLs default to the Chinese (zh) build, but the English equivalents are
the same content and are included for completeness.
