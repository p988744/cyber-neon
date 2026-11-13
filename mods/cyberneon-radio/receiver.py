"""Local Unix-socket bridge; no shell, TCP listener, downloads, or media library.

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

LEASE_SECONDS = 20


def directory(token):
    if os.name != "posix":
        raise RuntimeError("RECEIVER // Unix sockets require macOS or Linux")
    if not re.fullmatch(r"[a-f0-9]{32}", token):
        raise ValueError("Invalid receiver token")
    # macOS's per-user TMPDIR can exceed sockaddr_un's 104-byte path limit.
    return Path("/tmp") / ("cnr-" + token)


def prepare(root):
    root.mkdir(mode=0o700, exist_ok=True)
    info = root.lstat()
    if root.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Receiver directory must be private and owned by this user")


def touch(root):
    if (root / "closed").exists():
        raise RuntimeError("Receiver closed")
    (root / "lease").touch()


def serve(root, mpv):
    player = None
    ready = False
    try:
        if (root / "closed").exists():
            return
        touch(root)
        player = subprocess.Popen([mpv, "--no-video", "--idle",
                                   "--input-ipc-server=" + str(root / "ipc"),
                                   "--no-config", "--load-scripts=no", "--ytdl=no",
                                   "--input-terminal=no", "--terminal=no"],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL)
        (root / "pid").write_text(str(player.pid))
        while player.poll() is None:
            if (root / "closed").exists():
                break
            if time.time() - (root / "lease").stat().st_mtime > LEASE_SECONDS:
                break
            if not ready and (root / "ipc").exists():
                (root / "ready").touch(exist_ok=True)
                ready = True
            time.sleep(0.05)
        if player.poll() is not None and not (root / "ready").exists():
            (root / "error").write_text("mpv exited before opening IPC")
    except Exception as error:
        (root / "error").write_text(str(error))
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
    mpv = shutil.which("mpv")
    if not mpv:
        raise RuntimeError("NO RECEIVER // install mpv")
    prepare(root)
    touch(root)
    # Exclusive creation prevents duplicate guardians for the same engine token.
    with (root / "started").open("x"):
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve", root.name[4:], mpv],
                         start_new_session=True, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if (root / "closed").exists():
            raise RuntimeError("Receiver closed")
        if (root / "error").exists():
            raise RuntimeError((root / "error").read_text())
        if (root / "ready").exists():
            return
        time.sleep(0.025)
    (root / "closed").touch()
    raise RuntimeError("mpv IPC startup timed out")


def request(root, payload):
    touch(root)
    messages = [json.loads(line) for line in payload.splitlines() if line.strip()]
    pending = {m["request_id"] for m in messages}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(2)
        client.connect(str(root / "ipc"))
        client.sendall(payload.encode("utf8"))
        with client.makefile("r", encoding="utf8") as stream:
            while pending:
                line = stream.readline()
                if not line:
                    raise RuntimeError("mpv IPC disconnected")
                message = json.loads(line)
                if message.get("request_id") in pending:
                    pending.remove(message["request_id"])
                    print(json.dumps(message), flush=True)


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
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
