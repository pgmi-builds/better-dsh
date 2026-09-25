<!--
source: https://omp.sh/docs/context-files
fetched: 2026-09-06
-->

# Context files

> Give omp durable project instructions with AGENTS.md, then layer global, sticky, or system-level guidance only when you need it.

## Give omp the project rules once

Put an `AGENTS.md` in your repository root. omp loads it automatically and applies it throughout the session, so you do not have to repeat build commands, conventions, or safety boundaries in every prompt.

```md
# Project instructions

## Build and test
- Install dependencies with `bun install`.
- Run unit tests with `bun test`.
- Run the app with `bun run dev`.

## Conventions
- Keep public API changes backward compatible.
- Never edit generated files under `src/generated/`.
- Before finishing, run the narrowest test that covers the change.
```

Start omp anywhere inside the repository and ask normally:

```text
Fix the failing invoice test and follow the repository instructions.
```

Use `AGENTS.md` for facts and constraints that should guide most work in that directory tree. Keep it short and concrete: every loaded instruction consumes context.

## Supported files

All instruction files are plain Markdown. They do not require frontmatter or a configuration entry.

### Native omp files

| File | Recommended project location | User-wide location | Behavior |
| --- | --- | --- | --- |
| `AGENTS.md` | `<repo>/AGENTS.md` | `~/.omp/agent/AGENTS.md` | Normal standing instructions. Standalone project files compose across directory levels. |
| `AGENTS.md` | `<repo>/.omp/AGENTS.md` | `~/.omp/agent/AGENTS.md` | omp-specific alternative. At a given directory level it takes priority over compatible context-file providers. |
| `RULES.md` | `<repo>/.omp/RULES.md` | `~/.omp/agent/RULES.md` | Sticky, always-apply rules. User and project files can both apply. |
| `APPEND_SYSTEM.md` | `<launch-directory>/.omp/APPEND_SYSTEM.md` | `~/.omp/agent/APPEND_SYSTEM.md` | Adds text to omp's built-in system instructions. Prefer this to replacing them. |
| `SYSTEM.md` | `<launch-directory>/.omp/SYSTEM.md` | `~/.omp/agent/SYSTEM.md` | Replaces omp's built-in instruction body. Project scope wins over user scope. Use only for a deliberately different agent persona. |

`~/.omp/agent/` is the default user-wide directory. With a named profile, the equivalent directory is `~/.omp/profiles/<profile>/agent/`. A custom omp configuration root changes the prefix in the same way.

For `SYSTEM.md` and `APPEND_SYSTEM.md`, the most predictable setup is to launch omp from the directory containing `.omp/`. Their direct CLI search checks project files first, in this order:

1. `<launch-directory>/.omp/`
2. `<launch-directory>/.claude/`
3. `<launch-directory>/.codex/`
4. `<launch-directory>/.gemini/`

If none exists, omp checks the corresponding user directories in the same order: the active omp profile's `agent/` directory, the active Claude configuration directory, `~/.codex/`, then `~/.gemini/`. It uses the first matching filename. Enabled discovery providers can supply additional `SYSTEM.md` locations only when that direct search found nothing; `APPEND_SYSTEM.md` uses only the direct search.

`--system-prompt` and `--append-system-prompt` take priority over discovered files; each accepts either literal text or a readable file path.

`SYSTEM.md` removes the built-in behavioral and tool-usage guidance, but omp still supplies project context, rules, and environment information around it. `APPEND_SYSTEM.md` preserves the built-in guidance and is therefore the safer default.

### Compatible context files

omp can reuse instruction files from other agent ecosystems. These are context-file sources, not additional formats: their contents are still Markdown.

| Provider ID | Project source | User-wide source | Project discovery |
| --- | --- | --- | --- |
| `native` | nearest `.omp/AGENTS.md` | active omp profile's `AGENTS.md` | Walks upward to the repository root and uses the nearest `.omp` configuration directory. |
| `claude` | `.claude/CLAUDE.md` | active Claude configuration directory's `CLAUDE.md` | Launch directory only. |
| `agents` | `.agent/AGENTS.md` or `.agents/AGENTS.md` | `~/.agent/AGENTS.md` or `~/.agents/AGENTS.md` | Walks from the launch directory to the repository root. `.agent` wins over `.agents` at the same level. |
| `codex` | — | `~/.codex/AGENTS.md` | User-wide only. |
| `gemini` | `.gemini/GEMINI.md` | `~/.gemini/GEMINI.md` | Launch directory only. |
| `opencode` | — | `~/.config/opencode/AGENTS.md` | User-wide only. |
| `github` | `.github/copilot-instructions.md` | `~/.copilot/copilot-instructions.md` | Launch directory only. `COPILOT_HOME` can relocate the user source. |
| `agents-md` | `AGENTS.md` | — | Walks upward from the launch directory. |

