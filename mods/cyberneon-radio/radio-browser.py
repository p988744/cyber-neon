#!/usr/bin/env python3
"""On-demand directory lookup only; never fetches a station stream or writes config."""
import json
import random
import re
import socket
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

USER_AGENT = "Cyber-Neon-Radio/0.5"
MAX_BYTES = 1024 * 1024


def servers():
    addresses = {item[4][0] for item in socket.getaddrinfo("all.api.radio-browser.info", 443, type=socket.SOCK_STREAM)}
    names = set()
    for address in addresses:
        try:
            name = socket.gethostbyaddr(address)[0].lower().rstrip(".")
            if re.fullmatch(r"[a-z0-9-]+\.api\.radio-browser\.info", name):
                names.add(name)
        except OSError:
            continue
    result = sorted(names)
    random.shuffle(result)  # Balance directory servers, never shuffle stations.
    if not result:
        raise ValueError("Radio Browser DNS discovery found no servers; retry Search")
    return result


def search(tag, discover=servers, request=urlopen):
    if not isinstance(tag, str) or not tag.strip() or len(tag) > 80 or re.search(r"[\x00-\x1f\x7f]", tag):
        raise ValueError("Enter a tag of 1–80 characters")
    query = urlencode({"tag": tag.strip(), "hidebroken": "true", "order": "clickcount", "reverse": "true", "limit": 50})
    for host in discover()[:2]:
        try:
            req = Request(f"https://{host}/json/stations/search?{query}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with request(req, timeout=5) as response:
                body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError("Radio Browser response exceeds 1 MiB")
            values = json.loads(body)
            if not isinstance(values, list):
                raise ValueError("Invalid Radio Browser response")
            return values[:50]
        except (OSError, ValueError):
            continue
    raise ValueError("Radio Browser is unavailable; retry Search")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        if len(sys.argv) != 2:
            raise ValueError("Expected a search tag")
        print(json.dumps(search(sys.argv[1]), ensure_ascii=False))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
