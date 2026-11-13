// Native eager rendering, offline fixtures and scratch appHome only.
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = await mkdtemp(join(tmpdir(), "radio-search-render-"));
try {
  const mod = join(root, "mods", "cyberneon-radio");
  await cp(fileURLToPath(new URL(".", import.meta.url)), mod, { recursive: true });
  execFileSync("herdr-app", ["check", mod], { env: { ...process.env, HERDR_APP_HOME: root }, stdio: "inherit" });
  await writeFile(join(mod, "main.js"), `
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";
import { DirectoryPanel } from "./search-ui.js";
export default class Check extends View {
  init() {
    const row = {name:"Fixture Radio", url:"https://example.invalid/live", country:"Taiwan", codec:"MP3", bitrate:128, lastCheckOK:true, lastCheck:"2026-11-13T00:00:00Z"};
    const fixtures = [
      {}, {loading:true,tag:"ambient"}, {tag:"lofi",results:[]},
      {error:"Radio Browser unavailable; retry Search"},
      {results:[row]}, {results:[row],saving:row.url},
      {results:[{...row,lastCheckOK:false}]}, {results:[{...row,lastCheckOK:null}]}, {results:[row],message:"Saved Fixture Radio",saved:true}
    ];
    this.panels = fixtures.map((state, i) => {
      const panel = new DirectoryPanel({snapshot:()=>({stations:state.saved?[row]:[]})}, {search:async()=>[]});
      panel.expanded = i !== 0;
      Object.assign(panel.model.state,state);
      return panel;
    });
  }
  render() { return v_flex().children(this.panels.map((p,i)=>p.render(theme()).id("fixture-"+i))); }
}
`);
  execFileSync("herdr-app", ["check", mod], { env: { ...process.env, HERDR_APP_HOME: root }, stdio: "inherit" });
  console.log("search.render.check ok (native collapsed, loading, empty, error, results, saving, failed check, saved; no user app changes)");
} finally { await rm(root, { recursive: true, force: true }); }