`COPILOT_CUSTOM_INSTRUCTIONS_DIRS` can also name comma-separated directories whose `AGENTS.md` files are considered user-wide GitHub Copilot context.

Cursor rules, Cline rules, `*.instructions.md`, and similar path-specific rule files are discovered as **rules**, not as general context files. They appear separately in `/extensions` and apply according to their own conditions.

## Discovery and scope

omp resolves context from the session's working directory.

For the recommended standalone `AGENTS.md` layout, it walks upward and loads every applicable file. In a repository nested under your home directory, the scan may continue above the Git root to pick up workspace instructions, but stops before treating `~/AGENTS.md` as project context. Outside that case, the repository root is the boundary.

For example, starting omp in `repo/packages/api` can load:

```text
~/.omp/agent/AGENTS.md       user-wide
~/work/AGENTS.md             enclosing workspace
~/work/repo/AGENTS.md        repository
~/work/repo/packages/api/AGENTS.md
```

The files are presented from most general to most local, so the nearest project instructions have the final, most specific position. This makes a monorepo layout useful:

- put shared commands and policies at the repository root;
- put package-specific commands in a nested `AGENTS.md`;
- avoid copying the root file into every package.

Changes are picked up when omp rebuilds a new session. After editing an instruction file, use `/new` or restart omp before relying on the new text.

### What wins at the same scope

Only one context-file provider survives for each user-wide scope and each project directory depth. Provider priority is:

1. `native`
2. `claude`
3. `agents`, then `codex`
4. `gemini`
5. `opencode`
6. `github`
7. `agents-md`

This means `<repo>/.omp/AGENTS.md` shadows `<repo>/AGENTS.md` at the same repository level; they are not concatenated. Do not create both unless that shadowing is intentional. Standalone `AGENTS.md` files at different ancestor levels have different scopes and therefore compose normally.

User-wide context follows the same provider priority and contributes at most one general context file. `RULES.md` is separate: the user-wide rule and nearest project `.omp/RULES.md` both load when present. For `SYSTEM.md` and `APPEND_SYSTEM.md`, one discovered file is selected, with project scope ahead of user scope and omp's `.omp` location ahead of compatible config directories.

## Import shared instructions

Use an `@path` token to include another file without copying it:

```md
# Project instructions

@docs/agent/testing.md
@docs/agent/style.md
```

Import behavior is predictable:

- a relative path is resolved from the file containing the import, not from omp's working directory;
- `~/...` resolves from your home directory, and absolute paths are accepted;
- `@` must begin a line or follow whitespace, so email addresses and `git@github.com` are left alone;
- imports inside inline code or fenced code blocks are left as examples rather than expanded;
- nested imports are followed for at most five hops;
- cycles are stopped, and an unreadable import remains visible as its original `@path` token.

Imported text is inserted at the token's position. Use imports for small shared policies, not for large generated documents.

## Verify what loaded

1. Start omp from the directory where you intend to work.
2. Enter `/extensions` in the interactive session.
3. Select the relevant provider tab and inspect **Context Files**. The dashboard shows the source path, whether it is enabled, and whether a higher-priority file shadowed it.
4. After changing a file, use `/new` or restart omp, reopen `/extensions`, and confirm the expected path is active.

You can also ask:

```text
Summarize the repository instructions that apply to this task and name their source files.
```

The `/extensions` dashboard is the authoritative check; the summary is useful for confirming that the instruction itself is clear.

## Troubleshooting

### The file does not appear

- Check the exact capitalization: the supported names are case-sensitive on case-sensitive filesystems.
- Confirm omp was launched from the intended directory. Providers marked “Launch directory only” do not walk to a parent repository.
- Make sure the file is readable Markdown, then start a new session.
- For `.omp/AGENTS.md` and `.omp/RULES.md`, inspect the nearest `.omp` directory first. A nearer project configuration directory defines the native project scope.
- If a named profile is active, check its profile-specific `agent/` directory instead of the default `~/.omp/agent/`.

### The file appears as shadowed

A higher-priority provider supplied a context file at the same scope. The inspector names both sources. Remove the duplicate, move genuinely narrower instructions into a nested directory, or disable the unwanted provider from `/extensions`.

Provider switches persist through the `disabledProviders` setting. Common IDs are listed in the table above; disabling `agents-md`, for example, stops standalone `AGENTS.md` discovery while leaving `.omp/AGENTS.md` available.

### Sticky rules are missing

`RULES.md` must be in the active user `agent/` directory or in the nearest project `.omp/` directory. The `--no-rules` flag disables `RULES.md` and all other discovered rules for that run.

### An import remains as `@path`

Resolve the path relative to the importing file, check file permissions, and make sure the token is outside inline or fenced code. A cycle or a chain beyond five recursive hops also leaves an import unexpanded.

See [CLI reference](/docs/cli) for prompt and rule flags, [Settings](/docs/settings) for `disabledProviders`, and `/extensions` for discovered conditional rule files.
