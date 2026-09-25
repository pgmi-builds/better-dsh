# pi-and-omp — pi.dev & omp.sh official docs (fetch stage)

Grouped together because **omp (oh-my-pi) is pi-based** — the projects share lineage and an
overlapping vocabulary (`sdk`, `rpc`, `session-format`, `sessions`, `settings`, `keybindings`,
`skills`, `prompt-templates`, `providers`, …). But their **exposed SDKs are not the same
surface**, so each project is fetched independently into its own sub-directory:

- **`pi/`**  ← https://pi.dev/docs/latest  (Pi, by Earendil Inc.)  — **30 pages**
- **`omp/`** ← https://omp.sh/docs        (omp, by Stencil)       — **56 pages**

Proof that the "related but different" reading is right: omp's SDK (`@oh-my-pi/pi-coding-agent`,
Bun-only) mirrors pi's SDK API (`createAgentSession`, `SessionManager.inMemory`, stream events
like `message_update`) — omp renamed/reforked pi's package — yet omp's own doc surface diverges
with pages pi does not have (`acp`, `plugins`, `marketplace`, `hooks`, `custom-tools`, `modes`,
`ttsr`, …), and pi keeps pages omp lacks (`termux`, `tmux`, `llama-cpp`, `compaction`,
`packages`, …). Distill each project from its own directory.

## Method

- **pi.dev** — server-rendered site. The full set under `/docs/*` was BFS-crawled (queue drained
  to zero → 30 pages). Each page was fetched as raw HTML and converted locally to Markdown
  (BeautifulSoup + markdownify on the `section.docs-article-card` article container).
- **omp.sh** — client-rendered SPA (every path returns only a JS shell; `llms.txt`/`sitemap.xml`
  are not a content source — the sitemap is **stale, listing only 35 of 56 pages**). The app's
  own router table and compiled page chunks carry the authoritative set: **56 docs pages**
  (55 topics + the `/docs` Overview). Content was recovered from the site's compiled MDX chunks:
  each page's element tree was materialized with stub runtimes (record-only `jsx-runtime`) under
  Node, then serialized to Markdown. This preserves internal links (`[Providers](/docs/providers)`),
  fenced code with languages, tables, `<kbd>`, and definition lists — higher fidelity than a
  headless-browser text render.
- Every file starts with an HTML comment header: `<!-- source: <URL>  fetched: 2026-09-06 -->`.

## Layout

```
pi-and-omp/
├── README.md
├── .tools/                        # fetch tooling + provenance (re-run recipes)
│   ├── pi_pages.txt  omp_pages.txt           # canonical URL inventories (30 / 56)
│   ├── pi_convert.py  fetch_pi.py            # pi.dev: html -> markdown
│   ├── extract_omp.mjs  serialize_omp.py     # omp.sh: chunks -> element trees -> markdown
│   ├── jsx-runtime-BHwPObl3.js  MdxPage-CTY7atqe.js  package.json   # record-only stubs
│   └── omp_extracted.json                    # element trees (source of truth for omp/)
├── pi/                            # 30 markdown files, one per /docs/latest page
│   ├── index.md  quickstart.md  usage.md  development.md  models.md  providers.md
│   ├── custom-provider.md  settings.md  keybindings.md  sessions.md  session-format.md
│   ├── compaction.md  containerization.md  environment-variables.md  extensions.md
│   ├── json.md  llama-cpp.md  packages.md  prompt-templates.md  rpc.md  sdk.md
│   ├── security.md  shell-aliases.md  skills.md  terminal-setup.md  termux.md
│   ├── themes.md  tmux.md  tui.md  windows.md
│   └── pages.txt                   # 30 canonical URLs
└── omp/                           # 56 markdown files (55 topic slugs + Overview for /docs)
    ├── Overview.md  quickstart.md  using.md  slash.md  keybindings.md  settings.md  modes.md
    ├── sessions.md  session-tree.md  memory.md  compaction.md  plan.md  goal.md  handoff.md
    ├── files.md  code-intelligence.md  debugging.md  editing.md  review.md  commit.md
    ├── security.md  subagents.md  advisor.md  vibe.md  collab.md  web.md  computer.md
    ├── github.md  providers.md  roles.md  agents-and-roles.md  custom-models.md  prewalk.md
    ├── context-files.md  skills.md  prompt-templates.md  magic-keywords.md  hooks.md
    ├── custom-tools.md  subagent-authoring.md  mcp.md  mcp-authoring.md  themes.md  ttsr.md
    ├── plugins.md  extension-authoring.md  marketplace.md  sdk.md  rpc.md  acp.md  cli.md
    ├── env.md  secrets.md  approvals.md  session-format.md  tools.md
    └── pages.txt                   # 56 canonical URLs
```

## Completeness

- **pi.dev**: 30/30 fetched, 0 failures — full reachable `/docs/*` set.
- **omp.sh**: 56/56 pages (55 router topics + Overview) recovered from the compiled chunks;
  every page mapped to its router entry, none missing. Fences balanced, no empty files, no
  renderer-chrome artifacts.

## Provenance / re-run notes

- `pi/` and `omp/` are derived from live site snapshots fetched 2026-09-06. If the upstream
  sites change, re-run the recipes in `.tools/`:
  - pi: re-crawl `/docs/*`, then `fetch_pi.py` (needs `markdownify` + `beautifulsoup4`).
  - omp: re-download the six `assets/*.js` page chunks (names are version-hashed), place them
    next to `extract_omp.mjs`, ensure the stub filenames match the current `jsx-runtime` /
    `MdxPage` hashes, run `node extract_omp.mjs`, then `python3 serialize_omp.py`.
- `.tools/omp_extracted.json` lets `serialize_omp.py` rebuild `omp/*.md` without re-downloading.
