#!/usr/bin/env bash
# Provenance: how src/docs and src/i18n/zh-Hans were fetched (one-shot; run from anywhere).
# Repo is ~1GB with full history -> partial sparse clone of website/ only.
set -euo pipefail
WORK=$(mktemp -d)
cd "$WORK"
git clone --depth 1 --filter=blob:none --sparse https://github.com/NousResearch/hermes-agent.git repo
cd repo
git sparse-checkout set website/docs website/i18n
echo "HEAD: $(git rev-parse HEAD)"
# destination layout used by this fetch stage:
#   website/docs                                            -> src/docs
#   website/i18n/zh-Hans/docusaurus-plugin-content-docs/current -> src/i18n/zh-Hans
mkdir -p src/i18n
cp -r website/docs src/docs
cp -r website/i18n/zh-Hans/docusaurus-plugin-content-docs/current src/i18n/zh-Hans
echo "staged at $WORK/repo ; copy src/docs and src/i18n/zh-Hans into this directory's src/"
