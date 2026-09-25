<!--
source: https://omp.sh/docs/keybindings
fetched: 2026-09-06
-->

# Keybindings

> The shortcuts that control an omp session, where they apply, and how to remap them.

Keybindings let you send or queue prompts, interrupt work, navigate the editor, and open common session controls without leaving the keyboard. Start with the small set below; use `/hotkeys` when you forget a chord.

## First-session shortcuts

| Key | What it does |
| --- | --- |
| <kbd>Enter</kbd> | Send the prompt. While omp is working, this sends a steering message to the active turn. |
| <kbd>Shift</kbd>+<kbd>Enter</kbd>, <kbd>Ctrl</kbd>+<kbd>J</kbd>, or <kbd>Alt</kbd>+<kbd>Enter</kbd> | Insert a newline instead of sending. |
| <kbd>Ctrl</kbd>+<kbd>Q</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Queue a follow-up for after the current turn finishes. |
| <kbd>Escape</kbd> | Dismiss autocomplete or interrupt the active operation. |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Expand or collapse tool output. |
| <kbd>Ctrl</kbd>+<kbd>R</kbd> | Search prompt history. |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Clear the editor. Press it again within half a second to exit. |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Exit immediately; a non-empty prompt is saved as a resumable draft. |
| <kbd>Alt</kbd>+<kbd>A</kbd> | Open the Agent Hub. |

## Discover the active shortcuts

Enter this in any interactive session:

```text
/hotkeys
```

The resulting table uses your platform's key names and resolves application remaps from the active `keybindings.yml`. For example, macOS displays `Option` and `Cmd` where the configuration syntax uses `alt` and `super`.

`/hotkeys` is a quick everyday list, not the complete configuration registry. Its editor navigation rows describe the standard defaults, and extension-added shortcuts are not appended to it. Use the action tables below when remapping editor or selection controls.

## Where a shortcut applies

The focused surface decides what a key means. Reusing a key in separate contexts is normal: <kbd>Ctrl</kbd>+<kbd>O</kbd> expands tool output in the transcript but cycles filters inside `/tree`, for example.

| Context | Controls |
| --- | --- |
| Main prompt editor | Application actions (`app.*`) plus editor actions (`tui.editor.*` and `tui.input.*`). |
| Autocomplete, history, and most pickers | Selection actions (`tui.select.*`): arrows move, <kbd>PageUp</kbd>/<kbd>PageDown</kbd> page, <kbd>Enter</kbd> confirms, and <kbd>Escape</kbd> cancels. |
| `@` file picker | Type to fuzzy-filter project files, use <kbd>Up</kbd>/<kbd>Down</kbd>, accept with <kbd>Tab</kbd>, and dismiss with <kbd>Escape</kbd>. |
| Plan approval | <kbd>Escape</kbd> cancels approval and returns to [plan-mode iteration](/docs/plan). |

### Full-screen surfaces

These pages add controls specific to the surface. Their fixed controls are not separate action IDs in `keybindings.yml`; remappable selection and interrupt actions still apply where shown.

