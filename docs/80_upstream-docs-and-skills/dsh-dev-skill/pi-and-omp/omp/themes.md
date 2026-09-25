<!--
source: https://omp.sh/docs/themes
fetched: 2026-09-06
-->

# Themes

> Preview a bundled palette, follow your terminal’s dark or light appearance, or install a readable JSON theme of your own.

Themes control the TUI’s text, backgrounds, borders, Markdown, syntax highlighting, diffs, input modes, status line, and symbols. The fastest way to choose one is `/settings`: open **Appearance**, then **Dark Theme** or **Light Theme**. Moving through the list previews each bundled or installed theme immediately. Press Enter to keep the highlighted theme, or Escape to restore the previous one.

## Follow the terminal appearance

omp does not have one fixed “system” palette. It keeps a dark-theme slot and a light-theme slot, then uses the slot matching the terminal background. The defaults are `titanium` for dark backgrounds and `light` for light backgrounds.

Set both slots in `/settings`, or in the active agent configuration:

```yaml
# ~/.omp/agent/config.yml
theme:
  dark: titanium
  light: light
```

omp determines the slot from the terminal-reported OSC 11 background, then `COLORFGBG`. On macOS under Zellij, where OSC 11 is unreliable, it can use the macOS appearance. If none is available, it chooses the dark slot. Appearance changes are reevaluated while the interactive TUI is running.

The bundled list includes `dark`, `light`, `titanium`, terminal-oriented palettes such as `dark-terminal`, and many named dark and light palettes. Use the `/settings` list as the authoritative catalog for your installed version rather than copying a name from another release.

## Create and install a custom theme

A custom theme is one JSON file in the active agent directory:

- default profile: `~/.omp/agent/themes/<name>.json`
- named profile: `~/.omp/profiles/<profile>/agent/themes/<name>.json`
- custom agent directory: `$PI_CODING_AGENT_DIR/themes/<name>.json`

Project-local theme files are not scanned. The filename without `.json` is the selection name; use the same value for the JSON `name`. A bundled theme wins if its name collides with a custom file.

Create the directory, then save the complete minimal theme below as `~/.omp/agent/themes/ink.json`:

```sh
mkdir -p ~/.omp/agent/themes
```

```json
{
  "name": "ink",
  "vars": {
    "fg": "#e6edf3",
    "muted": "#8b949e",
    "dim": "#6e7681",
    "accent": "#79c0ff",
    "green": "#56d364",
    "red": "#ff7b72",
    "yellow": "#e3b341",
    "purple": "#d2a8ff",
    "panel": "#161b22",
    "selected": "#26364a",
    "border": "#30363d"
  },
  "colors": {
    "accent": "accent",
    "border": "border",
    "borderAccent": "accent",
    "borderMuted": "border",
    "success": "green",
    "error": "red",
    "warning": "yellow",
    "muted": "muted",
    "dim": "dim",
    "text": "fg",
    "thinkingText": "muted",

    "selectedBg": "selected",
    "userMessageBg": "panel",
    "customMessageBg": "panel",
    "toolPendingBg": "panel",
    "toolSuccessBg": "#14251a",
    "toolErrorBg": "#2d1719",
    "statusLineBg": "panel",

    "userMessageText": "fg",
    "customMessageText": "fg",
    "customMessageLabel": "accent",
    "toolTitle": "fg",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "yellow",
    "mdCodeBlock": "fg",
    "mdCodeBlockBorder": "border",
    "mdQuote": "muted",
    "mdQuoteBorder": "border",
    "mdHr": "border",
    "mdListBullet": "accent",

    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "muted",

    "syntaxComment": "muted",
    "syntaxKeyword": "purple",
    "syntaxFunction": "accent",
    "syntaxVariable": "fg",
    "syntaxString": "green",
    "syntaxNumber": "yellow",
    "syntaxType": "accent",
    "syntaxOperator": "red",
    "syntaxPunctuation": "muted",

    "thinkingOff": "dim",
    "thinkingMinimal": "muted",
    "thinkingLow": "accent",
    "thinkingMedium": "green",
    "thinkingHigh": "yellow",
    "thinkingXhigh": "purple",
    "bashMode": "green",
    "pythonMode": "yellow",

    "statusLineSep": "dim",
    "statusLineModel": "purple",
    "statusLinePath": "accent",
    "statusLineGitClean": "green",
    "statusLineGitDirty": "yellow",
    "statusLineContext": "accent",
    "statusLineSpend": "muted",
    "statusLineStaged": "green",
    "statusLineDirty": "yellow",
    "statusLineUntracked": "red",
    "statusLineOutput": "fg",
    "statusLineCost": "yellow",
    "statusLineSubagents": "purple"
  },
  "symbols": {
    "preset": "unicode"
  }
}
```

