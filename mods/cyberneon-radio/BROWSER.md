# Browser-only radio sources (#11)

No station list, media, service credentials or restricted source is configured by
this mod. A user can add `{ "name": "My browser station", "open": "https://example.invalid/" }`
to their own `radio.json`. `open` takes precedence over `url` when both are present;
it must never fall back to mpv. `StationStore.prepare` continues to reject browser
entries, including calls outside the tuner.

`browser.js` validates absolute HTTP(S) URLs (no credentials, control characters,
spaces or backslashes) and exposes `browserOpener({exec, platform})`. The host
adapter `localBrowser()` in `browser-host.js` injects Herdr's local `exec` and
window platform. macOS uses `open`, Linux uses `xdg-open`, with one URL argument,
no shell, a 5s timeout and checked exit status. Windows is unsupported, matching
the receiver's scope. No source requests or extraction happen in this helper.
Successful handoff only means the operating system accepted the request; browser
playback, track titles and browser tab lifetime are outside this mod's control.

The layout owner injects this opener into `Tuner(engine, store, openBrowser)`.
Explicit power/choose/step actions still use its serialized queue. The browser
branch validates normalized station metadata and awaits the existing final
`beforePlay(station)` hook before stopping local audio or launching the browser.
Dismissed actions and pending explicit warnings therefore cancel the handoff.
Stop failure aborts it; launch failure leaves the receiver off and sets
`tuner.error`, with no playback fallback. Successful handoff stores the station
in `browserOpened`, clears `playing`, and leaves engine source empty. Closing
while stop is pending prevents launch; closing after an opener request has been
sent cannot retract that operating-system request, but cannot revive UI state.

Off-state selection/next/previous only browse. OPEN launches the selected browser
station; CLEAR removes the acknowledged handoff notice without controlling any
external page. Selection, in-app play, power-off and close also clear the notice.
The receiver chip remains OFF, with a browser destination in its tooltip and
EXPLICIT when applicable. No receiver is allocated for an off-state browser
request, including when mpv is not installed. An existing receiver is stopped and
kept for later reuse. Ownership, hidden heartbeat and final cleanup are unchanged.

## Source policy evidence

Checked 2026-11-13 against the following primary sources. These findings explain
the shipped browser-only policy; they do not confer permissions on this project.

- **YouTube:** [YouTube API Services Developer Policies, III.I.7–9](https://developers.google.com/youtube/terms/developer-policies#additional-prohibitions)
  prohibit splitting audiovisual components, separately promoting those components,
  and playback in a player hidden from the current page/tab/screen. This mod opens
  YouTube in the browser; it has no yt-dlp, audio extraction or hidden player.
  The existing receiver starts mpv with `--ytdl=no` and the source resolver rejects
  known YouTube domains for in-app playback.
- **SoundCloud:** [API Terms, Content and Privacy / User Content](https://developers.soundcloud.com/docs/api/terms-of-use#user-content)
  prohibit webcasting radio apps and restrict alternative listening services that
  aggregate content across users or services (the latter has an explicit-license
  qualification). A publicly accessible track does not grant this project those
  rights. SoundCloud stays browser-only.
- **Poolsuite:** the [official site](https://poolsuite.net/) and its
  [published application bundle](https://poolsuite.net/js/index.5497143f.js)
  reference SoundCloud playlists. This establishes the integration, **not** its
  private licensing terms. No first-party evidence of a transferable arrangement
  was found. We do not reuse its API IDs, stream URLs or playlists; users may open
  its own site in the browser. A private arrangement held by another app would
  not establish this project's permission.
- **SomaFM:** [Terms of Service, Important Message about Third-Party usage](https://somafm.com/contact/tos.html)
  (updated September 4, 2026) says it cannot authorize new third-party clients,
  including noncommercial clients, under its music licenses. Existing longstanding
  exceptions do not extend to new applications. It appears in no example list;
  its known domains remain rejected for in-app playback.
- **One More Lawn:** the [developer's Steam page](https://store.steampowered.com/app/5378110/One_More_Lawn/)
  links [Superdou's YouTube channel](https://www.youtube.com/@Superdoudev).
  Its [Playlists page](https://www.youtube.com/@Superdoudev/playlists) lists
  [One More Lawn - Full Radio (All Songs)](https://www.youtube.com/playlist?list=PLJ19oo9w4X5A).
  The playlist's own page title was independently checked. Steam's permission for
  streamers to use built-in radio in videos is not evidence of permission to
  distribute it through a separate radio app. No such permission is recorded here;
  keep it browser-only while the issue's permission request remains unresolved.
  No source-owner messages were sent in this work.

For a user who chooses that last source, this is an **inactive documentation
example**, never loaded by the mod or written into their config:

```json
{
  "name": "One More Lawn radio",
  "open": "https://www.youtube.com/playlist?list=PLJ19oo9w4X5A",
  "explicit": true,
  "note": "Developer's YouTube playlist; opens in browser"
}
```

The explicit content warning is retained in station metadata and displayed by
the tuner before handoff. Browser stations do not represent a live receiver or
an in-app track. The existing source-host guard is not a network sandbox: it
cannot inspect redirects or the content of remote playlists; no new guarantee
about those sources is made here.

## Checks

`node mods/cyberneon-radio/browser.check.mjs` verifies scheme/authority validation,
argument-array handoff on both platforms, unsupported platforms, nonzero exit
status and thrown/timeout failures using an injected opener. No real browser,
network media, user's station config or running app is changed by this check.

`node mods/cyberneon-radio/browser.native.check.mjs` loads the real host imports
and URL implementation in a temporary native fixture via `herdr-app check`.
It validates URL normalization/rejection and adapter construction without calling
the browser opener. This is not an end-to-end browser playback check.

`node mods/cyberneon-radio/browser-tuner.check.mjs` checks the actual controller
and station store with an injected opener: warning gates, off browsing, source
precedence, rejected URLs, stop/launch failures, serialization and close races.
`ui.check.mjs` additionally exercises keyboard handoff, native-warning layout,
dismissal generations and collapsed explicit markers using the actual View
handlers. `render.check.mjs` includes browser-opened/collapsed native fixtures.
`tuner.integration.mjs` stops a real mpv queue generated from silence before the
injected browser handoff and verifies the same receiver is reused on return.
