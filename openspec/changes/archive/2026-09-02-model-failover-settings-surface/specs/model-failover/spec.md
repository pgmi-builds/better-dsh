## ADDED Requirements

### Requirement: Model Failover surface in General settings

The plugin SHALL register a Model Failover row into the Settings > General page via the `settings.general.item` slot, exposing the failover pair (primary/secondary model selectors) with persisted configuration, wherever the plugin's client bundle is built and loaded — including the source-level test instance — and the row SHALL remain functional across upstream settings-slot contract evolutions covered by the alignment process.

#### Scenario: Row renders in the source-level test instance

- **WHEN** the Dev/Test 1 instance starts with the plugin's client bundle built and the user opens Settings > General
- **THEN** the Model Failover row with both model selectors is visible and its selections persist across instance restarts

#### Scenario: Failover engages on primary failure

- **WHEN** a turn's primary model request fails and a secondary model is configured in the row
- **THEN** the host-side per-turn waterfall retries via the configured secondary and the outcome is observable in the session
