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
  The first three accept an optional final `beforePlay(station)` async hook,
  called with prepared metadata before an engine load; false cancels that load.
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
- Keyboard next/previous opens the normal tuner, including when browsing while
  off. Before explicit playback, the View's `beforePlay` hook presents the
  normalized station name and warning, then waits for the warning element's
  first native layout callback before loading. There is no confirmation dialog
  or second Play action. Dismissal before presentation cancels that pending tune;
  owner close also releases the wait without playing. This path works with ANIM
  OFF. The collapsed chip retains a fixed `EXPLICIT` marker beside the actual
  playing station and `Explicit content` in its tooltip, even after list removal.
  Each action captures the dismissal generation before preparation begins;
  dismiss/close invalidates it. The post-prepare hook checks that generation
  before reopening/presenting or loading, for both explicit and ordinary stations.
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
checks pre-load warning ordering, ordered folder queues, single-file replacement,
mute/volume, malformed edits, browser handoff/receiver reuse, and Search/Add
persistence without tuning or losing manual edits. It never reads user config.

## Directory search and Add (#9)

`panel()` renders `DirectoryPanel` beneath the station list/footer. Expand
**FIND A STATION**, choose synthwave/lofi/cyberpunk/ambient or enter another tag
and press Search. Each result shows name, country, codec/bitrate and last directory
check status/time. Add persists in one click and displays SAVED. Search/Add
errors and empty/loading states stay in that section for retry. The directory
is not a license grant; the station's terms apply.

`this.directory` uses the existing `this.store`; Search and Add never call
`this.tuner.choose`, prepare or play. No request runs on init, panel opening or
refresh. Closing the owner invalidates directory completions after receiver
cleanup has started. [SEARCH.md](SEARCH.md) documents API/storage behavior and
isolated native fixtures. The original status-bar placement is unchanged.

## Follow-on UI seams

Browser-only entries (#11) use `Tuner(engine, store, openBrowser)` and the same
serialized `play(station, beforePlay)` seam. The owner supplies `localBrowser()`;
the pure controller retains the optional final `beforePlay` hook for power,
choose and step. For browser stations it normalizes metadata, validates the URL,
awaits that hook (including action-generation cancellation/native warning layout),
then stops local playback before invoking the opener. A failed stop aborts the
handoff. Opener failures appear in `tuner.error`; there is no mpv fallback.

`browserOpened` is a normalized station representing an acknowledged handoff,
separate from `playing` and `engine.snapshot().source`. The chip stays OFF after
handoff; its tooltip names the browser destination, and the fixed EXPLICIT marker
remains for an explicit browser source. The panel says OPENED IN BROWSER without
claiming live playback or track metadata. CLEAR dismisses that notice, not the
browser tab. Selection, in-app play, power-off and close clear the notice. Browsing
while off never opens a browser; press OPEN for the selected browser station.
The existing layout owner, hidden polling and final receiver close are unchanged.
See [BROWSER.md](BROWSER.md) for helper checks and primary-source policy evidence.
Preserve the optional `beforePlay` hook for in-app loads when extending this
method; it belongs to the current action's async View context, not a stored one.
