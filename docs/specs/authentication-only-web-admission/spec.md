# Authentication-only Web admission

## Goal

An operator can reach their authenticated DSH deployment through any domain or
LAN address without maintaining separate server and browser address allowlists.
The server keeps its current bind address; the existing rig's LAN relay supplies
LAN reachability. This feature does not change listening interfaces.

## Configuration

Opt in through the existing `dashr-web-trust` row:

```yaml
- id: dashr-web-trust
  name: better-dsh/web-trust
  config:
    trustAllHosts: true
```

The default is `false`, retaining existing declared-authority behavior. When
enabled, `--trusted-host`, `DSH_TRUSTED_HOSTS` and `trustedPageAuthorities` are
not needed for admission or page management privileges.

## Contract

- Keep the original Connection instance, transport, RPC registrations and token
  exchange. No upstream source changes, replacement service or private-field
  access are required.
- Replace only its `requestRejection` method while this row is active. Delegate
  cookie verification to public `authorizeIndex`, using the real request headers
  and a fixed query-free index URL. Discard the index responder's output; the
  transport remains responsible for the actual HTTP response.
- Any address, Origin and Fetch-Metadata marker can pass after authentication.
  Missing, invalid, expired or wrong-authority cookies still return 401. Cookie
  lifetime and signing remain the native authenticator's responsibility.
- This API admission delegate never exchanges a URL token: normal index login
  still performs that exchange. Existing password-login behavior is unchanged.
- Inject `ownsHost: true` before browser application initialization, regardless
  of page hostname, without overwriting an existing transport. Management UI
  consumers continue to use the original Connection's common capability flag.
- Unloading or disabling this row restores the original admission method;
  reload the page to update its initialization-time capability flag.

## Acceptance

Use a packaged plugin installed through `dsh plugin add` in the long-lived 4999
rig, with no trusted-host CLI argument or environment variable. Verify loopback,
LAN and the actual HTTPS deployment domain; an additional unlisted Host must
authenticate successfully without bypassing cookie verification. Check settings
persistence, provider settings and plugin management in the real browser.
