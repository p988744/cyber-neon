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
