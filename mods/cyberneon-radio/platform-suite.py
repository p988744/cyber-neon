"""Portable CI entrypoint: no /bin/sh, which, or user media/config required."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent
# runpy callers use __file__ from the target; Python is selected by setup-python.
print('Python:', sys.version, flush=True)
print('mpv:', shutil.which('mpv'), flush=True)
subprocess.run(['mpv', '--version'], check=True, timeout=10)
for name in ['windows-storage', 'storage', 'search', 'browser-open', 'windows-transport', 'receiver']:
    subprocess.run([sys.executable, '-B', str(root / (name + '.check.py'))], check=True, timeout=60)
for name in ['ipc', 'stations', 'search', 'add', 'browser', 'browser-tuner', 'ducking', 'ducking-lifecycle', 'tuner']:
    subprocess.run(['node', str(root / (name + '.check.mjs'))], check=True, timeout=60)
for name in ['tuner', 'recovery', 'queue', 'ducking']:
    subprocess.run(['node', str(root / (name + '.integration.mjs'))], check=True, timeout=180)