| Surface | Controls |
| --- | --- |
| `/tree` | <kbd>Up</kbd>/<kbd>Down</kbd> move; <kbd>Alt</kbd>+<kbd>Up</kbd>/<kbd>Down</kbd> jump between user or assistant turns; <kbd>Left</kbd>/<kbd>Right</kbd> or <kbd>PageUp</kbd>/<kbd>PageDown</kbd> page; <kbd>Home</kbd>/<kbd>End</kbd> jump to the first/last visible item; <kbd>Enter</kbd> selects; <kbd>Shift</kbd>+<kbd>Enter</kbd> summarizes and switches directly; <kbd>Ctrl</kbd>+<kbd>O</kbd>/<kbd>Shift</kbd>+<kbd>Ctrl</kbd>+<kbd>O</kbd> cycle filters; <kbd>Escape</kbd> clears search, then closes. |
| `/extensions` | <kbd>Tab</kbd>/<kbd>Shift</kbd>+<kbd>Tab</kbd> or <kbd>Left</kbd>/<kbd>Right</kbd> switch provider tabs; arrows or <kbd>j</kbd>/<kbd>k</kbd> move; <kbd>Space</kbd> or <kbd>Enter</kbd> toggles the selected row; typing filters; <kbd>Escape</kbd> clears the filter, then closes; <kbd>Ctrl</kbd>+<kbd>C</kbd> closes immediately. |
| `/agents` | <kbd>Tab</kbd>/<kbd>Shift</kbd>+<kbd>Tab</kbd> or <kbd>Left</kbd>/<kbd>Right</kbd> switch between scope and list; arrows move; <kbd>Enter</kbd> opens or activates; <kbd>Space</kbd> toggles the selected agent when the search is empty; typing filters; <kbd>Ctrl</kbd>+<kbd>R</kbd> reloads; <kbd>Escape</kbd> clears the filter, then closes. |
| Agent Hub | Arrows or <kbd>j</kbd>/<kbd>k</kbd> select; <kbd>Enter</kbd> opens an agent; <kbd>t</kbd> toggles flat/tree views; <kbd>Tab</kbd> shows the inspector on narrow terminals; <kbd>r</kbd> revives a parked agent; <kbd>x</kbd> kills and releases an agent; <kbd>Escape</kbd> closes the inspector, then the Hub. |

## Complete application defaults

These action IDs control the main omp session. An **Unbound** action works once you assign it a chord.

| Action ID | Default | User-visible action |
| --- | --- | --- |
| `app.interrupt` | `escape` | Cancel autocomplete or interrupt active work. |
| `app.clear` | `ctrl+c` | Clear the editor; a second press within 500 ms exits. |
| `app.exit` | `ctrl+d` | Exit and save the current prompt as a draft. |
| `app.suspend` | `ctrl+z` | Suspend omp on POSIX systems; resume with `fg`. |
| `app.display.reset` | `alt+l` | Reset and repaint the terminal display. |
| `app.thinking.cycle` | `shift+tab` | Cycle the thinking level. |
| `app.thinking.toggle` | `ctrl+t` | Show or hide thinking blocks. |
| `app.model.cycleForward` | `ctrl+p` | Cycle role models forward: slow, default, smol. |
| `app.model.cycleBackward` | `shift+ctrl+p` | Cycle role models backward. |
| `app.model.selectTemporary` | `alt+p` | Choose a temporary model for this session. |
| `app.model.select` | `alt+m` | Open the model selector and set model roles. |
| `app.tools.expand` | `ctrl+o` | Expand or collapse tool output. |
| `app.tools.toggleVisibility` | `ctrl+shift+o` | Show or hide tool activity. |
| `app.editor.external` | `ctrl+g` | Edit the draft with `$VISUAL`, falling back to `$EDITOR`. |
| `app.message.followUp` | `ctrl+q`, `ctrl+enter` | Queue a follow-up message. |
| `app.retry` | `alt+r` | Retry the last failed assistant turn. |
| `app.message.dequeue` | `alt+up`, `shift+up` | Move the most recently queued message back into the editor. |
| `app.clipboard.pasteImage` | Linux: `ctrl+v`; macOS: `ctrl+v`, `super+v`; Windows: `ctrl+v`, `alt+v` | Paste an image from the clipboard, or text when no image is present. |
| `app.clipboard.pasteTextRaw` | `ctrl+shift+v`, `alt+shift+v` | Paste text without collapsing a large paste. |
| `app.clipboard.copyLine` | `alt+shift+l` | Copy the current prompt line. |
| `app.clipboard.copyPrompt` | `alt+shift+c` | Copy the whole prompt. |
| `app.agents.hub` | `alt+a` | Open or close the Agent Hub. |
| `app.session.observe` | `ctrl+s` | Open or close the Agent Hub using the legacy session-observe chord. |
| `app.session.new` | Unbound | Start a new session, like `/new`. |
| `app.session.tree` | Unbound | Open the session tree. |
| `app.session.fork` | Unbound | Open the message picker used to fork the session. |
| `app.session.resume` | Unbound | Open the session resume picker. |
| `app.plan.toggle` | `alt+shift+p` | Toggle plan mode. |
| `app.history.search` | `ctrl+r` | Search prompt history. |
| `app.stt.toggle` | Unbound | Toggle speech-to-text recording. By default, hold <kbd>Space</kbd> to record and release it to transcribe when speech-to-text is enabled. |
| `app.live.toggle` | `ctrl+l` | Start or stop live voice mode, like `/live`. |

