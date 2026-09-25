# hermes-dev-skill — Hermes Agent dev docs (fetch stage)

This directory holds the **complete official Hermes Agent developer documentation**, fetched
locally so agents that develop / integrate with Hermes Agent can work without hitting the live
site. This stage only does the **fetching**; distillation into a skill is a separate follow-up
(same two-stage convention as `dashr/dsh-dev-skill`).

Fetch date: **2026-09-16** · Docs site deploy audited live the same day.

## What was fetched

Three sources, cross-verified against each other:

1. **Source repo:** `NousResearch/hermes-agent` (branch `main`), path `website/docs/`
   — the Markdown/MDX the Docusaurus site is generated from.
   - Commit: `4e9d3c713a3e3d47319ab18a8d8dfade5665270d` (partial sparse clone, `website/` only)
   - English: `website/docs/**` (457 `*.md` + 3 `*.mdx` + 7 `_category_.json`)
   - 简体中文: `website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/**` (312 `*.md`)
2. **Live site:** https://hermes-agent.nousresearch.com/docs/ (Docusaurus), crawled
   BFS from `/docs/` and `/docs/zh-Hans/` → **919 live pages** (465 en + 454 zh-Hans).
3. **Site-provided LLM entry points** (the site generates these fresh on every deploy —
   better than anything we could synthesize, snapshot both):
   - `/docs/llms.txt` — curated index of every doc page, 227 entries, ~43 KB
   - `/docs/llms-full.txt` — **every doc page concatenated into one markdown file** (~4.5 MB),
     one-shot ingestion; frontmatter stripped, source-file markers included
   - `/docs/api/skills.json` (59 MB) + `/docs/api/plugins.json` (72 KB) — machine-readable
     catalogs of all bundled/optional skills and plugins

## Layout

```
hermes-dev-skill/
├── src-README.md                  # this file (fetch manifest)
├── src-scripts/                   # fetch tooling (provenance; one-shot, re-runnable)
│   ├── clone_repo.sh               # partial sparse clone of website/docs + i18n
│   ├── crawl.py                    # concurrent BFS crawl (en + zh-Hans) -> src/site-pages.json
│   ├── verify_orphans.py           # makeup pass for orphan pages the link-crawl can't see
│   ├── gen_mapping.py              # builds src/site-pages-map.txt (+ reverse completeness check)
│   └── retry-none.json             # crawl-time connection-failure retries (provenance)
└── src/
    ├── docs/                      # THE COMPLETE EN DOCS — verbatim repo website/docs/
    │   ├── getting-started/         # install, quickstart, platforms, nix, termux
    │   ├── user-guide/              # CLI/TUI, config, sessions, skills/**, messaging/**, secrets/**
    │   ├── developer-guide/         # architecture, agent-loop, plugin SDK, provider adapters, …
    │   ├── guides/                  # how-to recipes (cron, oauth, migrations, …)
    │   ├── integrations/, reference/ # portal/vertex/bedrock; CLI/env/models/tools catalogs
    │   └── index.mdx                # docs root (frontmatter slug: /)
    ├── i18n/zh-Hans/              # 简体中文 docs (same layout; PARTIAL translation — see below)
    ├── llms.txt                   # snapshot: curated index of every doc page
    ├── llms-full.txt              # snapshot: all pages in ONE file for one-shot LLM ingestion
    ├── api-skills.json            # snapshot: full machine-readable skills catalog
    ├── api-plugins.json           # snapshot: plugin catalog
    ├── site-pages.json            # every crawled URL + HTTP status + lang
    ├── site-pages-map.txt         # each live URL -> the local file it resolves to
    └── docusaurus.config.ts       # site config (URL rules reference)
```

## Completeness proof

- **Forward:** 919 live pages (HTTP 200) from BFS crawl + orphan verification; **911 resolve to
  an exact local file**, 8 have no single md source and are accounted for:
  - `/docs/plugins`, `/docs/skills` → React pages (`website/src/pages/*/index.tsx`)
  - `/docs/api/plugins.json`, `/docs/api/skills.json` → snapshotted JSON catalogs (see above)
  - 4 URLs (plugins/skills zh twins + one skill page) → generated from repo skill sources
    (`optional-skills/**/SKILL.md`), or deploy drift; content is covered by the catalogs.
- **Reverse:** all **774** local md files' expected URLs are live pages **except one**:
  `zh-Hans/user-guide/skills/bundled/apple/apple-macos-computer-use.md` exists at HEAD but 404s
  on the deployed site (deploy drift; the en page is present).
- **llms.txt cross-check:** all 227 llms.txt URLs resolve to local files. 233 local files are
  NOT in llms.txt — intentionally excluded per-skill catalog pages under
  `user-guide/skills/{bundled,optional}/**` (83 + 149) plus the docs root.
- **Fidelity:** sampled pages match `llms-full.txt` verbatim after normalizing the bundle's
  transformations (frontmatter stripped, page title injected as H1, links rewritten `./x.md`).

## Language duality and the i18n fallback (important)

- `src/docs/` = English, `src/i18n/zh-Hans/` = 简体中文. **Translation is partial**: the zh tree
  has 314 files vs 467 en. Untranslated pages still exist on the zh site — Docusaurus serves the
  **ENGLISH content under the `/docs/zh-Hans/…` URL** (138 such URLs, marked
  `[zh-Hans fallback: … EN source]` in `site-pages-map.txt`). When working from a zh URL, look
  the path up in the map: if it says fallback, read the en file.
- `llms.txt` / `llms-full.txt` are **English-only**.

## Fast paths for agents

- **One-shot context:** load `src/llms-full.txt` (4.5 MB — chunk it) or grep it; it is the
  whole docs site in one file.
- **Skill/plugin inventory:** `src/api-skills.json` (59 MB, every skill with name/description/
  category/source/tags) and `src/api-plugins.json`. Parse with `jq`/streaming — do not cat.
- **URL → file:** `grep '<url-path>' src/site-pages-map.txt`.
- **Topic search:** `grep -r --include='*.md' <term> src/docs/` (en) / `src/i18n/zh-Hans/` (zh).

## Updating (re-fetch)

1. `bash src-scripts/clone_repo.sh` → refresh `src/docs` + `src/i18n/zh-Hans` from a new HEAD
   (record the commit SHA here).
2. `python3 src-scripts/crawl.py` (few minutes; concurrent) → `src/site-pages.json`.
3. Re-download the four snapshots from the stable URLs (`/docs/llms.txt`, `/docs/llms-full.txt`,
   `/docs/api/{skills,plugins}.json`).
4. `python3 src-scripts/gen_mapping.py` → refresh `src/site-pages-map.txt`; if it reports
   `LOCAL-ONLY` misses, `python3 src-scripts/verify_orphans.py` then re-run step 4.
