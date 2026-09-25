<!--
source: https://omp.sh/docs/compaction
fetched: 2026-09-06
-->

# Compaction

> Keep long omp sessions useful: let automatic context maintenance run, or recover deliberately with /compact, /handoff, and /shake.

Long sessions eventually contain more text than a model can consider at once. omp keeps the work moving by compacting older context while preserving the recent conversation. You normally do not need to do anything: automatic compaction is enabled by default.

Start with:

```text
/context
```

This shows how much of the active model's context window is in use and how much room remains before automatic maintenance. Keep working normally unless omp has lost an important detail, the context is dominated by bulky output, or you want to choose what survives.

## What automatic compaction does

As the context approaches the active model's limit, omp first removes stale file reads, empty searches, and other bulky results that are safe to elide. It then tries the configured maintenance methods in order. The default order is:

1. provider-native server compaction, when the active route supports it;
2. **snapcompact**, which archives older history into dense images for a vision-capable model;
3. a structured **handoff** summary;
4. **shake**, which removes recoverable command, search, and file-output bulk without a summarization request;
5. **soft** compaction, which summarizes older history with a model.

An unavailable or failed method advances to the next one. The default order therefore works across text-only and vision-capable models without model-specific configuration.

Whichever method succeeds, the active model keeps the recent tail of the conversation and receives a compact replacement for older context. Exact wording from the older turns is no longer in the model's live window, but normal compaction does not delete the original session record.

Automatic maintenance can happen:

- after a successful response crosses the threshold;
- between model requests during a long turn involving many commands or file reads;
- after a context-overflow or incomplete-output response, followed by a retry;
- while idle, but only when idle compaction is explicitly enabled.

By default, omp can prepare a summary shortly before the threshold so the visible pause is smaller. After threshold maintenance it continues the work automatically. Overflow and incomplete-output recovery retry the interrupted work instead.

### What you see

The TUI shows a status such as `Auto server compaction…`, `Auto-snapcompact…`, `Auto-handoff…`, or `Auto-shake…`. Press `Esc` to cancel it. Text entered while compaction is running waits until maintenance finishes.

After a summarizing method succeeds, the transcript is rebuilt around a slim divider such as `soft-compacted`, `remote-compacted`, or `handed-off`, usually with a token reduction such as `256K→20K`. Pre-compaction history is collapsed by default. Press `Ctrl+O` to expand the summary at the divider.

Automatic shake instead reports `Auto-shake completed` and replaces eligible heavy regions with short placeholders. With `compaction.autoContinue: true` (the default), threshold-triggered maintenance continues without waiting for another prompt.

## Choose a manual recovery path

Use the least destructive command that matches the problem:

| Situation | Command | Visible result |
| --- | --- | --- |
| The session is healthy, but you want more room or want to emphasize particular decisions | `/compact [focus]` | Older context becomes a compact summary/archive, a compaction divider appears, and omp waits for your next instruction. |
| The next phase needs a structured account of goals, decisions, progress, and next steps | `/handoff [focus]` | omp shows `Generating handoff…`, then replaces older live context with the handoff document and reports `Context handed off and compacted in place`. |
| Large command output, file contents, generated blocks, images, or stored reasoning are crowding out the conversation | `/shake [elide | images |
| Nothing is wrong | Do nothing | Automatic maintenance runs at the configured threshold. |

### `/compact`: the normal manual choice

Run `/compact` to compact now using the first usable configured manual method:

```text
/compact
```

Add focus instructions when older context contains several threads and one matters most:

```text
/compact Preserve the API decisions, unresolved test failure, and exact next steps. Treat benchmark experiments as disposable.
```

You can select a one-off method without changing settings:

| Syntax | Use it when |
| --- | --- |
| `/compact soft [focus]` | You want a conventional model-written summary and optionally want to direct it. |
| `/compact remote [focus]` | You want provider-native OpenAI-compatible compaction when available; it falls back to soft compaction. |
| `/compact snapcompact` | You want local image archival with a vision-capable model and no summarization request. It does not accept focus text. |

Manual `/compact` works even when automatic compaction is disabled. If a response is currently running, the command aborts that response before compacting. During the operation the TUI shows `Compacting context… (esc to cancel)`; after success, the divider and reduced context usage confirm the result.

### `/handoff`: preserve structured project state

Use `/handoff` when a generic conversation summary is too loose—for example, before moving from investigation to implementation or when a long task has many decisions and dependencies:

```text
/handoff Focus on the accepted design, files already changed, verification still needed, and known risks.
```

Despite the name, the manual command currently **compacts the current session in place**. It does not open a successor session and does not save a Markdown handoff file by default. Wait for the current response to finish, or abort it, before running `/handoff`. See [Handoff](/docs/handoff) for the handoff document's contents and automatic handoff behavior.

### `/shake`: remove bulk without summarizing the conversation

`/shake` defaults to `elide`:

```text
/shake
```

It replaces eligible command, search, and file-read output plus large fenced or XML-like blocks with short placeholders. In a persisted session, omp also saves the removed regions as a session artifact when possible; the placeholder includes an `artifact://…` recovery reference. If a removed result becomes important later, ask omp to recover the named region from that reference.

The targeted variants are more destructive:

| Command | Removes | Recovery |
| --- | --- | --- |
| `/shake elide` | Eligible heavy results and large blocks | Original regions are saved to an artifact when the session can persist one. |
| `/shake images` | Image blocks from the session | No recovery artifact is created. |
| `/shake thinking` | Stored reasoning blocks | No recovery artifact is created. |

