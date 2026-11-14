# cyberneon-radio — engine, stations and tuner

No stations or music ship. No source is loaded at startup. The layout places
one `main.js` View in the right work area's 28px bottom status bar. Its RADIO chip
opens a tuner in a native popover, retaining that same owner and receiver when
dismissed. `mod.json` uses `place: none`, so installing it alone starts nothing.
See [UI.md](UI.md) for controls, layout-only keys, UI state/extension seams,
ANIM OFF behavior and UI checks. The final station/source API is documented below.

For installation (`brew install mpv`), the config path, an inactive own-Music-folder
example and everyday controls, start with [README Radio](../../README.md#radio).
[Source terms](../../README.md#sources-and-permissions) and [BROWSER.md](BROWSER.md)
cover directory-only discovery, browser-only services and Creative Commons
attribution. No developer permission for One More Lawn has been received, no
music is bundled, and no music license grant is recorded in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md#radio-music-and-external-player).

## Reusable interface

`engine.js` exports `RadioEngine(bridge)` and `NO_RECEIVER`. The View creates
`this.engine` with `localReceiver()` from `bridge.js`. The UI controller calls:

```js
cx.spawn(async (cx) => {
  await this.engine.play(source); // direct URL or absolute local file path
  cx.notify();
});
// All return a Promise of the updated snapshot (except close).
await engine.pause(true);        // false resumes
await engine.stop();             // unloads; keeps this mpv for next play
await engine.volume(50);         // clamped to 0..100
await engine.mute(true);         // false unmutes
await engine.poll();             // metadata + heartbeat, every 5s while started
engine.snapshot();               // a copy, never mutate internal state
await engine.close();            // final; no further plays on this instance
```

Snapshot: `{status, source, title, paused, volume, muted, error}`. Status is
`idle | loading | playing | paused | unavailable | error | closed`. Controls
before first play do nothing. Defaults: volume 50, unmuted. Plays and controls
are serialized. A load acknowledgment means `loading`, not successful decoding;
poll resolves current playback state. ICY `icy-title` wins over `media-title`,
falls back when absent/blank, clears on a new source, stop, or end of file.
Title updates have up to 5s latency. Failed decoding returns to idle on poll.
Operational failures appear in `error`. Receiver death (closed session, missing
socket, refused/reset connection or EOF) clears liveness. Poll and controls never
restart it. The next explicit Play retires the old session and allocates a fresh
token, then loads only the requested source, preserving volume/mute settings.
If Play is the first call after expiry, it detects the loss and retries once on
that same click. Ordinary mpv command errors and helper timeouts do not replace
the player. Startup failures and missing mpv can also be retried by playing again.
`close()` is final across generations; no pending or later Play can revive it.

The owner must call `poll()` while hidden too and **start** `engine.close()`
directly in its `async close()` hook. Keep one owner in a **layout-owned block**;
a terminal pane's lifetime can span layouts. A station list should update this
engine, not create another owner. Mods cannot import one another: keep radio components
in this mod folder. No shared-state RPC or arbitrary mpv command API is exposed.

## Local process and dependencies

- Requires local `mpv` and `python3` on Herdr's PATH, macOS, Linux or Windows. `mpv
  --version` is checked on first play. If absent, the readout is exactly
  `NO RECEIVER // install mpv`; no bridge/guardian/session is started.
- Herdr provides `exec`. Python's stdlib bridge sends newline-delimited JSON
  to a private Unix socket on POSIX or an overlapped named pipe on Windows. No `socat`, npm packages,
  shell interpolation, remote machine selection, TCP listener, or downloaded code.
- First play starts one guardian owning `mpv --no-video --idle
  --input-ipc-server=<socket>`. It adds `--no-config --load-scripts=no --ytdl=no
  --input-terminal=no --terminal=no` to isolate it from CLI scripts/config and
  external website extraction. Stop keeps mpv idle; later play reuses the PID
  while that receiver remains alive. A dead receiver is replaced only on Play.
- Direct URLs/files are passed as JSON strings, never shell commands. Caller
  decides which sources are allowed; restricted services remain browser-only.
  Playback requests contact only the caller-selected source.
- The owner has a random 128-bit session token and a mode-0700 `/tmp/cnr-<token>`
  directory per generation on POSIX (short enough for macOS socket paths).
  Windows uses `%TEMP%/cnr-<token>` with a protected current-user-only DACL,
  inherited by session files, and `\\.\pipe\cnr-<token>`. Existing directories
  with a different DACL or reparse points are rejected. Pipe connections verify
  the server PID against the guardian-owned child; mpv restricts its pipe to
  the current user/integrity level and rejects remote clients. A replacement
  first cancels the old token; its fresh token is published before startup, so
  close can cancel it even while the launcher is pending. Close writes a cancellation
  marker; the guardian terminates and reaps its own mpv child, force-killing if
  needed. No PID-file kill or system-wide player kill is used. Closing before
  startup completes also cancels that session.
- Herdr's `View.close` runs on layout switch, mod reload and normal quit, with
  a 250ms budget. Cleanup starts immediately via `exec`, bypassing pending work.
  The guardian additionally expires after 20s without a poll/control heartbeat
  (app crash, forced quit, cancelled tasks). Playback can therefore stop if the
  app stalls/sleeps for 20s; explicit Play recovers without recreating the View,
  and playback never resumes automatically. A guardian forcibly killed by the OS cannot promise
  cleanup. Tiny temp cancellation markers remain for OS temp cleanup, preventing
  delayed launches from reviving a closed owner; socket/lease/PID are removed.
- Windows uses a detached guardian and owns `mpv.exe` directly (the console
  wrapper `mpv.com` would launch a different pipe-server PID). Connect/read/write
  have a shared 2s deadline using overlapped I/O; cancellation is reaped before
  releasing buffers. Byte fragments (including split UTF-8) are reassembled.
  Requests are capped at 32 commands / 1 MiB and replies at 8 MiB. All JSON helper
  stdout/stderr explicitly uses UTF-8, including Python 3.12 redirected output.
- Native Actions tests exercise the Python/JS adapters with real Windows mpv, not
  live Windows Herdr. Herdr exec Job Object inheritance and live app quit/layout
  teardown are untested: DETACHED_PROCESS changes console association, not Job
  Object membership. No forced breakaway from host jobs is attempted. The same
  explicit close marker and lease govern tested cleanup; host job termination
  may impose additional behavior. No audible/live-network test is included.

## Checks

```sh
node mods/cyberneon-radio/ipc.check.mjs
python3 -B mods/cyberneon-radio/receiver.check.py # requires mpv; generated silence
node mods/cyberneon-radio/recovery.integration.mjs # requires mpv; generated silence
herdr-app check mods/cyberneon-radio
node mods/cyberneon-radio/tuner.check.mjs
node mods/cyberneon-radio/ui.check.mjs
node mods/cyberneon-radio/render.check.mjs
node mods/cyberneon-radio/tuner.integration.mjs # actual station adapter + mpv; silence
```

The JS check covers JSON escaping, controls, metadata, no-mpv no-op behavior,
single startup, serialization, receiver loss versus ordinary command errors,
and final-close cancellation during retirement/startup of replacement generations.
The Python integration check
drives real mpv IPC with a temporary silent WAV, verifies pause/volume/mute/title,
repeated play/stop with the same PID, cleanup, close-before-start cancellation,
and heartbeat expiry. The JS integration check runs the actual engine and bridge
against real mpv: expiry detected by poll, expiry first detected by explicit Play,
no automatic resume, fresh tokens/PIDs, preserved settings, ordinary command errors
retaining their receiver, and close cancelling a delayed replacement launcher.
Both remove their own temp sessions. Host lifecycle triggers
use the same `View.close` hook; the integration check calls bridge close directly
and does not quit/switch the person's running Herdr window.

Protocol reference: [mpv JSON IPC and properties](https://mpv.io/manual/stable/#json-ipc).

## Station list and source API (#8)

`station-storage.js` exports `localStations()`. It binds to **`${appHome()}/radio.json`**
(the Herdr config folder, including `HERDR_APP_HOME` overrides), never the active
space or a remote machine. Reading never creates or overwrites config: missing means
`[]`. Explicit directory Add (#9) can create/append it; see [SEARCH.md](SEARCH.md).
No stations or media ship. `radio.example.json` is an **inactive example**
pointing only to `~/Music`; copy/edit it as `radio.json` in your own config folder
if desired. The list is a JSON array, for example:

```json
[{ "name": "My music", "url": "~/Music", "genre": "My collection", "note": "My files", "explicit": true }]
```

The layout-owned UI consumes this API:

```js
import { localStations } from "./station-storage.js";
const stations = localStations(); // independent data object; starts no process
const unsubscribe = stations.subscribe(snapshot => { /* notify owner */ });
await stations.refresh(); // call at init and every 2s, including while hidden
stations.snapshot(); // {stations, loading, error, path}; detached copy
// Only on an explicit Play/tune action; catch errors and display in UI:
const prepared = await stations.prepare(stations.snapshot().stations[0]);
await engine.play(prepared.source); // uses the existing layout-owned engine
unsubscribe(); // owner close hook; also start engine.close immediately as above
```

- `subscribe(fn)` returns an unsubscribe function; notifications include a detached
  snapshot, on loading and completion (no immediate initial callback). There is no
  internal timer, watch loop or receiver. `refresh()` coalesces concurrent calls,
  always reads the current file and resolves to a snapshot. It never plays anything.
  Invalid JSON/schema/read errors retain the last good list and set `error`; fixing
  the file clears it. Deleting the file clears the list. `loading` becomes true
  when refresh work starts and false on completion. The owner should ignore late
  callbacks after disposal and unsubscribe before closing.
- `stations` entries retain `{name,url,genre?,note?,explicit}` and other extension
  fields. `explicit` defaults to false. The derived `contentWarning` is exactly
  `"Explicit content"` for true, otherwise null. **The UI must display this warning
  with the station before playback and with the selected station**; it must not
  infer content rating from the current track. Original note/genre remain available.
- `prepare(station)` validates that supplied station, resolves its source afresh and
  returns `{station, source}` with normalized warning metadata. It does not require
  membership in the saved list, so #9 can prepare a newly added/search result. It
  never starts playback, saves edits, changes selection, or mutates a snapshot.
  It **rejects** (throws Error) on unsupported/missing/empty/cyclic sources and
  browser-only stations. The UI must catch this for its error readout. `refresh`
  errors instead appear in its snapshot. Loading here refers to config refresh,
  not source preparation or engine decoding; the UI owns its Play pending state.
- `StationStore` and `parseStations` in `stations.js` have no Herdr imports. The
  adapter contract is `{path, read(): Promise<string>, resolve(url): Promise<string|string[]>}`.
  The optional `save(station)` adapter supports explicit Add operations; the
  owner's `store.save(station)` refreshes after persistence without tuning.
  Optional `{name,open:"https://…"}` entries are preserved
  for #11; `prepare` rejects them so they cannot accidentally reach mpv. #11 owns
  browser launching. No browser is opened by this module.

Source handling is local Python stdlib via argument arrays, using the engine's
existing python3 dependency. Sources support direct `http`, `https`, `icy`, `rtsp`,
`rtmp`, `rtmps` URLs; absolute paths, config-relative paths, `~/` and local `file://`
URLs. Local audio extensions: mp3, flac, wav, ogg, opus, m4a, aac, aiff/aif, alac,
wma, ape, webm, mka (actual decoding depends on mpv). Folders expand recursively in
name order, audio files only; symlink children and non-audio files are skipped.
A directly selected symlink to an audio file/folder resolves normally.
Local `.m3u`/`.m3u8` support UTF-8/BOM, comments and relative entries; `.pls` uses
`[playlist]` and numerical `FileN` ordering. Nested local playlists are flattened;
paths in them are relative to that playlist. Duplicates/order are preserved.
Empty folders/playlists fail, and one bad entry rejects the whole preparation.
No playlist titles override station metadata or the engine's now-playing title.

Remote playlist URLs are passed to mpv, which owns fetching/format support; this
module performs **no network requests** or remote playlist expansion. Known
YouTube, SoundCloud, Poolsuite, SomaFM, Spotify and Apple Music hosts (including
subdomains) are rejected for in-app playback, including local playlist entries.
This is a source guard, not a network sandbox: redirects/contents of remote
playlists are not inspected. #11 owns browser-only presentation and policy.
No provider, endpoint or music is preconfigured in the shipped list or example.

Bounds: radio.json and each local playlist at most 1 MiB UTF-8; at most 1000
stations/tracks, 5000 visited source entries, 5000 children per folder, nesting 16.
Errors are surfaced instead of silent truncation. Local helper timeout is 5s.
Windows drive paths and local drive file URLs are supported; UNC/device paths
and drive-relative paths are rejected. Use forward slashes or escape backslashes
in JSON. Windows junction children are skipped along with symlinks. Invalid
protocols and control characters cannot reach engine commands.

### Ordered engine queues

`engine.play(string)` remains compatible. `engine.play(string[])` copies and
validates **all 1..1000 items before any receiver startup**. One serialized Play
sends `loadfile(first, replace)` followed by `loadfile(item, append)` in array
order and restores current volume/mute settings. Commands are sent in batches of
at most 32, each fully acknowledged before the next, so the helper's write-before-
read exchange cannot fill both Unix socket buffers with a large queue. All batches
stay in one serialized Play; controls and other Plays wait until it finishes.
Close bypasses that job immediately and prevents further batches. Receiver loss
between batches retries the full requested queue once, beginning with replace on
the new receiver. A new Play replaces the entire
old queue; mpv advances naturally, with no repeat or shuffle enabled here.
`snapshot().source` is the first requested item (not the current queue position),
while `title` follows current mpv ICY/media metadata on poll. Pause/resume, stop,
receiver recovery and close retain the #7 lifecycle; a recovered explicit Play
reloads only its newly requested queue, without resuming a stale queue. IPC load
acknowledgments still mean loading, not verified decoding. A receiver error can
leave a partially loaded queue; it surfaces via the existing engine error state.

Additional checks (scratch config only, no user's config/network/media touched):

```sh
node mods/cyberneon-radio/stations.check.mjs
```

This covers refresh/coalescing/subscriptions, malformed edit recovery, detached
snapshots, explicit metadata, missing config, safe path escaping, folder ordering,
local M3U/PLS/nested playlists, cycles, bounds, restricted and unsupported sources.
`ipc.check.mjs` additionally verifies array validation/copy/command ordering;
`recovery.integration.mjs` verifies real mpv queue order, advancing and replacement
with generated silence before its existing receiver lifecycle checks.

### Large queue regression (#15 review)

```sh
node mods/cyberneon-radio/queue.integration.mjs
```

This drives the real engine, Python helper, guardian and mpv with 500 then 1000
tracks (1000 repeated), using ordered symlinks to generated silence. It asserts
exact playlist order/count and receiver reuse, then checks queued controls/Play
replacement and close after a real middle batch acknowledgment (no subsequent
batches or queued playback). Before batching, 500-track Play fails with `timed out`;
with acknowledgment batches the full 1000-track contract is retained. The IPC
check also gates a middle batch to verify serialization, immediate close while a
request is pending, and full-queue replacement recovery after midqueue receiver
loss. No receiver timeout or source count limit was raised or lowered.

## Browser handoff (#11)

The layout owner now supplies `localBrowser()` from `browser-host.js` as Tuner's
optional third argument. Browser entries are intercepted by `Tuner.play` before
`StationStore.prepare`; direct prepare calls continue to reject them. The existing
final `beforePlay` hook still gates explicit warnings and dismissed actions before
any stop/open effect. A handoff stops the local queue, retains the receiver for
reuse, and never forwards that URL to mpv. Browser state/error presentation and
policy evidence are documented in [UI.md](UI.md) and [BROWSER.md](BROWSER.md).
The engine, queue batching, recovery and final-close lifecycle above are unchanged.

## Attention gain (#12)

The optional tuner `DUCK ON/OFF` setting and host transition/timing policy are
specified in [UI.md](UI.md#attention-ducking-12). `ducking.js` is a separate gain
controller. `engine.setVolumePolicy({value, reset})` installs the one owner's
synchronous gain policy: `value()` resolves the current effective level inside
serialized volume writes and explicit Play; `reset()` invalidates temporary gain
on acknowledged stop, definite receiver loss and EOF before replay. This hook
performs no IPC and changes no receiver allocation/cleanup behavior. Ducking close
detaches it before receiver cleanup. Successful volume acknowledgment clears its
control error; unconfirmed targets remain pending in the gain controller with
capped retry backoff. Source preparation and browser validity gates are unchanged.
Run `ducking.check.mjs`, `ducking-lifecycle.check.mjs` and
`ducking.integration.mjs` in addition to the tuner/View/native checks.


## Windows regression checks (#21)

`.github/workflows/radio-platforms.yml` runs Python 3.12.10 on Windows Server 2022
and Linux with real mpv, generated silence and scratch station/session files only.
The Windows mpv test dependency is the first-party v0.41.0 release, pinned by
asset URL and SHA-256 (not a rolling nightly). The
runner-only python3 executable fixture does not change user installations.
`windows-storage.check.py` executes the actual read/resolve CLI with an import
blocker for fcntl (red on the old code), plus native Windows drive/file URLs.
`windows-transport.check.py` tests real Win32 partial UTF-8 replies, bounded stalled
reads/writes, server PID rejection and private-directory ACL validation.
`search.check.mjs` covers concurrent Add, duplicates, manual edits, overflow and
cleanup; `tuner.integration.mjs` exercises the actual station adapter through
Python with a Unicode config root/media, warning gates, Search/Add and ducking.
`recovery.integration.mjs` checks UTF-8 mpv titles, queue advance, receiver reuse,
lease expiry and explicit recovery. `queue.integration.mjs` uses test hard links
for 500/1000 tracks on both platforms. Browser dispatch tests intercept
`os.startfile(url, "open")` so no real browser launches.

Primary implementation references:
[mpv JSON IPC](https://mpv.io/manual/stable/#json-ipc),
[mpv Windows pipe access control](https://github.com/mpv-player/mpv/blob/master/input/ipc-win.c),
[Python msvcrt byte locking](https://docs.python.org/3.12/library/msvcrt.html),
[Python os.startfile](https://docs.python.org/3.12/library/os.html#os.startfile),
[Microsoft named-pipe clients](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-client),
[overlapped completion](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-getoverlappedresult).

Storage uses a stable sidecar lock, Windows nonblocking retries bounded to 3s
(inside the 5s helper budget), fsync + atomic replacement, and a final comparison
against current config bytes. The lock file intentionally remains so parallel
processes always lock the same object. Arbitrary editors do not participate in
that lock; edits observed before replacement reject Add safely. As before, an
external write racing after the final comparison cannot be made transactional.
