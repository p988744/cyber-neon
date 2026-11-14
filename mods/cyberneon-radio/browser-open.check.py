"""Exercise the native Windows dispatch seam without opening a browser."""
import importlib.util
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('browser_open', Path(__file__).with_name('browser-open.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
url = 'https://example.invalid/音樂?x=%22&y=$(calc)&z=^%25#fragment'
with patch.object(module.os, 'startfile', create=True) as start:
    module.open_browser(url)
    start.assert_called_once_with(url, 'open')
    for invalid in ['file:///C:/x', 'https://user:pass@example.invalid', 'https://x/\n', 'https://x/\\bad', 'cmd:calc', 'https://']:
        try:
            module.open_browser(invalid)
            raise AssertionError('unsafe browser URL accepted')
        except ValueError:
            pass
    start.assert_called_once()
print('browser-open.check ok (os.startfile argument boundary; browser deliberately not launched)')
