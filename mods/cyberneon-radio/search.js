import { stationMetadata } from "./stations.js";
import { browserURL } from "./browser.js";

export const SEARCH_TAGS = ["synthwave", "lofi", "cyberpunk", "ambient"];
const text = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim() : "";
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;

// A stream on a port other than 80/443, e.g. "448". Firewalls often drop these
// (seen live), so search flags them and ranks them after standard-port streams.
export function oddPort(url) {
  try { const port = new URL(url).port; return port && port !== "80" && port !== "443" ? port : null; }
  catch { return null; }
}

export function directoryStation(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid directory station");
  const url = text(value.url_resolved) || text(value.url);
  // Directory records cannot inject local files or mpv protocols into saved sources.
  if (!/^https?:\/\/[^\s/]+(?:[/?#]|$)/i.test(url)) throw new Error("Directory station needs an HTTP(S) stream");
  const station = { name: text(value.name), url, explicit: false,
    radioBrowserId: text(value.stationuuid), country: text(value.country) || text(value.countrycode) || "Unknown country",
    codec: text(value.codec) || "Unknown codec", bitrate: number(value.bitrate),
    lastCheckOK: value.lastcheckok === 1 ? true : value.lastcheckok === 0 ? false : null,
    lastCheck: text(value.lastchecktime_iso8601) || text(value.lastchecktime) || "Unknown time" };
  const genre = text(value.tags);
  if (genre) station.genre = genre;
  // The station's own site; dropped unless it is a plain HTTP(S) URL a browser can open.
  try { station.homepage = browserURL(text(value.homepage)); } catch { /* No usable homepage. */ }
  return stationMetadata(station);
}

// Pure request state. The View supplies directory I/O and its existing station store.
export class RadioSearch {
  constructor(directory, store) {
    this.directory = directory;
    this.store = store;
    this.state = { tag: "", loading: false, results: [], error: null, saving: null, message: null };
    this.generation = 0;
    this.closed = false;
  }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  async search(tag) {
    const generation = ++this.generation;
    this.state = { ...this.state, tag, loading: true, results: [], error: null, message: null };
    try {
      if (typeof tag !== "string" || !tag.trim() || tag.length > 80 || /[\x00-\x1f\x7f]/.test(tag)) throw new Error("Enter a tag of 1–80 characters");
      const rows = await this.directory.search(tag.trim());
      if (!Array.isArray(rows)) throw new Error("Invalid Radio Browser response");
      const results = [];
      for (const row of rows.slice(0, 50)) {
        try { results.push(directoryStation(row)); } catch { /* Ignore malformed directory records. */ }
      }
      // Directory order is most played first; keep it, but put streams that passed
      // their last check on a standard port ahead of the rest (sort is stable).
      const rank = s => s.lastCheckOK === true && !oddPort(s.url) ? 0 : 1;
      if (generation === this.generation) this.state.results = results.sort((a, b) => rank(a) - rank(b));
    } catch (error) {
      if (generation === this.generation) this.state.error = String(error.message ?? error);
    } finally { if (generation === this.generation) this.state.loading = false; }
    return this.snapshot();
  }
  async add(station, wait) {
    if (this.closed || this.state.saving) return this.snapshot();
    this.state.saving = station.url;
    this.state.error = null;
    this.state.message = null;
    try {
      await this.store.save(station, wait);
      if (!this.closed) this.state.message = `Saved ${station.name}`;
    } catch (error) { if (!this.closed) this.state.error = String(error.message ?? error); }
    finally { if (!this.closed) this.state.saving = null; }
    return this.snapshot();
  }
  close() { this.closed = true; ++this.generation; this.state.saving = null; }
}
