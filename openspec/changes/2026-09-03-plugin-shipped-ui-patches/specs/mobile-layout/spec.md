## ADDED Requirements

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
