# Radio tuner (#10)

The `RADIO OFF` / playing station chip occupies the right end of the right work
area's **28px bottom status bar**. `status` is a row: the original status readout
and one fixed-width `radio` block. No radio UI is placed in the sidebar footer.
The footer's existing `ANIM ON/OFF` switch controls radio motion too.

## Owner and API contract

`main.js` owns one `RadioEngine(localReceiver())` and one `localStations()` store
in that layout block. Its native `Popover` renders the chip and tuner content
inside the same View. Closing the tuner, changing tabs/spaces, or hiding a block
does not destroy playback. Layout removal/switch, mod reload and normal quit call
`close()`: it marks the `Tuner` closed and starts `engine.close()` directly,
bypassing queued controls and pending source preparation. A pending prepare
cannot revive a closed owner.

The View calls the #8 store's `refresh()` at init and every 2 seconds, even while
hidden; the engine's `poll()` runs every 5 seconds while started, also hidden.
Refreshes coalesce. Store snapshots provide `{stations, loading, error, path}`;
station objects can be fresh copies each time. Navigation compares name/source
keys, never object identity. The View notifies before/after its own refresh task
using that task's context; it does not retain a host context in `subscribe()`.
Station parsing, validation, file reads, folders and playlists belong to #8.

`tuner.js` exports `Tuner(engine, store)`, a small UI controller with:

- `station()` / `stations()` / `key(station)` for selection and rendering.
- `choose(station)`, `step(1|-1)`, `power()`, `mute()`, `volume(0..100)` for
  explicit actions; these return promises and serialize through one queue.
- `playing` for the station whose load the engine acknowledged; `error` and
  `pending` for the readout; `level` / `silenced` for volume/mute preferences.
- `close()` to prevent pending or later UI work from playing anything. The View
  closes the engine itself, immediately after this call.

Only an explicit power-on or tuning action calls `store.prepare(station)`.
Its `{station, source}` result is passed to `engine.play(source)` unchanged:
`source` may be a direct string or an ordered array from a local folder/playlist.
The controller accepts the load only when the engine reports `loading` for the
requested first source. A failed prepare/load does not relabel an old playing
source. No source is resolved or played on init, refresh or tuner open.

## Controls and states

- Off: select or previous/next only browses. PLAY resolves and plays the selection.
- On: select or previous/next tunes immediately. OFF unloads playback and keeps
  the receiver available for a later explicit PLAY.
- Volume is a native slider; changes display immediately and commit to the
  engine on release. Mute and volume can be chosen before first play without
  starting a receiver; the controller applies these preferences after a load.
- The selected station's genre/note and `Explicit content` warning are shown.
  A playing station removed from the config keeps its chip name, ON AIR line
  and explicit warning until stopped or successfully replaced.
- Empty/loading lists have explicit readouts. Store/prepare/engine errors appear
  in the tuner, including `NO RECEIVER // install mpv`. The store retains its last
  good list on malformed JSON. Browser-only entries surface prepare's error;
  browser opening is owned by #11.
- Receiver expiry and recovery follow the reviewed engine: no automatic restart
  or resume. A later explicit PLAY retries; poll and volume/mute never restart.

`keys.json` binds these only under `layout:Cyber-Neon`:

| Key | Action |
| --- | --- |
| Ctrl-Shift-Right | Next station |
| Ctrl-Shift-Left | Previous station |
| Ctrl-Shift-M | Mute / unmute |

Long now-playing titles scroll natively in a clipped line (with the complete
title in its tooltip). Each tune shows 420ms of generated glyph interference
on the dial. This is visual static only: no audio is generated or bundled. Both
motion effects are removed from the description while ANIM OFF; track polling
and playback continue. One timer ends a tune effect; no frame-by-frame JS timer
animates anything. All labels/visuals are original; no stations/music ship.

## Checks and limits

```sh
node mods/cyberneon-radio/tuner.check.mjs
node mods/cyberneon-radio/ui.check.mjs
node mods/cyberneon-radio/render.check.mjs
herdr-app check mods/cyberneon-radio
node mods/cyberneon-radio/tuner.integration.mjs
```

The controller checks cover empty/off/playing states, copied snapshots, queue
forwarding, controls, last playing station identity, prepare errors and close
while preparing. View-description checks invoke handlers and verify placement,
layout keys, explicit warnings and both motion paths with ANIM ON/OFF.
`render.check.mjs` validates actual native builders in isolated temporary
empty/loading/playing/error fixture mods. It never reads user config, loads
media or changes the live app layout. `herdr-app check` validates eager builders;
it does not lay out pixels or exercise pointer drags. Live screenshot/pointer
and audible stream checks are not performed. Engine/station integration checks
are documented in NOTES.md; their media is generated silence in temporary files.
`tuner.integration.mjs` exercises the actual `localStations()` adapter against a
scratch radio.json and local files, through `Tuner` and the real engine/mpv. It
checks ordered folder queues, single-file replacement, mute/volume, malformed
edits, browser-only errors and receiver reuse without reading user config.

## Follow-on UI seams

The `panel()` method owns the tuner content; its station list/footer area is the
extension point for #9 search/add controls. `this.store` is the existing store;
`this.tuner.choose(station)` is an explicit selection/tune action. Saving or
refreshing the list should never call choose/play by itself.

#11 can extend `Tuner.play(station)` inside the existing serialized UI queue with
an injected browser opener, while preserving the one layout owner. Browser-open
state should be separate from `playing` and `engine.snapshot().source`: the RADIO
chip is the receiver's actual state, and a browser page cannot report its live
playback/track state through this engine. Stop the receiver before a browser
handoff and clear browser-open state on a subsequent in-app play or power-off.
