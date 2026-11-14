#!/usr/bin/env python3
"""Isolated save race and file-preservation checks."""
import importlib.util
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("storage", Path(__file__).with_name("station-files.py"))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
station = {"name": "Fixture", "url": "https://example.invalid/live"}
with TemporaryDirectory(prefix="radio-save-") as root:
    path = Path(root) / "radio.json"
    path.write_text("[]")
    os.chmod(path, 0o640)
    assert storage.save_station(root, dict(station))
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o640
    external = '[{"name":"Manual edit","url":"~/Music"}]'
    sync = storage.os.fsync
    def changed(fd):
        sync(fd)
        path.write_text(external)
    with patch.object(storage.os, "fsync", changed):
        try:
            storage.save_station(root, {"name": "Another", "url": "https://example.invalid/another"})
            raise AssertionError("overwrote concurrent external edit")
        except ValueError as error:
            assert "changed" in str(error)
    assert path.read_text() == external
    assert not list(Path(root).glob(".radio-*"))
    target = Path(root) / "target.json"
    path.rename(target)
    path.symlink_to(target)
    try:
        storage.save_station(root, dict(station))
        raise AssertionError("replaced symlink")
    except ValueError as error:
        assert "symlink" in str(error)
    assert target.read_text() == external
    assert path.is_symlink()
print("storage.check.py ok (external edit during save, cleanup, permissions, symlink; scratch config only)")

if os.name == 'nt':
    import subprocess
    import sys
    import time
    with TemporaryDirectory(prefix='radio-lock-timeout-') as root:
        path = Path(root) / 'radio.json'
        path.write_bytes(b'[]')
        holder = subprocess.Popen([sys.executable, '-c', '''import msvcrt, sys
with open(sys.argv[1], 'a+b') as lock:
    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    print('locked', flush=True)
    sys.stdin.read(1)
''', str(Path(root) / 'radio.json.lock')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            assert holder.stdout.readline().strip() == 'locked'
            started = time.monotonic()
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('station-files.py')), 'save', root, json.dumps(station)],
                                    capture_output=True, text=True, encoding='utf-8', timeout=4.5)
            assert result.returncode != 0
            assert time.monotonic() - started < 4.5
            assert path.read_bytes() == b'[]'
            assert not list(Path(root).glob('.radio-*'))
        finally:
            holder.communicate('x', timeout=3)
    print('native Windows storage lock contention is bounded below helper timeout')
