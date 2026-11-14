# Cyber-Neon

A Herdr Desktop layout inspired by the user interface of Cyberpunk 2077: red-on-black panels, cut corners, a city map of your spaces, and a GitHub job journal.

> **This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED.** Cyberpunk 2077 is a trademark of CD PROJEKT S.A.; this layout uses no game assets.

![Cyber-Neon](preview.png)

Version 0.4.2 · Apache-2.0 · for Herdr App 0.1.15 or later · unofficial fan work

## What you get

- **Space map**: your spaces as points on a generated city map with coast, river and roads. They're placed A to Z by name, with yellow labels (agents, branch, open milestones and issues) and a numbered legend. Worktree spaces share their repo's point, with one extra tag line like `↳ M1 ●1 · #4 ○1`. Hover a point to see every agent in that space.
- **Agents list with a scanner**: hover an agent for a scan card with its class, state, uptime, path and branch, live context and 5h/7d usage (Claude Code and Codex; model, context and cost for Oh My Pi and OpenCode), and a THREAT meter. A worktree space reads as its repo's (`herdr-gallery ↳ M1`), and a milestone's agents stay together.
- **JOBS journal**: for a GitHub repo, the current branch's PR is the main job, with CI checks, review and task boxes as objectives. The selected milestone and its issues are main jobs too; issues without a milestone are side jobs. There's a RISK level per job, a tracked job, and a floating job HUD you can minimize or close.
- **Agents for milestones and issues**: pick an agent from the dropdown (the ones Herdr can start and you have installed), then:
  - **▶ LAUNCH** on a milestone makes a worktree on `milestone-<n>-<slug>` and a space there, running a lead agent that coordinates and writes no code. It reads the milestone, takes over work left from earlier runs, works out which issues depend on which, and starts each ready issue as its own sub-agent. **One issue, one branch, one PR** to your default branch, with `Closes #<n>`. Dependent issues wait until what they need is merged. The lead tells you which PR to merge to unblock what, and ends with the PRs to review and a reminder to close the milestone. Merging is always your call.
  - **▶ DISPATCH** on an issue makes its `issue-<n>-<slug>` worktree off your default branch and starts an agent with the issue as its first message; it commits, pushes and opens one PR with `Closes #<n>`. It runs as a tab under the milestone's lead when one is running, otherwise as a `#<n>` tab in the project's space.
  - A card with an agent on it shows its state (`▶ EXEC`), and **JACK IN** goes to it. An issue with an open PR from its branch shows `PR #<n>`: it's waiting on your review.
  - Agents are linked to their issue by branch and folder name (`issue-<n>…`, `<n>-…`, `milestone-<n>…`). `<slug>` is the title's ASCII words, at most 40 characters.
- **GRAPH page**: the focused repo's commit graph in the right panel, with neon lanes, diamond commits, branch and tag chips, a hover card with stats, and click to copy the hash. It's local and read-only git.
- **Files**: markdown files open rendered, with a **SOURCE / RENDER** switch in the preview's header.
- **Everything restyled**: tabs, pane headers, menus, a hacking-style `cmd-p` picker, in-game style notifications and a status readout. Blocked agents are impossible to miss.
- **`ANIM ON/OFF`** in the sidebar footer turns every animation off.
- **Radio**: a `RADIO OFF` / station chip in the right work area's bottom
  status bar opens the tuner. Select a station, press PLAY, tune with previous /
  next, adjust volume or mute, and power off. Track titles scroll; tuning gets
  a short generated visual static effect. Both stop with ANIM OFF.

## Install

```sh
git clone https://github.com/p988744/cyber-neon && cd cyber-neon
H=~/.config/herdr-app
cp layouts/Cyber-Neon.json $H/layouts/ && cp themes/Cyber-Neon.json $H/themes/ && cp -R mods/cyberneon-* $H/mods/
herdr-app do layout.switch '{"name":"Cyber-Neon"}'
```

- Merge `keys.json` into `~/.config/herdr-app/keys.json`. Its `layout:Cyber-Neon`
  section binds `cmd-p` to the picker, `ctrl-shift-right` / `ctrl-shift-left`
  to next / previous station, and `ctrl-shift-m` to mute. Radio keys apply only
  in this layout. While off, next / previous browse without starting playback.
