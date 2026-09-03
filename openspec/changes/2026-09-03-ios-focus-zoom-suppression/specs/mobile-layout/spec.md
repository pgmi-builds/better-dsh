## ADDED Requirements

### Requirement: iOS focus auto-zoom suppression on narrow viewports

The plugin's host half SHALL suppress the iOS Safari focus-triggered auto-zoom by rewriting the page's viewport meta (appending `maximum-scale=1` and `user-scalable=no`) inside the injected head boot script — before any application bundle can focus an input. The rewrite SHALL be doubly gated: iOS-class browsers only AND viewport width below the configured `mobile.breakpoint`; it SHALL re-evaluate when the viewport crosses the breakpoint (rewrite on entry, restore on exit), SHALL create the meta element if absent, and SHALL be idempotent under repeated evaluation. The behavior SHALL be config-gated via `mobile.zoomGuard` (`'meta'` default; `'off'` fully disables any rewriting). Non-iOS browsers and wide viewports SHALL observe stock viewport meta bytes. The plugin SHALL NOT otherwise alter zoom behavior; pinch zoom remains engine-controlled (iOS 10+ ignores `user-scalable=no` for pinch).

#### Scenario: iOS narrow focus does not zoom

- **WHEN** an input, select, checkbox, or contenteditable receives focus on an iOS-class browser below the breakpoint with `zoomGuard: 'meta'`
- **THEN** the visual viewport does not scale up; the page keeps its layout width and no content overflows the screen

#### Scenario: Rewrite lands before first possible focus

- **WHEN** the head boot script executes during page load
- **THEN** the viewport meta rewrite is applied synchronously before any application bundle materializes, so no zoom flash can occur on an early auto-focus

#### Scenario: Desktop and wide viewports unaffected

- **WHEN** the page loads on a desktop browser, or on any device at or above the breakpoint
- **THEN** the viewport meta is byte-identical to stock and zoom behavior is unchanged

#### Scenario: Non-iOS touch browsers unaffected

- **WHEN** the page loads on a non-iOS touch browser (e.g. Android Chrome) below the breakpoint
- **THEN** the viewport meta is not rewritten (Android never focus-zooms; the gate avoids `maximum-scale` side effects there)

#### Scenario: Breakpoint crossing re-evaluates

- **WHEN** the viewport crosses the breakpoint after load (rotation, split-screen)
- **THEN** the rewrite is applied on entering the narrow band and the stock meta content is restored on leaving it

#### Scenario: Config off restores stock behavior

- **WHEN** `mobile.zoomGuard` is `'off'`
- **THEN** no meta rewriting occurs on any platform or viewport, and behavior matches the unpatched product

#### Scenario: Idempotent evaluation

- **WHEN** the re-evaluation runs multiple times within one state (load, resize storms, repeated crossings)
- **THEN** the meta content does not accumulate duplicate tokens or regress
