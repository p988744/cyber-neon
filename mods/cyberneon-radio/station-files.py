#!/usr/bin/env python3
"""Bounded local sources and explicit station saves. No network or shell."""
import configparser
import json
import os
from pathlib import Path
import re
import sys
from contextlib import contextmanager
import time
import tempfile
from urllib.parse import unquote, urlsplit

MAX_BYTES = 1024 * 1024
MAX_ITEMS = 1000
AUDIO = {".mp3", ".flac", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".aiff", ".aif", ".alac", ".wma", ".ape", ".webm", ".mka"}
PLAYLIST = {".m3u", ".m3u8", ".pls"}
STREAMS = {"http", "https", "icy", "rtsp", "rtmp", "rtmps"}
BROWSER_ONLY = {"youtube.com", "youtu.be", "youtube-nocookie.com", "spotify.com", "music.apple.com", "soundcloud.com", "snd.sc", "poolsuite.net", "somafm.com"}


@contextmanager
def station_lock(path):
    # Lock a stable sidecar, never the atomically replaced config inode. Windows
    # locking starts at the current byte offset, including beyond EOF.
    with path.open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            deadline = time.monotonic() + 3
            while True:
                lock.seek(0)
                try:
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as error:
                    if error.errno not in (13, 11, 36) or time.monotonic() >= deadline:
                        raise
                    time.sleep(0.025)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)


def windows_drive(value):
    return bool(re.match(r"^[a-zA-Z]:[\\/]", value))


