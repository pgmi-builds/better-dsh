<!--
source: https://omp.sh/docs/computer
fetched: 2026-09-06
-->

# Computer control

> Let omp inspect and operate real desktop applications through screenshots, native input, and the operating system accessibility tree.

## Control the desktop, not just a web page

Computer control lets omp work with the desktop you are looking at: IDEs, terminals, office applications, browser chrome, native dialogs, and system settings. It can inspect windows and displays, take screenshots, use native accessibility controls, click, type, scroll, press shortcuts, and read or replace clipboard text.

It is disabled by default because it can see private screen content and act in real applications. A mistaken click can affect an account, send a message, change a setting, or overwrite data. Enable it only when you need native desktop access, and keep an approval boundary around actions that change anything.

For a cautious one-session trial, start omp in the desktop session you want it to control and enter:

```text
/computer on
/computer status
```

Then make an inspection-only request in normal language:

```text
Inspect the currently focused application and tell me its window title and
visible controls. Do not click, type, change the clipboard, or grant permissions.
```

You never need to invoke the computer-control machinery yourself. Describe the target, the result you want, what omp may change, and where it must stop.

## Browser or computer control?

Use the narrowest surface that can finish the task.

| Need | Use |
| --- | --- |
| Read or interact with a web page through DOM and web accessibility information | [Browser control](/docs/web) |
| Work in a Chromium tab, including an authenticated Chrome tab connected through the browser relay | [Browser control](/docs/web) |
| Operate a native app, browser toolbar, file picker, system dialog, or the desktop itself | Computer control |
| Interact with a web app whose controls are not usable through the page structure | Try browser control first; use computer control only when pixels or native chrome are required |

Browser control understands page elements and stays within the selected browser tab. Computer control sees OS windows and screen pixels; it does not have a web page DOM. A browser window is just another desktop window to it. For forms and authenticated sites, browser control is usually more precise and exposes less of the surrounding desktop.

## Enable it safely

`/computer on` enables computer control only for the current session. `/computer off` removes it from the active tool set immediately. To make it available in future sessions, use **Tools → Available Tools → Computer** in `/settings`, or edit `~/.omp/agent/config.yml`:

```yaml
computer:
  enabled: true
  display: all
  maxWidth: 3840
  maxHeight: 2400

tools:
  approval:
    computer: prompt
```

This policy asks before every computer-control run. It is a good first configuration because enabling the capability does not silently authorize its use.

If you want inspection to proceed without prompts while still confirming input-capable runs, remove the per-tool override and set the global approval mode to `write`:

```yaml
tools:
  approvalMode: write
```

In that mode, omp can perform a run it has classified as inspection-only, while desktop input and mutation require confirmation. The mode applies to other tools too. A per-tool `computer: allow`, `prompt`, or `deny` overrides the global mode; use `deny` when desktop control must remain blocked even if someone enables it for the session. Avoid `allow` and `--yolo` on a desktop that contains valuable accounts or data.

Changes made with `/computer` are temporary and do not rewrite the config file. Start a new session after editing a settings file. See [Settings](/docs/settings) for config locations and precedence.

### Limit what screenshots include

The default `display: all` creates a composite of every display. That is convenient, but it may expose unrelated windows and increases image size. Ask omp to list connected display names and IDs without taking action, then replace `all` with the native ID you want to expose.

`maxWidth` and `maxHeight` cap screenshot dimensions. Their defaults are 3840 × 2400. Some model transports apply a smaller coordinate-safe limit automatically. Lower values reduce transferred image detail; they do not change which windows are visible within the selected display.

There is no backend setting. omp selects the native backend for the operating system and desktop session.

## Grant operating-system permissions

Enablement in omp and permission from the operating system are separate gates. Grant only the capabilities you intend to use.

### macOS

Open **System Settings → Privacy & Security** and grant:

- **Screen Recording** to capture displays and windows.
- **Accessibility** to inspect accessibility controls and send native input.

