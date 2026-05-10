/**
 * Session Prep Toolkit — Pass 3: AI Tools
 * Depends on: session-prep.js (Pass 1) and prep-window.js (Pass 2) loaded first.
 * Adds: Claude API integration, AI Tools tab in SPTFullWindow, Journal Gen,
 *       Scene Gen, NPC Gen, Recap Writer, Encounter Builder, Handout Gen,
 *       Hook Bank context toggle, GM Toolkit bridge, custom name tables.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const P3_KEYS = {
  API_KEY:       "p3-api-key",
  HOOK_CONTEXT:  "p3-hook-context",
  CUSTOM_NAMES:  "p3-custom-names",
  AI_HISTORY:    "p3-ai-history",
};

function registerP3Settings() {
  const defs = [
    { key: P3_KEYS.API_KEY,      type: String,  default: "",    config: true,  name: "Claude API Key",         hint: "Your Anthropic API key (sk-ant-...)" },
    { key: P3_KEYS.HOOK_CONTEXT, type: Boolean, default: false, config: true,  name: "Include Hooks in AI Context", hint: "Send active Hook Bank entries to Claude with every request." },
    { key: P3_KEYS.CUSTOM_NAMES, type: String,  default: "{}",  config: false },
    { key: P3_KEYS.AI_HISTORY,   type: String,  default: "[]",  config: false },
  ];
  for (const d of defs) {
    try {
      const cfg = { scope: "world", config: !!d.config, type: d.type, default: d.default, restricted: true };
      if (d.name) cfg.name = d.name;
      if (d.hint) cfg.hint = d.hint;
      game.settings.register(MODULE_ID, d.key, cfg);
    } catch { /* already registered */ }
  }
  SPT.log("info", "P3Settings", "Registered.");
}

const getApiKey      = () => game.settings.get(MODULE_ID, P3_KEYS.API_KEY);
const getHookContext = () => game.settings.get(MODULE_ID, P3_KEYS.HOOK_CONTEXT);
const getCustomNames = () => { try { return JSON.parse(game.settings.get(MODULE_ID, P3_KEYS.CUSTOM_NAMES)); } catch { return {}; } };
const getAIHistory   = () => { try { return JSON.parse(game.settings.get(MODULE_ID, P3_KEYS.AI_HISTORY)); } catch { return []; } };
const saveAIHistory  = (h) => game.settings.set(MODULE_ID, P3_KEYS.AI_HISTORY, JSON.stringify(h.slice(-40)));

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

/**
 * Assembles world context for Claude based on what's available and enabled.
 * @param {object} opts - Which context sections to include
 * @returns {string} Formatted context block
 */
