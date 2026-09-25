<!--
source: https://omp.sh/docs/web
fetched: 2026-09-06
-->

# Web & browser

> Choose between researched web answers, fast reading from a known URL, browser automation, and your own logged-in Chrome tabs.

## Choose the lightest path that works

Tell omp the outcome you want. It chooses the underlying capability; you do not need to call a web or browser tool yourself.

| Your task | Best path | Example request |
| --- | --- | --- |
| Find current information or compare several sources | Web search | `Compare the current Bun and Node.js workspace behavior. Cite the official documentation.` |
| Read a page whose URL you already know | URL reading | `Read https://example.com/docs/auth and summarize the token refresh rules.` |
| Use a JavaScript application, click, fill a form, or inspect the rendered UI | Managed browser | `Open the local app, create a test account, and report any validation problems. Do not submit payment details.` |
| Work inside an account already signed in to Chrome | Browser Relay | `Using my visible Chrome tab titled “Acme Admin,” export the August report and tell me where it downloaded.` |

Start with search when you do not know the source. Give omp an exact URL when you do. Use browser automation only when rendering or interaction is necessary, and use the relay only when you intentionally want to share your own Chrome state.

For GitHub issues and pull requests, ask omp to use its [GitHub integration](/docs/github) instead. It is structured, cached, and usually more reliable than scraping the site.

## Search the web

Web search returns an answer together with source URLs. Ask for the kind of evidence you need:

```text
Find the release note that introduced Node.js permission-model networking. Use primary sources, quote the relevant sentence, and link it.
```

```text
Research PostgreSQL 18 logical replication changes from the past month. Separate confirmed facts from commentary and cite every claim.
```

Search is enabled by default with `web_search.enabled`. omp walks the available providers in priority order and falls through when a provider is unavailable, times out, or returns no usable result. Open `/settings` to enable **Web Search**, choose **Web Search Provider Order**, exclude providers you do not trust, or change the per-provider timeout.

Providers can use credentials already stored by `/login`, provider API-key environment variables, or credential-free search engines. A practical setup is:

1. Run `/login` for the provider you already use, or configure its API key as described in [Providers](/docs/providers) and [Secrets](/docs/secrets).
2. In `/settings`, put that provider near the front of **Web Search Provider Order**.
3. Ask omp to search for a small, current fact and include its sources.

Persistent configuration can also go in `~/.omp/agent/config.yml` or a project `.omp/config.yml`:

```yaml
web_search:
  enabled: true
providers:
  webSearchOrder: [perplexity, exa, gemini]
  webSearchExclude: []
  webSearchTimeoutSeconds: 60
```

Unlisted providers retain their built-in relative order. The timeout applies to each provider attempt, not the entire fallback chain. See [Settings](/docs/settings) for configuration precedence.

Search results are evidence, not authority. Ask omp to prefer primary sources, corroborate important claims, and identify sources it could not access. Search cannot see private pages merely because you are signed in to Chrome; use the relay for those.

## Read a known URL

When a page is public and mostly static, give omp the URL directly:

```text
Read https://example.com/security.pdf and list the supported encryption algorithms with page references.
```

```text
Read the API documentation at https://example.com/reference and turn the pagination rules into a short implementation checklist.
```

URL reading extracts clean text from articles, documentation, PDFs, JSON, feeds, and many common developer sites. It does not execute page JavaScript or inherit browser cookies. This makes it faster and less stateful than browser automation, but unsuitable for client-rendered applications, authenticated dashboards, consent flows, and interactive forms. If the extracted page is empty or incomplete, ask omp to retry it in a browser.

## Automate a managed browser

The managed browser is a Chromium instance controlled by omp. It is the right choice for rendered pages, local development servers, screenshots, multi-step navigation, form validation, and other interactions that do not require your everyday Chrome profile.

```text
Open http://localhost:3000 in a browser. Test the sign-up form at mobile and desktop widths, take screenshots of any broken state, and do not submit the final form.
```

