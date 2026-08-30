# Vendored: dsh-llm-fallbacks

Snapshot of the standalone `dsh-llm-fallbacks` plugin, kept for reference and
as the fork base for dashr's global fallback-provider infrastructure.

- Source: https://github.com/omdsh-dev/dsh-llm-fallbacks
  (listed as `btspoony/dsh-llm-fallbacks` in awesome-dsh-plugins)
- npm: `dsh-llm-fallbacks@0.3.5`
- Vendored commit: `95d94419afb0869a255a4ac0fa232fe3c09cd3f3`
- License: MIT

## Verified properties (2026-08-29)

- **Host-plane / service-level, not agent-scoped.** The host half declares
  `provide = ['llm-fallbacks']`, registers the named service via
  `ctx.provide('llm-fallbacks', …)`, merges `ctx.get('llm-fallbacks')` into the
  cordis `Context`, and hooks the global `agent/request` / `agent/request-error`
  waterfalls on the root context (no `ctx.scope` / `scopeTarget`). Every agent
  and subagent — any preset — flows through these hooks; `agent` arrives as a
  payload for per-agent role/chain resolution, but the mount is global.
- **Web-UI plugin-configurations wired.** The client half registers the
  `FallbacksCard` into the `settings.plugin.item` slot (Settings → Plugins →
  Fallbacks), backed by the host `/api/fallbacks/get|set|reset` RPC gateway,
  plus a `settings.general.item` status row and a `conversation.chat.node`
  transcript switch notice. `package.json` `dsh.client` declares the web client
  bundle; `bundle/cordis.patch.yml` mounts the plugin row.

## Note on host-version peers

`package.json` pins peers at `^0.1.1-rc.2` (matches the installed dsh). If the
host moves to `0.1.2-alpha.1` (the `CallId` → `ToolCallId` rename), this plugin
will need the same peer-range widening / rename handled in dashr — see
`dashr/src/tool-call-id.ts`.
