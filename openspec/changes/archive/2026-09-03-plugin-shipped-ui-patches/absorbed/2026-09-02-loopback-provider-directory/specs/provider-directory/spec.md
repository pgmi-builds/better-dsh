## ADDED Requirements

### Requirement: Provider directory loads under the user-local loopback auth patch

On the user's hosts where the loopback auth patch is applied, the Settings > Models page SHALL load the provider directory and present the selectable model list, across upstream upgrades, with the patch maintained as a replayable artifact (scripted overlay or configuration) rather than ad-hoc edits to installed products; the patch SHALL NOT ship as a default-enabled feature of the plugin.

#### Scenario: Models page lists providers after re-alignment

- **WHEN** the loopback auth patch is replayed on an aligned upstream version and the user opens Settings > Models
- **THEN** the provider directory loads and the model list is selectable, with no "loading the provider directory failed" error

#### Scenario: Patch survives the alignment process

- **WHEN** an upstream-alignment round completes and the S7 checklist runs
- **THEN** the patch's touchpoints are checked against the diff and the replay steps in its maintenance doc are executed or explicitly deferred
