"""Local Unix-socket / Windows named-pipe bridge; no shell, TCP listener, downloads, or media library.

The detached guardian owns/reaps mpv, checks a close marker, and expires without
heartbeats. Herdr exec has a finite timeout, so mpv cannot live inside that call.
"""
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
import tempfile

if os.name == "nt":
    import importlib.util
    spec = importlib.util.spec_from_file_location("windows_native", Path(__file__).with_name("windows-native.py"))
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)

LEASE_SECONDS = 20


class ReceiverGone(RuntimeError):
    """Exit code 3: this session cannot accept further playback commands."""


def directory(token):
    if not re.fullmatch(r"[a-f0-9]{32}", token):
        raise ValueError("Invalid receiver token")
    # macOS's per-user TMPDIR can exceed sockaddr_un's 104-byte path limit.
    return Path(tempfile.gettempdir() if os.name == "nt" else "/tmp") / ("cnr-" + token)


def endpoint(root):
    return "\\\\.\\pipe\\" + root.name if os.name == "nt" else str(root / "ipc")


def prepare(root):
    if os.name == "nt":
        native.prepare(root)
        return
    root.mkdir(mode=0o700, exist_ok=True)
    info = root.lstat()
    if root.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Receiver directory must be private and owned by this user")


def touch(root):
    if (root / "closed").exists():
        raise ReceiverGone("Receiver closed")
    (root / "lease").touch()


def serve(root, mpv):
    player = None
    ready = False
    try:
        if (root / "closed").exists():
            return
        touch(root)
        player = subprocess.Popen([mpv, "--no-video", "--idle",
                                   "--input-ipc-server=" + endpoint(root),
                                   "--no-config", "--load-scripts=no", "--ytdl=no",
                                   "--input-terminal=no", "--terminal=no"],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL,
                                  **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        (root / "pid").write_text(str(player.pid))
        while player.poll() is None:
            if (root / "closed").exists():
                break
            if time.time() - (root / "lease").stat().st_mtime > LEASE_SECONDS:
                break
            if not ready:
                if os.name == "nt":
                    try:
                        pipe = native.Pipe(endpoint(root), player.pid, timeout=0.1)
                        pipe.close()
                        ready = True
                    except OSError:
                        pass
                else:
                    ready = (root / "ipc").exists()
                if ready:
                    (root / "ready").touch(exist_ok=True)
            time.sleep(0.05)
        if player.poll() is not None and not (root / "ready").exists():
            (root / "error").write_text("mpv exited before opening IPC", encoding="utf-8")
    except Exception as error:
        (root / "error").write_text(str(error), encoding="utf-8")
    finally:
        if player is not None and player.poll() is None:
            player.terminate()
            try:
                player.wait(timeout=0.08)
            except subprocess.TimeoutExpired:
                player.kill()
                player.wait()
        # Keep a tiny cancellation tombstone: a delayed start must never resurrect
        # an owner already closed by Herdr. The OS temp directory owns its lifetime.
        (root / "closed").touch()
        for name in ("ipc", "lease", "ready", "pid"):
            (root / name).unlink(missing_ok=True)
        (root / "done").touch()


def start(root):
    # Windows distributions also ship mpv.com, a console wrapper that launches
    # another process. Own the actual pipe server directly, never its wrapper.
    mpv = shutil.which("mpv.exe" if os.name == "nt" else "mpv")
    if not mpv:
        raise RuntimeError("NO RECEIVER // install mpv")
    prepare(root)
    touch(root)
    # Exclusive creation prevents duplicate guardians for the same engine token.
    with (root / "started").open("x"):
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve", root.name[4:], mpv],
                         **({"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
                            if os.name == "nt" else {"start_new_session": True}), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if (root / "closed").exists():
            raise RuntimeError("Receiver closed")
        if (root / "error").exists():
            raise RuntimeError((root / "error").read_text(encoding="utf-8"))
        if (root / "ready").exists():
            return
        time.sleep(0.025)
    (root / "closed").touch()
    raise RuntimeError("mpv IPC startup timed out")


def request(root, payload):
    try:
        exchange(root, payload)
    except OSError as error:
        if isinstance(error, (FileNotFoundError, ConnectionRefusedError, ConnectionResetError, BrokenPipeError)) or getattr(error, "winerror", None) in (2, 109, 232, 233):
            raise ReceiverGone("Receiver disconnected") from error
        raise


def exchange(root, payload):
    if not root.exists():
        raise ReceiverGone("Receiver disconnected")
    prepare(root)
    touch(root)
    if len(payload.encode("utf-8")) > 1024 * 1024:
        raise ValueError("mpv IPC request exceeds 1 MiB")
    messages = [json.loads(line) for line in payload.splitlines() if line.strip()]
    if not 1 <= len(messages) <= 32:
        raise ValueError("mpv IPC allows 1..32 commands per request")
    pending = {m["request_id"] for m in messages}
    if os.name == "nt":
        client = native.Pipe(endpoint(root), int((root / "pid").read_text()))
        try:
            client.sendall(payload.encode("utf-8"))
            receive(client.chunks(), pending)
        finally:
            client.close()
    else:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2)
            client.connect(endpoint(root))
            client.sendall(payload.encode("utf-8"))
            receive(iter(lambda: client.recv(65536), b""), pending)


def receive(chunks, pending):
    buffer = b""
    total = 0
    deadline = time.monotonic() + 2
    for chunk in chunks:
        total += len(chunk)
        if total > 8 * 1024 * 1024 or time.monotonic() > deadline:
            raise TimeoutError("mpv IPC reply limit exceeded")
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            message = json.loads(line)
            if message.get("request_id") in pending:
                pending.remove(message["request_id"])
                print(json.dumps(message, ensure_ascii=False), flush=True)
        if not pending:
            return
    raise ReceiverGone("mpv IPC disconnected")


def close(root):
    prepare(root)
    (root / "closed").touch()
    # The guardian terminates its own child, never a PID read from an old file.
    deadline = time.monotonic() + 0.18
    while (root / "started").exists() and not (root / "done").exists() and time.monotonic() < deadline:
        time.sleep(0.01)


def main():
    action, token = sys.argv[1:3]
    root = directory(token)
    if action == "start":
        start(root)
    elif action == "serve":
        serve(root, sys.argv[3])
    elif action == "request":
        request(root, sys.argv[3])
    elif action == "close":
        close(root)
    else:
        raise ValueError("Unknown receiver action")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except ReceiverGone as error:
        print(str(error), file=sys.stderr)
        sys.exit(3)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
