## ADDED Requirements

### Requirement: Plugin-shipped fence authorities

The plugin's bundle patch layer SHALL override the `connection` loader row by id, restating the row's full shape, with `config.trustedHosts` computed as the concatenation of `DSH_TRUSTED_HOSTS` environment entries (whitespace-separated) and the upstream `webRuntime`-derived authorities; with the environment variable unset or empty the resulting composition SHALL be byte-equivalent in behavior to the unpatched upstream row (inert by default).

#### Scenario: Env-derived authority passes the fence

- **WHEN** the daemon runs with `DSH_TRUSTED_HOSTS=host.example` and a browser reaches `/api` with `Host: host.example` and same-origin markers
- **THEN** the request passes the Host/Origin trust fence (no 403 from the fence) and the Settings > Models provider directory loads from that authority

#### Scenario: Inert without the environment variable

- **WHEN** the daemon runs without `DSH_TRUSTED_HOSTS`
- **THEN** the fence accepts exactly the authorities the unpatched upstream composition would (loopback, LAN literals on all-interface binds, `--trusted-host` extras)

#### Scenario: Malformed entry fails loud at load

- **WHEN** `DSH_TRUSTED_HOSTS` contains an entry that is not a bare canonical `host[:port]` authority
- **THEN** plugin load fails loudly via the upstream `assertTrustedAuthority` validation instead of silently widening or narrowing the fence

### Requirement: Upgrade-safe replacement of the hand patch

The plugin SHALL NOT require source-level edits to vendored `@deepseek-ai/*` files for fence behavior; the alpha.3 hand patch (`isLoopbackHostname` widening in `dsh-client-connection` index.js and client bundle) SHALL be retirable on alpha.5+ by this capability alone, and the row-override shape SHALL be tracked as an upstream-alignment checklist item (diff `packages/bundle/web-app/cordis.patch.yml`'s `connection` row each alignment round).

#### Scenario: Upstream row drift is detected at alignment time

- **WHEN** an upstream release changes the `connection` row's keys (name, inject, or config shape)
- **THEN** the alignment-round checklist surfaces the drift before the stale restated row ships

### Requirement: User layer keeps precedence

A user's own profile or home `cordis.patch.yml` override of the `connection` row SHALL take precedence over the plugin's bundle layer, preserving the upstream layering contract.

#### Scenario: User override wins

- **WHEN** the user's profile patch restates the `connection` row
- **THEN** the user's row applies, not the plugin's
