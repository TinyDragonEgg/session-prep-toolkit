# CLAUDE.md — session-prep-toolkit Pass 2

You are adding the full prep window to an existing Foundry VTT v13 module. Pass 1 is already built and working. Read DEV_NOTES before touching anything.

---

## DEV_NOTES — read before touching any code

- `src/session-prep.js` is Pass 1. **Do not modify it.**
- Pass 2 adds `src/prep-window.js`. This is the only file you write.
- `SPTFullWindow` is defined as a stub in Pass 1. Pass 2 redefines it. JavaScript allows class redeclaration across files as long as `prep-window.js` loads after `session-prep.js`. The load order in `module.json` enforces this.
- All writes go through `SPT.safe(ctx, desc, fn)` from Pass 1. It is already globally available.
- All logging goes through `SPT.log(level, ctx, ...args)`. Never use `console.log` directly.
- `pushNote(type, text)` from Pass 1 is globally available — use it for weather stamp and name stamp.
- `MODULE_ID` and `MODULE_TAG` are globals from Pass 1. Do not redefine them.
- `foundry.applications.api.ApplicationV2` and `HandlebarsApplicationMixin` are already destructured in Pass 1. Destructure them again locally in `prep-window.js` — no conflict.
- `_id` fields must be EXACTLY 16 lowercase alphanumeric characters. `foundry.utils.randomID(16)` produces this.
- CSS uses `--spt-*` variables from Pass 1. Never hardcode colors. Add new styles to a separate `<style id="spt-p2-styles">` tag.
- `P2_KEYS.TIMELINE` reuses the `"timeline"` key from Pass 1 so timeline entries from session end are visible in the full window.
- The `SPTFullWindow` stub from Pass 1 renders a placeholder. Pass 2 replaces it by redefining the class. This is intentional.

---

## Step 1 — Add prep-window.js to module.json

Run this script. Do not edit module.json manually.

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Insert prep-window.js into scripts array after session-prep.js
node -e "
  const fs  = require('fs');
  const path = '$ROOT/module.json';
  const mod  = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!mod.scripts.includes('src/prep-window.js')) {
    mod.scripts.push('src/prep-window.js');
  }
  fs.writeFileSync(path, JSON.stringify(mod, null, 2));
  console.log('module.json updated.');
"
```

Save as `scripts/add-p2-script.sh`, run it:

```bash
chmod +x scripts/add-p2-script.sh && bash scripts/add-p2-script.sh
```

---

## Step 2 — Place the Pass 2 source

Copy the full contents of `prep-window.js` into `src/prep-window.js` verbatim.

```
[PASTE FULL CONTENTS OF prep-window.js HERE]
```

---

## Step 3 — Append to CHANGELOG.md

```bash
cat >> CHANGELOG.md <<'EOF'

## Pass 2
### Added
- Full prep window (SPTFullWindow) replacing Pass 1 stub
- Prep Checklist with categories (Scene, NPC, Item, Encounter, Handout, Other)
- Session Goals (DM / Players / World) — persisted for Pass 3 recap context
- Hook Bank with status cycling (unused → active → done)
- Secrets Tracker with revealed/hidden toggle
- Relationship Web with name search
- Session Timeline with per-entry notes, manual entry + auto from Pass 1 session end
- Weather roller (condition, time, wind, mood) with stamp to Live Notes
- Name Generator with 4 style tables (Generic Fantasy, Northern, Elvish, Desert)
EOF
```

---

## Step 4 — Verify module.json scripts order

The scripts array must be exactly:

```json
"scripts": [
  "src/session-prep.js",
  "src/prep-window.js"
]
```

Check with:

```bash
node -e "const m = require('./module.json'); console.log(m.scripts);"
```

If order is wrong, fix it:

```bash
node -e "
  const fs = require('fs');
  const m  = JSON.parse(fs.readFileSync('module.json', 'utf8'));
  m.scripts = ['src/session-prep.js', 'src/prep-window.js'];
  fs.writeFileSync('module.json', JSON.stringify(m, null, 2));
  console.log('Fixed.');
"
```

---

## Step 5 — Release

```bash
bash scripts/release.sh 2.0.0
git add -A && git commit -m "Release 2.0.0 — Pass 2 prep window" && git tag 2.0.0 && git push origin main --tags
```

---

## Pass 3 context (do not implement — read only)

Pass 3 adds `src/ai-tools.js`. It will:
- Add Claude API key setting
- Add AI Tools tab to `SPTFullWindow` (journal gen, scene gen, NPC gen, recap writer, encounter builder, handout gen)
- Read `api.loadGoals()`, `api.loadHooks()` for context
- Hook bank active hooks are injected into AI context when the toggle is on
- Add "Send to GM Toolkit" button that pushes session notes to `game.modules.get("gm-toolkit").api` if present
- Name tables will be expandable via settings

---

## File tree when done

```
session-prep-toolkit/
├── .github/workflows/release.yml
├── scripts/
│   ├── scaffold.sh
│   ├── release.sh
│   └── add-p2-script.sh
├── src/
│   ├── session-prep.js   ← Pass 1, do not touch
│   └── prep-window.js    ← Pass 2, this file
├── languages/
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── module.json
└── README.md
```

---

## Rules

- Do not modify `src/session-prep.js` under any circumstances.
- All writes via `SPT.safe()`. All logs via `SPT.log()`.
- Append to CHANGELOG.md after every code change.
- Do not re-read files you just wrote.
- Do not summarize between steps unless a step fails.
- If a command fails, print the error and fix. Do not retry blindly.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh 2.0.0`
