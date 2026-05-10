# CLAUDE.md — session-prep-toolkit Pass 4

You are adding a soundboard to an existing Foundry VTT v13 module. Passes 1-3 are already built and working. Read DEV_NOTES first. Touch nothing except what is described.

---

## DEV_NOTES

- `src/session-prep.js` Pass 1 — **do not modify**
- `src/prep-window.js` Pass 2 — **do not modify**
- `src/ai-tools.js` Pass 3 — **do not modify**
- Pass 4 adds `src/soundboard.js` only
- `SPT`, `MODULE_ID`, `SPTSidebar` are globals from Pass 1 — do not redefine
- Pass 4 patches `SPTSidebar.prototype` at runtime — same isolation pattern as Pass 3
- The `🔊` sounds tab is injected by replacing the tab array inline in `_build`. The patch wraps `_build`, searches for the debug tab injection line, and inserts the sounds tab after it
- Freesound preview uses browser `Audio` API, not Foundry's audio system — this is intentional. It avoids polluting the Foundry playlist with previews
- Actual saved sounds go through Foundry's `FilePicker.upload` and `Playlist`/`PlaylistSound` documents
- `FilePicker.createDirectory` may throw if folder exists — always `.catch()` it
- `FilePicker.upload` returns `{ path }` on success — check for it explicitly
- All Foundry document writes go through `SPT.safe(ctx, desc, fn)`
- All logging goes through `SPT.log(level, ctx, ...args)`
- CSS: `--spt-*` variables only. New styles in `<style id="spt-p4-styles">`
- Load order: session-prep.js → prep-window.js → ai-tools.js → soundboard.js

---

## Step 1 — Add soundboard.js to module.json

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node -e "
  const fs  = require('fs');
  const path = '$ROOT/module.json';
  const mod  = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!mod.scripts.includes('src/soundboard.js')) {
    mod.scripts.push('src/soundboard.js');
  }
  fs.writeFileSync(path, JSON.stringify(mod, null, 2));
  console.log('module.json scripts:', mod.scripts);
"
```

Save as `scripts/add-p4-script.sh`, run it:

```bash
chmod +x scripts/add-p4-script.sh && bash scripts/add-p4-script.sh
```

---

## Step 2 — Verify load order

```bash
node -e "const m = require('./module.json'); console.log(m.scripts);"
```

Must be exactly:
```
[
  'src/session-prep.js',
  'src/prep-window.js',
  'src/ai-tools.js',
  'src/soundboard.js'
]
```

If wrong, fix:
```bash
node -e "
  const fs = require('fs');
  const m  = JSON.parse(fs.readFileSync('module.json', 'utf8'));
  m.scripts = ['src/session-prep.js','src/prep-window.js','src/ai-tools.js','src/soundboard.js'];
  fs.writeFileSync('module.json', JSON.stringify(m, null, 2));
  console.log('Fixed.');
"
```

---

## Step 3 — Place source

Copy the full contents of `soundboard.js` into `src/soundboard.js` verbatim.

```
[PASTE FULL CONTENTS OF soundboard.js HERE]
```

---

## Step 4 — Append to CHANGELOG.md

```bash
cat >> CHANGELOG.md <<'EOF'

## Pass 4
### Added
- Soundboard tab (🔊) in sidebar
- Freesound.org search (requires free API key in Module Settings)
- Browser-side audio preview of search results
- One-click download to Foundry Data/audio/spt/ folder
- Auto-add downloaded sounds to SPT Soundboard Foundry playlist
- Sound library with category tags (Ambience, Combat, Nature, Urban, Magic, Horror, Travel)
- Category filter buttons, stop-all button
- Pagination for search results
- p4-freesound-key and p4-download-path settings
EOF
```

---

## Step 5 — Release

```bash
bash scripts/release.sh 4.0.0
git add -A && git commit -m "Release 4.0.0 — Pass 4 soundboard" && git tag 4.0.0 && git push origin main --tags
```

---

## File tree when done

```
session-prep-toolkit/
├── .github/workflows/release.yml
├── scripts/
│   ├── scaffold.sh
│   ├── release.sh
│   ├── add-p2-script.sh
│   ├── add-p3-script.sh
│   └── add-p4-script.sh
├── src/
│   ├── session-prep.js    ← Pass 1, do not touch
│   ├── prep-window.js     ← Pass 2, do not touch
│   ├── ai-tools.js        ← Pass 3, do not touch
│   └── soundboard.js      ← Pass 4, this file
├── languages/
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── module.json
└── README.md
```

---

## Rules

- Do not modify any existing src file.
- All Foundry writes via `SPT.safe()`. All logs via `SPT.log()`.
- Never log the Freesound API key.
- Append to CHANGELOG.md after every code change.
- Do not re-read files you just wrote.
- Do not summarize between steps unless a step fails.
- If a command fails, print the error and fix. Do not retry blindly.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh 4.0.0`
