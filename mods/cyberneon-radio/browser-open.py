"""Windows ShellExecute handoff via Python, never cmd/start or a command string."""
import os
import re
import sys
from urllib.parse import urlsplit


def open_browser(url):
    parts = urlsplit(url)
    if (re.search(r'[\x00-\x20\x7f\\]', url) or parts.scheme.lower() not in ('http', 'https')
            or not parts.hostname or parts.username or parts.password):
        raise ValueError('Browser station needs an absolute HTTP(S) URL without credentials')
    os.startfile(url, 'open')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    try:
        open_browser(sys.argv[1])
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
