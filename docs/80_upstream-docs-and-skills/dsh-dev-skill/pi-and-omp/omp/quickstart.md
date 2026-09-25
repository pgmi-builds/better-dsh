<!--
source: https://omp.sh/docs/quickstart
fetched: 2026-09-06
-->

# Quickstart

> Install omp, choose a provider and model, and complete your first coding task.

omp works inside your existing project: describe a change in plain language, let the agent inspect and edit the code, then review the result and continue the conversation. This guide takes you from installation to a resumable first session.

## 1. Install omp

On macOS or Linux:

```sh
curl -fsSL https://omp.sh/install | sh
```

On Windows, run this in PowerShell:

```powershell
irm https://omp.sh/install.ps1 | iex
```

Confirm that the executable is available:

```sh
omp --version
```

If your shell cannot find `omp`, follow the PATH instruction printed by the installer, then open a new terminal and try again.

## 2. Open your project

Change into the project you want omp to work on. The directory where you launch omp becomes the project root for the session.

```sh
cd ~/code/my-project
```

Replace `~/code/my-project` with your project’s path.

If you use an API key, export it in this terminal before launch. For example:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

If you use a provider subscription with browser sign-in, skip that command; the first-run setup will sign you in.

Now launch the interactive app:

```sh
omp
```

## 3. Sign in and choose a model

The first launch opens a setup wizard.

1. On **Set up your providers**, keep the **Sign in** tab selected, choose your provider, and press <kbd>Enter</kbd>. Complete the browser login, then return to the terminal. You can sign in to more than one provider.
2. If you exported an API key instead, it is already available to omp; press <kbd>Esc</kbd> to leave the provider step.
3. Press <kbd>Esc</kbd> when you are done connecting providers.
4. On **Choose your default model**, type to search, highlight a model from the provider you configured, and press <kbd>Enter</kbd>. omp saves this choice for new sessions.
5. Finish the remaining terminal appearance prompts. They preview each choice before you save it.

Later launches go directly to the prompt. OAuth users can reopen sign-in with `/login`; use `/model` to change the current session’s model.

## 4. Give omp a coding task

At the prompt, type a concrete outcome in ordinary language. This example works as a first tour of an unfamiliar project:

```text
Inspect this project for one small bug or inconsistency that can be verified locally. Explain what you found, make the smallest safe fix, and run the most relevant check.
```

Press <kbd>Enter</kbd>. omp will inspect the project, show its actions as tool cards, edit files when needed, and stream its response. Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to expand or collapse full tool output.

## 5. Review and continue

Read the final summary and the reported check result. Ask for a focused review without leaving the session:

```text
Show me the diff and explain each changed file. Do not make more changes.
```

Then continue with a follow-up, just as you would with a teammate:

```text
Looks good. Run the relevant check once more and summarize any remaining risk.
```

If the agent is heading in the wrong direction during a turn, press <kbd>Esc</kbd> to interrupt it, then clarify the request.

## 6. Exit and resume

Press <kbd>Ctrl</kbd>+<kbd>D</kbd> or enter `/exit` to leave. omp saves the session automatically.

To continue the most recent session for this project, return to the same project directory and run:

```sh
omp --continue
```

The conversation and selected model reopen in the same project so you can send the next message. Run `omp --resume` instead when you want to choose from recent sessions.

## Optional next steps

Your first session needs no configuration file. When you want to customize omp, continue with:

- [Providers](/docs/providers) for API keys, OAuth providers, and authentication troubleshooting.
- [Custom models & providers](/docs/custom-models) when the built-in catalog is not enough.
- [Settings](/docs/settings) for user and project configuration.
- [Using omp](/docs/using) for the editor, message queue, and everyday workflow.
- [Sessions](/docs/sessions) for resume, fork, and session history.
- [Keybindings](/docs/keybindings) for all default controls.
