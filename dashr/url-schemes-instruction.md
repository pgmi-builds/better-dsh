# Internal URL Schemes

- Format: `scheme://<path>[:selector]`.
- Compatibility: Supported anywhere a filesystem path is accepted across `read`, `write`, `grep`, and `glob`.
- `skill://`, `agent://`, `ctx://`, `dsh://`, `dvc://`, `http(s)://`.
- Reading scheme:// lists available surfaces/help for that scheme.

**Selectors:**
- `:raw` — Accesses the full underlying content bypasses prepared faces/summaries.
- `:N-M[,N2-M2]` — Line range selection (1-based, inclusive; `N-` reads to end). Indexes canonical full content (so `:raw:N-M` ≡ `:N-M`).
- `:path/<a.b>` — Traverses JSON using dot-path notation.
- `?q=<q>` — Dot-path search or plain line filter.

**Schemes:**
- `skill://<name>[/<file>]` — a registered skill's files; first level = skill names.
- `agent://[<id>[/transcript]]` — agent roster / a LIVE agent's transcript.
- `dsh://docs[/<doc>]` and `dsh://config` — harness docs / live resolved config.
- `ctx://session/<face>` — THIS session's own log; faces: `transcript`, `compactions`, `compactions[<label|n>]`, `thinking`, `system`, `user_prompts[n]`, `tool_calls[n]`, `agent_responses[n]`.
- `dvc://<device>` — device registry; devices: `ast_edit`, `ast_grep`, `browser`, `lsp`; `write` executes.
- `http(s)://<host>/<path>` — plain fetch.

Bulk: prefer grep or `:N-M` line windows over full reads.