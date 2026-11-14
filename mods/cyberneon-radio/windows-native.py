"""Windows-only stdlib bindings: private sessions and deadline-bound mpv pipes.

CreateFile uses FILE_FLAG_OVERLAPPED; every pending operation is cancelled and
reaped before its buffer/event is released. No shell or third-party runtime.
"""
import ctypes as C
from ctypes import wintypes as W
import time

kernel = C.WinDLL('kernel32', use_last_error=True)
advapi = C.WinDLL('advapi32', use_last_error=True)


def api(dll, name, result, *args):
    fn = getattr(dll, name)
    fn.restype, fn.argtypes = result, args
    return fn


CloseHandle = api(kernel, 'CloseHandle', W.BOOL, W.HANDLE)
LocalFree = api(kernel, 'LocalFree', W.HANDLE, W.HANDLE)
CreateFile = api(kernel, 'CreateFileW', W.HANDLE, W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE)
CreateEvent = api(kernel, 'CreateEventW', W.HANDLE, C.c_void_p, W.BOOL, W.BOOL, W.LPCWSTR)
Wait = api(kernel, 'WaitForSingleObject', W.DWORD, W.HANDLE, W.DWORD)
INVALID_HANDLE = C.c_void_p(-1).value


class Overlapped(C.Structure):
    _fields_ = [('Internal', C.c_size_t), ('InternalHigh', C.c_size_t),
                ('Offset', W.DWORD), ('OffsetHigh', W.DWORD), ('hEvent', W.HANDLE)]


ReadFile = api(kernel, 'ReadFile', W.BOOL, W.HANDLE, C.c_void_p, W.DWORD, C.POINTER(W.DWORD), C.POINTER(Overlapped))
WriteFile = api(kernel, 'WriteFile', W.BOOL, W.HANDLE, C.c_void_p, W.DWORD, C.POINTER(W.DWORD), C.POINTER(Overlapped))
Result = api(kernel, 'GetOverlappedResult', W.BOOL, W.HANDLE, C.POINTER(Overlapped), C.POINTER(W.DWORD), W.BOOL)
Cancel = api(kernel, 'CancelIoEx', W.BOOL, W.HANDLE, C.POINTER(Overlapped))
ServerPid = api(kernel, 'GetNamedPipeServerProcessId', W.BOOL, W.HANDLE, C.POINTER(W.DWORD))


def checked(result):
    if not result:
        raise C.WinError(C.get_last_error())
    return result


def user_sid():
    token = W.HANDLE()
    process = api(kernel, 'GetCurrentProcess', W.HANDLE)()
    checked(api(advapi, 'OpenProcessToken', W.BOOL, W.HANDLE, W.DWORD, C.POINTER(W.HANDLE))(process, 8, C.byref(token)))
    try:
        size = W.DWORD()
        get = api(advapi, 'GetTokenInformation', W.BOOL, W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.POINTER(W.DWORD))
        get(token, 1, None, 0, C.byref(size))
        data = C.create_string_buffer(size.value)
        checked(get(token, 1, data, size, C.byref(size)))
        sid = C.cast(data, C.POINTER(C.c_void_p))[0]
        text = W.LPWSTR()
        checked(api(advapi, 'ConvertSidToStringSidW', W.BOOL, C.c_void_p, C.POINTER(W.LPWSTR))(sid, C.byref(text)))
        try:
            return text.value
        finally:
            LocalFree(text)
    finally:
        CloseHandle(token)


class SecurityAttributes(C.Structure):
    _fields_ = [('nLength', W.DWORD), ('lpSecurityDescriptor', C.c_void_p), ('bInheritHandle', W.BOOL)]


