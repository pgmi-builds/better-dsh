# DASHR

DASHR is the persistent-kernel REPL plugin for DeepSeek Harness: one persistent IPython kernel per agent session, all tools callable as typed Python objects inside cells.

## Language

**Delegation**:
An agent spawning sub-agents through a standard tool call. DASHR exposes the upstream delegation tools (`subagent`, `subagent_fork`, `list_agents`, `interrupt_agent`, `workflow`, `ralph`) directly as `tool.*` members; only the two A2A tools are displaced into `send_message`.
_Avoid_: RLM (Recursive Language Model) — the retired v0.1.x product name

**eval**:
The single model-facing transport tool (renamed from `run_cell`): its `cell` argument carries the program, `description` labels it.
_Avoid_: run_code (upstream PTC transport), run_cell (the pre-0.1.5 name), ipython (the pre-0.1.8 name)

**Tool Catalog**:
The prompt section listing every tool as flat Python signatures the model can call inside cells. Generated from the registry's tool schemas, presentation-only.
_Avoid_: SDK tools, tools:dashr-sdk (the old section name), tools block

**Binding**:
A kernel-side `tool.*` member whose calls round-trip to the host registry's real tool execution (or a bridge callable).
_Avoid_: proxy, flat global (the pre-0.1.8 shape), tools.* (the pre-0.1.5 namespaced form)

**Masking**:
Presentation-layer exclusion: hiding exactly the two A2A names (`send_message`, `report`) from the Tool Catalog and kernel bindings while they stay registered and executable upstream (the `send_message` bridge dispatches them internally).
_Avoid_: tool removal, disable (a disable patch physically unregisters — different thing)

**DashrDaemon**:
The profile-level daemon concept: a process-global owner for cross-session kernel lifecycle. Empty shell in 0.1.5; the mount-level DashrRuntime is the de facto daemon today.
_Avoid_: KernelManager (the pre-interview working name)

**DashrRuntime**:
The mount-level runtime (renamed from IPythonCodeRuntime): one instance per standing mount, keying one kernel per session and owning spawn/dispose, snapshot/restore, and host-request dispatch.
_Avoid_: IPythonCodeRuntime, kernel runtime

**Kernel**:
The ipykernel Python subprocess itself — a pure interpreter with no harness awareness. Only the TS-side runtime knows about sessions and tools.
_Avoid_: Python runtime, IPython runtime (ambiguous between the subprocess and the TS manager)

**Control Prompt**:
The system-prompt section teaching the model the cell paradigm (single entry, typed errors, kernel-vs-host split, background handles).
_Avoid_: IPython control prompt (that's Prime Agent's section name)

**Standing Mount**:
The preset's per-composition mount: one instance shared by every session joined to it, one level above sessions and below the profile. Child agents join their parent's standing mount — the mechanism that makes recursion work.
_Avoid_: session mount, per-session mount

**Harness (Continual Harness)**:
DASHR's durable per-agent guidance store (`refine`/`compact` write it, the dashr:harness prompt section renders it).
_Avoid_: memory (that's the host's own memory tools)

**send_message**:
The single dual-direction A2A Python function: `send_message({"receiver": "child"|"parent", ...})` — `'child'` bridges the send_message tool downlink; `'parent'` bridges the service-layer reportFrom uplink (parent derived from the caller's own session header, no ID). Wakeup delivery, fixed.
_Avoid_: agent_message (the pre-0.1.8 name), report (the upstream uplink tool it displaces)
