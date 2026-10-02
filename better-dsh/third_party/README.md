# third_party/ — vendored sources

Source copies of MIT-licensed upstream packages, imported by **relative path**
so this plugin never depends on how a host installation scope resolves them.
Licenses: [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Why (the 0.2.5 incident)

`@deepseek-ai/schemastery` was declared as an npm dependency/peer. When a
profile materialized its own copy, that copy was frozen at **3.18.2** while the
host had moved to **3.18.4**; `.volatile()` (introduced in 3.18.3) was missing,
and `failover` / `compaction` — which build their Config schema with
`.volatile()` at module scope — died at import:

```
dashr-failover (better-dsh/failover): failed to import
dashr-compaction-tuning (better-dsh/compaction-tuning): failed to import
```

Copying the sources in removes the resolution question entirely: the version is
whatever this directory says, and the bundler inlines the closure.

## Layout

```
third_party/
  schemastery/                                  @deepseek-ai/schemastery 3.18.4
    lib/                                        index.mjs (ESM entry), index.cjs, types/
    lib/index.d.mts                             ADDED BY US (see below)
    src/ LICENSE README.md package.json
    node_modules/
      @deepseek-ai/cosmokit/                    @deepseek-ai/cosmokit 1.8.5
      @standard-schema/spec/                    @standard-schema/spec 1.1.0 (types only)
```

`lib/index.d.mts` is the single file we add: it forwards to the package's own
`lib/types/index.d.ts`, which a direct `./lib/index.mjs` import would otherwise
not consult (the package only maps types through its `exports` field). All
other files are byte-for-byte upstream.

`third_party/schemastery/node_modules/` exists so that `schemastery`'s own
`import … from "@deepseek-ai/cosmokit"` resolves inside this directory without
patching vendored code.

## Consumers

`src/schemastery.ts` is the only importer; every module uses that path.

```
src/…  →  src/schemastery.ts  →  third_party/schemastery/lib/index.mjs
```

## Updating

Copy from a review target (host install, or a fresh `npm pack` of the upstream
package), keeping the layout above and re-adding `lib/index.d.mts`:

```bash
H=<somewhere>/node_modules
rm -rf third_party/schemastery
mkdir -p third_party/schemastery/node_modules/@deepseek-ai third_party/schemastery/node_modules/@standard-schema
cp -r "$H/@deepseek-ai/schemastery" third_party/schemastery
cp -r "$H/@deepseek-ai/cosmokit"    third_party/schemastery/node_modules/@deepseek-ai/cosmokit
cp -r "$H/@standard-schema/spec"    third_party/schemastery/node_modules/@standard-schema/spec
# re-create lib/index.d.mts (see above), then: npm run typecheck && npm test
```

Bumping `schemastery` is a behavioural change for every settings/config surface
that uses it: run the full suite and the 4999 first-person pass before shipping.
