# Session Prep Toolkit

Foundry VTT v13 GM module. Collapsible sidebar for live session management plus a full prep window with AI tools and soundboard.

## Install
```
https://github.com/TinyDragonEgg/session-prep-toolkit/releases/latest/download/module.json
```

## Features

### Sidebar (Pass 1)
- **Session Start/End** — pick players, activate scene, stack sheets, export notes to journal
- **Live Notes** — quick-stamp buttons (Item Given, NPC Met, Decision, Combat, Discovery, Note) + free text
- **Item Tracker** — auto-logs items added to player actors, pending/done checklist
- **Loot Logger** — freeform loot notes, mark as distributed
- **Condition Tracker** — world-state flags, toggle active/inactive
- **Tension Timer** — countdown trackers for time-pressure moments
- **Table Roller** — roll any existing Foundry RollTable, result stamps to notes

### Full Prep Window (Pass 2)
Hook Bank, Timeline, Prep Checklist, Secrets Tracker, Relationship Web, Weather roller, Session Goals, Name Generator.

### AI Tools (Pass 3)
Claude API integration. Session note summarization, NPC generation, encounter suggestions, world context injection.

### Soundboard (Pass 4)
Freesound search, local sound library, Foundry playlist integration.

## Settings

| Key | Default | Description |
|---|---|---|
| logLevel | warn | error/warn/info/debug/verbose |
| dryRun | false | Prevent all writes, log intent only |
| showDebugPanel | false | Show Debug tab |
| disableItemHook | false | Disable item tracking hook |
| disableSceneHook | false | Disable scene auto-activation |
| mockSession | false | Test session flow without world changes |
| apiKey | — | Anthropic API key (Pass 3) |

## License
MIT
