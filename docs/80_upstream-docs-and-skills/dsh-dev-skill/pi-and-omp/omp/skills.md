<!--
source: https://omp.sh/docs/skills
fetched: 2026-09-06
-->

# Skills

> Give omp a reusable playbook for a kind of work, then let it load that guidance only when it is relevant.

A skill changes **how omp approaches a task**: it supplies instructions, conventions, and optional supporting files for a particular domain. It does not add permissions or an executable tool by itself.

To use an installed skill, start with the task you actually want done:

```text
Review this Postgres migration for locking and rollback risks.
```

At session start, omp advertises each available skill's name and description. When your request matches a description, the agent loads that skill's full playbook before working. You do not need special syntax for normal use.

## Find and use an installed skill

In the interactive TUI, run:

```text
/extensions
```

Open **Skills** to see each discovered skill's description, status, scope, provider, and source path. Select a skill and press <kbd>Space</kbd> or <kbd>Enter</kbd> to enable or disable it. Changes are persisted; run `/reload-plugins` afterward so the current session refreshes its skills and `/skill:` commands.

When you want to require a particular skill rather than rely on matching, invoke it explicitly:

```text
/skill:postgres Review migrations/042_add_status.sql for lock risk.
```

Skill names appear in slash-command completion after you type `/skill:`. A skill token can also appear in ordinary prose:

```text
Review migrations/042_add_status.sql with /skill:postgres and propose a safer rollout.
```

Explicit invocation is available by default. It can be disabled with `skills.enableSkillCommands: false`; natural task matching still works. A hidden skill is also absent from automatic matching, but remains available through `/skill:<name>` when skill commands are enabled.

## Install a skill

A standalone skill is just a directory containing `SKILL.md`. Copy it into one of omp's native locations:

```text
~/.omp/agent/skills/<name>/SKILL.md   # user: every project
.omp/skills/<name>/SKILL.md           # project: this repository/tree
```

For example, installing a checked-out skill for your user can be as small as:

```sh
mkdir -p ~/.omp/agent/skills/postgres
cp ./postgres-skill/SKILL.md ~/.omp/agent/skills/postgres/SKILL.md
```

Keep any files referenced by the playbook in that same `postgres/` directory. Discovery is one level deep: `skills/postgres/SKILL.md` is found, while `skills/databases/postgres/SKILL.md` is not.

Skills can also arrive inside plugins. Browse a configured marketplace, then install the plugin at user or project scope:

```sh
omp plugin discover [marketplace]
omp plugin install --scope user name@marketplace
# or: omp plugin install --scope project name@marketplace
```

See [Marketplace](/docs/marketplace) for adding catalogs, inspecting packages, pinning, upgrading, and uninstalling plugins. After copying, installing, upgrading, or editing a skill, start a new session or run `/reload-plugins`. Plugin modules, hooks, or tools bundled beside a skill can still require a full restart.

## Scope and trust

A user skill is available in every project. A project skill is discovered only when omp starts within that project tree; omp also walks parent directories up to the repository boundary. This makes project skills useful for repository-specific workflows, but it also means a repository you open can contribute instructions.

Treat a skill like code:

- inspect `SKILL.md` and its referenced scripts, templates, and files before enabling it;
- check the origin shown in `/extensions`, especially in a newly cloned repository;
- install third-party skills at project scope when they are needed by only one project;
- remember that a playbook may instruct the agent to run commands using the session's existing permissions.

Skills with the same name do not merge. An explicitly configured custom directory overrides default discovery locations. Otherwise omp keeps the highest-priority provider: native `.omp`, OMP/plugin packages, Claude, Agent/Codex-compatible directories, OpenCode, GitHub, then managed auto-learned skills. Within a walked project source, the closest directory wins. Avoid duplicate names; `/extensions` shows which copy is active and which is shadowed.

## Enable and filter discovery

Use one-run flags when you want a temporary boundary:

```sh
omp --no-skills
omp --skills 'git-*,postgres'
```

