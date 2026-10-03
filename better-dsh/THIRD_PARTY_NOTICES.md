# Third-party notices

`better-dsh` ships source copies of three MIT-licensed packages under
[`third_party/`](third_party/). They are **vendored, not dependencies**: the
plugin must not depend on how a host installation scope resolves them, so the
sources live here, are imported by relative path, and are inlined into the
published `lib/` bundle. Provenance, version pins, and the update procedure are
documented in [`third_party/README.md`](third_party/README.md).

| Package | Version | License | Upstream |
|---|---|---|---|
| `@deepseek-ai/schemastery` | 3.18.4 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@deepseek-ai/cosmokit` | 1.8.5 | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `@standard-schema/spec` | 1.1.0 | MIT | <https://github.com/standard-schema/standard-schema> |
| `@ast-grep/wasm` | 0.45.3 | MIT | <https://github.com/ast-grep/ast-grep> |
| `web-tree-sitter` | 0.26.12 | MIT | <https://github.com/tree-sitter/tree-sitter> |
| `@lumis-sh/wasm-*` (14 grammars) | 0.26.x | MIT | <https://www.npmjs.com/org/lumis-sh> |

`@standard-schema/spec` is a type-only import of `schemastery`'s declarations;
`cosmokit` is `schemastery`'s sole runtime dependency and is resolved from
`third_party/schemastery/node_modules/`.

## MIT License

Applies to all three packages above, each with its own copyright holder:

```
MIT License

Copyright (c) 2021-present Shigma                 (schemastery, cosmokit)
Copyright (c) 2024 Colin McDonnell                (@standard-schema/spec)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Each copy also retains its upstream `LICENSE` file in place.
