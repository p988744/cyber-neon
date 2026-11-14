"""Native Win32 edge cases; no mpv/browser/user data involved."""
import contextlib
import ctypes as C
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import uuid
from ctypes import wintypes as W

if os.name != 'nt':
    print('windows-transport.check: Windows-only kernel tests (not run on this host)')
    raise SystemExit(0)

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('receiver.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
n = receiver.native
create = n.api(n.kernel, 'CreateNamedPipeW', W.HANDLE, W.LPCWSTR, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, C.c_void_p)
connect = n.api(n.kernel, 'ConnectNamedPipe', W.BOOL, W.HANDLE, C.c_void_p)


def fixture(mode):
    name = '\\\\.\\pipe\\cn-radio-test-' + uuid.uuid4().hex
    handle = create(name, 3, 0, 1, 4096, 4096, 0, None)
    assert handle != n.INVALID_HANDLE
    stop = threading.Event()
    def server():
        try:
            connect(handle, None)
            if mode == 'fragment':
                buffer, count = C.create_string_buffer(64), W.DWORD()
                n.checked(n.ReadFile(handle, buffer, 64, C.byref(count), None))
                reply = (json.dumps({'request_id': 1, 'data': '音樂', 'error': 'success'}, ensure_ascii=False) + '\n').encode()
                for byte in reply:
                    data = C.create_string_buffer(bytes([byte]))
                    n.checked(n.WriteFile(handle, data, 1, C.byref(count), None))
                    time.sleep(.001)
            stop.wait(3)
        finally:
            n.CloseHandle(handle)
    thread = threading.Thread(target=server, daemon=True)
    thread.start()
    return name, stop, thread


for mode in ['fragment', 'read-timeout', 'write-timeout', 'wrong-owner']:
    name, stop, thread = fixture(mode)
    pipe = None
    try:
        started = time.monotonic()
        if mode == 'wrong-owner':
            try:
                n.Pipe(name, os.getpid() + 1, timeout=.2)
                raise AssertionError('foreign pipe server accepted')
            except ValueError:
                pass
        else:
            pipe = n.Pipe(name, os.getpid(), timeout=.5)
            if mode == 'fragment':
                pipe.sendall(b'test\n')
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    receiver.receive(pipe.chunks(), {1})
                assert json.loads(output.getvalue())['data'] == '音樂'
            else:
                try:
                    if mode == 'write-timeout':
                        pipe.sendall(b'x' * 1024 * 1024)
                    else:
                        pipe.transfer()
                    raise AssertionError('unresponsive pipe did not time out')
                except TimeoutError:
                    assert time.monotonic() - started < 1.5
        print('native pipe:', mode, 'ok')
    finally:
        if pipe:
            pipe.close()
        stop.set()
        thread.join(4)
        assert not thread.is_alive()

with tempfile.TemporaryDirectory(prefix='radio-acl-') as folder:
    private = Path(folder) / 'private'
    n.prepare(private)
    n.prepare(private)  # safe reuse checks the ACL again
    public = Path(folder) / 'public'
    public.mkdir()
    try:
        n.prepare(public)
        raise AssertionError('unprotected existing session adopted')
    except ValueError:
        pass
print('windows-transport.check ok (real kernel partial UTF-8/read+write deadlines/PID ownership/private ACL)')