Use image or thinking removal only after that material is no longer needed. A result such as `Nothing to shake`, `No images found`, or `No thinking blocks found` is a successful no-op, not an error.

## Configuration

The defaults are appropriate for most users. Change them through `/settings`, shell commands such as `omp config set`, or YAML in `~/.omp/agent/config.yml` (an existing `config.yaml` is also honored). Project overrides can live in `<project>/.omp/config.yml`.

For example, this opts into idle maintenance while keeping the normal automatic behavior:

```yaml
compaction:
  enabled: true
  idleEnabled: true
  idleThresholdTokens: 200000
  idleTimeoutSeconds: 300
```

Verify effective values from your shell:

```bash
omp config get compaction.enabled
omp config get compaction.methodOrder
omp config get compaction.thresholdPercent
```

Inside a session, run `/context` to verify the resulting threshold and available slack.

### Settings reference

| Setting | Default | Effect |
| --- | --- | --- |
| `compaction.enabled` | `true` | Enables automatic maintenance. Manual `/compact`, `/handoff`, and `/shake` remain available when false. |
| `compaction.methodOrder` | `[remote, snapcompact, handoff, shake, soft]` | Ordered automatic fallback list. Supported values are `remote`, `snapcompact`, `handoff`, `shake`, and `soft`. |
| `compaction.thresholdTokens` | `-1` | Fixed trigger when greater than zero. It takes precedence over `thresholdPercent`. |
| `compaction.thresholdPercent` | `-1` | Percentage trigger when greater than zero. `-1` uses reserve-based automatic sizing. Values are clamped to 1–99%. |
| `compaction.reserveTokens` | unset | Headroom used by reserve-based sizing. When unset, omp normally reserves the larger of 16,384 tokens or 15% of the model window; small windows fall back to the proportional reserve. |
| `compaction.keepRecentTokens` | `20000` | Target amount of recent conversation retained verbatim after summarizing compaction. |
| `compaction.midTurnEnabled` | `true` | Allows maintenance at safe boundaries during a long turn involving many commands or file reads. |
| `compaction.asyncEnabled` | `true` | Prepares eligible summarization shortly before the threshold to reduce the pause when compaction commits. |
| `compaction.autoContinue` | `true` | Continues automatically after post-turn threshold maintenance. Set false when a scripted or headless run should stop there. |
| `compaction.idleEnabled` | `false` | Enables maintenance while the session is idle. |
| `compaction.idleThresholdTokens` | `200000` | Minimum context size for idle maintenance. |
| `compaction.idleTimeoutSeconds` | `300` | Idle time before maintenance is considered. |
| `compaction.handoffSaveToDisk` | `false` | Saves documents generated by **automatic** handoff to disk. It does not make manual `/handoff` save a file. |
| `compaction.supersedeReads` | `true` | Elides older copies of file contents after the same file is read again, when caching conditions permit. |
| `compaction.dropUseless` | `true` | Elides consumed output that carries no useful context, such as empty searches or timed-out waits. |
| `compaction.remoteEndpoint` | unset | Uses a custom OpenAI-compatible remote compaction endpoint. Most users should leave this unset. |
| `compaction.remoteStreamingV2Enabled` | `true` | Uses streaming remote compaction on compatible routes. |
| `compaction.v2RetainedMessageBudget` | `64000` | Caps the recent-message budget retained by streaming remote compaction. |

`display.collapseCompacted` is a related appearance setting. It defaults to `true`, hiding pre-compaction history from the live transcript while leaving the summary divider visible. Set it to `false` if you prefer the full stored transcript inline.

## Troubleshooting

### Automatic compaction did not run

1. Run `/context`. Maintenance does not run merely because a session feels long; the estimated usage must cross the resolved threshold.
2. Check `omp config get compaction.enabled` and `omp config get compaction.methodOrder`.
3. If you expected idle maintenance, remember that `compaction.idleEnabled` defaults to `false` and the session must exceed `idleThresholdTokens` for at least `idleTimeoutSeconds`.
4. If one method is unavailable, let the fallback list proceed. A text-only model, for example, cannot use snapcompact but can continue to handoff, shake, or soft compaction.

### `/compact` says the session is too small or already compacted

`Nothing to compact (session too small)` means there is not enough older context to replace. `Already compacted` means no substantial new history exists beyond the latest boundary. Continue working and try again later; no recovery is required.

### Snapcompact fails

Snapcompact requires a vision-capable active model and text its bundled image font can represent. Use `/compact soft` for a predictable text summary. `/compact remote` is another option when the current provider supports server compaction.

### Context is still too large

Run `/context` to identify whether messages or bulky historical results dominate. Use `/shake` first for heavy output; use `/compact soft` when the conversation itself is large. If this repeats, lower `compaction.thresholdPercent`, reduce `compaction.keepRecentTokens`, or choose a model with a larger context window rather than waiting for overflow.

### An important old detail is missing

Press `Ctrl+O` on the compaction divider to inspect the generated summary. Normal compaction preserves the underlying session history, so use the [session tree](/docs/sessions) to revisit or branch from an earlier point. For future manual compactions, include explicit focus instructions or use `/handoff` for a more structured continuation. Content removed by `/shake images` or `/shake thinking` is not preserved in a recovery artifact.

## Related

- [Handoff](/docs/handoff) — structured continuation summaries and automatic handoff behavior.
- [Sessions](/docs/sessions) — stored history, resume, branches, and the session tree.
- [Settings](/docs/settings) — configuration files, precedence, `/settings`, and `omp config`.
- [Memory](/docs/memory) — durable facts across sessions; separate from context compaction.
