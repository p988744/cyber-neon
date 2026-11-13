#!/usr/bin/env python3
"""Offline directory protocol and DNS discovery checks."""
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("directory", Path(__file__).with_name("radio-browser.py"))
directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)
with patch.object(directory.socket, "getaddrinfo", return_value=[(0, 0, 0, "", ("1.2.3.4", 443)), (0, 0, 0, "", ("2.3.4.5", 443))]), patch.object(directory.socket, "gethostbyaddr", side_effect=[("one.api.radio-browser.info", [], []), ("foreign.invalid", [], [])]):
    assert directory.servers() == ["one.api.radio-browser.info"]
calls = []
def request(req, timeout):
    calls.append(req)
    assert timeout == 5
    assert req.get_header("User-agent") == "Cyber-Neon-Radio/0.5"
    assert req.get_header("Accept") == "application/json"
    assert "tag=lofi&hidebroken=true&order=clickcount&reverse=true&limit=50" in req.full_url
    if len(calls) == 1:
        raise OSError("offline")
    return io.BytesIO(json.dumps([{"name": "fixture"}]).encode())
assert directory.search("lofi", lambda: ["one.api.radio-browser.info", "two.api.radio-browser.info"], request) == [{"name": "fixture"}]
assert len(calls) == 2
for payload in [b"{}", b"invalid", b" " * (directory.MAX_BYTES + 1)]:
    try:
        directory.search("ambient", lambda: ["one.api.radio-browser.info"], lambda *a, **k: io.BytesIO(payload))
        raise AssertionError("accepted malformed response")
    except ValueError:
        pass
print("search.check.py ok (DNS, UA, query, fallback, response bounds; no network)")
