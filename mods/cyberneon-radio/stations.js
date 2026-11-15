// Pure station contract; no UI, filesystem, network or receiver ownership.
export const CONTENT_WARNING = "Explicit content";
export const MAX_STATIONS = 1000;

export function stationMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a station object");
  const station = { ...value };
  for (const field of ["name", "url", "open", "genre", "note"]) {
    if (station[field] === undefined && field !== "name") continue;
    if (typeof station[field] !== "string" || !station[field].trim() || /[\x00-\x1f\x7f]/.test(station[field])) {
      throw new Error(`Station ${field} must be nonempty text without control characters`);
    }
    station[field] = station[field].trim();
  }
  if (!station.url && !station.open) throw new Error("Station needs a url (or browser-only open URL)");
  if (station.explicit !== undefined && typeof station.explicit !== "boolean") throw new Error("Station explicit must be boolean");
  station.explicit = station.explicit === true;
  station.contentWarning = station.explicit ? CONTENT_WARNING : null;
  return station;
}

export function parseStations(text) {
  const values = JSON.parse(text);
  if (!Array.isArray(values)) throw new Error("radio.json must contain an array of stations");
  if (values.length > MAX_STATIONS) throw new Error(`radio.json allows at most ${MAX_STATIONS} stations`);
  return values.map((value, i) => {
    try { return stationMetadata(value); }
    catch (error) { throw new Error(`Station ${i + 1}: ${error.message}`); }
  });
}

const copy = (value) => JSON.parse(JSON.stringify(value));

// Adapter: {path, read(): Promise<string>, resolve(url): Promise<string|string[]>}.
// A missing file is read as "[]" by the adapter. Bad edits retain the last good list.
export class StationStore {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = { stations: [], loading: false, error: null, path: adapter.path };
    this.listeners = new Set();
    this.pending = null;
    this.revision = 0;
    this.supersedeRefresh = null;
  }
  snapshot() { return copy(this.state); }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish() {
    for (const listener of this.listeners) {
      try { listener(this.snapshot()); } catch { /* One observer cannot block others. */ }
    }
  }
  refresh({ fresh = false, wait = promise => promise } = {}) {
    if (this.pending && !fresh) return this.pending;
    const revision = ++this.revision;
    const supersedePrevious = this.supersedeRefresh;
    const superseded = new Promise(resolve => { this.supersedeRefresh = resolve; });
    // Defer the work so pending is installed before subscribers can refresh again.
    const work = Promise.resolve().then(async () => {
      if (revision !== this.revision) return this.snapshot();
      this.state.loading = true;
      this.publish();
      try {
        const stations = parseStations(await wait(this.adapter.read()));
        if (revision === this.revision) this.state = { ...this.state, stations, error: null };
      } catch (error) {
        if (revision === this.revision) this.state.error = String(error.message ?? error);
      }
      finally {
        if (revision === this.revision) {
          this.state.loading = false;
          this.pending = null;
          this.supersedeRefresh = null;
          this.publish();
        }
      }
      return this.snapshot();
    });
    this.pending = Promise.race([work, superseded]);
    // Coalesced callers (including the owner's refresh task) follow the fresh
    // read too; they must not remain suspended on the superseded helper.
    if (supersedePrevious) supersedePrevious(this.pending);
    return this.pending;
  }
  async prepare(value) {
    const station = stationMetadata(value);
    if (station.open) throw new Error("Browser-only station: open in your browser");
    const source = await this.adapter.resolve(station.url);
    return { station, source };
  }
  async save(value, wait = promise => promise) {
    const station = stationMetadata(value);
    if (!this.adapter.save) throw new Error("Station storage is read-only");
    // The adapter appends against the current disk contents, never this snapshot.
    await wait(this.adapter.save(station));
    // Only a read started after persistence can confirm this Add. Never wait on
    // an older refresh: it may be stalled or contain a pre-save snapshot.
    const snapshot = await this.refresh({ fresh: true, wait });
    if (snapshot.error) throw new Error(`Cannot confirm saved station: ${snapshot.error}`);
    const source = station.open || station.url;
    if (!snapshot.stations.some(s => (s.open || s.url) === source ||
      (station.radioBrowserId && s.radioBrowserId === station.radioBrowserId))) {
      throw new Error("Station missing after save; retry Add");
    }
    return snapshot;
  }
  async remove(value) {
    const station = stationMetadata(value);
    if (!this.adapter.remove) throw new Error("Station storage is read-only");
    const source = station.open || station.url;
    // Removes by source under the adapter's lock; other entries stay untouched.
    await this.adapter.remove(source);
    const snapshot = await this.refresh({ fresh: true });
    if (snapshot.error) throw new Error(`Cannot confirm removed station: ${snapshot.error}`);
    if (snapshot.stations.some(s => (s.open || s.url) === source)) throw new Error("Station still listed after remove; retry");
    return snapshot;
  }
}