def read_text(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Radio file exceeds 1 MiB")
    return data.decode("utf-8-sig")


def config_bytes(path):
    try:
        with path.open("rb") as stream:
            data = stream.read(MAX_BYTES + 1)
    except FileNotFoundError:
        return None
    if len(data) > MAX_BYTES:
        raise ValueError("Radio file exceeds 1 MiB")
    return data


def stream_url(value):
    if windows_drive(value):
        return False
    parts = urlsplit(value)
    if not parts.scheme:
        return False
    if parts.scheme.lower() not in STREAMS:
        raise ValueError("Unsupported radio source protocol")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise ValueError("Stream URL needs a host")
    if any(host == domain or host.endswith("." + domain) for domain in BROWSER_ONLY):
        raise ValueError("Browser-only source: open in your browser")
    return True


def local_path(value, base):
    parts = urlsplit(value)
    if windows_drive(value):
        if os.name != "nt":
            raise ValueError("Windows drive paths require Windows")
    elif parts.scheme.lower() == "file":
        if parts.netloc not in ("", "localhost") or parts.query or parts.fragment:
            raise ValueError("Expected a local file URL")
        value = unquote(parts.path)
        if os.name == "nt" and re.match(r"^/[a-zA-Z]:/", value):
            value = value[1:]
        if os.name == "nt" and (value.startswith(("//", "\\\\")) or not windows_drive(value)):
            raise ValueError("Expected a local drive file URL")
    elif parts.scheme:
        raise ValueError("Unsupported radio source protocol")
    if os.name == "nt" and (value.startswith(("//", "\\\\")) or re.match(r"^[a-zA-Z]:(?![\\/])", value)):
        raise ValueError("Expected a local absolute drive or relative path")
    if value.startswith("~") and value != "~" and not value.startswith("~/"):
        raise ValueError("Use ~/ for home-relative paths")
    path = Path(os.path.expanduser(value))
    return (base / path).resolve() if not path.is_absolute() else path.resolve()


def resolve_source(value, root):
    items = []
    active = set()
    visited = 0

    def expand(value, base, depth=0):
        nonlocal visited
        visited += 1
        if visited > 5000 or depth > 16:
            raise ValueError("Radio source expansion limit exceeded")
        if not isinstance(value, str) or not value.strip() or re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError("Invalid radio source")
        # File URLs are handled locally; other schemes must be approved streams.
        if urlsplit(value).scheme.lower() != "file" and stream_url(value):
            items.append(value)
        else:
            path = local_path(value, base)
            if path in active:
                raise ValueError("Cyclic radio folder or playlist")
            if not path.exists():
                raise ValueError(f"Radio source does not exist: {path}")
            active.add(path)
            try:
                if path.is_dir():
                    # Deterministic recursive audio-only traversal; links skipped to avoid loops.
                    with os.scandir(path) as entries:
                        children = []
                        for child in entries:
                            if len(children) >= 5000:
                                raise ValueError("Radio folder expansion limit exceeded")
                            children.append(child)
                    for child in sorted(children, key=lambda entry: entry.name):
                        if child.is_symlink() or (os.name == "nt" and os.path.isjunction(child.path)):
                            continue
                        if child.is_dir() or Path(child.name).suffix.lower() in AUDIO:
                            expand(child.path, path, depth + 1)
                elif path.suffix.lower() in PLAYLIST:
                    text = read_text(path)
                    if path.suffix.lower() == ".pls":
                        parser = configparser.ConfigParser(interpolation=None, strict=True)
                        parser.read_string(text)
                        section = next((s for s in parser.sections() if s.lower() == "playlist"), None)
                        if section is None:
                            raise ValueError("PLS needs a [playlist] section")
                        entries = [(int(key[4:]), item) for key, item in parser[section].items() if re.fullmatch(r"file\d+", key)]
                        entries = [item for _, item in sorted(entries)]
                    else:
                        entries = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
                    for entry in entries:
                        expand(entry, path.parent, depth + 1)
                elif path.is_file() and path.suffix.lower() in AUDIO:
                    items.append(str(path))
                else:
                    raise ValueError("Unsupported local audio file")
            finally:
                active.remove(path)
        if len(items) > MAX_ITEMS:
            raise ValueError(f"Radio sources allow at most {MAX_ITEMS} tracks")

    expand(value, Path(root))
    if not items:
        raise ValueError("No audio tracks in radio source")
    if any(re.search(r"[\x00-\x1f\x7f]", item) for item in items):
        raise ValueError("Audio paths must not contain control characters")
    return items[0] if len(items) == 1 else items


def validate_stations(values):
    if not isinstance(values, list) or len(values) > MAX_ITEMS:
        raise ValueError("radio.json must be an array of at most 1000 stations")
    for station in values:
        if not isinstance(station, dict):
            raise ValueError("Expected a station object")
        for field in ("name", "url", "open", "genre", "note"):
            if field not in station and field != "name":
                continue
            value = station.get(field)
            if not isinstance(value, str) or not value.strip() or re.search(r"[\x00-\x1f\x7f]", value):
                raise ValueError(f"Invalid station {field}")
        if not (station.get("url") or station.get("open")):
            raise ValueError("Station needs url or open")
        if "explicit" in station and not isinstance(station["explicit"], bool):
            raise ValueError("Station explicit must be boolean")


def invalid_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


def save_station(root, station):
    validate_stations([station])
    path = Path(root) / "radio.json"
    # An editor's symlink must not be replaced with a different regular file.
    if path.is_symlink():
        raise ValueError("Cannot save a symlinked radio.json; edit its target manually")
    with station_lock(Path(root) / "radio.json.lock"):
        original = config_bytes(path)
        values = json.loads(original.decode("utf-8-sig"), parse_constant=invalid_constant) if original is not None else []
        validate_stations(values)
        source = station.get("open") or station.get("url")
        if any((s.get("open") or s.get("url")).strip() == source.strip() or
               (station.get("radioBrowserId") and s.get("radioBrowserId") == station["radioBrowserId"])
               for s in values):
            return False
        station.pop("contentWarning", None)  # Derived at read time.
        values.append(station)
        validate_stations(values)
        data = (json.dumps(values, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError("Radio file exceeds 1 MiB")
        fd, temporary = tempfile.mkstemp(prefix=".radio-", dir=root)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            # Windows readers/editors may briefly hold a handle without delete
            # sharing. Retry replacement boundedly, rechecking external edits on
            # every attempt; never move/delete the original to work around it.
            deadline = time.monotonic() + 0.5
            while True:
                latest = config_bytes(path)
                if path.is_symlink() or latest != original:
                    raise ValueError("radio.json changed while saving; retry Add")
                if path.exists() and os.name != "nt":
                    os.chmod(temporary, path.stat().st_mode & 0o777)
                try:
                    os.replace(temporary, path)
                    break
                except PermissionError:
                    if os.name != "nt" or time.monotonic() >= deadline:
                        raise
                    time.sleep(0.01)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return True


def main():
    action, root, *values = sys.argv[1:]
    if action == "read":
        path = Path(root) / "radio.json"
        try:
            result = read_text(path)
        except FileNotFoundError:
            result = "[]"
    elif action == "resolve" and len(values) == 1:
        result = resolve_source(values[0], root)
    elif action == "save" and len(values) == 1:
        result = save_station(root, json.loads(values[0]))
    else:
        raise ValueError("Unknown radio storage action")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except (OSError, ValueError, configparser.Error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