Grant the entries macOS presents for the application that launches omp, such as your terminal or IDE. Fully quit and reopen that launching application after changing either permission, then start omp again. A capture can work while clicks fail when Screen Recording is granted but Accessibility is not.

### Linux on X11

Run omp inside the logged-in graphical session with access to the intended `DISPLAY`. Capture and input require a readable X11 display with RandR and XTEST. Semantic accessibility requires the desktop's AT-SPI service. There is normally no omp-specific permission dialog; missing session services appear as unavailable capabilities.

### Linux on Wayland

Native input uses the desktop's RemoteDesktop portal, or an administrator-provided `LIBEI_SOCKET`. The portal asks for permission lazily when input is first needed. That grant is not persisted by omp and closes with the desktop-control session; an inspection-only accessibility request does not open the input portal.

Released omp binaries do not include Wayland ScreenCast/PipeWire capture, so screenshots report unavailable on those builds. A custom build with Wayland screencast support uses the compositor's ScreenCast portal. AT-SPI can still provide window and control information when the application exposes it.

Wayland compositors do not let omp activate an arbitrary background window. Focus the target yourself when native input is required, or ask omp to use an available accessibility action.

### Windows

Windows x64 uses native display and window capture, Win32 input, and UI Automation accessibility. Run omp in the interactive desktop session that contains the target applications. The current backend reports capture, input, and accessibility availability through `/computer status`; there is no omp backend selector to configure.

## Ask for a desktop task

A useful request names the application or window, states the allowed changes, and places a boundary before any consequential step.

```text
In the open Calendar app, inspect next Tuesday and summarize my free blocks.
Do not create or edit events.
```

```text
In the focused spreadsheet, enter these four values into cells B2:B5 and save
the existing file. Do not rename, move, or close it.
```

```text
Open the desktop mail app, draft a reply to Casey using the text below, and stop
with the draft visible. Do not send it.
```

```text
Check whether Screen Recording and Accessibility are enabled for my terminal.
Tell me what is missing, but leave permission changes for me to make manually.
```

For an unfamiliar app, ask omp to inspect first and report the intended control before it acts. For a long workflow, define checkpoints such as “stop before Submit,” “do not replace an existing file,” or “ask before switching to foreground input.”

## How omp observes and acts

omp prefers the operating system accessibility tree when an app exposes one. Accessibility controls carry semantic roles, labels, values, and actions, so omp can target a named button or field without estimating a pixel coordinate. This is more reliable across window movement, scaling, and theme changes.

Screenshots are used when appearance matters or the app does not expose a usable accessibility control. Pixel actions are grounded in the latest screenshot of that same target. After a UI change, omp should take a fresh accessibility snapshot or screenshot before the next action rather than assuming the screen stayed the same.

Both sources can reveal sensitive information. Accessibility data may include text that is visually clipped or masked, while screenshots may include notifications and neighboring windows. Narrow the display, close unrelated windows, and use a dedicated account or VM for risky automation.

### Background and foreground input

Input normally targets a window in the background so your focus, pointer position, and window order are not disturbed. Not every OS or application can accept every event this way:

- On macOS, keyboard delivery to one window of a multi-window app may be ambiguous. omp should use an accessibility action or ask before briefly bringing the target forward.
- Some applications reject background pointer or keyboard events. omp reports the failure instead of treating the action as successful.
- On Wayland, arbitrary per-window background input and programmatic window raising are unavailable. Only the currently focused surface can receive native desktop input.

When foreground delivery is necessary, the target may appear briefly and omp attempts to restore the previous focus afterward. If that would interrupt your work, say “do not use foreground input; stop if background control is unavailable.”

## Approval and consequential actions

Tool approval and task authorization are different safety layers:

- The approval policy decides whether a proposed computer-control run is allowed, confirmed, or blocked.
- Your direct message determines what consequential action is authorized. On-screen text, a website, an email, or a dialog cannot grant permission to do more.