def prepare(root):
    # Protected DACL, inherited by markers; only the current user gets access.
    sddl = 'D:P(A;OICI;FA;;;' + user_sid() + ')'
    descriptor = C.c_void_p()
    checked(api(advapi, 'ConvertStringSecurityDescriptorToSecurityDescriptorW', W.BOOL,
                W.LPCWSTR, W.DWORD, C.POINTER(C.c_void_p), C.c_void_p)(sddl, 1, C.byref(descriptor), None))
    try:
        attrs = SecurityAttributes(C.sizeof(SecurityAttributes), descriptor, False)
        create = api(kernel, 'CreateDirectoryW', W.BOOL, W.LPCWSTR, C.POINTER(SecurityAttributes))
        if not create(str(root), C.byref(attrs)) and C.get_last_error() != 183:
            raise C.WinError(C.get_last_error())
    finally:
        LocalFree(descriptor)
    attributes = api(kernel, 'GetFileAttributesW', W.DWORD, W.LPCWSTR)(str(root))
    if attributes == 0xffffffff or attributes & 0x400 or not attributes & 0x10:
        raise ValueError('Receiver directory must be private, without reparse points')
    # Do not repair/adopt an existing directory with a different ACL.
    descriptor = C.c_void_p()
    code = api(advapi, 'GetNamedSecurityInfoW', W.DWORD, W.LPWSTR, C.c_int, W.DWORD,
               C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p))(
                   str(root), 1, 4, None, None, None, None, C.byref(descriptor))
    if code:
        raise C.WinError(code)
    text = W.LPWSTR()
    try:
        checked(api(advapi, 'ConvertSecurityDescriptorToStringSecurityDescriptorW', W.BOOL,
                    C.c_void_p, W.DWORD, W.DWORD, C.POINTER(W.LPWSTR), C.c_void_p)(descriptor, 1, 4, C.byref(text), None))
        if text.value != sddl:
            raise ValueError('Receiver directory must be private and owned by this user')
    finally:
        if text:
            LocalFree(text)
        LocalFree(descriptor)


class Pipe:
    def __init__(self, name, pid, timeout=2):
        self.deadline = time.monotonic() + timeout
        self.handle = INVALID_HANDLE
        while True:
            # SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION prevents a pipe
            # server impersonating this helper. Random name + child PID pin it.
            self.handle = CreateFile(name, 0xc0000000, 0, None, 3, 0x40000000 | 0x100000 | 0x10000, None)
            if self.handle != INVALID_HANDLE:
                break
            error = C.get_last_error()
            if error not in (2, 231) or time.monotonic() >= self.deadline:
                raise C.WinError(error)
            time.sleep(0.01)
        actual = W.DWORD()
        try:
            checked(ServerPid(self.handle, C.byref(actual)))
            if actual.value != pid:
                raise ValueError('Receiver pipe does not belong to this mpv child')
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.handle != INVALID_HANDLE:
            CloseHandle(self.handle)
            self.handle = INVALID_HANDLE

    def transfer(self, data=None):
        size = 65536 if data is None else len(data)
        buffer = C.create_string_buffer(size) if data is None else C.create_string_buffer(data)
        operation = Overlapped()
        operation.hEvent = checked(CreateEvent(None, True, False, None))
        count = W.DWORD()
        try:
            fn = ReadFile if data is None else WriteFile
            if not fn(self.handle, buffer, size, C.byref(count), C.byref(operation)):
                error = C.get_last_error()
                if error != 997:
                    raise C.WinError(error)
                remaining = max(0, int((self.deadline - time.monotonic()) * 1000))
                if Wait(operation.hEvent, remaining) != 0:
                    Cancel(self.handle, C.byref(operation))
                    Result(self.handle, C.byref(operation), C.byref(count), True)
                    raise TimeoutError('mpv IPC timed out')
                checked(Result(self.handle, C.byref(operation), C.byref(count), False))
            return buffer.raw[:count.value] if data is None else count.value
        finally:
            CloseHandle(operation.hEvent)

    def sendall(self, data):
        while data:
            count = self.transfer(data)
            if not count:
                raise BrokenPipeError('mpv IPC disconnected')
            data = data[count:]

    def chunks(self):
        while True:
            chunk = self.transfer()
            if not chunk:
                raise BrokenPipeError('mpv IPC disconnected')
            yield chunk
