#!/usr/bin/env python3
"""stdio <-> ZeroMQ bridge for the DASHR REPL.

The host (Node/TS) owns the kernel lifecycle but must not link a native ZMQ
binding: `zeromq` was a hard npm dependency whose install script compiles C++
inside the consumer's install transaction (and whose top-level import killed
the whole plugin when the binding was missing). This process is the only ZMQ
speaker on the host side; it speaks JSON lines on stdio to Node.

    Node  ──stdio JSON lines──►  kernel-bridge.py  ──pyzmq/jupyter_client──►  ipykernel

Requirements come from the kernel's own environment: `jupyter_client` and
`pyzmq` are transitive dependencies of the `ipykernel` we provision (see
`kernel-env.ts`), so nothing extra is fetched from any package manager.

Protocol
--------
stdin (one JSON object per line)::

    {"op":"send","channel":"shell"|"control","header":{...},"content":{...}}
    {"op":"interrupt"}
    {"op":"shutdown"}

stdout (one JSON object per line)::

    {"ev":"ready"}
    {"ev":"msg","channel":"shell"|"iopub"|"control"|"stdin","msg":{...}}
    {"ev":"fatal","message":"..."}

The caller-supplied `header` is passed to `Session.msg` verbatim, so the
message id the host generated is the id on the wire — parent-matching and
request/response correlation stay exactly as they were on the raw-socket path.
"""
from __future__ import annotations

import json
import queue
import sys
import threading

CHANNELS = ("iopub", "shell", "control", "stdin")
POLL_SECONDS = 0.2

# Protocol output goes to the real stdout; anything a library prints must never
# corrupt the byte stream the host parses, so sys.stdout is repointed to stderr.
_PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr

_write_lock = threading.Lock()


def emit(payload: dict) -> None:
    """Write one protocol line, atomically across the pump threads."""
    # `default=str`: jupyter_client hands back parsed values (a header `date`
    # arrives as `datetime`, for instance) that are not JSON-native; the host
    # only reads msg_id/msg_type/content, so stringifying the rest is lossless
    # for its purposes and keeps one pump thread from dying on a header field.
    line = json.dumps(payload, ensure_ascii=False, default=str)
    with _write_lock:
        _PROTOCOL_OUT.write(line + "\n")
        _PROTOCOL_OUT.flush()


def _clean(value: object) -> object:
    """Strip binary buffers: this protocol carries JSON only."""
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in value.items() if key != "buffers"}
    if isinstance(value, (list, tuple)):
        return [_clean(item) for item in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def pump(client, name: str, stop: threading.Event) -> None:
    """Relay one client channel onto stdout until `stop` is set."""
    channel = getattr(client, f"{name}_channel")
    while not stop.is_set():
        try:
            message = channel.get_msg(timeout=POLL_SECONDS)
        except queue.Empty:
            continue
        except Exception as error:  # channel torn down, or the socket died
            if not stop.is_set():
                emit({"ev": "fatal", "channel": name, "message": f"{type(error).__name__}: {error}"})
        try:
            emit({
                "ev": "msg",
                "channel": name,
                "msg": {
                    "header": message.get("header") or {},
                    "parent_header": message.get("parent_header") or {},
                    "content": _clean(message.get("content") or {}),
                    "metadata": _clean(message.get("metadata") or {}),
                },
            })
        except Exception as error:  # never let one message kill a channel pump
            sys.stderr.write(f"kernel-bridge: cannot relay {name} message: {type(error).__name__}: {error}\n")
            sys.stderr.flush()


def main() -> int:
    if len(sys.argv) != 2:
        emit({"ev": "fatal", "message": "usage: kernel-bridge.py <connection-file>"})
        return 2

    try:
        from jupyter_client import BlockingKernelClient
    except Exception as error:  # the kernel environment is incomplete
        emit({"ev": "fatal", "message": f"jupyter_client unavailable: {type(error).__name__}: {error}"})
        return 3

    try:
        client = BlockingKernelClient(connection_file=sys.argv[1])
        client.load_connection_file()
        client.start_channels()
    except Exception as error:
        emit({"ev": "fatal", "message": f"cannot connect to the kernel: {type(error).__name__}: {error}"})
        return 4

    stop = threading.Event()
    for name in CHANNELS:
        threading.Thread(target=pump, args=(client, name, stop), name=f"pump-{name}", daemon=True).start()

    emit({"ev": "ready"})

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except Exception:
                continue
            op = request.get("op")
            if op == "send":
                channel_name = request.get("channel")
                if channel_name not in ("shell", "control"):
                    emit({"ev": "fatal", "message": f"unknown send channel {channel_name!r}"})
                    continue
                channel = getattr(client, f"{channel_name}_channel")
                try:
                    header = request.get("header") or None
                    message = client.session.msg(
                        header["msg_type"] if header else "comm_msg",
                        content=request.get("content") or {},
                        header=header,
                    )
                    channel.send(message)
                except Exception as error:
                    emit({"ev": "fatal", "channel": channel_name, "message": f"send failed: {type(error).__name__}: {error}"})
            elif op == "interrupt":
                try:
                    client.interrupt_kernel()
                except Exception as error:
                    emit({"ev": "fatal", "message": f"interrupt failed: {type(error).__name__}: {error}"})
            elif op == "shutdown":
                break
    except (KeyboardInterrupt, BrokenPipeError):
        pass
    finally:
        stop.set()
        try:
            client.stop_channels()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
