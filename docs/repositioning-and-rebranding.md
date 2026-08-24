# DASHR: Repositioning & Rebranding

Status: proposal / agreed direction (2026-08-24)
Audience: maintainers, contributors, future packaging & marketing work.

---

## 1. Pronunciation

**DASHR** is read as **"Dasher"** — plain English natural reading. Anyone seeing the word
should be able to pronounce it without a guide (which is the point of the vowelized
spelling, see §3).

## 2. Name origin (literal reading)

- **DASH** = upstream `DSH` (DeepSeek Harness) with a vowel inserted, so the acronym
  becomes a naturally pronounceable word.
- **DASHR** = **"better form of dash"** — literally *dasher* with one vowel (`e`)
  removed. The name itself encodes "a leaner-but-more dash".

## 3. Repositioning

### Before (current repo reality)

DASHR was positioned as a **plugin**: the RLM mode for `dsh` (npm `dsh-rlm-mode`).
One capability, installed into an existing dsh setup.

### Now

DASHR is repositioned as **"Better Dash"** — a complete, ready-to-run App built on the
upstream DeepSeek Agent runtime ("Everything is plugin" / Cordis framework).

The phrase "Better Dash" is deliberately down-to-earth. We do not want to appear
grandiose: everything is built on open-source work. What the phrase conveys:

- **完整体** — a whole product, not a component.
- **开箱即用** — one install, works immediately.
- **接地气** — honest about being open-source-derived; no inflated claims.

### Product shape (the "Linux distro" model)

| Layer | Analogy | DASHR reality |
|---|---|---|
| Kernel / core | Linux kernel | Upstream official DeepSeek Agent runtime (`dsh`), tracked at latest official release |
| Distro | Ubuntu / RHEL | DASHR: curated plugin composition + compatibility guarantee |
| Default enabled flagship | — | RLM mode (the former standalone plugin) |
| Enterprise services | Canonical custom engagements | Fast custom-agent builds on top of the distro |

Commercial positioning:

- We do **not** sell the agent core. We sell a **composition of plugins** (a recipe),
  the compatibility matrix behind it, and support.
- The core stays anchored to the official latest release; we dynamically smoke-test
  every bundled plugin against new core versions.
- Distribution form: semi-precompiled binary — shaped like a complete App, one-click
  install.
- Full compatibility with the DASH community ecosystem: after installing the DASHR
  App, users can still use the official plugin marketplace seamlessly.

## 4. Self-owned vs community plugins

- **(a) Own plugins**: e.g. improvements where the current PTC code mode falls short
  (RLM mode is the flagship).
- **(b) Curated community plugins**: selected useful plugins from the ecosystem
  (source: `awesome-dsh-plugin`), each held to the compatibility matrix.
- **(c) Packaged whole**: the App bundles (a)+(b) into one agent runtime with
  one-click install.

## 5. Known risks (ranked)

1. **The compatibility matrix is the moat.** Upstream is at `0.1.0-rc` (no semver
   guarantees); every rc requires plugin × core smoke tests. The product promise
   does not exist until this CI matrix exists. Build it first.
2. **Semi-precompiled binary ships three runtimes.** Node ≥22 + Python 3.11 kernel
   (uv venv) + plugin deps. Realistic v1 form: structured directory + launcher +
   installer (Electron-style), not a true single-file binary.
3. **Naming / trademark boundary.** DASHR's name derives from DSH and currently
   carries DeepSeek branding/badges. As a distro we must state clearly in docs that
   this is an **unofficial distribution**, mirroring how Canonical/Debian and
   Fedora/RHEL handle the relationship.
4. **"Seamless official marketplace" is conditional.** Our `cordis.patch.yml` bundle
   patch must stay minimal and be pushed upstream wherever possible; any behavior
   divergence breaks the seamlessness promise.

## 6. Repository implications

- Three-layer layout going forward: `core/` (the npm plugin, stays independently
  publishable — free acquisition funnel, keeps us honest against vendor lock),
  `distro/` (lockfile + compatibility matrix + packaging), `app/` (launcher /
  installer).
- `install.sh` evolves from single-plugin installer to distro installer.
- README narrative shifts from "RLM plugin for dsh" to "a DASH distribution —
  RLM mode enabled by default".
- The standalone plugin remains published and usable on plain dsh.

## 7. Sequence

1. Build the minimal viable compatibility matrix (target: upstream rc stream).
2. Distill the plugin composition (own + curated) into a lockfile.
3. Package as directory+launcher App; one-click install.
4. Rebrand surfaces (README, docs, badges) to the "Better Dash" positioning with
   the unofficial-distribution disclaimer.