function buildAIContext(opts = {}) {
  const parts = [];

  parts.push(`## World Context
- Foundry v${game.version} | System: ${game.system.id} v${game.system.version}
- World: ${game.world.title} | Active scene: ${game.scenes.active?.name ?? "none"}`);

  // Session state
  const state = getState();
  if (state.active) {
    const names = (state.playerIds ?? []).map(id => game.actors.get(id)?.name ?? id);
    parts.push(`## Active Session\nPlayers: ${names.join(", ")}`);
  }

  // Session goals
  if (opts.goals !== false) {
    const goals = game.modules.get(MODULE_ID).api?.loadGoals?.() ?? {};
    if (goals.dm || goals.players || goals.world) {
      parts.push(`## Session Goals\n- DM wants: ${goals.dm || "—"}\n- Players want: ${goals.players || "—"}\n- World is doing: ${goals.world || "—"}`);
    }
  }

  // Active hooks
  if (getHookContext() || opts.hooks) {
    const hooks = (game.modules.get(MODULE_ID).api?.loadHooks?.() ?? []).filter(h => h.status === "active");
    if (hooks.length) {
      parts.push(`## Active Plot Hooks\n${hooks.map(h => `- ${h.title}${h.detail ? `: ${h.detail}` : ""}`).join("\n")}`);
    }
  }

  // Live notes summary (last 10)
  if (opts.notes && state.liveNotes?.length) {
    const recent = state.liveNotes.slice(-10).map(n => `[${n.type}] ${n.text}`).join("\n");
    parts.push(`## Recent Session Notes\n${recent}`);
  }

  // Custom context passed by caller
  if (opts.extra) parts.push(opts.extra);

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a creative assistant helping a Dungeon Master prepare and run tabletop RPG sessions. Be concise and practical. When creating content, make it immediately usable at the table.

Formatting rules:
- For journal entries: respond with valid HTML suitable for Foundry VTT journal pages.
- For JSON (scenes, NPCs, encounters): respond with a single JSON code block, no preamble.
- For recaps and handouts: respond with clean prose, no markdown headers.
- Never add disclaimers or meta-commentary about the content you generate.`;

/**
 * Call the Claude API.
 * @param {string} userMessage
 * @param {string} [context] - Pre-built context string
 * @param {object[]} [history] - Prior message pairs for multi-turn
 * @returns {Promise<string>}
 */
async function callClaude(userMessage, context = "", history = []) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key. Go to Settings > Module Settings > Session Prep Toolkit.");

  const messages = [
    ...history,
    { role: "user", content: context ? `${context}\n\n---\n\n${userMessage}` : userMessage },
  ];

  SPT.log("debug", "API", "Calling Claude. Messages:", messages.length);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message ?? `API error ${res.status}`;
    SPT.log("error", "API", "Request failed:", msg);
    throw new Error(msg);
  }

  const data  = await res.json();
  const reply = data.content?.find(b => b.type === "text")?.text ?? "(no response)";
  SPT.log("debug", "API", "Reply received. Length:", reply.length);
  return reply;
}

// ---------------------------------------------------------------------------
// Foundry document creators
// ---------------------------------------------------------------------------

/**
 * Create a JournalEntry with a single text page.
 * @param {string} name
 * @param {string} htmlContent
 * @param {string|null} [folderId]
 * @returns {Promise<JournalEntry>}
 */
async function createJournalEntry(name, htmlContent, folderId = null) {
  return SPT.safe("JournalGen", `Create journal: ${name}`, async () => {
    const entry = await JournalEntry.create({ name, folder: folderId });
    await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name, type: "text", text: { content: htmlContent },
    }]);
    entry.sheet.render(true);
    return entry;
  });
}

/**
 * Create a Scene from a descriptor object.
 * @param {{name:string, backgroundColor:string, description:string}} descriptor
 * @returns {Promise<Scene>}
 */
async function createScene(descriptor) {
  return SPT.safe("SceneGen", `Create scene: ${descriptor.name}`, async () => {
    const scene = await Scene.create({
      name: descriptor.name,
      backgroundColor: descriptor.backgroundColor ?? "#1a1a2e",
      width: 3000,
      height: 2000,
      grid: { type: 1, size: 100 },
      description: descriptor.description ?? "",
    });
    SPT.log("info", "SceneGen", "Created scene:", scene.name, scene.id);
    return scene;
  });
}

/**
 * Create a JournalEntry formatted as a player handout and share it.
 * @param {string} name
 * @param {string} content
 * @returns {Promise<JournalEntry>}
 */
async function createHandout(name, content) {
  return SPT.safe("Handout", `Create handout: ${name}`, async () => {
    const entry = await JournalEntry.create({
      name,
      ownership: Object.fromEntries(game.users.filter(u => !u.isGM).map(u => [u.id, 2])),
    });
    await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name, type: "text", text: { content: `<p>${content}</p>` },
    }]);
    // Share to all players
    entry.sheet.render(true);
    ui.notifications.info(`Handout "${name}" shared to all players.`);
    return entry;
  });
}

// ---------------------------------------------------------------------------
// AI tool functions
// ---------------------------------------------------------------------------

async function genJournal(topic, opts = {}) {
  const ctx    = buildAIContext(opts);
  const prompt = `Write a Foundry VTT journal entry about: ${topic}

Requirements:
- Valid HTML (use <h2>, <h3>, <p>, <ul><li>, <strong>, <em>)
- 3-5 paragraphs of lore, description, or notes
- Atmosphere appropriate for a dark fantasy setting
- Include a "GM Notes" section at the end with hooks or secrets`;

  SPT.log("info", "JournalGen", "Generating:", topic);
  return callClaude(prompt, ctx);
}

async function genScene(concept, opts = {}) {
  const ctx    = buildAIContext(opts);
  const prompt = `Generate a Foundry VTT scene descriptor for: ${concept}

Respond ONLY with a JSON object in this exact format:
{
  "name": "Scene Name",
  "backgroundColor": "#hexcolor",
  "description": "2-3 sentences describing the scene for the GM",
  "mapDescription": "What this location looks like — useful for describing to players or commissioning art",
  "encounters": ["Possible encounter 1", "Possible encounter 2", "Possible encounter 3"],
  "secrets": ["A secret about this place", "Another secret"]
}

The backgroundColor should match the atmosphere (dark dungeon = near black, forest = dark green, etc).`;

  SPT.log("info", "SceneGen", "Generating:", concept);
  return callClaude(prompt, ctx);
}

async function genNPC(role, opts = {}) {
  const ctx    = buildAIContext(opts);
  const prompt = `Generate an NPC for a tabletop RPG session. Role/concept: ${role}

Respond ONLY with a JSON object:
{
  "name": "Full Name",
  "role": "Their role or profession",
  "appearance": "Brief physical description",
  "personality": "2-3 personality traits",
  "motivation": "What they want",
  "secret": "Something they're hiding",
  "hook": "How they could involve the party",
  "quirk": "One memorable mannerism or detail",
  "voice": "How they speak — accent, vocabulary, cadence"
}`;

  SPT.log("info", "NPCGen", "Generating:", role);
  return callClaude(prompt, ctx);
}

async function genRecap(opts = {}) {
  const state  = getState();
  const ctx    = buildAIContext({ ...opts, notes: true, goals: true, hooks: true });
  const goals  = game.modules.get(MODULE_ID).api?.loadGoals?.() ?? {};

  const noteLines = (state.liveNotes ?? []).map(n => `[${n.type}] ${n.text}`).join("\n") || "(no notes)";
  const itemLines = (state.itemLog ?? []).map(e => `${e.actorName} received ${e.itemName}`).join("\n") || "(none)";

  const prompt = `Write a session recap based on the following notes. Write in past tense, 3-4 paragraphs, as if addressing the players. Make it feel like an epic story summary.

Session notes:
${noteLines}

Items distributed:
${itemLines}

DM's intended goals: ${goals.dm || "—"}
Player goals: ${goals.players || "—"}

Do NOT include any JSON. Just prose.`;

  SPT.log("info", "Recap", "Generating recap.");
  return callClaude(prompt, ctx);
}

async function genEncounter(situation, opts = {}) {
  const ctx    = buildAIContext(opts);
  const prompt = `Design a tactical encounter for: ${situation}

Respond ONLY with a JSON object:
{
  "name": "Encounter name",
  "summary": "2-sentence DM summary",
  "enemies": [
    { "name": "Enemy type", "count": 2, "role": "skirmisher/controller/brute/boss", "tactic": "How they fight" }
  ],
  "terrain": ["Terrain feature 1", "Terrain feature 2"],
  "complications": ["Complication or dynamic element", "Another complication"],
  "objective": "What the party needs to do to win (not just kill everything)",
  "rewards": "Suggested rewards",
  "escalation": "What happens if the fight drags on"
}`;

  SPT.log("info", "Encounter", "Generating:", situation);
  return callClaude(prompt, ctx);
}

async function genHandout(subject, opts = {}) {
  const ctx    = buildAIContext(opts);
  const prompt = `Write player-facing handout text about: ${subject}

Rules:
- Written as if it's a real in-world document, letter, inscription, or notice
- 2-4 short paragraphs or equivalent
- No meta-commentary, no "this handout contains..."
- Dark fantasy tone
- Plain prose only, no markdown`;

  SPT.log("info", "Handout", "Generating:", subject);
  return callClaude(prompt, ctx);
}

// ---------------------------------------------------------------------------
// GM Toolkit bridge
// ---------------------------------------------------------------------------

function sendToGMToolkit(content) {
  const gmt = game.modules.get("gm-toolkit");
  if (!gmt?.active) {
    ui.notifications.warn("GM Toolkit is not active.");
    SPT.log("warn", "Bridge", "GM Toolkit not active.");
    return;
  }
  const api = gmt.api;
  if (!api?.open) {
    ui.notifications.warn("GM Toolkit API not available.");
    SPT.log("warn", "Bridge", "GM Toolkit API missing.");
    return;
  }
  // Inject into GM Toolkit's Claude tab history if accessible
  if (api._instance?._aiHistory) {
    api._instance._aiHistory.push({ role: "user", content });
    api._instance.render();
  }
  api.open();
  ui.notifications.info("Session notes sent to GM Toolkit.");
  SPT.log("info", "Bridge", "Sent to GM Toolkit.");
}

// ---------------------------------------------------------------------------
// AI Tools tab — injected into SPTFullWindow via monkey-patch on ready
// ---------------------------------------------------------------------------

/**
 * We extend SPTFullWindow by patching its _buildTab and _listen methods
 * after both Pass 1 and Pass 2 have loaded. This avoids redefining the
 * entire class and keeps each pass isolated.
 */

function patchFullWindow() {
  const proto = SPTFullWindow.prototype;

  // Store original methods
  const _origBuildTab = proto._buildTab.bind;
  const _origBuild    = proto._build;
  const _origListen   = proto._listen;

  // Add AI tab to tab bar
  proto._build = function() {
    const base = _origBuild.call(this);
    // Inject AI tab button into the tab bar
    return base.replace(
      'class="spt-full-tabs">',
      'class="spt-full-tabs">'
    ).replace(
      `data-tab="checklist"`,
      `data-tab="checklist"`
    ).replace(
      '</div>\n      <div class="spt-full-content">',
      `<button class="spt-tab ${this._tab === "ai" ? "active" : ""}" data-tab="ai">✦ AI Tools</button></div>\n      <div class="spt-full-content">`
    );
  };

  // Add AI tab content
  const _origBuildTabInner = proto._buildTab;
  proto._buildTab = function() {
    if (this._tab === "ai") return this._buildAI();
    return _origBuildTabInner.call(this);
  };

  // AI state
  proto._aiLoading  = false;
  proto._aiResult   = null;
  proto._aiTool     = "journal";
  proto._aiInput    = "";

  proto._buildAI = function() {
    const TOOLS = [
      { id: "journal",   label: "Journal Entry" },
      { id: "scene",     label: "Scene"         },
      { id: "npc",       label: "NPC"           },
      { id: "recap",     label: "Session Recap" },
      { id: "encounter", label: "Encounter"     },
      { id: "handout",   label: "Handout"       },
    ];

    const toolBtns = TOOLS.map(t =>
      `<button class="spt-ai-tool-btn ${this._aiTool === t.id ? "active" : ""}" data-tool="${t.id}">${t.label}</button>`
    ).join("");

    const PLACEHOLDERS = {
      journal:   "Topic or location (e.g. The Sunken Library of Valdris)",
      scene:     "Scene concept (e.g. Flooded crypt with rising water)",
      npc:       "Role or concept (e.g. Corrupt carnival ringmaster)",
      recap:     "Leave blank to use current session notes, or describe the session",
      encounter: "Situation (e.g. Ambush on a narrow bridge at night)",
      handout:   "Subject (e.g. A wanted poster for the party rogue)",
    };

    const hookToggle = `
      <label class="spt-ctx-toggle">
        <input type="checkbox" id="spt-ai-hook-ctx" ${getHookContext() ? "checked" : ""}>
        Include active hooks as context
      </label>`;

    const resultHtml = this._aiResult
      ? `<div class="spt-ai-result">
          <div class="spt-ai-result-body" id="spt-ai-result-body">${this._renderResult(this._aiResult, this._aiTool)}</div>
          <div class="spt-ai-result-actions">
            ${this._buildResultActions(this._aiTool)}
          </div>
        </div>`
      : "";

    return `
      <div class="spt-ai">
        <div class="spt-ai-tools">${toolBtns}</div>
        ${hookToggle}
        <div class="spt-ai-input-wrap">
          <textarea id="spt-ai-input" rows="3" placeholder="${PLACEHOLDERS[this._aiTool] ?? ""}">${this._aiInput}</textarea>
          <button id="spt-ai-generate" class="spt-btn" ${this._aiLoading ? "disabled" : ""}>
            ${this._aiLoading ? "Generating..." : "Generate"}
          </button>
        </div>
        ${this._aiLoading ? `<div class="spt-ai-loading"><span class="spt-ai-spinner">⟳</span> Calling Claude...</div>` : ""}
        ${resultHtml}
      </div>`;
  };

  proto._renderResult = function(raw, tool) {
    if (tool === "scene" || tool === "npc" || tool === "encounter") {
      // Try to extract and pretty-print JSON
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const json  = match ? match[1] : raw;
      try {
        const parsed = JSON.parse(json);
        return this._jsonToHtml(parsed, tool);
      } catch {
        return `<pre class="spt-ai-raw">${raw}</pre>`;
      }
    }
    if (tool === "journal") {
      // Raw HTML — render as preview
      return `<div class="spt-ai-journal-preview">${raw}</div>`;
    }
    // Recap, handout — plain prose
    return `<div class="spt-ai-prose">${raw.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</div>`;
  };

  proto._jsonToHtml = function(obj, tool) {
    const row = (label, val) => val ? `<div class="spt-ai-row"><span class="spt-ai-label">${label}</span><span class="spt-ai-val">${val}</span></div>` : "";

    if (tool === "scene") return `
      <div class="spt-ai-card">
        ${row("Name", obj.name)}
        ${row("Background", obj.backgroundColor ? `<span style="display:inline-block;width:14px;height:14px;background:${obj.backgroundColor};border-radius:3px;vertical-align:middle"></span> ${obj.backgroundColor}` : "")}
        ${row("Description", obj.description)}
        ${row("Map", obj.mapDescription)}
        ${obj.encounters?.length ? `<div class="spt-ai-row"><span class="spt-ai-label">Encounters</span><ul class="spt-ai-list">${obj.encounters.map(e => `<li>${e}</li>`).join("")}</ul></div>` : ""}
        ${obj.secrets?.length ? `<div class="spt-ai-row"><span class="spt-ai-label">Secrets</span><ul class="spt-ai-list">${obj.secrets.map(s => `<li>${s}</li>`).join("")}</ul></div>` : ""}
      </div>`;

    if (tool === "npc") return `
      <div class="spt-ai-card">
        ${row("Name", obj.name)} ${row("Role", obj.role)}
        ${row("Appearance", obj.appearance)} ${row("Personality", obj.personality)}
        ${row("Motivation", obj.motivation)} ${row("Secret", obj.secret)}
        ${row("Hook", obj.hook)} ${row("Quirk", obj.quirk)}
        ${row("Voice", obj.voice)}
      </div>`;

    if (tool === "encounter") return `
      <div class="spt-ai-card">
        ${row("Name", obj.name)} ${row("Summary", obj.summary)}
        ${obj.enemies?.length ? `<div class="spt-ai-row"><span class="spt-ai-label">Enemies</span><ul class="spt-ai-list">${obj.enemies.map(e => `<li><strong>${e.count}x ${e.name}</strong> (${e.role}) — ${e.tactic}</li>`).join("")}</ul></div>` : ""}
        ${obj.terrain?.length ? row("Terrain", obj.terrain.join(", ")) : ""}
        ${obj.complications?.length ? row("Complications", obj.complications.join("; ")) : ""}
        ${row("Objective", obj.objective)} ${row("Rewards", obj.rewards)}
        ${row("Escalation", obj.escalation)}
      </div>`;

    return `<pre class="spt-ai-raw">${JSON.stringify(obj, null, 2)}</pre>`;
  };

  proto._buildResultActions = function(tool) {
    const copy   = `<button id="spt-ai-copy"   class="spt-btn spt-btn-secondary">Copy Raw</button>`;
    const clear  = `<button id="spt-ai-clear"  class="spt-btn spt-btn-secondary">Clear</button>`;
    const bridge = `<button id="spt-ai-bridge" class="spt-btn spt-btn-secondary">Send to GM Toolkit</button>`;

    switch (tool) {
      case "journal":
        return `<button id="spt-ai-create-journal" class="spt-btn">Create Journal Entry</button>${copy}${clear}${bridge}`;
      case "scene":
        return `<button id="spt-ai-create-scene" class="spt-btn">Create Scene in Foundry</button>${copy}${clear}`;
      case "npc":
        return `<button id="spt-ai-create-npc-journal" class="spt-btn">Save as Journal Entry</button>${copy}${clear}`;
      case "recap":
        return `<button id="spt-ai-create-recap" class="spt-btn">Save as Journal Entry</button>${copy}${clear}${bridge}`;
      case "encounter":
        return `<button id="spt-ai-create-encounter" class="spt-btn">Save as Journal Entry</button>${copy}${clear}`;
      case "handout":
        return `<button id="spt-ai-create-handout" class="spt-btn">Create &amp; Share Handout</button>${copy}${clear}`;
      default:
        return `${copy}${clear}`;
    }
  };

  // Extend _listen to handle AI tab
  const _origListenP3 = proto._listen;
  proto._listen = function() {
    _origListenP3.call(this);
    const el = this.element;

    // Tool switcher
    el.querySelectorAll(".spt-ai-tool-btn").forEach(btn =>
      btn.addEventListener("click", () => {
        this._aiTool   = btn.dataset.tool;
        this._aiResult = null;
        this._aiInput  = "";
        this.render();
      })
    );

    // Hook context toggle — save immediately
    el.querySelector("#spt-ai-hook-ctx")?.addEventListener("change", async e => {
      await game.settings.set(MODULE_ID, P3_KEYS.HOOK_CONTEXT, e.target.checked);
      SPT.log("info", "AI", "Hook context toggled:", e.target.checked);
    });

    // Generate
    el.querySelector("#spt-ai-generate")?.addEventListener("click", () => this._generate());

    // Result actions
    el.querySelector("#spt-ai-copy")?.addEventListener("click", () => {
      navigator.clipboard.writeText(this._aiResult ?? "");
      ui.notifications.info("Copied to clipboard.");
    });
    el.querySelector("#spt-ai-clear")?.addEventListener("click", () => {
      this._aiResult = null; this._aiInput = ""; this.render();
    });
    el.querySelector("#spt-ai-bridge")?.addEventListener("click", () => {
      if (this._aiResult) sendToGMToolkit(this._aiResult);
    });
    el.querySelector("#spt-ai-create-journal")?.addEventListener("click", () => {
      if (!this._aiResult) return;
      const title = el.querySelector("#spt-ai-input")?.value?.trim() || "Generated Entry";
      createJournalEntry(title, this._aiResult);
    });
    el.querySelector("#spt-ai-create-scene")?.addEventListener("click", async () => {
      if (!this._aiResult) return;
      try {
        const match = this._aiResult.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const json  = match ? match[1] : this._aiResult;
        const desc  = JSON.parse(json);
        await createScene(desc);
        ui.notifications.info(`Scene "${desc.name}" created.`);
      } catch (e) {
        SPT.log("error", "SceneGen", "Parse failed:", e);
        ui.notifications.error("Could not parse scene JSON.");
      }
    });
    el.querySelector("#spt-ai-create-npc-journal")?.addEventListener("click", () => {
      if (!this._aiResult) return;
      try {
        const match = this._aiResult.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const json  = match ? match[1] : this._aiResult;
        const npc   = JSON.parse(json);
        const html  = `<h2>${npc.name}</h2><p><strong>Role:</strong> ${npc.role}</p><p><strong>Appearance:</strong> ${npc.appearance}</p><p><strong>Personality:</strong> ${npc.personality}</p><p><strong>Motivation:</strong> ${npc.motivation}</p><p><strong>Hook:</strong> ${npc.hook}</p><p><strong>Quirk:</strong> ${npc.quirk}</p><p><strong>Voice:</strong> ${npc.voice}</p><h3>GM Notes</h3><p><strong>Secret:</strong> ${npc.secret}</p>`;
        createJournalEntry(npc.name, html);
      } catch (e) {
        SPT.log("error", "NPCGen", "Parse failed:", e);
        ui.notifications.error("Could not parse NPC JSON.");
      }
    });
    el.querySelector("#spt-ai-create-recap")?.addEventListener("click", () => {
      if (!this._aiResult) return;
      const date  = new Date().toLocaleDateString();
      const html  = `<h2>Session Recap — ${date}</h2><p>${this._aiResult.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
      createJournalEntry(`Session Recap — ${date}`, html);
    });
    el.querySelector("#spt-ai-create-encounter")?.addEventListener("click", () => {
      if (!this._aiResult) return;
      try {
        const match   = this._aiResult.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const json    = match ? match[1] : this._aiResult;
        const enc     = JSON.parse(json);
        const enemies = (enc.enemies ?? []).map(e => `<li><strong>${e.count}x ${e.name}</strong> (${e.role}): ${e.tactic}</li>`).join("");
        const html    = `<h2>${enc.name}</h2><p>${enc.summary}</p><h3>Enemies</h3><ul>${enemies}</ul><h3>Terrain</h3><p>${(enc.terrain ?? []).join(", ")}</p><h3>Complications</h3><ul>${(enc.complications ?? []).map(c => `<li>${c}</li>`).join("")}</ul><h3>Objective</h3><p>${enc.objective}</p><h3>Rewards</h3><p>${enc.rewards}</p><h3>Escalation</h3><p>${enc.escalation}</p>`;
        createJournalEntry(enc.name, html);
      } catch (e) {
        SPT.log("error", "Encounter", "Parse failed:", e);
        ui.notifications.error("Could not parse encounter JSON.");
      }
    });
    el.querySelector("#spt-ai-create-handout")?.addEventListener("click", () => {
      if (!this._aiResult) return;
      const title = el.querySelector("#spt-ai-input")?.value?.trim() || "Handout";
      createHandout(title, this._aiResult);
    });
  };

  proto._generate = async function() {
    const el    = this.element;
    const input = el.querySelector("#spt-ai-input")?.value?.trim() ?? "";
    this._aiInput  = input;
    this._aiResult = null;
    this._aiLoading = true;
    await this.render();

    try {
      const ctx  = buildAIContext({ goals: true });
      let result = "";

      switch (this._aiTool) {
        case "journal":   result = await genJournal(input || "a mysterious location"); break;
        case "scene":     result = await genScene(input || "a generic fantasy scene"); break;
        case "npc":       result = await genNPC(input || "a mysterious stranger"); break;
        case "recap":     result = await genRecap(); break;
        case "encounter": result = await genEncounter(input || "a random encounter"); break;
        case "handout":   result = await genHandout(input || "a cryptic message"); break;
      }

      this._aiResult = result;
      SPT.log("info", "AI", `${this._aiTool} generated. Length:`, result.length);
    } catch (e) {
      SPT.log("error", "AI", "Generation failed:", e);
      ui.notifications.error(`${MODULE_TAG} | AI generation failed: ${e.message}`);
    }

    this._aiLoading = false;
    await this.render();
  };

  SPT.log("info", "P3Patch", "SPTFullWindow patched with AI Tools tab.");
}