`--skills` accepts comma-separated glob patterns and keeps only matching names. For persistent controls, edit `~/.omp/agent/config.yml`:

```yaml
skills:
  enabled: true
  enableSkillCommands: true
  includeSkills:
    - "git-*"
    - postgres
  ignoredSkills:
    - "*-experimental"
  customDirectories:
    - ~/work/shared-skills
```

An empty `includeSkills` list includes all names. `ignoredSkills` excludes matching names even if they also match the allowlist. Each custom directory must contain one directory per skill, such as `~/work/shared-skills/postgres/SKILL.md`.

The `/extensions` toggle persists an individual disabled skill as `skill:<name>` in the top-level `disabledExtensions` setting. Prefer the dashboard for individual changes; the equivalent YAML is:

```yaml
disabledExtensions:
  - skill:untrusted-skill
```

Provider-specific switches are also available under `skills`: `enablePiUser`, `enablePiProject`, `enableAgentsUser`, `enableAgentsProject`, `enableClaudeUser`, `enableClaudeProject`, and `enableCodexUser`. All default to `true`.

## Compatible locations

In addition to `.omp`, omp discovers these one-skill-per-directory layouts by default:

| Scope | Locations |
| --- | --- |
| User | `~/.agent/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, `~/.codex/skills/`, `~/.config/opencode/skills/` |
| Project | `.agent/skills/`, `.agents/skills/`, `.claude/skills/`, `.codex/skills/`, `.opencode/skills/`, `.github/skills/` |
| Managed | `~/.omp/agent/managed-skills/` |

Project `.agent`, `.agents`, and `.claude` locations are found while walking from the working directory toward the repository root. Use `/extensions` rather than guessing when several compatible tools have installed the same name.

## Create the smallest skill

Create `.omp/skills/release-check/SKILL.md` in a project:

```md
---
description: Use when preparing or reviewing a release; verify versioning, changelog, build artifacts, and publication status.
---

# Release check

1. Identify the version and release tag.
2. Verify the changelog describes the shipped behavior.
3. Check the build artifacts before publishing.
4. Report blockers before changing a tag or publishing.
```

That is a complete current skill. The directory name, `release-check`, becomes its invocation name, so it can be requested with `/skill:release-check` after `/reload-plugins` or in a new session.

## Authoring reference

### Frontmatter

| Field | Required | Current behavior |
| --- | --- | --- |
| `description` | Yes for `.omp`, custom-directory, plugin, and GitHub skills | Shown before the body loads and used to decide whether the skill applies. Write concrete task verbs, nouns, and scope. |
| `name` | No | Overrides the directory name used for matching and `/skill:<name>`. Prefer the directory name unless compatibility requires an override. |
| `hide` | No | Omits the skill from the automatic skill listing while preserving explicit invocation. |
| `disable-model-invocation` | No | Agent Skills-compatible spelling with the same effect as `hide`. |

Although some compatible formats accept fields such as `globs` or `alwaysApply`, omp does not currently use them to select or automatically inject a skill. Put the trigger conditions in `description`. For guidance that must always be present, use [Context files](/docs/context-files) instead.

A useful description names:

- the actions: writing, reviewing, debugging, migrating;
- the objects: Postgres migrations, snapshot tests, release artifacts;
- the boundary when needed: a directory, file type, or subsystem.

```yaml
description: Use when adding or reviewing Vitest tests in src/importer; covers fixtures, snapshots, and integration setup.
```

### Body and supporting files

Write direct, operational instructions. State when the workflow applies, the required sequence, important safety boundaries, and what a successful result contains. Keep detailed references, templates, or scripts beside `SKILL.md` and refer to them with paths relative to the skill directory:

```text
release-check/
├── SKILL.md
├── references/
│   └── registry-checks.md
└── scripts/
    └── verify-artifacts.sh
```

The body is loaded only on demand, so moving long reference material out of the always-visible description keeps ordinary sessions small. Supporting files do not execute automatically; the playbook must explain when and how they should be used.
