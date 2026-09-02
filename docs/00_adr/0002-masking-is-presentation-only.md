# Masking is presentation-only

Hiding exactly two upstream A2A tool names (`send_message` — the parent→child downlink — and `report` — the child→parent uplink) from the model is done by excluding them from the generated Tool Catalog text and from the kernel binding names — nothing else. The two tools stay registered, executable, and dispatchable; the single `send_message` bridge dispatches them internally. Every OTHER upstream delegation tool (`subagent`, `subagent_fork`, `list_agents`, `interrupt_agent`, `workflow`, `ralph`) is exposed directly as a native `tool.*` member — no re-wrapping (v0.1.9).

## Considered Options

- **`restrict()` at runtime**: hides names in the registry's model-facing view, but validates against the live view at call time — ordering hazards against late tool registration can fail the whole preset mount.
- **`disabled: true` include patches**: physically unregisters the tool, which also removes the bridge's dispatch target. Masking must not break the bridge.
- **Presentation-only exclusion** (chosen): the registry is never touched. The model's surface (wire schema collapse to `eval`, Tool Catalog text, kernel bindings) is entirely DASHR-generated, so exclusion happens at the two points DASHR owns.

## Consequences

- The masked tools remain in the registry and are reachable via nested sub-dispatch with a parent token, which passes the model-direct guard.
- **Field-verified (v0.1.8d, `both` presentation mode)**: reachable by MODEL-DIRECT native call too — no parent token needed. A probe calling the masked `skill({"name":…})` through the API function-call surface executed in full. Cause: the mask registers no visibility filter, so the name stays in `view(scope).visible`, and `resolveExecution` collapses model-direct calls only under `code` mode. The mask is an ADVERTISING cut, not an enforcement point; the hard gate is the REPL binding allowlist (`unknown binding`). If a deployment ever needs true model-direct rejection, the mechanisms are a visibility-layer `restrict()` (rejected here for ordering hazards) or a `code`-mode collapse — both are deployment-level decisions, not mask-level ones.
- Zero upstream mutation means zero interference with host-plane modules that enumerate or interact with the delegation tools.