- On a first install, switch to another layout and back once: Herdr loads the layout's fonts on the next look change.
- To go back to your own layout, press `ctrl-shift-l`. Deleting the copied files removes it.

## Radio

A local background player for your own streams, audio folders and playlists,
with an optional browser handoff for services that stay in their own player.
**No stations or music ship, and nothing plays on startup.**

1. For in-app playback, install [mpv](https://mpv.io/installation/) on macOS:

   ```sh
   brew install mpv
   ```

   macOS, Linux and Windows are supported. Local `mpv` and `python3` must be on
   Herdr's PATH (`mpv.exe` and Python 3.12+ as `python3.exe` on Windows). On Windows,
   install mpv from its [installation page](https://mpv.io/installation/) and
   verify `python3 --version` and `mpv --version` in the environment used to launch
   Herdr, then restart Herdr after PATH changes. A Windows browser-only station
   uses the default browser through the native URL opener. Missing mpv shows
   `NO RECEIVER // install mpv`; install it and press PLAY again.
2. Create `radio.json` in Herdr's config folder: normally
   `~/.config/herdr-app/radio.json`, or `${HERDR_APP_HOME}/radio.json` if overridden.
   This **inactive example** points only to your own Music folder; use files you
   have permission to play:

   ```json
   [
     { "name": "My music", "url": "~/Music", "genre": "My collection", "note": "My files", "explicit": false }
   ]
   ```

   `name` and either `url` or `open` are required; `genre`, `note` and the boolean
   `explicit` are optional. Set `explicit: true` for an **Explicit content** warning
   before playback and on the selected/playing station. `url` accepts a permitted
   direct stream, local audio file, folder, or local M3U/M3U8/PLS playlist. Folders
   play audio recursively in name order; local playlists preserve their order.
   Relative paths start at the config folder (playlist entries at the playlist).
   Windows paths may use `C:/Users/me/Music` or JSON-escaped backslashes
   (`C:\\Users\\me\\Music`); local `file:///C:/Users/me/Music/song.wav` URLs
   also work, including percent-encoded spaces and Unicode. UNC/network shares
   and drive-relative paths such as `C:Music` are not accepted.
   For browser listening, use `open` with the service's HTTPS page instead of `url`.
   See [station/source details](mods/cyberneon-radio/NOTES.md#station-list-and-source-api-8).
3. Click **RADIO OFF** at the right end of the work area's bottom status bar.
   Choose a station and press **PLAY** (or **OPEN** for a browser entry).
   Off-state selection and previous/next only browse; while playing, they tune
   immediately. The volume slider and mute control affect local playback;
   **OFF** stops it. Closing the tuner leaves local playback running.

The list refreshes automatically without playing. **FIND A STATION** searches
Radio Browser only when you press Search; **ADD** saves a result without tuning.
Review the station's terms and content before playing it. Layout-only shortcuts
are Ctrl-Shift-Right / Left for next / previous station and Ctrl-Shift-M for mute.

**DUCK ON/OFF** defaults on: a newly observed agent transition to blocked lowers
local audio to 20% of your chosen volume for four seconds, then restores it.
Your slider level and mute choice are preserved. **ANIM OFF** stops the scrolling
track title and visual tuning static; playback and ducking continue. Receiver
loss never resumes automatically; press PLAY to retry. Switching layouts,
reloading the mod or quitting closes the local player.

**OPEN** stops local audio before handing off to your browser. The chip stays
OFF and the tuner says **OPENED IN BROWSER**; **CLEAR** dismisses that notice.
Radio cannot control the browser's volume, playback or tabs, including on quit.

### Sources and permissions

- **[Radio Browser](https://api.radio-browser.info/)** is a directory only;
  a listing or successful check grants no license to a station's stream.
- **[SomaFM](https://somafm.com/contact/tos.html)** cannot authorize new third-party
  clients, including noncommercial ones; it is blocked for in-app playback.
- **[SoundCloud](https://developers.soundcloud.com/docs/api/terms-of-use#user-content)**
  prohibits webcasting radio apps under its API terms, so SoundCloud and
  **[Poolsuite](https://poolsuite.net/)** stay browser-only here; Poolsuite's
  SoundCloud integration establishes no transferable permission for this project.
- **[YouTube](https://developers.google.com/youtube/terms/developer-policies#additional-prohibitions)**
  stays browser-only: its API policies prohibit separating audio/video and hidden
  background players; this mod does no extraction.
- **[Creative Commons](https://creativecommons.org/cc-licenses/)** music requires
  [attribution](https://creativecommons.org/licenses/by/4.0/) under its specific
  license (creator, source, license link and any
  changes), plus any applicable NC/ND/SA conditions; a CC label alone is insufficient.

**One More Lawn:** developer permission for this app is pending; none has been
received and no music is bundled or licensed to this project. The
[official developer playlist](https://www.youtube.com/playlist?list=PLJ19oo9w4X5A)
is a browser link only. [Policy evidence and Steam → official @Superdoudev →
playlist provenance](mods/cyberneon-radio/BROWSER.md#source-policy-evidence) explain
that distinction; no source-owner messages were sent for this work.

## What it runs and reaches

- `git` in your spaces' folders: read-only to find branches and remotes, and `git log` / `git show --stat` for the GRAPH page. The only writes come from your clicks on **▶ LAUNCH** or **▶ DISPATCH**: `git worktree add` (making the `milestone-…` or `issue-…` branch if it doesn't exist yet), local only.
- `gh` with your own login, **read-only**, only for folders whose remote is on github.com. It calls `pr view`, `pr list`, `issue list`, `issue view` and `api …/milestones`, plus one GraphQL count of open issues and milestones per repo, at most every 2 to 10 minutes. The panel itself never writes to GitHub.
- `hc read <terminal>` once when you open an agent's scan card, to read its status line (context and usage). `hc run` / `hc send` and Herdr's `space.new`, `tab.new` and `terminal.keep` when you click LAUNCH or DISPATCH.
- `cyberneon-radio` uses local `python3` for config, source resolution and explicit
  Radio Browser searches, and starts local `mpv` only on Play (macOS/Linux/Windows).
  In the tuner, **FIND A STATION** searches by tag and shows country, codec/bitrate
  and directory check status. **ADD** saves to your config folder's `radio.json`
  without tuning. Search uses DNS-discovered directory servers and a generic
  User-Agent. The directory grants no station license; each station's terms apply.
  No stations or music ship. Reloading the list never starts playback.

Radio directory searches and selected stream playback contact their respective
servers on your explicit actions. The agents you start run with your tools and
logins, and talk to their own providers.

## Before you click LAUNCH or DISPATCH

- **The issue becomes the agent's task.** Its title goes into the first message, and the agent reads the body with `gh`. On a public repo, anyone can open an issue, so read it first: text in an issue can try to steer an agent (prompt injection).
- **The agent runs with the permissions its command gives it.** The command is the one in Herdr's agent list (`programs.json`). Ticking **YOLO** adds that agent's own skip-permission flag (e.g. `--dangerously-skip-permissions` for Claude Code), and then it acts on the issue without asking. A lead starts its sub-agents with the same command and adds no flags of its own, so YOLO carries over to them.
- **Agents do git and GitHub work for you**: worktrees, commits, pushes, and one PR per issue to your default branch. They never merge PRs or close issues or milestones.

## Docs

- `RECIPE.md`: the full brief (what you see, how it behaves, how it's built, gotchas). It's also how to rebuild it from scratch.
- `docs/DESIGN.md`: the early design notes (in Traditional Chinese).
- Each `mods/cyberneon-*/NOTES.md`: per-mod details and pitfalls.
- [`mods/cyberneon-radio/NOTES.md`](mods/cyberneon-radio/NOTES.md): radio engine,
  station setup, tuner controls, dependencies, lifecycle and checks.
- [`mods/cyberneon-radio/UI.md`](mods/cyberneon-radio/UI.md): tuner, browser handoff and ducking behavior.
- [`mods/cyberneon-radio/BROWSER.md`](mods/cyberneon-radio/BROWSER.md): primary source policies and playlist provenance.
- [`mods/cyberneon-radio/SEARCH.md`](mods/cyberneon-radio/SEARCH.md): directory search,
  Add persistence, API references, concurrency limits and isolated checks.

## License

Apache-2.0, see `LICENSE`. Parts are adapted from Herdr's shipped mods (Apache-2.0), and the fonts are SIL OFL 1.1. See `THIRD_PARTY_NOTICES.md`.
Cyberpunk 2077 is a trademark of CD PROJEKT S.A. This project uses no game assets and isn't endorsed by CD PROJEKT RED.
