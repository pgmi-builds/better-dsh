#!/usr/bin/env bash
# DASHR one-click installer.
#
# Installs (or reuses) the DeepSeek Harness (dsh), installs the DASHR plugin
# (`dashr`, from the npm registry; source build as fallback), and makes sure
# the kernel Python environment has `ipykernel`. The plugin's cordis.patch.yml
# mounts the `eval` REPL tool on the host plane, so it is available in every
# agent preset — there is no preset-localization step.
#
# Env knobs:
#   DSH_PROFILE         dsh profile to install into            (default: web)
#   DSH_HOME            dsh harness home                       (default: ~/.dsh)
#   DASHR_VERSION       repo ref (tag or branch) to fetch      (default: main)
#   DASHR_REPO          repo origin                            (default: github.com/pgmi-builds/dashr)
#   DASHR_SRC           existing source dir for offline fallback  (default: unset)
#   DASHR_KERNEL_PYTHON Python interpreter with ipykernel      (default: host python3; set if using a venv)
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DASHR_VERSION="${DASHR_VERSION:-main}"
DASHR_REPO="${DASHR_REPO:-https://github.com/pgmi-builds/dashr}"
DASHR_SRC="${DASHR_SRC:-}"

info()  { printf '\033[1;32m[dashr]\033[0m %s\n' "$*"; }
step()  { printf '\033[1;34m[dashr]\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m[dashr] error:\033[0m %s\n' "$*" >&2; exit 1; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# ---------------------------------------------------------------- 1. env scan
step "1/4 scanning environment"
command -v node    >/dev/null || die "node not found — install Node.js >= 20 first"
command -v npm     >/dev/null || die "npm not found"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "node $(node -v) is too old — install Node.js >= 20 first"
[ "$NODE_MAJOR" -ge 22 ] || step "warning: node $(node -v) is below the recommended 22; dsh may misbehave"
command -v python3 >/dev/null || die "python3 not found"
command -v curl    >/dev/null || command -v git >/dev/null || die "need curl or git"
command -v pnpm   >/dev/null 2>&1 || { step "pnpm not found — installing (required by dsh plugin add)"; npm install -g pnpm || die "pnpm install failed"; }

# ------------------------------------------------------ 2. dsh (if missing)
if command -v dsh >/dev/null 2>&1; then
  info "dsh found at $(command -v dsh)"
else
  step "2/4 dsh not found — installing latest via npm (large install: ~60 packages + a native addon; expect 2-5 minutes, do not interrupt)"
  if npm install -g @deepseek-ai/dsh@latest; then
    info "dsh installed globally"
  else
    info "npm -g not writable — installing into $HOME/.local"
    mkdir -p "$HOME/.local"
    npm install --prefix "$HOME/.local" @deepseek-ai/dsh@latest
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi
DSH="$(command -v dsh)" || die "dsh installed but not on PATH; add <npm-prefix>/bin to PATH and re-run"

# --------------------------------- 3. kernel Python (ipykernel + dill)
step "3/4 ensuring the kernel Python has ipykernel + dill"
KERNEL_PY="${DASHR_KERNEL_PYTHON:-}"
if [ -z "$KERNEL_PY" ]; then
  if python3 -c "import ipykernel, dill" >/dev/null 2>&1; then
    KERNEL_PY="$(command -v python3)"
    info "host python3 already has ipykernel + dill ($KERNEL_PY)"
  else
    # The runtime OWNS the kernel environment: on first use it provisions a
    # managed venv under the dashr package (ipykernel + dill). Leave the
    # hint unset so it does, rather than pinning a half-configured python3.
    info "host python3 lacks ipykernel or dill — the runtime will provision a managed venv under the package on first use"
    KERNEL_PY=""
  fi
fi
if [ -n "$KERNEL_PY" ]; then
  export DASHR_KERNEL_PYTHON="$KERNEL_PY"
fi

# ---------------------------------------------------- 4. plugin install
step "4/4 installing the dashr plugin"
# Pre-seed the profile's pnpm policy BEFORE `dsh plugin add` forwards to pnpm:
#   - allowBuilds.zeromq: false — zeromq ships prebuilt binaries, its build
#     script is an optional source-compile fallback. pnpm v10+ ignoring it is
#     harmless, BUT it exits non-zero and makes `dsh plugin add` report a
#     failure (skipping its bundle reconciliation → the plugin's
#     cordis.patch.yml never loads). Declaring it false makes the ignore
#     explicit and non-fatal.
PROFILE_DIR="$DSH_HOME_DIR/profiles/$DSH_PROFILE"
mkdir -p "$PROFILE_DIR"
if [ ! -f "$PROFILE_DIR/pnpm-workspace.yaml" ]; then
  printf 'allowBuilds:\n  zeromq: false\n' > "$PROFILE_DIR/pnpm-workspace.yaml"
else
  grep -q '^allowBuilds:' "$PROFILE_DIR/pnpm-workspace.yaml" \
    || printf 'allowBuilds:\n  zeromq: false\n' >> "$PROFILE_DIR/pnpm-workspace.yaml"
  sed -i 's|^  zeromq: set this to true or false$|  zeromq: false|' "$PROFILE_DIR/pnpm-workspace.yaml"
fi
# Drop pnpm's registry metadata cache so `@latest` resolves the just-published
# version instead of a cached older one (pnpm's own cache TTL can lag a fresh
# publish by minutes-to-hours).
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/pnpm" 2>/dev/null || true
if "$DSH" plugin --profile "$DSH_PROFILE" add --config.auto-install-peers=false @pgmi-builds/dashr@latest; then
  info "installed dashr from the npm registry"
else
  # Offline / registry-blocked fallback: build the pinned release from source.
  info "registry install failed — falling back to building $DASHR_VERSION from source"
  if [ -n "$DASHR_SRC" ]; then
    SRC="$DASHR_SRC"
    info "using local source: $SRC (skipping fetch)"
  else
    ARCHIVE="$TMP_ROOT/dashr-src.tar.gz"
    if [ "$DASHR_VERSION" = "main" ]; then
      curl -fsSL "$DASHR_REPO/archive/refs/heads/main.tar.gz" -o "$ARCHIVE" \
        || die "download failed: $DASHR_REPO (main)"
    else
      curl -fsSL "$DASHR_REPO/archive/refs/tags/$DASHR_VERSION.tar.gz" -o "$ARCHIVE" \
        || curl -fsSL "$DASHR_REPO/archive/refs/heads/$DASHR_VERSION.tar.gz" -o "$ARCHIVE" \
        || die "download failed: $DASHR_REPO (tag or branch $DASHR_VERSION)"
    fi
    mkdir -p "$TMP_ROOT/src"
    tar -xzf "$ARCHIVE" -C "$TMP_ROOT/src" --strip-components=1
    SRC="$TMP_ROOT/src"
  fi
  if [ ! -d "$SRC/dashr/lib" ]; then
    info "building dashr (lib/ missing, 1-2 minutes)"
    (cd "$SRC/dashr" && npm install --no-audit --no-fund && npm run build)
  fi
  (cd "$SRC/dashr" && npm pack --pack-destination "$TMP_ROOT" >/dev/null)
  "$DSH" plugin --profile "$DSH_PROFILE" add --config.auto-install-peers=false \
    "$TMP_ROOT/dashr-"*.tgz
fi

# --------------------------------------- 4.5 preset localization (v0.1.8b)
step "4.5/5 writing the dashr agent preset (tuned passive compaction)"
DSH_DIR="$(dirname "$(readlink -f "$DSH")")"
while [ "$DSH_DIR" != "/" ] && [ "$(basename "$(dirname "$DSH_DIR")")" != "@deepseek-ai" ]; do
  DSH_DIR="$(dirname "$DSH_DIR")"
done
STANDARD_PRESET="$DSH_DIR/config/agent-presets/standard/agent.cordis.yml"
[ -f "$STANDARD_PRESET" ] || die "cannot locate the shipped standard preset under $DSH_DIR — re-point the dashr preset's include path by hand"
PRESET_DIR="$DSH_HOME_DIR/.agent-presets/dashr"
mkdir -p "$PRESET_DIR"
cat > "$PRESET_DIR/agent.cordis.yml" <<YAML
# The `dashr` agent preset — DASHR distro default (the dashr bundle patch
# points agent-presets at it): the shipped `standard` preset, with the
# compaction group re-pointed at the settings-driven engine.
#
# What changes from `standard`: the default-config `compaction-basic` row is
# disabled and `dashr-compaction` is inserted into the SAME group — so the
# group's isolate realm, `/compact`, and the tool-result pruner all stay as
# upstream ships them, and the one `compaction` service the realm resolves is
# the upstream `BasicCompactionEngine` mounted with DASHR's tuned defaults
# (threshold 0.5, retain 0.05, DeepSeek V4 Flash summarizer), overridable per
# deployment through the `dashr-compaction` settings section.
#
# The include path is the LITERAL absolute path of the installed dsh's
# shipped standard preset; re-running this installer rewrites it, and a dsh
# reinstall at another location needs the same.
- name: '@deepseek-ai/cordis-plugin-include'
  config:
    path: $STANDARD_PRESET
    patches:
      - id: compaction-basic
        disabled: true
      - id: compaction
        insert:
          - id: dashr-compaction
            name: '@pgmi-builds/dashr/compaction'
YAML
cat > "$PRESET_DIR/preset.yml" <<YAML
# Display metadata for the dashr preset. The id is the directory name
# (`dashr`); this file carries display text ONLY.
name: DASHR (调优压缩)
description: 'DASHR 默认预设：官方 standard 之上启用调优被动压缩（阈值 0.5 / 保留 0.05 / DeepSeek V4 Flash 摘要），参数在 settings 的 dashr-compaction 节可调（重启生效）。'
YAML
info "preset written: $PRESET_DIR (the dashr bundle patch makes it the new-session default)"
# ------------------------------------------------------------- restart note
if pgrep -f "[d]sh .* --port\|[d]sh web" >/dev/null 2>&1 || systemctl --user is-active --quiet dsh.service 2>/dev/null; then
  step "a running dsh instance was detected — restart it to load the dashr bundle"
  step "  systemd:  systemctl --user restart dsh.service"
  step "  manual:   kill the dsh process, then relaunch with your usual flags"
fi

info "done. The DASHR REPL (`eval`) is available in every agent preset."
if [ -n "$KERNEL_PY" ] && [ "$KERNEL_PY" != "$(command -v python3)" ]; then
  info "kernel python: $KERNEL_PY — persist DASHR_KERNEL_PYTHON=$KERNEL_PY in your shell profile or dsh service env."
elif [ -z "$KERNEL_PY" ]; then
  info "kernel python: managed by the runtime (a venv under the dashr package, provisioned on first use)"
fi

