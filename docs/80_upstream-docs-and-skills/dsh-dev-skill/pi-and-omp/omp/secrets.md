<!--
source: https://omp.sh/docs/secrets
fetched: 2026-09-06
-->

# Secrets and auth

> Sign in safely, understand which credential omp uses, and operate shared auth without exposing provider secrets.

The recommended setup is to let omp manage a provider login for you. Start `omp`, run `/login`, choose a provider, and complete the browser or API-key prompt. This avoids putting a key in a shell command, keeps OAuth refresh automatic, and makes account removal available from the same interface.

```text
/login
```

After a successful login, omp names the account when the provider supplies an identity and prints the path where it saved the credential. Open `/login` again to see each provider's status and active source, such as `login`, `api key`, `env`, `config`, or `--api-key`. Then use `/model` to choose a model.

You can go directly to a known provider ID:

```text
/login anthropic
```

Some providers use OAuth, some ask for an API key, and some use a device-code or pasted-code flow. Follow the prompt shown by omp. Paste credentials only into that login prompt—not into a chat message or a shell argument. Repeating `/login` for an OAuth provider can add another account; omp can select among stored accounts when making requests.

## Where credentials live

Without an auth broker, the default store is:

```text
~/.omp/agent/agent.db
```

Profiles, `PI_CODING_AGENT_DIR`, and XDG data directories can relocate it. The success message from `/login` shows the actual path in use. `agent.db` is also used for other omp state, so do not delete the whole database just to sign out.

The SQLite credential rows contain the provider ID and either:

- an API key, or
- an OAuth access token, refresh token, expiry, and available account metadata.

The local database is **not encrypted at rest**. On POSIX systems, omp creates its directory with mode `0700` and changes the database to `0600`; Windows relies on the account's filesystem ACLs. SQLite also uses `agent.db-wal` and `agent.db-shm` beside the database while it is open. Protect the entire directory and any backups or sync copies, not only `agent.db`.

To inspect permissions on the default path:

```sh
ls -ld ~/.omp ~/.omp/agent
ls -l ~/.omp/agent/agent.db*
```

Other users should not have access. Full-disk encryption protects a powered-off machine, but it does not protect credentials from malware, an untrusted extension, or another process already running as your user.

## What leaves the machine

A normal provider login and request has three relevant flows:

1. **OAuth login:** your browser opens the provider's authorization page. The provider returns a short-lived authorization result to omp, and omp exchanges it for tokens. For loopback flows, the callback returns to a local port on the machine running omp.
2. **Provider request:** omp sends the selected API key or OAuth access token in authentication headers to the model endpoint. A custom `baseUrl` or proxy is therefore part of your trust boundary—it receives the credential and request content.
3. **OAuth refresh:** omp sends the refresh token to the provider's token endpoint when the access token needs renewal. The refreshed values are saved back to the credential store.

Provider credentials authenticate network requests; they are not meant to be placed in the conversation. Treat authorization URLs, callback URLs, device codes, and pasted login codes as secrets until the login finishes. omp excludes `/login <callback-or-code>` commands from input history, but your terminal, clipboard manager, screen sharing, or shell history may still expose secrets entered elsewhere.

## Which credential wins

For a provider, omp uses the first available source in this order:

| Priority | Source | Practical effect |
| --- | --- | --- |
| 1 | `omp --api-key …` | One-run override for the explicitly selected model's provider (`--api-key` requires a model selection). Avoid on shared systems: command lines may enter shell history or process listings. |
| 2 | `providers.<name>.apiKey` in `models.yml` | Explicit provider override, commonly used with a custom endpoint. Prefer an environment-variable or secret-manager reference instead of a literal key. |
| 3 | Stored OAuth login | Refreshed automatically and preferred over ordinary environment keys. |
| 4 | API key saved by `/login` | A deliberate interactive login also wins over the provider environment variable. |
| 5 | Provider environment variable | For example, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`; exact names vary by provider. |
| 6 | Other stored static API key | Primarily credentials imported or migrated by broker tooling. |
| 7 | Custom-provider fallback | The resolver configured for a custom provider. |

This means exporting an environment key does **not** replace an existing `/login` credential. Use `/logout` to remove the stored account first, or use an explicit `models.yml`/`--api-key` override when that is truly what you intend. Restart omp after changing its environment. See [Environment variables](/docs/env) and [Custom models](/docs/custom-models) for provider-specific setup.

For local development and CI, a provider environment variable is preferable to a key literal in a checked-in file. Inject it from the CI secret store or a password manager, and confirm that project files, shell history, logs, and exported session transcripts do not contain it.

## Sign out, revoke, and rotate

Run `/logout` and select the provider and stored account to remove. With a provider ID, omp opens that provider's account selector directly:

```text
/logout anthropic
```

Interactive `/logout` removes **one selected stored credential**, which matters when you have several accounts. It does not remove an environment variable, a `models.yml` override, or a `--api-key` passed when the process started. After removal, omp reports any remaining auth source; remove that source and restart if you intend to be completely signed out.

Deleting a local row is not the same as revoking the credential at the provider. For a lost device or suspected compromise:

1. Revoke the OAuth grant or old API key in the provider's security console.
2. Remove the stored credential with `/logout`.
3. Create or authorize the replacement with `/login` (or update the environment/secret-manager source).
4. Verify the intended account in `/login` and make a request with the selected model.

For routine API-key rotation, create the replacement first, update the source, verify it, and then revoke the old key. OAuth access tokens already issued by a provider may remain valid until the provider expires or revokes them.

## Centralize credentials with an auth broker

Use an auth broker when several trusted machines should share one credential pool or when refresh tokens should stay on a controlled host. omp uses the local SQLite store by default; configuring a broker switches credential storage to the broker for that process.

On the broker host, log in and start the loopback-only service:

```sh
omp auth-broker login anthropic
omp auth-broker serve
```

The default bind is `127.0.0.1:8765`. `serve` creates a bearer token if needed; print it in another shell with:

```sh
omp auth-broker token
```

For a remote broker, expose it only through a private network or a TLS-terminating reverse proxy. The broker protocol is HTTP and does not add TLS itself. Do not publish `0.0.0.0:8765` directly to the internet.

Configure each client, preferably through a secret injector:

```sh
export OMP_AUTH_BROKER_URL='https://auth.example.internal'
export OMP_AUTH_BROKER_TOKEN='…'
omp auth-broker status
omp
```

The equivalent config keys are `auth.broker.url` and `auth.broker.token` in the active agent `config.yml`. Environment variables take precedence. If a URL is configured without a token, startup fails instead of silently falling back to local credentials. A token may also be read from the config-root `auth-broker.token` file.

When a TUI client is broker-backed, `/login` uploads the new credential to the broker and `/logout` disables the selected broker credential. For the tighter boundary, perform OAuth on the broker host itself. If the host is reachable by SSH but its loopback callback must reach your local browser, run:

```sh
omp auth-broker login anthropic --via=user@broker
```

`omp auth-broker login` and `omp auth-broker logout` operate on the local credential database of the host where that command runs; use them on the broker host for broker administration. `omp auth-broker logout <provider>` removes all active rows for that provider, unlike the TUI's one-account selector.

### Broker data and trust boundary

Broker clients receive API keys and OAuth **access** tokens so they can call providers directly. OAuth refresh tokens stay on the broker and are replaced by a remote sentinel in snapshots. A login initiated from a client must still send the newly issued credential to the broker over the protected connection once.

Clients keep a short-lived encrypted snapshot cache at the config-root `cache/auth-broker-snapshot.enc` (default `~/.omp/cache/auth-broker-snapshot.enc`). Its encryption key is derived from the broker bearer token and URL. This protects a copied cache file by itself; a process that can read the bearer token can also decrypt the cache and query the broker.

The broker bearer is a vault administrator credential: it can read usable credentials and mutate the store. Keep it out of source control and logs, distribute it only to trusted clients, and rotate it after exposure:

```sh
omp auth-broker token --regenerate
```

The running broker reads its allowed token at startup, so restart the broker and update every client after regeneration. The health endpoint is unauthenticated; credential endpoints require the bearer.

## Put an auth gateway in front of provider traffic

The broker shares credentials with trusted omp clients; it does not proxy their model requests. Use `omp auth-gateway` only when a less-trusted client must make OpenAI-, Anthropic-, Responses-, or pi-native-compatible requests without receiving provider credentials.

The gateway requires a configured broker:

```sh
omp auth-gateway serve
omp auth-gateway token
```

It binds to `127.0.0.1:4000` by default and stores its inbound bearer in the config-root `auth-gateway.token` with mode `0600`. The gateway authenticates the client, resolves a provider credential through the broker, and injects upstream auth. The client's inbound bearer is not forwarded as the provider credential.

This reduces secret distribution, not authority: anyone holding the gateway bearer can spend provider quota and send request content through the associated accounts. The gateway operator can observe request content and responses. Keep the default loopback bind or add private networking, TLS, access control, and logging protections before remote exposure. `--no-auth` allows every process that can reach the socket and should be limited to an intentionally trusted loopback environment.

Rotate the gateway bearer with `omp auth-gateway token --regenerate`, then restart the gateway and update its clients.

## Troubleshooting

### `/login` succeeded, but no model is available

Open `/login` and check the provider's source/status, then open `/model`. Confirm you logged into the provider used by the desired model. If you set an environment variable, start omp from the same environment and use the exact variable supported by that provider.

### An environment key is ignored

A runtime override, `models.yml` API key, stored OAuth login, or API key saved through `/login` outranks the environment. `/logout <provider>` shows stored accounts; after removing them, also check custom model config and how omp was launched.

### `/logout` did not fully sign out

You may have another stored account or a non-store source. Repeat `/logout` for remaining accounts. Remove provider environment variables or config overrides at their source, and restart without `--api-key`. The post-logout message identifies a remaining source when one exists.

### The browser callback cannot complete

Use the full authorization URL shown by omp; do not copy a visually truncated fragment. If omp reports that its callback port is busy, stop the other process using that port and retry. On remote or headless systems, follow the provider-specific device/paste instructions shown in the dialog; for a remote broker, use `auth-broker login --via=user@host` when that provider has a loopback callback.

### Broker startup or requests fail

Run `omp auth-broker status` from the client. Check the resolved URL, TLS/private-network reachability, and that the client bearer matches the running broker. A configured broker replaces local auth rather than falling back to `agent.db`; a missing token is a configuration error. After regenerating a token, restart the broker and update all clients.

### A credential file has broad permissions

Stop omp before repairing or moving its SQLite files. Restrict the agent directory to your account and the database, WAL, SHM, broker-token, gateway-token, and encrypted-cache files to their owner. Also fix the permissions of backups and secret-manager export files; changing only the live database does not remove leaked copies.

## Related

- [Providers](/docs/providers) — supported login methods and provider-specific environment variables.
- [Environment variables](/docs/env) — credential and broker environment settings.
- [Custom models](/docs/custom-models) — custom endpoints and `models.yml` provider overrides.
- [MCP](/docs/mcp) — MCP OAuth credentials use the same underlying credential store and broker refresh path.
