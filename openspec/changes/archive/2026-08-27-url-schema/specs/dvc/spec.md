## Purpose

Reserve DASHR's device I/O surface under `dvc://` (renamed from the earlier `xd://` placeholder — no `xd` name remains anywhere): a read = device list/document view, a write = device dispatch entry. No device provider is mounted this wave, so both views are placeholders that fix the URL shapes and the structured write error for whatever device layer lands later.

## ADDED Requirements

### Requirement: Device roster placeholder
The system SHALL let bare `dvc://` return the mounted-device roster, which in this wave is the placeholder text `no devices mounted`.

#### Scenario: Listing mounted devices
- **WHEN** the model reads bare `dvc://`
- **THEN** the system returns `no devices mounted`

### Requirement: Unknown device placeholder
The system SHALL let `dvc://<device>` return placeholder text `unknown device: <name>` — no device provider exists to answer with a real document.

#### Scenario: Reading an unmounted device
- **WHEN** the model reads `dvc://<any device name>`
- **THEN** the system returns `unknown device: <name>`

### Requirement: Write dispatch is a structured no-op
The system SHALL reject every write to `dvc://` with the structured `DVC_NO_DEVICE` error — no device is mounted to route the write to. This fixes the write-dispatch path (scheme → per-device routing seam) that a future device layer plugs into.

#### Scenario: Writing with no devices
- **WHEN** the model writes to `dvc://<device>`
- **THEN** the system returns the structured `DVC_NO_DEVICE` error and dispatches nothing
