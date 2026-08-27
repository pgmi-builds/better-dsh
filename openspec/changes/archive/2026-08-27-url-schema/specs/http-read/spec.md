## Purpose

Let the model read plain-text web resources via `http://` / `https://` URLs — a curl-equivalent direct HTTP GET with a hard budget, never a browser. One stateless handler serves both schemes.

## ADDED Requirements

### Requirement: GET-only plain-text fetch
The system SHALL resolve `http://` and `https://` URLs by one GET request (redirects followed) to the exact URL — parsed strictly with `new URL(raw)` from the env's `rawUrl`, so ports and queries survive at the handler level — and return the disclaimer line, a blank line, then the decoded body text.

#### Scenario: Fetching a text resource
- **WHEN** the model reads `https://example.com/a.txt` and the server responds 200 with a text content-type
- **THEN** the system returns the disclaimer line, a blank line, and the body text

#### Scenario: The disclaimer is always first
- **WHEN** any http(s) URL resolves successfully
- **THEN** the first line of the result is `[url-fetch] plain-text result of a direct HTTP GET (curl-equivalent). No JS execution or interaction — use browser tools, if any, for that.` — the consumer sees the fetch semantics before any body content

#### Scenario: Non-http(s) protocol is rejected
- **WHEN** the handler is asked to resolve a URL whose strict-parsed protocol is neither `http:` nor `https:`
- **THEN** the system returns the structured `URL_INVALID` error

### Requirement: Hard time budget
The system SHALL abort the GET after 20 seconds and return the structured `URL_HTTP_TIMEOUT` error.

#### Scenario: Server never responds
- **WHEN** the server accepts the connection but sends no response within the deadline
- **THEN** the system aborts the fetch and returns `URL_HTTP_TIMEOUT`

### Requirement: Hard size cap
The system SHALL reject bodies over 2 MiB: first via a `Content-Length` precheck when present, then via streaming byte accounting while decoding (and a buffered re-check on bodyless runtimes), returning the structured `URL_HTTP_TOO_LARGE` error with the actual byte count.

#### Scenario: Oversized declared body
- **WHEN** the response declares a Content-Length over 2 MiB
- **THEN** the system returns `URL_HTTP_TOO_LARGE` without downloading the body

#### Scenario: Undeclared oversized body
- **WHEN** no Content-Length is declared but the streamed bytes pass 2 MiB
- **THEN** the system aborts decoding and returns `URL_HTTP_TOO_LARGE` with the received byte count

### Requirement: Text-only media whitelist
The system SHALL accept only textual responses: any `text/*` content-type, or `application/{json, xml, yaml, toml, xhtml+xml, javascript, plain}` (charset parameters ignored). A missing content-type fails the check. Anything else returns the structured `URL_HTTP_UNSUPPORTED_MEDIA` error — binary decoding is deliberately not guessed.

#### Scenario: JSON response resolves
- **WHEN** the server responds with `application/json`
- **THEN** the body text resolves normally

#### Scenario: Binary response is rejected
- **WHEN** the server responds with `image/png`
- **THEN** the system returns `URL_HTTP_UNSUPPORTED_MEDIA` and decodes nothing

### Requirement: Structured failure codes
The system SHALL report every failure with a structured code: non-2xx status → `URL_HTTP_STATUS` (status + statusText); network/DNS failure → `URL_HTTP_FETCH_FAILED` (with the underlying cause message); unparseable or non-http(s) URL → `URL_INVALID`. Precedence: status → size precheck → media whitelist → streamed body.

#### Scenario: HTTP error status
- **WHEN** the server responds 404
- **THEN** the system returns `URL_HTTP_STATUS` with the status in the message

#### Scenario: DNS failure
- **WHEN** the host does not resolve
- **THEN** the system returns `URL_HTTP_FETCH_FAILED` with the underlying cause

### Requirement: No scheme-specific selector
The system SHALL define no selector of its own for http(s): the handler always returns the disclaimer plus the full body. Selector handling is inherited solely from the shared resolver layer, whose parse runs first on the tool path — a URL query (`?…`) is consumed as a query selector by the shared parser (the fetch itself still uses the complete raw URL), and a `:port` currently fails the shared `URL_BAD_SELECTOR` check end-to-end. This is a documented known limitation, not a hidden behavior.

#### Scenario: Query string is preserved for the fetch
- **WHEN** the model reads `https://example.com/x?q=1`
- **THEN** the fetch uses the complete URL `https://example.com/x?q=1` (from the env's rawUrl), and the shared parser's query selector applies only to the result text

#### Scenario: Port-carrying URL on the tool path
- **WHEN** the model reads `https://example.com:8443/x` through the read tool
- **THEN** the shared selector parse fails with `URL_BAD_SELECTOR` — the handler's whole-URL parse is only reachable directly or via URLs without a port
