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
