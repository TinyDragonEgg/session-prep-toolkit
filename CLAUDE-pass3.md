# CLAUDE.md — session-prep-toolkit Pass 3

You are adding AI tools to an existing Foundry VTT v13 module. Pass 1 and Pass 2 are already built and working. Read DEV_NOTES before touching anything.

---

## DEV_NOTES — read before touching any code

- `src/session-prep.js` is Pass 1. **Do not modify it.**
- `src/prep-window.js` is Pass 2. **Do not modify it.**
- Pass 3 adds `src/ai-tools.js` only.
- `SPT`, `MODULE_ID`, `MODULE_TAG`, `getState`, `pushNote` are globals from Pass 1.
- `SPTFullWindow` is defined in Pass 2. Pass 3 patches its prototype at runtime via `patchFullWindow()`. This is intentional — it avoids redefining the class and keeps passes isolated.
- All writes go through `SPT.safe(ctx, desc, fn)`. Never call Foundry document methods directly.
- All logging goes through `SPT.log(level, ctx, ...args)`. Never use `console.log`.
- `_id` fields must be EXACTLY 16 lowercase alphanumeric characters. `foundry.utils.randomID(16)` produces this.
- Image paths: never invent paths. Only use paths that exist in the Foundry data directory.
- CSS: use `--spt-*` variables only. New styles go in `<style id="spt-p3-styles">`.
- The API key is stored world-scoped and restricted. Never log it, never expose it in UI beyond the settings field.
- The `anthropic-dangerous-direct-browser-access` header is required for browser-side API calls. Always include it.
- Load order in module.json must be: session-prep.js → prep-window.js → ai-tools.js.

---

## Step 1 — Add ai-tools.js to module.json

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node -e "
  const fs  = require('fs');
  const path = '$ROOT/module.json';
  const mod  = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!mod.scripts.includes('src/ai-tools.js')) {
    mod.scripts.push('src/ai-tools.js');
  }
  fs.writeFileSync(path, JSON.stringify(mod, null, 2));
  console.log('module.json updated:', mod.scripts);
"
```

Save as `scripts/add-p3-script.sh`, run it:

```bash
chmod +x scripts/add-p3-script.sh && bash scripts/add-p3-script.sh
```

---

## Step 2 — Verify script load order

```bash
node -e "const m = require('./module.json'); console.log(m.scripts);"
```

Must output exactly:
```
[ 'src/session-prep.js', 'src/prep-window.js', 'src/ai-tools.js' ]
```

If wrong:
```bash
node -e "
  const fs = require('fs');
  const m  = JSON.parse(fs.readFileSync('module.json', 'utf8'));
  m.scripts = ['src/session-prep.js', 'src/prep-window.js', 'src/ai-tools.js'];
  fs.writeFileSync('module.json', JSON.stringify(m, null, 2));
  console.log('Fixed.');
"
```

---

## Step 3 — Place the Pass 3 source

Copy the full contents of `ai-tools.js` into `src/ai-tools.js` verbatim.

```
[PASTE FULL CONTENTS OF ai-tools.js HERE]
```

---

## Step 4 — Append to CHANGELOG.md

```bash
cat >> CHANGELOG.md <<'EOF'

## Pass 3
### Added
- Claude API integration (claude-sonnet-4-20250514)
- AI Tools tab injected into SPTFullWindow via prototype patch
- Journal Entry generator (HTML output, creates Foundry journal)
- Scene generator (JSON → Foundry Scene document)
- NPC generator (JSON card view, save as journal)
- Session Recap writer (uses live notes + session goals as context)
- Encounter builder (JSON → journal entry)
- Handout generator (prose → shared JournalEntry, visible to all players)
- Hook Bank context toggle (active hooks injected into every AI call when enabled)
- GM Toolkit bridge (send results to GM Toolkit Claude tab if module is active)
- World context bundled automatically (session state, goals, active hooks)
- p3-api-key setting (world-scoped, restricted, never logged)
EOF
```

---

## Step 5 — Release

```bash
bash scripts/release.sh 3.0.0
git add -A && git commit -m "Release 3.0.0 — Pass 3 AI tools" && git tag 3.0.0 && git push origin main --tags
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
│   └── add-p3-script.sh
├── src/
│   ├── session-prep.js    ← Pass 1, do not touch
│   ├── prep-window.js     ← Pass 2, do not touch
│   └── ai-tools.js        ← Pass 3, this file
├── languages/
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── module.json
└── README.md
```

---

## Rules

- Do not modify `src/session-prep.js` or `src/prep-window.js` under any circumstances.
- All writes via `SPT.safe()`. All logs via `SPT.log()`.
- Never log or expose the API key.
- Append to CHANGELOG.md after every code change.
- Do not re-read files you just wrote.
- Do not summarize between steps unless a step fails.
- If a command fails, print the error and fix. Do not retry blindly.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh 3.0.0`
