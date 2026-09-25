<!--
source: https://omp.sh/docs/collab
fetched: 2026-09-06
-->

# Collab

> Invite a teammate into your live omp session to watch, prompt, and help steer the work securely.

Collab is for working together **in the session you already have open**. Use it when a teammate should see the full context and live progress instead of receiving screenshots or a static export. The host's omp remains authoritative: the model and tools keep running on the host machine, while guests see the same transcript and status in their own omp or browser.

## Share your current session

In the interactive omp session you want to share, run:

```text
/collab
```

omp starts sharing and shows:

- a terminal command such as `omp join "<room>.<secret>"`,
- a clickable browser link,
- a QR code for the browser link, and
- a reminder that this first link allows guests to prompt the agent.

Send **one complete link** to your teammate. The terminal and browser forms grant the same permissions. Keep omp running on the host machine; that machine continues to run the agent, model requests, and tools.

Running `/collab` again while hosting reprints the full-control links and QR code. To see who is connected, run:

```text
/collab status
```

The participant list identifies the host and marks guests who joined view-only.

## Share a view-only link

Use a view-only link for reviews, demos, or anyone who should observe without steering the work:

```text
/collab view
```

This starts sharing if necessary, or prints the view-only links for an existing collab session. A viewer can see the prior transcript and live updates, including tool cards and subagent transcripts, but cannot prompt, interrupt, answer requests, or control subagents.

A hosting session has both a full-control link and a view-only link. You can give different people different access without restarting it:

```text
/collab       # print the full-control link
/collab view  # print the view-only link
```

## Join a session

Choose any of these methods.

### From an omp session

Paste the link into the interactive TUI:

```text
/join "<link>"
```

Your current local session is set aside while you participate. When you leave—or when the host ends sharing—omp restores the session you were using before you joined.

You cannot join while you are hosting or already connected as a guest. Run `/collab stop` or `/leave` first.

### From a new terminal

Start omp directly in the shared session:

```bash
omp join "<link>"
```

`omp join` requires an interactive terminal. Quote the link so your shell does not interpret characters such as `#`.

### From a browser

Open the browser link or scan its QR code. No omp installation is required. The page connects automatically and shows the transcript, streaming output, tool cards, participants, and subagents. A full-control browser link also enables the composer, interrupt button, subagent controls, and host questions; a view-only link clearly shows that it is read-only.

After joining, omp loads the existing transcript before following live activity. A terminal guest also sees the host's session status, including working directory, model, context usage, and cost, but does not change into the host's directory.

## Work together

| Action | Host | Full-control guest | View-only guest |
| --- | --- | --- | --- |
| Read the existing and live transcript | Yes | Yes | Yes |
| See tool activity and subagent transcripts | Yes | Yes | Yes |
| Type a prompt for the agent | Yes | Yes | No |
| Interrupt the current response with `Esc` | Yes | Yes | No |
| Answer a host selection or editor request | Yes | Yes | No |
| Inspect, message, stop, or revive host subagents | Yes | Yes | No |
| Run host-local slash commands, shell commands, Python, or skills | Yes | No | No |

Prompts from guests are labeled with their display name in the transcript. The name is attribution for people; it is not an authenticated identity and is not included as instructions to the model.

When the agent asks the host to choose an option or edit text, every connected full-control guest may receive the same request. The first answer or cancellation settles it and dismisses the other copies.

In the terminal, a full-control guest can press `Alt+A` to open Agent Hub and inspect the host's subagents, read their transcripts, send them a message, stop them, or revive them. These actions affect work running on the host. View-only guests can inspect the same subagent information but cannot change it.

Host-only commands stay host-only, including `/model`, `/compact`, `/resume`, `/branch`, `!` shell commands, `$` Python, and skills. A terminal guest can still use these local commands without changing the host session:

| Guest-local command | Purpose |
| --- | --- |
| `/dump`, `/export`, `/copy` | Copy or export what the guest can see |
| `/help`, `/hotkeys` | Open local help |
| `/theme`, `/settings` | Change settings on the guest machine; the host is unaffected |
| `/collab` | Show the guest's collab status |
| `/leave`, `/exit`, `/quit` | `/leave` restores the previous session; `/exit` and `/quit` close omp |

## Leave, stop, and reconnect

A guest leaves with:

```text
/leave
```

