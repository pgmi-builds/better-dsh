# mobile-layout Specification

## Purpose
better-dsh 的移动端布局与输入契约：窄视口侧栏轨 0（注入 CSS 覆盖，桌面档零影响）、三条件滑动手势（边缘带 × 距离 × 速率，纯函数可测）、iOS focus 自动放大抑制 zoomGuard（browser=viewport meta token 改写 / standalone=16px 字号地板双形态，`'off'` 逃生门），全部随插件发布、config 门控（`mobile.enabled` / `mobile.breakpoint` / `mobile.zoomGuard`）。

## Requirements

### Requirement: iOS focus auto-zoom suppression on narrow viewports

The plugin's host half SHALL suppress the iOS Safari focus-triggered auto-zoom with **display-mode-dependent behavior**:

- **Browser context** (not standalone): rewrite the page's viewport meta (appending `maximum-scale=1` and `user-scalable=no`) inside the injected head boot script — before any application bundle can focus an input — with the v0.2.4 machinery (double gate iOS-class UA AND narrow viewport, breakpoint re-evaluation, provisional/reconcile single-meta invariant, early-load re-evaluation ladder, idempotent merge, byte-level restore). Real-device datum (2026-09-03): in-browser iOS Safari ignores `user-scalable=no` for pinch, so pinch zoom remains available in this mode.
- **Standalone context** (`(display-mode: standalone)` media query matches OR `navigator.standalone === true`): the plugin SHALL NOT touch the viewport meta at all (no rewrite, no provisional, no listeners, no timers — real-device datum: standalone iOS honors `user-scalable=no` and pinch would break), and SHALL instead inject a static style element (`id="ios-zoom-font-floor"`, carrying the plugin's style-claim attributes) with `@media (max-width: {breakpoint-0.02}px){ input,textarea,select,[contenteditable="true"]{ font-size:16px !important } }`, which suppresses the focus auto-zoom by the font-size mechanism.

Both branches SHALL be config-gated via `mobile.zoomGuard` (`'meta'` default = auto dual-mode behavior; `'off'` emits neither branch on any platform). Non-iOS browsers and wide viewports SHALL observe stock behavior in both display modes.

#### Scenario: iOS narrow focus does not zoom

- **WHEN** an input, select, checkbox, or contenteditable receives focus on an iOS-class browser below the breakpoint with `zoomGuard: 'meta'`
- **THEN** no auto-zoom occurs in either display mode: browser mode suppresses it via the rewritten viewport meta, standalone mode via the 16px font-floor style

#### Scenario: Rewrite lands before first possible focus

- **WHEN** the head boot script executes during page load in browser (non-standalone) display mode
- **THEN** the viewport meta rewrite is applied synchronously before any application bundle materializes, so no zoom flash can occur on an early auto-focus

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

#### Scenario: Non-iOS touch browsers unaffected

- **WHEN** the page loads on a non-iOS touch browser (e.g. Android Chrome) below the breakpoint, in either display mode
- **THEN** the viewport meta is not rewritten and no font-floor style is injected (Android never focus-zooms; the iOS gate avoids `maximum-scale` side effects there)

#### Scenario: Breakpoint crossing re-evaluates

- **WHEN** the viewport crosses the breakpoint after load (rotation, split-screen) in browser display mode
- **THEN** the rewrite is applied on entering the narrow band and the stock meta content is restored on leaving it; in standalone mode the font-floor style's media query naturally stops matching above the breakpoint (no JS re-evaluation exists there)

#### Scenario: Desktop and wide viewports unaffected

- **WHEN** the page loads on a desktop browser, a non-iOS browser, or at/above the breakpoint (either display mode)
- **THEN** the viewport meta is stock and no font-floor style is injected (the floor's media query does not match above the breakpoint)

#### Scenario: Config off restores stock behavior

- **WHEN** `mobile.zoomGuard` is `'off'`
- **THEN** neither the meta machinery nor the font-floor style exists in any display mode

#### Scenario: Idempotent evaluation

- **WHEN** the browser-mode re-evaluation runs multiple times within one state (load, resize storms, repeated crossings)
- **THEN** the meta content does not accumulate duplicate tokens or regress (standalone mode arms no re-evaluation machinery at all)

### Requirement: Sidebar occupies zero width on narrow viewports

The plugin's client half SHALL hide the sidebar rail (zero-width column track) on narrow viewports via injected static CSS (media query + semantic attribute selectors, `!important` over the inline grid template), aligned with the upstream CSS-first layout paradigm and WITHOUT JavaScript geometry measurement; desktop-class rendering SHALL remain identical to the unpatched product, and the feature SHALL ship with the plugin, config-gated (`mobile.enabled`, default on).

#### Scenario: Mobile viewport hides the rail

- **WHEN** the page renders at a mobile-class viewport width below the configured breakpoint with the feature enabled
- **THEN** the sidebar column track is zero width and the conversation area spans the frame

#### Scenario: Desktop unaffected

- **WHEN** the page renders at or above the breakpoint
- **THEN** layout behavior is identical to the unpatched product

#### Scenario: Degradation is benign

- **WHEN** upstream DOM/attribute changes break the CSS override
- **THEN** the layout falls back to the native rail rendering without errors or blank areas

### Requirement: Three-condition swipe recognition

Swipe recognition SHALL require all three of: gesture origin within the edge band, displacement at or above the distance threshold, and average velocity at or above the velocity threshold; slow press-drag gestures (text selection and similar) SHALL NOT trigger a swipe, and a recognized swipe SHALL toggle the sidebar via the layout service (`ctx.layout.toggleSidebar()`, narrow-viewport semantics), with the velocity/distance predicates implemented as pure functions under unit test.

#### Scenario: Slow text-selection drag does not toggle

- **WHEN** a pointer press-drag covers the distance threshold at sub-threshold velocity (e.g. selecting text to copy)
- **THEN** no sidebar toggle occurs

#### Scenario: Fast swipe toggles

- **WHEN** a pointer gesture starts in the edge band, exceeds the distance threshold, and meets the velocity threshold
- **THEN** the sidebar overlay state toggles (narrowExpanded flips)

#### Scenario: Interactive-element origins are ignored

- **WHEN** a gesture begins on an interactive element (link, button, input)
- **THEN** no swipe recognition runs for that gesture
