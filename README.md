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

## Install

```sh
git clone https://github.com/p988744/cyber-neon && cd cyber-neon
H=~/.config/herdr-app
cp layouts/Cyber-Neon.json $H/layouts/ && cp themes/Cyber-Neon.json $H/themes/ && cp -R mods/cyberneon-* $H/mods/
herdr-app do layout.switch '{"name":"Cyber-Neon"}'
```

- Merge `keys.json` into `~/.config/herdr-app/keys.json`. Its `layout:Cyber-Neon` section makes `cmd-p` open the hacking-style picker in this layout only.
- On a first install, switch to another layout and back once: Herdr loads the layout's fonts on the next look change.
- To go back to your own layout, press `ctrl-shift-l`. Deleting the copied files removes it.

## What it runs and reaches

- `git` in your spaces' folders: read-only to find branches and remotes, and `git log` / `git show --stat` for the GRAPH page. The only writes come from your clicks on **▶ LAUNCH** or **▶ DISPATCH**: `git worktree add` (making the `milestone-…` or `issue-…` branch if it doesn't exist yet), local only.
- `gh` with your own login, **read-only**, only for folders whose remote is on github.com. It calls `pr view`, `pr list`, `issue list`, `issue view` and `api …/milestones`, plus one GraphQL count of open issues and milestones per repo, at most every 2 to 10 minutes. The panel itself never writes to GitHub.
- `hc read <terminal>` once when you open an agent's scan card, to read its status line (context and usage). `hc run` / `hc send` and Herdr's `space.new`, `tab.new` and `terminal.keep` when you click LAUNCH or DISPATCH.
- The optional `cyberneon-radio` playback foundation uses local `mpv` and `python3`
  (macOS/Linux) only after play is requested. It is not placed in the layout yet;
  no stations or music ship. See its notes for the engine interface and cleanup.

The panel sends nothing anywhere. The agents you start are a different matter: they run with your tools and logins, and talk to their own providers.

## Before you click LAUNCH or DISPATCH

- **The issue becomes the agent's task.** Its title goes into the first message, and the agent reads the body with `gh`. On a public repo, anyone can open an issue, so read it first: text in an issue can try to steer an agent (prompt injection).
- **The agent runs with the permissions its command gives it.** The command is the one in Herdr's agent list (`programs.json`). Ticking **YOLO** adds that agent's own skip-permission flag (e.g. `--dangerously-skip-permissions` for Claude Code), and then it acts on the issue without asking. A lead starts its sub-agents with the same command and adds no flags of its own, so YOLO carries over to them.
- **Agents do git and GitHub work for you**: worktrees, commits, pushes, and one PR per issue to your default branch. They never merge PRs or close issues or milestones.

## Docs

- `RECIPE.md`: the full brief (what you see, how it behaves, how it's built, gotchas). It's also how to rebuild it from scratch.
- `docs/DESIGN.md`: the early design notes (in Traditional Chinese).
- Each `mods/cyberneon-*/NOTES.md`: per-mod details and pitfalls.
- [`mods/cyberneon-radio/NOTES.md`](mods/cyberneon-radio/NOTES.md): reusable radio
  engine for the upcoming station list and UI, dependencies, lifecycle and checks.

## License

Apache-2.0, see `LICENSE`. Parts are adapted from Herdr's shipped mods (Apache-2.0), and the fonts are SIL OFL 1.1. See `THIRD_PARTY_NOTICES.md`.
Cyberpunk 2077 is a trademark of CD PROJEKT S.A. This project uses no game assets and isn't endorsed by CD PROJEKT RED.
