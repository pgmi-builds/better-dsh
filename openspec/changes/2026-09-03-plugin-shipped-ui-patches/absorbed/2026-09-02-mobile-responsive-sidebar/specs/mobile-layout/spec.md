## ADDED Requirements

### Requirement: Sidebar hidden on narrow viewports

On the user's hosts where the mobile responsiveness patch is applied, the right sidebar SHALL collapse to zero width (hidden) under narrow-viewport (mobile) conditions via static CSS aligned with the upstream layout paradigm (media/container queries over semantic attributes, no JavaScript geometry measurement), restoring horizontal swipe interactions; swipe recognition SHALL incorporate a velocity threshold alongside origin and distance so that slow press-drag gestures (text selection for copy and similar operations) are NOT misclassified as swipes; the behavior SHALL NOT change desktop-layout rendering, and the patch SHALL NOT ship as a default-enabled feature of the plugin.

#### Scenario: Narrow viewport hides the sidebar

- **WHEN** the page renders at a mobile-class viewport width with the patch applied
- **THEN** the right sidebar occupies zero width (is hidden) and the main conversation area uses the full width

#### Scenario: Swipe interactions restored

- **WHEN** the sidebar is hidden at a mobile-class viewport
- **THEN** horizontal swipe gestures with genuine velocity function without the visible-sidebar layout interfering, while slow press-drag text-selection gestures do not trigger any swipe action

#### Scenario: Desktop layout unaffected

- **WHEN** the page renders at desktop-class viewport width with the patch applied
- **THEN** the sidebar and overall layout behave identically to the unpatched product
