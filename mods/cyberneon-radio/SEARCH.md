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
`close()` invalidates pending search/Add completions. The View starts I/O inside
`cx.spawn` and owns notifications. Add uses one-shot owner timers (6s per save or
confirmation read, alongside the helper's 5s exec timeout), with no redraw polling.
Completion or close cancels the timers; late completions cannot notify a closed
owner. A timeout displays an error and enables retry; a helper that completes
after timeout may still have saved, so retry rechecks disk through idempotent Add.

Results normalize to the existing station schema, preferring `url_resolved` over
`url`. Only HTTP(S) directory sources are accepted; local paths and other schemes
are discarded. Results include country, codec, bitrate, last-check status/time,
and `radioBrowserId`. A missing country or codec is labeled unknown. Broken
records from a failed last check remain truthfully labeled if returned despite
the requested filter. Content rating is not inferred from tags or titles.

`await search.add(station, wait?)` calls **only** `store.save(station, wait?)`. It never selects,
prepares or plays a result. `StationStore.save(station)` validates the station,
awaits adapter persistence, then starts a fresh confirmation read. It supersedes
any older refresh without waiting for its helper. Existing coalesced refresh
callers follow the fresh read, and revision guards prevent late old reads/errors
from replacing it. Ordinary refresh calls still coalesce. Add confirms membership
in the refreshed list; a read error or missing station rejects instead of claiming
success. The optional `wait(promise)` bounds each adapter operation using the
current task's owner timer. Errors reject for callers to display; the search controller
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
folder, fsync and atomic replace, retaining existing POSIX permission bits. On
Windows, the replacement inherits the config folder's ACL; bounded nonblocking
byte locking serializes Adds, and brief replacement-sharing conflicts retry
within the helper timeout while rechecking current bytes. External
edits detected immediately before replacement reject with a retry message.
The advisory lock serializes app writers; arbitrary external editors do not take
it, so an edit in the final compare/replace window cannot be excluded. No local
filesystem API can promise a transaction with an uncooperative editor. A missing
file is created only by Add. Search, refresh and playback never create it.

## Checks

```sh
node mods/cyberneon-radio/search.check.mjs
node mods/cyberneon-radio/add.check.mjs
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

`add.check.mjs` invokes actual DirectoryPanel controls, RadioSearch, StationStore,
localStations and Python against scratch config. It asserts rendered SAVED after
persistence, retaining manual edits and selection/playback, superseded refresh
callers resuming, late-read protection, visible errors/deadlines/retry, pending Add
coalescing and close cancellation. It includes real POSIX lock contention with
the production exec timeout. Native builders, exec and timers have Node shims;
never-settling reads/save promises and startup errors are deliberately injected.
The pre-fix regression persists successfully but stays SAVING when an earlier
refresh never settles. This demonstrates the unbounded dependency, not why the
reporting macOS host's promise stalled. An isolated native check with deferred
sleep/exec did not run its completion sentinel; `herdr-app check` cannot establish
native async correctness. The reporting installation still needs a live retest.
