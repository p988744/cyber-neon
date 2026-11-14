"""Actual CLI regression: read/resolve must not import POSIX fcntl."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

helper = Path(__file__).with_name('station-files.py').resolve()
runner = '''import builtins, runpy, sys
original = builtins.__import__
def restricted(name, *args, **kwargs):
    if name == 'fcntl':
        raise ModuleNotFoundError("No module named 'fcntl'")
    return original(name, *args, **kwargs)
builtins.__import__ = restricted
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
'''
with tempfile.TemporaryDirectory(prefix='radio-platform-') as folder:
    root = Path(folder)
    media = root / '音樂 space.wav'
    media.write_bytes(b'fixture')
    cases = [('read', [], '[]'), ('resolve', [str(media)], str(media.resolve()))]
    if os.name == 'nt':
        cases += [('resolve', [media.as_uri()], str(media.resolve())),
                  ('resolve', [str(media).replace('\\', '/')], str(media.resolve()))]
    for action, values, expected in cases:
        result = subprocess.run([sys.executable, '-c', runner, str(helper), action, folder, *values],
                                capture_output=True, text=True, encoding='utf-8', timeout=5)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == expected
print('windows-storage.check ok (actual CLI with fcntl unavailable; read + resolve)')

# Exercise the Windows branch on every host, intercepting Path construction so
# a regression cannot resolve/probe a UNC share or device even on Windows CI.
import importlib.util
from unittest.mock import patch
from contextlib import nullcontext
spec = importlib.util.spec_from_file_location('storage', helper)
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
rejected = [
    r'/\server/share/song.wav',
    r'\/server/share/song.wav',
    r'/\?/C:/Music/song.wav',
    r'\/?/C:/Music/song.wav',
    r'//server/share/song.wav',
    r'\\server\share\song.wav',
    r'\\?\C:\Music\song.wav',
    r'\\.\C:\Music\song.wav',
    r'C:Music\song.wav',
    r'\Music\song.wav',
    '/Music/song.wav',
    r'//./C:/Music/song.wav',
    'file:///%2f%5cserver/share/song.wav',
    'file:///%5c%2fserver/share/song.wav',
    'file:///%2f%5c%3f/C:/Music/song.wav',
]
for value in rejected:
    platform = nullcontext() if os.name == 'nt' else patch.object(storage.os, 'name', 'nt')
    with platform, patch.object(storage, 'Path') as filesystem:
        filesystem.side_effect = AssertionError('unsafe Windows source reached filesystem: ' + value)
        try:
            storage.local_path(value, None)
            raise AssertionError('accepted unsafe Windows source: ' + value)
        except ValueError:
            pass
        filesystem.assert_not_called()
print('windows-storage.check ok (mixed UNC/device/drive-relative inputs rejected before filesystem access on every host)')

for value, expected in [
    (r'C:\Music\音樂 song.wav', r'C:\Music\音樂 song.wav'),
    ('C:/Music/音樂 song.wav', 'C:/Music/音樂 song.wav'),
    (r'folder\list.m3u', r'folder\list.m3u'),
    ('folder/list.m3u', 'folder/list.m3u'),
    ('file:///C:/Music/%E9%9F%B3%E6%A8%82%20song.wav', 'C:/Music/音樂 song.wav'),
]:
    platform = nullcontext() if os.name == 'nt' else patch.object(storage.os, 'name', 'nt')
    with platform, patch.object(storage, 'Path') as filesystem:
        filesystem.return_value.is_absolute.return_value = True
        storage.local_path(value, None)
        filesystem.assert_called_once_with(expected)
print('windows-storage.check ok (letter drives, relative playlists and Unicode file URLs retain lexical acceptance)')
