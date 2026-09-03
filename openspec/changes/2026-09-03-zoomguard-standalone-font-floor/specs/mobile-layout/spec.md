## MODIFIED Requirements

### Requirement: iOS focus auto-zoom suppression on narrow viewports

The plugin's host half SHALL suppress the iOS Safari focus-triggered auto-zoom with **display-mode-dependent behavior**:

- **Browser context** (not standalone): rewrite the page's viewport meta (appending `maximum-scale=1` and `user-scalable=no`) inside the injected head boot script — before any application bundle can focus an input — with the v0.2.4 machinery (double gate iOS-class UA AND narrow viewport, breakpoint re-evaluation, provisional/reconcile single-meta invariant, early-load re-evaluation ladder, idempotent merge, byte-level restore). Real-device datum (2026-09-03): in-browser iOS Safari ignores `user-scalable=no` for pinch, so pinch zoom remains available in this mode.
- **Standalone context** (`(display-mode: standalone)` media query matches OR `navigator.standalone === true`): the plugin SHALL NOT touch the viewport meta at all (no rewrite, no provisional, no listeners, no timers — real-device datum: standalone iOS honors `user-scalable=no` and pinch would break), and SHALL instead inject a static style element (`id="ios-zoom-font-floor"`, carrying the plugin's style-claim attributes) with `@media (max-width: {breakpoint-0.02}px){ input,textarea,select,[contenteditable="true"]{ font-size:16px !important } }`, which suppresses the focus auto-zoom by the font-size mechanism.

Both branches SHALL be config-gated via `mobile.zoomGuard` (`'meta'` default = auto dual-mode behavior; `'off'` emits neither branch on any platform). Non-iOS browsers and wide viewports SHALL observe stock behavior in both display modes.

#### Scenario: Browser mode rewrites meta (unchanged from v0.2.4)

- **WHEN** an iOS-class browser below the breakpoint loads in a non-standalone display mode with `zoomGuard: 'meta'`
- **THEN** the viewport meta carries `maximum-scale=1, user-scalable=no` (single meta, idempotent, restorable) and no font-floor style is injected

#### Scenario: Standalone mode never touches the viewport meta

- **WHEN** an iOS-class browser below the breakpoint loads with display-mode standalone (matched via media query or `navigator.standalone`) and `zoomGuard: 'meta'`
- **THEN** the viewport meta is byte-identical to stock, no provisional meta is created, no resize/MQ listeners or re-evaluation timers are armed, and the `ios-zoom-font-floor` style element is present with the 16px floor rules scoped to the configured breakpoint

#### Scenario: Standalone pinch zoom is preserved

- **WHEN** the user pinch-zooms in standalone display mode with the guard active
- **THEN** the viewport meta contains no zoom-restricting tokens (pinch is engine-available; suppression relies solely on the font-size floor)

#### Scenario: Font floor suppresses the focus zoom in standalone

- **WHEN** an input, textarea, select, or `[contenteditable="true"]` element receives focus in standalone mode below the breakpoint
- **THEN** its computed font-size is at least 16px and no auto-zoom occurs

#### Scenario: Desktop and wide viewports unaffected

- **WHEN** the page loads on a desktop browser, a non-iOS browser, or at/above the breakpoint (either display mode)
- **THEN** the viewport meta is stock and no font-floor style is injected (the floor's media query does not match above the breakpoint)

#### Scenario: Config off restores stock behavior

- **WHEN** `mobile.zoomGuard` is `'off'`
- **THEN** neither the meta machinery nor the font-floor style exists in any display mode

#### Scenario: Idempotent evaluation (browser mode, unchanged)

- **WHEN** the browser-mode re-evaluation runs multiple times within one state
- **THEN** the meta content does not accumulate duplicate tokens or regress
