# cyberneon-radio — playback core (#7)

No stations or music ship in M2. No source is loaded at startup. The station
list (#8) and controls (#10) extend this mod; this PR does not change the layout.
`main.js` is a minimal layout-owned View with an idle/error/title readout, no
buttons. `mod.json` uses `place: none`, so installing it alone starts nothing.

## Reusable interface

`engine.js` exports `RadioEngine(bridge)` and `NO_RECEIVER`. The View creates
`this.engine` with `localReceiver()` from `bridge.js`. Future UI handlers call:

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
engine, not create another owner. Mods cannot import one another: #8/#10 should
add their files here. No shared-state RPC or arbitrary mpv command API is exposed.

## Local process and dependencies

- Requires local `mpv` and `python3` on Herdr's PATH, macOS or Linux. `mpv
  --version` is checked on first play. If absent, the readout is exactly
  `NO RECEIVER // install mpv`; no bridge/guardian/session is started.
- Herdr provides `exec`, but no Unix socket API. Python's stdlib bridge sends
  newline-delimited JSON to a private Unix socket. No `socat`, npm packages,
  shell interpolation, remote machine selection, TCP listener, or downloaded code.
- First play starts one guardian owning `mpv --no-video --idle
  --input-ipc-server=<socket>`. It adds `--no-config --load-scripts=no --ytdl=no
  --input-terminal=no --terminal=no` to isolate it from CLI scripts/config and
  external website extraction. Stop keeps mpv idle; later play reuses the PID
  while that receiver remains alive. A dead receiver is replaced only on Play.
- Direct URLs/files are passed as JSON strings, never shell commands. Caller
  decides which sources are allowed; restricted services remain browser-only
  in later issues. Playback requests contact only the caller-selected source.
- The owner has a random 128-bit session token and a mode-0700 `/tmp/cnr-<token>`
  directory per generation (short enough for macOS socket paths). A replacement
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
- Windows named pipes are not implemented. No audible/network validation of
  live radio streams is included; no sources are supplied in this foundation.

## Checks

```sh
node mods/cyberneon-radio/ipc.check.mjs
python3 -B mods/cyberneon-radio/receiver.check.py # requires mpv; generated silence
node mods/cyberneon-radio/recovery.integration.mjs # requires mpv; generated silence
herdr-app check mods/cyberneon-radio
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
space or a remote machine. No config file is created or overwritten: missing means
`[]`. No stations or media ship. `radio.example.json` is an **inactive example**
pointing only to `~/Music`; copy/edit it as `radio.json` in your own config folder
if desired. The list is a JSON array, for example:

```json
[{ "name": "My music", "url": "~/Music", "genre": "My collection", "note": "My files", "explicit": true }]
```

The UI owner (#10) consumes this API; #8 changes no View, layout or keys:

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
  Read-only storage is intentional; #9 can add explicit save operations without
  duplicating parsing. Optional `{name,open:"https://…"}` entries are preserved
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
Windows source handling is not implemented (matching the engine's macOS/Linux
scope). Invalid protocols and control characters cannot reach engine commands.

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