Double-tapping <kbd>Left</kbd> in an empty editor also opens the Agent Hub when there is an agent to show. That gesture is fixed rather than a remappable action.

## Complete editor and picker defaults

### Editor navigation and editing

| Action ID | Default | Action |
| --- | --- | --- |
| `tui.editor.cursorUp` | `up` | Move the cursor up; in an empty main editor, browse older prompt history. |
| `tui.editor.cursorDown` | `down` | Move the cursor down or browse newer prompt history. |
| `tui.editor.cursorLeft` | `left`, `ctrl+b` | Move left one character. |
| `tui.editor.cursorRight` | `right`, `ctrl+f` | Move right one character. |
| `tui.editor.cursorWordLeft` | `alt+left`, `ctrl+left`, `alt+b` | Move left one word. |
| `tui.editor.cursorWordRight` | `alt+right`, `ctrl+right`, `alt+f` | Move right one word. |
| `tui.editor.cursorLineStart` | `home`, `ctrl+a` | Move to the start of the line. |
| `tui.editor.cursorLineEnd` | `end`, `ctrl+e` | Move to the end of the line. |
| `tui.editor.jumpForward` | `ctrl+]` | Read a character, then jump forward to it. |
| `tui.editor.jumpBackward` | `ctrl+alt+]` | Read a character, then jump backward to it. |
| `tui.editor.pageUp` | `pageUp` | Move up one editor page. |
| `tui.editor.pageDown` | `pageDown` | Move down one editor page. |
| `tui.editor.deleteCharBackward` | `backspace` | Delete the character before the cursor. |
| `tui.editor.deleteCharForward` | `delete`, `ctrl+d` | Delete the character after the cursor. In the main omp editor, `app.exit` takes `ctrl+d`, so use <kbd>Delete</kbd>. |
| `tui.editor.deleteWordBackward` | `ctrl+w`, `alt+backspace`, `ctrl+backspace`, `super+alt+backspace` | Delete the previous word. |
| `tui.editor.deleteWordForward` | `alt+delete`, `alt+d`, `super+alt+delete`, `super+alt+d` | Delete the next word. |
| `tui.editor.deleteToLineStart` | `ctrl+u` | Delete to the start of the line. |
| `tui.editor.deleteToLineEnd` | `ctrl+k` | Delete to the end of the line. |
| `tui.editor.yank` | `ctrl+y` | Insert the most recently deleted text. |
| `tui.editor.yankPop` | `alt+y` | Replace the last yank with the previous deleted-text entry. |
| `tui.editor.undo` | `ctrl+-`, `ctrl+_` | Undo the last edit. |
| `tui.editor.spellingSuggestions` | `ctrl+.` | Show spelling replacements. |

### Generic input and selection

| Action ID | Default | Action |
| --- | --- | --- |
| `tui.input.newLine` | `shift+enter`, `ctrl+j` | Insert a newline. <kbd>Alt</kbd>+<kbd>Enter</kbd> is also a built-in newline fallback. |
| `tui.input.submit` | `enter` | Submit the input. |
| `tui.input.tab` | `tab` | Tab or accept autocomplete. |
| `tui.input.copy` | `ctrl+c` | Copy a selection in inputs that support selection. |
| `tui.select.up` | `up` | Move a picker selection up. |
| `tui.select.down` | `down` | Move a picker selection down. |
| `tui.select.pageUp` | `pageUp` | Move a picker selection up one page. |
| `tui.select.pageDown` | `pageDown` | Move a picker selection down one page. |
| `tui.select.confirm` | `enter` | Confirm a picker selection. |
| `tui.select.cancel` | `escape`, `ctrl+c` | Cancel a picker. |

## Remap shortcuts

Keybindings are separate from the main settings file:

- Default profile: `~/.omp/agent/keybindings.yml`
- Named profile: `~/.omp/profiles/<name>/agent/keybindings.yml`
- Custom default-profile agent directory: `$PI_CODING_AGENT_DIR/keybindings.yml`

