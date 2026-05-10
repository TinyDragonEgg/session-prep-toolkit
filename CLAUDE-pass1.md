# CLAUDE.md — session-prep-toolkit Pass 1

You are scaffolding a Foundry VTT v13 module. Follow every instruction exactly. Ask nothing. Use scripts for all multi-file work.

---

## Identity

- Module ID: `session-prep-toolkit`
- Display name: Session Prep Toolkit
- Author: Tiny Dragon
- Foundry: v13, any system
- License: MIT

---

## DEV_NOTES — read before touching any code

- All Foundry document writes go through `SPT.safe(ctx, desc, fn)`. Never call `.update()`, `.create()`, or `.delete()` directly.
- All logging goes through `SPT.log(level, ctx, ...args)`. Never use `console.log` directly.
- Foundry v13 uses ApplicationV2. Never use the legacy `Application` class.
- `_id` fields must be EXACTLY 16 lowercase alphanumeric characters (a-z, 0-9). Count manually.
- Image paths must exist in the Foundry data directory. Never invent paths.
- Never use `localStorage` or `sessionStorage`. All state lives in `game.settings`.
- The sidebar window (`SPTSidebar`) re-renders via `this.render()`. Never replace the entire DOM manually.
- `SPTFullWindow` is a stub. Do not modify it in Pass 1.
- CSS uses `--spt-*` variables defined in `:root`. Never hardcode colors.

---

## Step 1 — Scaffold

Create `scripts/scaffold.sh`, run it immediately.

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT"/{scripts,src,languages,.github/workflows}

cat > "$ROOT/module.json" <<'EOF'
{
  "id": "session-prep-toolkit",
  "title": "Session Prep Toolkit",
  "description": "GM-only live session assistant. Sidebar with live notes, item tracker, loot logger, condition tracker, tension timers, and Foundry table roller. Session start/end with player sheet stacking.",
  "version": "{{version}}",
  "compatibility": { "minimum": "13", "verified": "13" },
  "authors": [{ "name": "Tiny Dragon" }],
  "license": "MIT",
  "url": "https://github.com/TinyDragon/session-prep-toolkit",
  "manifest": "https://github.com/TinyDragon/session-prep-toolkit/releases/latest/download/module.json",
  "download": "https://github.com/TinyDragon/session-prep-toolkit/releases/download/{{version}}/session-prep-toolkit.zip",
  "scripts": ["src/session-prep.js"],
  "languages": [],
  "flags": {}
}
EOF

cat > "$ROOT/LICENSE" <<'EOF'
MIT License — Copyright (c) 2026 Tiny Dragon
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
EOF

cat > "$ROOT/.gitignore" <<'EOF'
node_modules/
*.zip
dist/
.DS_Store
Thumbs.db
EOF

cat > "$ROOT/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]
### Added
- Pass 1: SPT logger, settings, session state, sidebar with Live Notes / Item Tracker / Loot / Conditions / Table Roller / Debug tab
- Session Start/End with player picker, scene activation, sheet stacking
- Tension timer, item hook, export to journal
EOF

cat > "$ROOT/README.md" <<'EOF'
# Session Prep Toolkit

Foundry VTT v13 GM module. Collapsible sidebar for live session management.

## Install
```
https://github.com/TinyDragon/session-prep-toolkit/releases/latest/download/module.json
```

## Pass 1 Features
- **Session Start/End** — pick players, activate scene, stack sheets, export notes to journal
- **Live Notes** — quick-stamp buttons (Item Given, NPC Met, Decision, Combat, Discovery, Note) + free text
- **Item Tracker** — auto-logs items added to player actors, pending/done checklist
- **Loot Logger** — freeform loot notes, mark as distributed
- **Condition Tracker** — world-state flags, toggle active/inactive
- **Tension Timer** — countdown trackers for time-pressure moments
- **Table Roller** — roll any existing Foundry RollTable, result stamps to notes
- **Debug Tab** — live log, state dump, hook health, reset

## Settings
All settings are GM-only (restricted: true).

| Key | Default | Description |
|---|---|---|
| logLevel | warn | error/warn/info/debug/verbose |
| dryRun | false | Prevent all writes, log intent only |
| showDebugPanel | false | Show Debug tab |
| disableItemHook | false | Disable item tracking hook |
| disableSceneHook | false | Disable scene auto-activation |
| mockSession | false | Test session flow without world changes |

## License
MIT
EOF

echo "Scaffold complete."
```

```bash
chmod +x scripts/scaffold.sh && bash scripts/scaffold.sh
```

---

## Step 2 — Place source

Copy the full contents of `session-prep.js` into `src/session-prep.js` verbatim.

```
[PASTE FULL CONTENTS OF session-prep.js HERE]
```

---

## Step 3 — Release script

Create `scripts/release.sh`:

```bash
#!/usr/bin/env bash
set -e
VERSION="${1:?Usage: release.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sed -i "s/\"{{version}}\"/\"$VERSION\"/g" "$ROOT/module.json"
sed -i "s/{{version}}/$VERSION/g"         "$ROOT/module.json"
cd "$ROOT"
zip -r "session-prep-toolkit.zip" module.json src/ languages/ LICENSE README.md CHANGELOG.md
echo "Done. Run: git add -A && git commit -m \"Release $VERSION\" && git tag $VERSION && git push origin main --tags"
```

```bash
chmod +x scripts/release.sh
```

---

## Step 4 — GitHub Actions

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['[0-9]+.[0-9]+.[0-9]+']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: sed -i "s/{{version}}/${GITHUB_REF_NAME}/g" module.json
      - run: zip -r session-prep-toolkit.zip module.json src/ languages/ LICENSE README.md CHANGELOG.md
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          body: |
            **Manifest:** `https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/module.json`
          files: |
            session-prep-toolkit.zip
            module.json
```

---

## Step 5 — Create repo and push

```bash
cd /path/to/session-prep-toolkit

git init
git add -A
git commit -m "Initial commit — Pass 1"
git branch -M main

gh repo create session-prep-toolkit \
  --public \
  --description "Foundry VTT v13 GM session prep sidebar — live notes, item tracker, loot, conditions, timers, table roller" \
  --source . \
  --remote origin \
  --push
```

---

## Step 6 — First release

```bash
bash scripts/release.sh 1.0.0
git add -A && git commit -m "Release 1.0.0" && git tag 1.0.0 && git push origin main --tags
```

---

## Pass 2 context (do not implement — read only)

Pass 2 will add a full prep window (`SPTFullWindow`) with: Hook Bank, Timeline, Prep Checklist, Secrets Tracker, Relationship Web, Weather roller, Session Goals, Name Generator. The `SPTFullWindow` stub in Pass 1 must not be removed or modified.

Pass 3 adds Claude AI tools. The API key setting will be added in Pass 3.

---

## File tree when done

```
session-prep-toolkit/
├── .github/workflows/release.yml
├── scripts/scaffold.sh
├── scripts/release.sh
├── src/session-prep.js
├── languages/
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── module.json
└── README.md
```

---

## Rules

- All writes via `SPT.safe()`. All logs via `SPT.log()`.
- Scripts for any operation touching more than one file.
- Do not re-read files you just wrote.
- Do not summarize between steps unless a step fails.
- Append to CHANGELOG.md after every code change.
- If a command fails, print the error and fix. Do not retry blindly.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh <version>`