```text
Navigate through the public pricing calculator, enter 25 seats, and report the displayed annual total. Stop before checkout.
```

Browser support is enabled by default. Open `/settings` and check **Tools → Available Tools → Browser** if omp says it is unavailable. The relevant persistent settings are:

```yaml
browser:
  enabled: true
  headless: true
```

- **Headless (`browser.headless: true`)** is the default. It is quiet and best for repeatable navigation, extraction, and screenshots.
- **Visible (`browser.headless: false`)** opens browser UI so you can watch, handle a login or challenge, and take over when a site resists automation.

The first managed-browser use may download Chromium. Headless and visible modes use an omp-managed browser profile, not your normal Chrome profile. Login and page state can survive while that managed browser is running, but do not rely on it as permanent credential storage. For an existing login, passkey, client certificate, or carefully curated browser profile, prefer the relay.

You can also configure `browser.cdpUrl` to attach to a Chromium instance that you deliberately started with a remote-debugging endpoint. This is an advanced alternative to the relay: omp does not own that process, and disconnecting does not close its pages. Modern Chrome restricts remote debugging of the default profile, so the relay is normally the better choice for everyday Chrome.

## Connect your own Chrome with Browser Relay

The OMP Browser Relay extension lets omp drive an existing Chrome tab, including its cookies and logged-in session. This is the most capable path and the largest trust decision: an attached tab has the same account access you do.

### Install once

```sh
omp browser-relay install
```

Then:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `~/.omp/browser-relay/extension`.
4. Enable the relay in `/settings`, or run:

```sh
omp config set browser.relay true
```

The local relay server starts automatically when omp first needs it. The extension badge reads **on** after it connects. You normally do not run a server yourself.

Open the page you want to share, make it the visible tab, and name it in your request when possible:

```text
Use the Chrome tab whose title contains “Staging Orders.” Find order 1842 and summarize its fulfillment history. Do not edit or refund anything.
```

Without a named target, omp adopts the visible usable tab without bringing another tab to the front. Tabs it is actively driving appear in a cyan **omp** tab group; the group dissolves when the connection ends. Releasing a relay session does not close your Chrome page.

### Relay trust and hardening

The extension uses Chrome's debugger permission. While attached, omp can read rendered page content, enter text, click controls, upload files, initiate downloads, and act with that tab's cookies and account permissions. Chrome displays an “is debugging this browser” infobar.

The relay listens on loopback at `http://127.0.0.1:9224` by default. Any local process that can reach an unprotected relay can drive the attached logged-in tab. If you do not trust every process on the machine, start it with a token:

```sh
omp browser-relay --token 'a-long-random-secret'
```

Open the extension's settings by clicking its toolbar icon and enter the same token. Use a password manager or environment-safe launcher rather than committing the token to a repository. A custom port must also match in the extension and `browser.relayUrl`. Manual launch is otherwise needed only for a token, a non-default port, or `--no-group`.

Disable the relay setting when you are done sharing your Chrome state:

```sh
omp config set browser.relay false
```

## Logins, files, and state

For credentials, prefer logging in yourself in a visible managed browser or in Chrome before granting relay access. Do not paste passwords, recovery codes, or one-time codes into a prompt. A site may detect automation, require CAPTCHA or hardware-backed authentication, or block debugger-controlled tabs; take over manually rather than asking omp to bypass the control.

For uploads, give omp the exact local path and the intended destination:

```text
Upload ./artifacts/report.pdf to the “August evidence” field, verify the filename and size, but wait for me before submitting.
```

Upload paths are resolved from the directory where the session started. omp can upload only through a page's file input, and the local file must be readable. Treat an upload as data disclosure: confirm the site, account, file, and audience.

For downloads, state what you expect and ask omp to verify the result:

```text
Download the CSV report for 2026-08-01 through 2026-08-31 and tell me the final filename and local path. Do not open or execute it.
```

