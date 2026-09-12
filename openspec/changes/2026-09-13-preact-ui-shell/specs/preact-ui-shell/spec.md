## ADDED Requirements

### Requirement: Preact-shell build for the web UI
The test-line harness build SHALL support building the web shell (`apps/web`) with the React family aliased to `preact/compat` (including `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client` subpaths) via a build-time vite alias, so the platform module seed materializes Preact instances and every upstream client plugin bundle's `require("react")` receives Preact with zero upstream component edits. The alias SHALL be a monorepo-local build patch (documented, re-applied on tag switches), never an upstream source fork.

#### Scenario: Shell serves the UI with Preact
- **WHEN** the test-line instance is rebuilt with the alias patch and a browser loads the served UI
- **THEN** the full upstream UI corpus mounts (sidebar/workspace/settings/chat), the session reports zero `pageerror` and zero `console.error`, and the shell bundle contains no `react-dom` production banner while carrying `preact` identity

#### Scenario: Size regression is measured, not assumed
- **WHEN** the alias build completes
- **THEN** the shell `index` chunk (where the React family rides) is measured against the stock build and the delta recorded in the change report

### Requirement: Test-line-only scope pending a ship decision
The alias patch lives in the harness checkout only. The published plugin package (`@pgmi-builds/better-dsh`) SHALL NOT silently fork the web-UI serve surface: shipping a Preact-built frontend dist through the plugin (web-runtime override rows) is a separate decision gated on the prod host version upgrade, because a shipped dist freezes the UI corpus at the fork point.

#### Scenario: Plugin publish content unchanged by this change
- **WHEN** the next plugin alpha is published after this change
- **THEN** the Preact enhancement is not part of the published artifact; the report records the ship-in-plugin option (dist + override rows) and its corpus-freeze trade-off as a pending decision tied to the prod host upgrade