// ---------------------------------------------------------------------------
// Pass 3 styles
// ---------------------------------------------------------------------------

function injectP3Styles() {
  if (document.getElementById("spt-p3-styles")) return;
  const s = document.createElement("style");
  s.id = "spt-p3-styles";
  s.textContent = `
    /* AI tab */
    .spt-ai            { display:flex; flex-direction:column; gap:10px; }
    .spt-ai-tools      { display:flex; flex-wrap:wrap; gap:4px; }
    .spt-ai-tool-btn   { padding:4px 12px; border-radius:12px; border:1px solid var(--spt-border); background:var(--spt-bg3); color:var(--spt-text); cursor:pointer; font-size:0.82em; }
    .spt-ai-tool-btn:hover  { border-color:var(--spt-accent2); }
    .spt-ai-tool-btn.active { background:var(--spt-accent); border-color:var(--spt-accent2); color:#fff; }
    .spt-ctx-toggle    { display:flex; align-items:center; gap:6px; font-size:0.82em; color:var(--spt-text-dim); }
    .spt-ai-input-wrap { display:flex; gap:6px; align-items:flex-end; }
    .spt-ai-input-wrap textarea { flex:1; min-height:60px; }
    .spt-ai-loading    { display:flex; align-items:center; gap:8px; color:var(--spt-text-dim); font-size:0.85em; padding:8px; }
    .spt-ai-spinner    { display:inline-block; animation:spt-spin 1s linear infinite; }
    @keyframes spt-spin { to { transform:rotate(360deg); } }

    /* Result */
    .spt-ai-result        { display:flex; flex-direction:column; gap:8px; }
    .spt-ai-result-body   { background:var(--spt-bg2); border:1px solid var(--spt-border); border-radius:var(--spt-radius); padding:12px; max-height:340px; overflow-y:auto; }
    .spt-ai-result-actions { display:flex; gap:6px; flex-wrap:wrap; }
    .spt-ai-raw           { font-family:monospace; font-size:0.75em; white-space:pre-wrap; color:var(--spt-text-dim); }
    .spt-ai-prose         { font-size:0.85em; line-height:1.7; }
    .spt-ai-journal-preview { font-size:0.85em; line-height:1.7; }
    .spt-ai-journal-preview h2, .spt-ai-journal-preview h3 { margin:8px 0 4px; color:var(--spt-accent2); }

    /* Card layout for JSON results */
    .spt-ai-card    { display:flex; flex-direction:column; gap:6px; }
    .spt-ai-row     { display:flex; gap:8px; font-size:0.83em; }
    .spt-ai-label   { color:var(--spt-text-dim); min-width:100px; font-size:0.9em; padding-top:1px; }
    .spt-ai-val     { flex:1; line-height:1.5; }
    .spt-ai-list    { margin:2px 0 0 16px; padding:0; }
    .spt-ai-list li { margin-bottom:2px; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

Hooks.once("init",  () => { registerP3Settings(); });

Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  injectP3Styles();
  patchFullWindow();

  // Extend API
  const api = game.modules.get(MODULE_ID).api ?? {};
  api.genJournal   = genJournal;
  api.genScene     = genScene;
  api.genNPC       = genNPC;
  api.genRecap     = genRecap;
  api.genEncounter = genEncounter;
  api.genHandout   = genHandout;
  api.callClaude   = callClaude;
  game.modules.get(MODULE_ID).api = api;

  SPT.log("info", "P3Ready", "Pass 3 loaded. AI tools available.");
});