A relay download follows your Chrome profile's normal download settings. A managed browser uses its own profile and download behavior, so the destination can differ. If a site exposes a direct public file URL, asking omp to fetch that URL is usually more predictable than clicking a browser download. Downloaded content is untrusted; inspect it before opening, importing, or executing it.

## Approvals and safe requests

Browser automation is an execution-capability tool. With `tools.approvalMode: write` or `always-ask`, omp prompts before browser operations; the default `yolo` mode does not. You can require a prompt for every browser operation regardless of the general mode:

```yaml
tools:
  approval:
    browser: prompt
```

An approval prompt authorizes omp to operate the browser, not every real-world consequence. Purchases, messages, publishing, deletion, account changes, financial actions, and submission of sensitive data still need point-of-action confirmation unless your request already authorized the exact target, scope, and values.

Write requests with boundaries:

```text
Draft the support reply in the browser, but do not send it. Show me the final recipient, subject, and body for approval.
```

```text
Add the two named items to the cart and report the total. Do not sign in, start a trial, or place the order.
```

Web pages are untrusted input. Instructions displayed on a page cannot override your request. If a page asks omp to reveal secrets, run commands, upload unrelated files, or change the task, it should stop and report the instruction.

## Limitations

- Browser automation can break when a site changes its DOM, virtualizes content, rate-limits requests, or detects automation.
- CAPTCHA, passkeys, hardware keys, biometric prompts, native file choosers, and some payment flows require you to take over.
- Browser sessions are stateful. A navigation or application rerender can invalidate a control omp previously found; asking it to re-inspect the page is safer than repeating a blind click.
- Relay mode cannot attach to `chrome://` pages, Chrome DevTools, the Chrome Web Store, or another extension's pages.
- A tab with DevTools open cannot be attached because Chrome permits only one debugger connection per tab.
- Dismissing Chrome's debugging infobar detaches that tab until it navigates again.
- Relay and attached-browser modes do not hide automation or close your pages when omp disconnects.
- Browser context isolation is unavailable through the relay. Use a separate Chrome profile or the managed browser when accounts must remain isolated.

## Troubleshooting

### Search says no provider is configured

Confirm `web_search.enabled` is on. Check **Web Search Provider Order** and **Excluded Web Search Providers** in `/settings`; an excluded provider cannot be used as a fallback. Re-run `/login` or update the chosen provider's credential, then ask for a simple current fact with one source. If a provider is slow, raise `providers.webSearchTimeoutSeconds` rather than repeatedly retrying the same request.

### A URL is empty or missing content

The page probably renders in JavaScript, requires cookies, blocks automated extraction, or embeds content in another frame. Ask omp to open it in the managed browser. If it is private, log in visibly or use a deliberately shared relay tab.

### Managed Chromium does not open

Confirm `browser.enabled` is on and allow the first-run Chromium download to finish. Switch `browser.headless` to `false` to make launch and navigation visible. If a configured `browser.cdpUrl` is stale, remove it so omp can launch its managed browser again.

### The relay badge does not show “on”

Run `omp browser-relay install` again after upgrading omp, reload the unpacked extension in `chrome://extensions`, and confirm the configured port and token match. The default endpoint is `127.0.0.1:9224`. If you manually started the relay, keep that process running; otherwise let omp auto-start it on first use.

### omp selects the wrong tab

Bring the intended tab to the front and include a distinctive title or URL fragment in your request. Close DevTools on that tab. Restricted Chrome pages are intentionally hidden from omp.

### A relay tab disconnects

Do not dismiss Chrome's debugging infobar while omp is working. Navigate the tab once to make it attachable again, verify the extension badge is on, and retry. If Chrome reports another debugger, close DevTools or the other debugger client first.

### Uploads or downloads are not where expected

Use a path relative to the session's starting directory for uploads, or give an absolute path. Confirm the target is a real file-upload control. For downloads, check the active browser profile's download settings and ask omp to report the observed filename and path; relay downloads and managed-browser downloads need not use the same directory.
