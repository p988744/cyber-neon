"""python3 -B mods/cyberneon-radio/receiver.check.py

Optional integration check: requires local mpv, plays generated silence only.
No stations, network, or bundled music. All session files are removed afterward.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import wave

SCRIPT = Path(__file__).with_name("receiver.py")
roots = []


def session():
    token = uuid.uuid4().hex
    root = Path(tempfile.gettempdir() if os.name == "nt" else "/tmp") / ("cnr-" + token)
    roots.append(root)
    return token, root


def call(action, token, payload=None, env=None, ok=True):
    args = [sys.executable, "-B", str(SCRIPT), action, token]
    if payload is not None:
        args.append(payload)
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=7, env=env)
    if ok:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0
    return result


def request(token, commands):
    wire = "".join(json.dumps({"command": command, "request_id": i}) + "\n" for i, command in enumerate(commands))
    return [json.loads(line) for line in call("request", token, wire).stdout.splitlines()]


def gone(pid):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return True
        kernel.CloseHandle(handle)
        return False
    try:
        os.kill(pid, 0)
        return False
    except ProcessLookupError:
        return True


def wait_for(check):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.025)
    raise AssertionError("Timed out waiting for receiver cleanup")


try:
    token, root = session()
    result = call("start", token, env={**os.environ, "PATH": ""}, ok=False)
    assert "NO RECEIVER // install mpv" in result.stderr
    assert not root.exists(), "Missing mpv must create nothing"

    token, root = session()
    call("close", token)  # close wins even before the launcher gets CPU
    call("start", token, ok=False)
    assert not (root / "pid").exists()

    assert shutil.which("mpv"), "Install mpv to run the integration check"
    token, root = session()
    launcher = subprocess.Popen([sys.executable, "-B", str(SCRIPT), "start", token],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    wait_for(lambda: (root / "started").exists())
    call("close", token)  # race with an in-flight start, not just before it
    launcher.communicate(timeout=7)
    wait_for(lambda: (root / "done").exists())
    assert not (root / "pid").exists()
    assert not (root / "ipc").exists()

    with tempfile.TemporaryDirectory(prefix="cn-radio-check-") as folder:
        media = Path(folder) / 'silent 音樂 file.wav'
        with wave.open(str(media), "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(8000)
            stream.writeframes(b"\0\0" * 8000 * 60)

        token, root = session()
        call("start", token)
        pid = int((root / "pid").read_text())
        assert request(token, [["set_property", "options/ao", "null"]])[0]["error"] == "success"
        for _ in range(2):
            replies = request(token, [["loadfile", str(media), "replace"], ["set_property", "pause", True],
                                      ["set_property", "volume", 23], ["set_property", "mute", True]])
            assert all(r["error"] == "success" for r in replies), replies
            time.sleep(0.1)
            replies = request(token, [["get_property", p] for p in ["pause", "volume", "mute", "media-title", "metadata"]])
            assert [r.get("data") for r in replies[:3]] == [True, 23, True], replies
            title = None
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                response = request(token, [["get_property", "media-title"]])[0]
                title = response.get("data")
                if title:
                    break
                time.sleep(.025)
            assert title == media.name, (title, response)
            assert replies[4]["error"] in ("success", "property unavailable"), replies
            request(token, [["stop"]])
            assert int((root / "pid").read_text()) == pid, "Stop/play must reuse mpv"

        # Three owners represent the same View.close used by layout switch,
        # mod reload and Herdr quit; every child is reaped by its guardian.
        call("close", token)
        wait_for(lambda: gone(pid) and (root / "done").exists())
        assert not (root / "ipc").exists()
        for _ in range(2):
            token, root = session()
            call("start", token)
            pid = int((root / "pid").read_text())
            call("close", token)
            wait_for(lambda: gone(pid) and (root / "done").exists())

        token, root = session()
        call("start", token)
        pid = int((root / "pid").read_text())
        # Simulate an app disappearing without close, without waiting 20 seconds.
        os.utime(root / "lease", (time.time() - 30, time.time() - 30))
        wait_for(lambda: gone(pid) and (root / "done").exists())
        assert (root / "done").exists()
    print("receiver.check ok (real mpv IPC, reuse, close, expired heartbeat, missing mpv)")
finally:
    for root in roots:
        if root.exists():
            call("close", root.name[4:])
            wait_for(lambda: not (root / "pid").exists()
                     and (not (root / "started").exists() or (root / "done").exists()))
            shutil.rmtree(root)