Unless your request already authorizes the exact target, scope, and values, omp must confirm immediately before sending or publishing, purchasing or transferring, deleting data, changing account security, granting permissions, disclosing private data, accepting legal terms, or making another irreversible change. Provider safety checks also require explicit interactive approval and fail closed when approval is unavailable.

Review approval prompts in context. If the target or effect is unclear, deny the run and restate the request more narrowly. An instruction such as “handle this website” is not a safe authorization to accept terms or complete a purchase; name the exact allowed outcome and the point where omp must stop.

## `/computer` controls

| Command | Effect |
| --- | --- |
| `/computer` | Toggle computer control for this session |
| `/computer on` | Enable it for this session |
| `/computer off` | Disable it for this session |
| `/computer status` | Show effective enablement, active state, model, display limits, backend, permissions, and input modes |

`/computer status` may show `session not started` before the first desktop request. After a request initializes the native session, run the command again to see capture, input, accessibility, and background-input availability. The command reports runtime facts; it does not request or grant OS permission.

## Supported platforms

| Platform | Current capability and limits |
| --- | --- |
| macOS x64 and arm64 | Quartz display/window capture, native input, and macOS accessibility. Screen Recording and Accessibility permissions are required. Background input is available where the OS can safely target the window. |
| Linux X11 x64 and arm64 | Display/window capture and X11 input; AT-SPI accessibility when available. Requires a usable X11 session with RandR and XTEST. |
| Linux Wayland x64 and arm64 | AT-SPI accessibility and portal/libei input where available. Released binaries omit screenshot capture. Per-window background input and arbitrary window activation are unavailable. |
| Windows x64 | Native display/window capture, Win32 input, and UI Automation accessibility. |
| Other targets | Unsupported unless the installed native addon reports capabilities. |

Capabilities are runtime facts. A supported operating system can still lack capture, input, or accessibility because of permissions, the current display server, the application, or how omp was packaged.

## Troubleshooting

### Computer control is missing

Run `/computer status`, then `/computer on`. If the response says it is unavailable, confirm `computer.enabled` in `/settings` or the effective config and start a new session after file-based changes. Also check that a restrictive tool list did not exclude computer control.

### Status says `session not started`

This is normal before the first request. Ask for a non-mutating inspection, then run `/computer status` again. The initialized status includes the selected backend and permission state.

### Screenshots are blank or unavailable

- On macOS, grant Screen Recording and restart the application that launched omp.
- On X11, confirm omp is running in the intended graphical session and can access `DISPLAY`.
- On released Wayland builds, screenshot capture is unavailable by design; use accessibility inspection where possible or use an X11 session.
- If the wrong monitor appears, ask omp to list displays, set `computer.display` to the intended ID, and begin a new session after editing the config file.

### omp can inspect but cannot click or type

On macOS, check Accessibility permission. On Wayland, accept the RemoteDesktop portal when input is first needed, or arrange `LIBEI_SOCKET`; focus the target before requesting native input. On every platform, `/computer status` distinguishes capture, input, and accessibility permission.

### Background input is unavailable

Ask omp to use the app's accessibility control. If that is not possible, explicitly allow foreground input, or focus the window yourself on Wayland. Do not assume a rejected background action landed.

### The wrong control was targeted

Ask omp to stop, inspect the window again, and identify the semantic control before retrying. If the app has no useful accessibility information, request a new screenshot of the same window. Do not reuse positions after the window moves, resizes, changes content, or switches displays.

### Accessibility information is empty or stale

The application may not expose its controls through the OS accessibility service, or that service may be unavailable. Confirm Accessibility or AT-SPI support, then ask omp for a fresh inspection. Fall back to screenshots only when the target is visually unambiguous.

### Wayland asks again for input permission

That is expected. omp does not persist the RemoteDesktop portal grant; it ends when the desktop-control session closes.
