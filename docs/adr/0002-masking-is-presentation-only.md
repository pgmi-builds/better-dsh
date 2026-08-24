# Masking is presentation-only

Hiding exactly two upstream A2A tool names (`send_message` — the parent→child downlink — and `report` — the child→parent uplink) from the model is done by excluding them from the generated Tool Catalog text and from the kernel binding names — nothing else. The two tools stay registered, executable, and dispatchable; the single `send_message` bridge dispatches them internally. Every OTHER upstream delegation tool (`subagent`, `subagent_fork`, `list_agents`, `interrupt_agent`, `workflow`, `ralph`) is exposed directly as a native `tool.*` member — no re-wrapping (v0.1.9).

## Considered Options

- **`restrict()` at runtime**: hides names in the registry's model-facing view, but validates against the live view at call time — ordering hazards against late tool registration can fail the whole preset mount.
- **`disabled: true` include patches**: physically unregisters the tool, which also removes the bridge's dispatch target. Masking must not break the bridge.
- **Presentation-only exclusion** (chosen): the registry is never touched. The model's surface (wire schema collapse to `eval`, Tool Catalog text, kernel bindings) is entirely DASHR-generated, so exclusion happens at the two points DASHR owns.

## Consequences

- The masked tools remain in the registry and are reachable via nested sub-dispatch with a parent token, which passes the model-direct guard.
- Zero upstream mutation means zero interference with host-plane modules that enumerate or interact with the delegation tools.
