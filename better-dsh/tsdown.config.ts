import { defineConfig } from 'tsdown'

export default defineConfig({
  // One entry per Plugins-page component row (spec docs/specs/plugins-page-
  // components/spec.md): the bundle patch inserts one row per subpath export.
  // Modules imported by several entries (native-capture, fs-aware/wrap,
  // py-sdk, kernel-env) code-split into shared chunks, so their module state
  // (the per-agent capture WeakMap) stays a single runtime instance.
  entry: [
    'src/index.ts',
    'src/py-sdk.ts',
    'src/kernel-env.ts',
    'src/fs-aware/sandbox-plugin.ts',
    'src/url-schemes/index.ts',
    'src/failover/index.ts',
    'src/compaction/index.ts',
    'src/web-trust.ts',
    'src/mobile/plugin.ts',
    'src/remote/plugin.ts',
  ],
  // Pin the output beside the package.json `main`/`types` declarations (the
  // default dist/ would leave the exports map dangling on a published tarball).
  outDir: 'lib',
  // Do NOT bundle dependency types into the declaration: inlined copies
  // create duplicate type identities in a consumer's program (schemastery's
  // generics appear twice and stop unifying). External imports resolve from
  // each consumer's own tree — one identity per package there.
  dts: { resolve: false },
  platform: 'node',
  format: 'esm',
  outputOptions: { exports: 'named' },
})