A named profile inherits the default profile's bindings, then overrides them action by action. See [Settings](/docs/settings) for profile and directory configuration.

Create the file if it does not exist. It is a YAML mapping from an exact action ID to one chord, an array of chords, or an empty array:

```yaml
# ~/.omp/agent/keybindings.yml
app.model.cycleForward: f6
app.plan.toggle: f7
tui.editor.undo: [ctrl+-, ctrl+_]
app.history.search: []
```

A remap **replaces** that action's complete default list; it does not add to it. Repeat any defaults you want to retain. An empty array disables the action.

Restart `omp` after saving the file. Run `/hotkeys` to verify application actions such as `app.model.cycleForward`; exercise the key directly to verify editor and picker actions, whose `/hotkeys` rows remain a compact defaults guide.

### Chord syntax

- Chords are simultaneous keys joined by `+`, such as `ctrl+p`, `alt+shift+p`, or `ctrl+backspace`. Multi-step sequences are not supported.
- Names are case-insensitive. Lowercase is recommended in authored files.
- Modifiers are `ctrl`, `shift`, `alt`, and `super`. On macOS, `alt` means Option and `super` means Command.
- Base keys include letters, digits, punctuation, arrows, `home`, `end`, `pageUp`, `pageDown`, `backspace`, `delete`, `insert`, `enter`, `escape`, `tab`, `space`, and `f1` through `f12`.
- `esc` is accepted as an alias for `escape`; `return` is accepted as an alias for `enter`.
- Avoid assigning the same chord to multiple actions in the same context. Which one wins can depend on the focused surface.

Legacy unqualified action names are migrated when loaded. A legacy `keybindings.json` is migrated to `keybindings.yml`; `keybindings.yaml` is also accepted. New configuration should use `keybindings.yml` and the namespaced IDs in this page.

## Platform and terminal notes

- **macOS:** write `alt` and `super` in YAML even though omp displays Option and Cmd. Some terminal profiles use Option for character composition and do not deliver <kbd>Option</kbd>+<kbd>Up</kbd>; use the <kbd>Shift</kbd>+<kbd>Up</kbd> dequeue fallback.
- **Windows:**<kbd>Ctrl</kbd>+<kbd>Z</kbd> cannot suspend omp. Windows Terminal does not deliver a distinct <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, so use <kbd>Ctrl</kbd>+<kbd>Q</kbd> for follow-ups. If it captures <kbd>Ctrl</kbd>+<kbd>V</kbd>, use <kbd>Alt</kbd>+<kbd>V</kbd> for clipboard images.
- **Newlines:** if a terminal cannot distinguish <kbd>Shift</kbd>+<kbd>Enter</kbd> from <kbd>Enter</kbd>, use <kbd>Ctrl</kbd>+<kbd>J</kbd> or <kbd>Alt</kbd>+<kbd>Enter</kbd>.
- **Terminal-owned keys:** your terminal, multiplexer, desktop, or shell may intercept a chord before omp receives it. Change that terminal binding or choose another omp chord.

## Troubleshooting

### A remap does not take effect

1. Confirm you edited `keybindings.yml` in the active profile's agent directory, not `config.yml`.
2. Confirm the action ID exactly matches a table entry; action IDs are case-sensitive.
3. Restart `omp`. Keybindings are loaded when the interactive session starts.
4. Check that the YAML value is a string, array of strings, or `[]`.
5. Run `/hotkeys` for an application action, or exercise an editor/picker action directly.

### A chord still does nothing

Try one of the documented fallback chords. If the fallback works, the terminal is probably consuming or normalizing the original chord. This is common for <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, <kbd>Shift</kbd>+<kbd>Enter</kbd>, Option combinations, and clipboard keys.

Also check the rest of `keybindings.yml` for the same chord. Assigning it to two actions in one context creates an ambiguous remap.

### The key does something different

Check the focused surface. Editor, picker, `/tree`, `/extensions`, `/agents`, and Agent Hub controls are context-sensitive. Press <kbd>Escape</kbd> to close the current overlay, then retry the shortcut in the main prompt editor. See [Slash commands](/docs/slash) for command alternatives to common shortcuts.