omp closes the shared view and restores that guest's previous local session. Leaving does not stop the host or disconnect anyone else. Browser guests use the page's leave control.

The host ends sharing for everyone with either command:

```text
/collab stop
```

```text
/leave
```

Guests see that the session ended and terminal guests return to their previous local sessions. Starting `/collab` again creates new links; old links do not join the new room.

Transient network or relay interruptions reconnect automatically. omp displays a `reconnecting…` status and resynchronizes the shared session when the connection returns. If the room is gone, the host stopped, the key is invalid, or the relay rejects the connection permanently, the guest session ends instead; ask the host for a fresh link if they are still sharing.

## Permissions and security

Collab links are bearer secrets: **anyone who has a link receives that link's permissions**.

- A full-control link contains the encryption key and a write token. Its holder can read the full transcript, submit prompts that cause the host's agent to act, interrupt work, answer requests, and control subagents.
- A view-only link contains the encryption key without the write token. Its holder can read the same potentially sensitive session history but cannot steer it.
- There is no account-based identity or approval prompt when someone uses a valid link. Participant display names can be chosen by the participant.

All session content is end-to-end encrypted with AES-256-GCM before it reaches the relay. The relay cannot read prompts, transcripts, tool details, or keys. It can observe room identifiers, connection counts, encrypted frame sizes, and limited routing metadata. In browser links, the room link is carried in the URL fragment, which browsers do not send in HTTP requests.

The relay does not make a full-control guest safe by itself. A guest prompt is executed by the agent on the **host machine** under the host's configured tool and approval policies. Before sharing, review the transcript for secrets and make sure the host's permissions are appropriate. Send view-only links by default when someone only needs to observe, and stop sharing when the collaboration is over.

## Relay configuration

Nothing needs configuring for the hosted service. By default, `/collab` uses `wss://my.omp.sh`, derives the matching browser UI, and uses your OS username as the participant name.

For a one-time alternate relay, pass it when you start sharing. A hostname without a scheme uses secure WebSocket (`wss://`):

```text
/collab relay.example.com
```

To start with a view-only link through that relay:

```text
/collab view relay.example.com
```

For a persistent choice, use `/settings` in omp or run:

```bash
omp config set collab.relayUrl wss://relay.example.com
omp config set collab.displayName "Ada"
```

Verify the effective values with:

```bash
omp config get collab.relayUrl
omp config get collab.displayName
```

If the browser UI is hosted separately from the relay, configure its base URL too:

```bash
omp config set collab.webUrl https://collab.example.com
```

`collab.webUrl` must be an `http://` or `https://` URL without a query string or fragment. Non-local URLs must use HTTPS; plain HTTP is accepted only for localhost. The generated browser link still points back to the configured relay.

| Setting | Default | Purpose |
| --- | --- | --- |
| `collab.relayUrl` | `wss://my.omp.sh` | Relay used when `/collab` has no relay argument |
| `collab.webUrl` | empty | Browser UI base; empty derives it from the relay URL |
| `collab.displayName` | empty | Participant name; empty falls back to the OS username, then `anonymous` |

Relay URLs may use `wss://` or `https://`; omp normalizes both to a secure relay connection. Plain `ws://` or `http://` relay URLs are allowed only for `localhost`, `127.0.0.1`, or `::1` development endpoints. A custom endpoint must implement the omp collab relay service; an ordinary WebSocket server is not sufficient.
omp does not currently distribute a production-ready relay server or standalone relay binaries for self-hosting. The source repository includes a WebSocket-only local development stand-in, but it does not serve the browser client and is not a replacement for the hosted service.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `No relay configured` | Set `collab.relayUrl` in `/settings`, run `omp config set collab.relayUrl wss://…`, or pass a relay to `/collab`. |
| `Stop hosting first` | Run `/collab stop`, then join the other session. |
| `Already in a collab session` | Run `/leave` before joining another link. |
| The guest is read-only | The host shared `/collab view`; ask for the full-control link only if you should steer the session. |
| Browser link opens but does not connect | Confirm the host is still sharing, use the entire current link, and check that a custom `collab.webUrl` serves the omp browser client over HTTPS. |
| `omp join requires an interactive terminal` | Run it from a TTY, or open the browser link instead. |
| The guest joins during a response but misses that response | Wait for the next update. If the response produced no update after the join, that one in-flight response may not render live; later transcript and session updates still synchronize. |
