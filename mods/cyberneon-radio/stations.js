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
  refresh() {
    if (this.pending) return this.pending;
    // Defer the work so pending is installed before subscribers can refresh again.
    this.pending = Promise.resolve().then(async () => {
      this.state.loading = true;
      this.publish();
      try {
        const stations = parseStations(await this.adapter.read());
        this.state = { ...this.state, stations, error: null };
      } catch (error) { this.state.error = String(error.message ?? error); }
      finally {
        this.state.loading = false;
        this.pending = null;
        this.publish();
      }
      return this.snapshot();
    });
    return this.pending;
  }
  async prepare(value) {
    const station = stationMetadata(value);
    if (station.open) throw new Error("Browser-only station: open in your browser");
    const source = await this.adapter.resolve(station.url);
    return { station, source };
  }
  async save(value) {
    const station = stationMetadata(value);
    if (!this.adapter.save) throw new Error("Station storage is read-only");
    // The adapter appends against the current disk contents, never this snapshot.
    await this.adapter.save(station);
    if (this.pending) await this.pending;
    return this.refresh();
  }
}
