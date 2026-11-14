import json
import subprocess
import sys
import tempfile
from pathlib import Path

script = Path(__file__).with_name("station-files.py")


def run(root, *args):
    result = subprocess.run([sys.executable, "-I", "-B", str(script), *args], capture_output=True, text=True, encoding="utf-8")
    return result.returncode, result.stdout.strip(), result.stderr.strip()


with tempfile.TemporaryDirectory(prefix="radio-remove-音樂 ") as root:
    path = Path(root) / "radio.json"
    # Missing file: nothing to remove, nothing created.
    assert run(root, "remove", root, "https://a.invalid/")[1] == "false"
    assert not path.exists()
    manual = {"name": "Manual", "url": "~/Music", "extra": {"keep": True}}
    path.write_text(json.dumps([manual], indent=2), encoding="utf-8")
    assert run(root, "save", root, json.dumps({"name": "A", "url": "https://a.invalid/"}))[1] == "true"
    assert run(root, "save", root, json.dumps({"name": "B", "open": "https://b.invalid/"}))[1] == "true"
    # Remove by source; others keep every field.
    assert run(root, "remove", root, "https://a.invalid/")[1] == "true"
    values = json.loads(path.read_text(encoding="utf-8"))
    assert [s["name"] for s in values] == ["Manual", "B"], values
    assert values[0] == manual
    # Browser-only stations are matched by their open URL; repeats are no-ops.
    assert run(root, "remove", root, "https://b.invalid/")[1] == "true"
    assert run(root, "remove", root, "https://b.invalid/")[1] == "false"
    assert json.loads(path.read_text(encoding="utf-8")) == [manual]
    # Invalid JSON is never overwritten.
    path.write_text("{broken", encoding="utf-8")
    code, _, error = run(root, "remove", root, "~/Music")
    assert code == 1 and error, (code, error)
    assert path.read_text(encoding="utf-8") == "{broken"
    assert not list(Path(root).glob(".radio-*"))
print("remove.check ok")
