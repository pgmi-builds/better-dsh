## ADDED Requirements

### Requirement: Exclusive managed kernel venv

The plugin SHALL provision its REPL kernel interpreter exclusively inside a managed venv rooted in the plugin's own package directory (web-profile scope in production deployments, `kernelEnvDir` as the explicit override), and SHALL NOT install into, mutate, or depend on the user's global Python environment; kernel probes MUST NOT import user-site modules, and the distributed npm package MUST NOT embed a prebuilt venv (provisioning capability ships, not provisioning results).

#### Scenario: Venv lives inside the plugin territory

- **WHEN** the plugin is installed into a web profile and the kernel is provisioned
- **THEN** the venv root is inside the plugin's package directory (or the explicitly configured `kernelEnvDir`), and no file outside that territory is required for kernel operation

#### Scenario: User global environment untouched

- **WHEN** provisioning runs on a host with an existing global Python installation
- **THEN** no package is installed into, and no configuration of, the user's global environment is modified

### Requirement: Robust provisioning with pinned versions

Provisioning SHALL redirect its tool caches (uv) to a plugin-territory location so read-only home directories cannot block it, SHALL fall back to `python3 -m venv` + ensurepip when `uv` is unavailable, and SHALL install pinned, tested versions of `ipykernel` and `dill` alongside the pinned CPython version; provisioning MUST be idempotent (a complete venv is reused; a partial one is repaired).

#### Scenario: Read-only home cache does not block

- **WHEN** the kernel is provisioned on a host whose `~/.cache` is read-only
- **THEN** provisioning succeeds using the redirected cache location

#### Scenario: Pinned versions installed

- **WHEN** provisioning creates or repairs the venv
- **THEN** the installed `ipykernel` and `dill` match the pinned tested versions, verifiable by the kernel probe

### Requirement: Provisioning ladder — install-time, daemon spin-up, first-use

The plugin SHALL provision the kernel through a three-trigger ladder converging on the same managed venv, every trigger fail-open (a failure or suppression at any level degrades to a logged status message and NEVER blocks package installation, daemon startup, or plugin mounting, and never asks the user for approval): (1) an install-time postinstall best-effort step that runs only when the package manager executes build scripts; (2) a daemon spin-up check as the PRIMARY path — when the plugin is brought up on the host plane by the host daemon, it asynchronously verifies the kernel environment and provisions it immediately when absent (uv → `python3 -m venv` → explicit configuration), so an agent session never discovers a missing kernel at first use; (3) first-use lazy provisioning as the final fallback. Provisioning status (provisioning/ready/degraded/failed) SHALL be logged, and failure messages MUST name the available remedies (`npm run kernel:venv`, `kernelAutoInstall`, explicit `python`).

#### Scenario: Daemon spin-up provisions before any agent session

- **WHEN** the host daemon starts and brings the plugin up on the host plane, and the managed venv is absent
- **THEN** the plugin asynchronously provisions the kernel within the spin-up window without blocking daemon startup or plugin mounting, and a new agent session's first REPL cell finds the kernel already in place

#### Scenario: Suppressed postinstall still reaches a working kernel

- **WHEN** the package manager skips the plugin's postinstall script and the daemon later starts
- **THEN** the spin-up check provisions the kernel and REPL cells execute, with the install itself never having failed and no approval ever having been requested

#### Scenario: Failure is non-blocking and visible

- **WHEN** provisioning fails on a constrained host at any trigger
- **THEN** the installation, daemon startup, and plugin mounting all succeed; the surfaced error names the concrete remedy commands/configuration paths
