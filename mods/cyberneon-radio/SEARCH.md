# Radio Browser search (#9)

Search runs only on an explicit tag search, using the free Radio Browser directory.
No directory lookup, station stream, station list or media is loaded at startup.
The suggested tags are synthwave, lofi, cyberpunk and ambient; custom tags are
limited to 80 characters. Results are limited to 50, with `hidebroken=true`,
`order=clickcount`, `reverse=true`. Directory availability and last-check reports
are not a guarantee that a station is playable now.

`radio-browser.py` uses the existing local Python dependency. Each search resolves
`all.api.radio-browser.info`, reverse-resolves addresses to directory hostnames,
randomizes the server order and tries at most two servers over HTTPS (5 seconds
per request, 1 MiB response limit, 18 second host command timeout including DNS).
Randomization is for server load balancing only. The User-Agent is the generic
`Cyber-Neon-Radio/0.5`, with no username, email, config path or machine details.
Only the requested tag and ordinary connection metadata reach the directory.
No station URL, homepage or favicon is fetched by search or Add.

Primary API references (checked 2026-11-13):

- [Server discovery, DNS round robin, failover and User-Agent](https://api.radio-browser.info/)
- [Search fields, ordering, hidebroken and station metadata](https://docs.radio-browser.info/)

The directory is not a permission or license grant. Each station's terms still
apply. No stations or media ship with this mod.

## Integration contract

`localDirectory()` in `search-client.js` supplies `search(tag)` to the pure
`RadioSearch(directory, store)` controller in `search.js`. The View uses its
existing `localStations()` owner as `store`. `snapshot()` is detached and contains
`{tag,loading,results,error,saving,message}`. Search starts immediately and clears
old results; completion from an older search cannot replace newer results.
`close()` invalidates pending search completions. The View owns notifications,
not a timer. It must ignore late async notifications after disposal.

Results normalize to the existing station schema, preferring `url_resolved` over
`url`. Only HTTP(S) directory sources are accepted; local paths and other schemes
are discarded. Results include country, codec, bitrate, last-check status/time,
and `radioBrowserId`. A missing country or codec is labeled unknown. Broken
records from a failed last check remain truthfully labeled if returned despite
the requested filter. Content rating is not inferred from tags or titles.

`await search.add(station)` calls **only** `store.save(station)`. It never selects,
prepares or plays a result. `StationStore.save(station)` validates the station,
awaits adapter persistence, waits for any active refresh, then reads and publishes
the latest config. Errors reject for callers to display; the search controller
turns these into its error readout. No second station store is created.

`localStations()` adds `adapter.save(station)` through `station-files.py save`.
The helper locks `radio.json.lock` to serialize app saves, reads the current file
under the lock, validates the full list, and appends. It never saves a stale UI
snapshot. Exact source URLs or matching nonempty Radio Browser IDs are duplicate
Adds and leave the existing entry/metadata intact. Unknown extension fields in
existing records survive. Derived `contentWarning` is computed on read, not saved.
If valid JSON contains a number that overflows Python's floating-point range
(for example an extension field `1e309`), Add rejects before writing and retains
the exact original bytes. It never emits nonstandard Infinity/NaN literals.

Malformed files, limits (1000 stations, 1 MiB UTF-8), and symlinked configs fail
without replacing the user's file. Writes use a temporary file in the same
folder, fsync and atomic replace, retaining existing permission bits. External
edits detected immediately before replacement reject with a retry message.
The advisory lock serializes app writers; arbitrary external editors do not take
it, so an edit in the final compare/replace window cannot be excluded. No local
filesystem API can promise a transaction with an uncooperative editor. A missing
file is created only by Add. Search, refresh and playback never create it.

## Checks

```sh
node mods/cyberneon-radio/search.check.mjs
python3 -B mods/cyberneon-radio/search.check.py
python3 -B mods/cyberneon-radio/storage.check.py
node mods/cyberneon-radio/stations.check.mjs
node mods/cyberneon-radio/search.render.check.mjs
node mods/cyberneon-radio/ui.check.mjs
node mods/cyberneon-radio/render.check.mjs
node mods/cyberneon-radio/tuner.integration.mjs
```

These use offline directory fixtures and temporary config folders: metadata,
invalid rows, failure/retry state, stale responses, idempotent Add, preserving
live edits, eight simultaneous writers, malformed files, bounds, DNS discovery,
generic headers/query parameters, server fallback, external edit during save,
temp cleanup, permission bits and symlink rejection. They never modify user
config or contact station streams. Native fixtures check eager builders for all
directory states, without changing the live app. View-handler checks execute the
actual Search/Add controls and shared Tuner/store wiring while off and on,
asserting no selection, prepare or playback side effect. `tuner.integration.mjs`
additionally uses the actual `localStations()` adapter and real engine/mpv with
generated silence in a scratch config: Add preserves a newer manual edit and
does not replace the playing queue or allocate a receiver. Eager native checks
do not verify pixels or pointer interaction; live screenshots/audible streams
are not tested.
