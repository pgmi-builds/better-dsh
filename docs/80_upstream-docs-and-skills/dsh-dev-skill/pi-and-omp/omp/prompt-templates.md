<!--
source: https://omp.sh/docs/prompt-templates
fetched: 2026-09-06
-->

# Prompt templates

> Turn a Markdown prompt into a reusable slash command for yourself or a project.

## Create your first template

A prompt template saves instructions you use repeatedly and exposes them as a slash command. Use one for a consistent review checklist, a release summary, a test plan, or any other task that does not need custom program logic.

Create `.omp/prompts/review-change.md` in the project where you want to use the command:

```md
---
description: Review one area of this project for correctness
---

Review the code related to $1.

Focus on: $@[2:].

Report concrete findings first, with file and line references. Then list any
remaining risks or missing tests. Do not change files.
```

Start a new omp session in that project, then type:

```text
/review-change authentication "error handling and tests"
```

The filename creates the `/review-change` command. omp expands `$1` to `authentication`, expands `$@[2:]` to `error handling and tests`, and sends the resulting Markdown as your message. The `description` appears beside the command in `/` autocomplete.

Use `.omp/prompts/` for prompts shared with a project. For a command available in every project, save the same Markdown file under `~/.omp/agent/prompts/` instead.

## Pass arguments

Arguments follow the command name. Spaces and tabs separate arguments; matching single or double quotes keep text together and the quote characters are removed.

```text
/review-change payments "retry behavior" tests
```

| Syntax | Value in this example |
| --- | --- |
| `$1`, `$2`, … | `payments`, `retry behavior`, … |
| `$@` or `$ARGUMENTS` | `payments retry behavior tests` |
| `$@[2]` or `$@[2:]` | All arguments from the second: `retry behavior tests` |
| `$@[2:1]` | One argument starting at the second: `retry behavior` |

Indexes are one-based. A missing positional argument, an out-of-range slice, or a non-positive slice index expands to an empty string.

The argument parser does not have a backslash escape syntax. If an argument contains spaces, wrap it in the other quote style rather than trying to escape the surrounding quote. Empty quoted arguments are discarded.

If the template has no argument placeholder, omp does not throw the supplied text away. It appends the joined arguments to the prompt after a blank line:

```md
Summarize the requested part of this project.
```

Invoking `/summarize src/auth` sends the template followed by `src/auth`.

## Use Handlebars interpolation

After replacing the `$…` placeholders, omp renders the result as a Handlebars template. The most useful values are:

| Syntax | Meaning |
| --- | --- |
| `{{arg 1}}` | First parsed argument; `arg` is one-based |
| `{{arguments}}` or `{{ARGUMENTS}}` | All parsed arguments joined with spaces |
| `{{args}}` | The parsed argument array, useful in blocks and helpers |
| `{{default (arg 1) "current branch"}}` | A fallback when the first argument is absent |
| `{{#if args}}…{{else}}…{{/if}}` | Conditional content based on whether arguments were supplied |

For example:

```md
---
description: Draft a test plan for a feature
---

Draft a test plan for {{default (arg 1) "the current change"}}.
{{#if args}}
Additional context: {{arguments}}
{{/if}}
```

Shell-style substitution happens first and Handlebars rendering happens second. Argument values containing `$1`, `$@`, or `$ARGUMENTS` are not recursively substituted. A template that uses either style of inline argument placeholder does not also receive the automatic argument suffix.

For ordinary reusable prompts, prefer the `$1` and `$@` forms: they are shorter and make the invocation easy to understand. Use Handlebars only when you need defaults or conditional sections.

## Add a description

Only `description` has special meaning in an omp prompt template's YAML frontmatter:

```md
---
description: Explain a failing test and propose the smallest fix
---
```

Put frontmatter at the beginning of the file. If `description` is absent, omp uses the first non-empty body line, truncated to 60 characters, in autocomplete. The command name always comes from the Markdown filename; a frontmatter `name` field does not rename it.

## Discovery and naming

At session startup, omp recursively discovers Markdown files in these locations:

| Scope | Directory | Autocomplete source label |
| --- | --- | --- |
| User | `~/.omp/agent/prompts/**/*.md` | `(user)` or `(user:subdirectory)` |
| Project | `<working-directory>/.omp/prompts/**/*.md` | `(project)` or `(project:subdirectory)` |

Only the final filename becomes the command name. Both `.omp/prompts/frontend/review.md` and `.omp/prompts/backend/review.md` define `/review`, not namespaced commands. Give every template a unique filename even when you organize files into subdirectories.

Prompt templates are Markdown prompts, not executable command modules. If a command needs to run custom program logic or display its own UI, build an [extension](/docs/extension-authoring) instead.

## Precedence

omp loads user templates before project templates and uses the first matching name. As a result, `~/.omp/agent/prompts/review.md` wins over `.omp/prompts/review.md`. This differs from many project-overrides-user configuration systems, so unique names are the safest choice.

Other slash-command types resolve before prompt templates. A built-in, extension command, custom command, skill command, or file-based slash command with the same name wins; the conflicting prompt template is omitted from autocomplete.

## Reload after editing

Prompt templates are read when the session starts. omp does not watch these files, and `/reload-plugins` does not reload them. After creating, renaming, or editing a template, exit and start a new `omp` session in the intended working directory.

## Troubleshooting

### The command is missing from autocomplete

- Confirm the file ends in `.md` and is under `.omp/prompts/` for the current working directory or `~/.omp/agent/prompts/` for your user.
- Start a new session after changing the file.
- Check for another template with the same filename. A user template wins over a project template.
- Try a more distinctive filename in case a built-in, skill, extension, custom, or file-based command already owns the name.
- Check the session logs for a prompt-template warning. Invalid YAML frontmatter or an unreadable file can prevent that template from loading.

### Arguments expand unexpectedly

- Quote an argument that contains spaces: `/review-change auth "error handling"`.
- Do not rely on backslash escapes inside quoted arguments; they are treated literally rather than as an escape mechanism.
- Remember that `$@` includes every argument, including `$1`. Use `$@[2:]` for only the remainder.
- Add an explicit placeholder if you need to control where arguments appear. Without one, omp appends them after the template body.

### The project template does not override my user template

This is the current precedence rule: user templates load first. Rename one of the files, or remove the user-level duplicate, then start a new session.