Open `/settings` after installing the file and select `ink` for **Dark Theme**. If the settings list was already open when you created the file, close and reopen it; restart omp if the new name still does not appear. To use a custom light palette, design it against a light terminal background and select it for **Light Theme** instead.

## File format and color values

`name` and `colors` are required. `vars`, `export`, and `symbols` are optional.

Each color may be:

- `"#RRGGBB"` for an RGB color;
- an integer from `0` through `255` for an ANSI 256-color palette index;
- the name of an entry in `vars` (references may be nested); or
- `""` to use the terminal’s default foreground or background.

Missing and circular variable references are errors. Hex colors are emitted as truecolor on capable terminals and converted to 256 colors otherwise. Numeric values always address the terminal’s 256-color palette, so their exact appearance depends on the terminal. The `dark-terminal` built-in is a useful compatibility starting point, while `""` lets the terminal own the base foreground or background.

All of these `colors` keys are required except `thinkingMax`, which is optional and falls back to `thinkingXhigh`:

| Area | Tokens |
| --- | --- |
| Core | `accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText` |
| Backgrounds | `selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg` |
| Message and tool text | `userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput` |
| Markdown | `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet` |
| Diff | `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext` |
| Syntax | `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation` |
| Thinking and input modes | `thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, optional `thinkingMax`, `bashMode`, `pythonMode` |
| Status line | `statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents` |

### Optional exports and symbol overrides

HTML export colors can be supplied independently:

```json
"export": {
  "pageBg": "#0d1117",
  "cardBg": "#161b22",
  "infoBg": "#26364a"
}
```

Without them, omp derives export backgrounds from the theme. `symbols.preset` accepts `unicode`, `nerd`, or `ascii`; Nerd symbols require a Nerd Font. The global **Symbol Preset** setting overrides the theme’s preset. Advanced themes may also replace individual symbols and spinner frames:

```json
"symbols": {
  "preset": "ascii",
  "overrides": {
    "status.success": "OK",
    "nav.cursor": ">",
    "boxRound.topLeft": "+"
  },
  "spinnerFrames": {
    "status": [".", "o", "O", "o"],
    "activity": [".", "..", "..."]
  }
}
```

Override keys use the UI symbol vocabulary, including `status.*`, `nav.*`, `tree.*`, `boxRound.*`, `boxSharp.*`, `sep.*`, `icon.*`, `thinking.*`, `md.*`, `lang.*`, `tab.*`, and `tool.*`. Unknown keys are ignored. `spinnerFrames` may instead be one non-empty string array applied to both spinners; in the object form, `status` and `activity` are independently optional, but at least one must be present and non-empty.

## Reload and review readability

Once an installed custom theme is active in an interactive session, omp watches that file. Saving valid JSON repaints the TUI after a short debounce; there is no reload command. A temporarily missing, malformed, or incomplete file leaves the last successfully loaded version on screen. Fix and save it again. Built-in themes are embedded and are not watched.

Before keeping a theme, inspect normal conversation text, selected rows, Markdown links and code, pending/success/error tool blocks, diffs, syntax, every thinking level, bash and Python modes, and all status-line segments. In particular:

- keep foreground/background contrast high, including muted text and selected rows;
- make errors, warnings, and additions distinguishable by luminance as well as hue;
- try both truecolor and a 256-color terminal if the theme will be shared;
- choose `ascii` if border or icon glyphs render with the wrong width;
- enable **Color Blind Mode** in `/settings` when useful. It shifts a hex `toolDiffAdded` green toward blue; it does not rewrite the rest of the palette.

## Troubleshooting

**The theme is not listed.** Check that the file is directly inside the active agent’s `themes` directory, ends in `.json`, and was present when the settings list was opened. A project `.omp/themes` directory is not a theme source.

**A different theme loads.** Do not reuse a bundled name: bundled themes take precedence. Also check whether you changed the dark slot while omp currently detects a light background, or vice versa.

**Selection reports missing colors.** Custom themes require the full token set above. `thinkingMax` alone is optional.

**Selection reports an invalid color or variable.** Use `#RRGGBB`, `0`–`255`, `""`, or a resolvable `vars` name. Check JSON syntax, missing variables, and reference cycles.

**Startup falls back to `dark`.** The configured theme could not be found or validated. Repair the selected file or choose a bundled theme in `/settings`; a failed initial load uses the built-in `dark` fallback.

**A save does not repaint.** Live reload only watches the currently active custom file. Select it first, then save valid JSON. If an editor replaced or removed the file temporarily, save it once more after the final file exists.

## Related

- [Settings](/docs/settings) — configuration file locations and appearance settings.
- [Plugins](/docs/plugins) — extension installation and other customization surfaces.
