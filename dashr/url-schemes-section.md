# Internal URLs (dsh-url-schemes)

read/write/grep/glob accept a `scheme://` URL anywhere a filesystem path is expected: `scheme://<path>[:selector]`. Reading a bare root (`ctx://`, `agent://`, `dvc://`, `skill://`) lists that scheme's surface — treat it as the scheme's help.

Selectors: `:raw` (full underlying content) | `:N-M[,N2-M2]` (1-based inclusive lines; `N-` = open tail) | `:path/<a.b>` (JSON dot-path) | `?q=<q>` (dot-path, else line filter). `ctx://*:raw` always returns the full underlying content; a bare URL returns the prepared face when the facility prepares one (summaries, snapshots). Line windows always index the canonical full content, so `:raw:N-M` ≡ `:N-M`.

Variance: `dvc://` addresses a device by its first path segment only; `ctx://` collections take `[n]` brackets in the path (0-based ordinal or event seq); `http(s)://` is selector-exempt (`:8443` is a port, `?x=1` a query).

Writes: only `dvc://<device>` is writable (JSON args payload executes the device). Every static/system resource — everything under `ctx://`, `skill://`, `agent://`, `dsh://`, `http(s)://` — is read-only.

Schemes:
- `skill://<name>[/<file>]` — a registered skill's files; first level = skill names.
- `agent://[<id>[/transcript]]` — agent roster / a LIVE agent's transcript.
- `dsh://docs[/<doc>]` and `dsh://config` — harness docs / live resolved config.
- `ctx://session/<face>` — THIS session's own log; faces: `transcript`, `compactions`, `compactions[<label|n>]`, `thinking`, `system`, `user_prompts[n]`, `tool_calls[n]`, `agent_responses[n]`.
- `dvc://<device>` — device registry; devices: `ast_edit`, `ast_grep`, `browser`, `lsp`; `write` executes.
- `http(s)://<host>/<path>` — plain fetch.

Bulk: prefer grep or `:N-M` line windows over full reads.
