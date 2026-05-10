/**
 * Session Prep Toolkit — Pass 1: Live Session Foundation
 * Foundry VTT v13 / dnd5e v5.x
 * No AI dependencies. All document writes go through SPT.safe().
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_ID  = "session-prep-toolkit";
const MODULE_TAG = "Session Prep";

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3, verbose: 4 };

// ---------------------------------------------------------------------------
// Central logger
// ---------------------------------------------------------------------------

const SPT = {
  /** @param {"error"|"warn"|"info"|"debug"|"verbose"} level @param {string} ctx @param {...any} args */
  log(level, ctx, ...args) {
    const min = LOG_LEVELS[game.settings.get(MODULE_ID, "logLevel") ?? "warn"] ?? 1;
    if (LOG_LEVELS[level] > min) return;
    const tag = `[${MODULE_TAG}][${ctx}]`;
    if (level === "error") console.error(tag, ...args);
    else if (level === "warn") console.warn(tag, ...args);
    else console.log(tag, ...args);
    // Push to in-memory log for debug panel
    SPT._log.push({ ts: Date.now(), level, ctx, msg: args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") });
    if (SPT._log.length > 500) SPT._log.shift();
  },

  /** @type {{ts:number,level:string,ctx:string,msg:string}[]} */
  _log: [],

  /**
   * Wrap any document write. Respects Dry Run.
   * @param {string} ctx  Label for logging
   * @param {string} desc Human-readable description of the action
   * @param {()=>Promise<any>} fn  The async write function
   */
  async safe(ctx, desc, fn) {
    SPT.log("debug", ctx, "Intent:", desc);
    if (game.settings.get(MODULE_ID, "dryRun")) {
      SPT.log("info", ctx, "[DRY RUN] Would:", desc);
      ui.notifications.info(`[Dry Run] ${desc}`);
      return null;
    }
    try {
      const result = await fn();
      SPT.log("info", ctx, "Done:", desc);
      return result;
    } catch (e) {
      SPT.log("error", ctx, "Failed:", desc, e);
      ui.notifications.error(`${MODULE_TAG} | ${ctx} failed: ${e.message}`);
      throw e;
    }
  },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function registerSettings() {
  const defs = [
    { key: "logLevel",           name: "Log Level",              type: String,  default: "warn",  choices: { error:"Error", warn:"Warn", info:"Info", debug:"Debug", verbose:"Verbose" } },
    { key: "dryRun",             name: "Dry Run Mode",           type: Boolean, default: false,   hint: "Prevent all document writes. Logs what would happen instead." },
    { key: "showDebugPanel",     name: "Show Debug Tab",         type: Boolean, default: false,   hint: "Adds a Debug tab to the prep window." },
    { key: "disableItemHook",    name: "Disable Item Tracking",  type: Boolean, default: false,   hint: "Turn off the item-given hook if it causes conflicts." },
    { key: "disableSceneHook",   name: "Disable Scene Hook",     type: Boolean, default: false,   hint: "Turn off auto scene activation." },
    { key: "mockSession",        name: "Mock Session Mode",      type: Boolean, default: false,   hint: "Test Start/End session without affecting live world." },
    { key: "sessionState",       name: "",                       type: String,  default: "{}",    config: false },  // internal
    { key: "hookBank",           name: "",                       type: String,  default: "[]",    config: false },
    { key: "timeline",           name: "",                       type: String,  default: "[]",    config: false },
    { key: "conditions",         name: "",                       type: String,  default: "[]",    config: false },
    { key: "lootLog",            name: "",                       type: String,  default: "[]",    config: false },
  ];

  for (const d of defs) {
    const cfg = { scope: "world", config: d.config !== false, type: d.type, default: d.default, restricted: true };
    if (d.name)    cfg.name = d.name;
    if (d.hint)    cfg.hint = d.hint;
    if (d.choices) cfg.choices = d.choices;
    game.settings.register(MODULE_ID, d.key, cfg);
  }
  SPT.log("info", "Settings", "Registered.");
}

// ---------------------------------------------------------------------------
// Session state helpers
// ---------------------------------------------------------------------------

/** @returns {{active:boolean, playerIds:string[], sceneId:string|null, startedAt:number|null, liveNotes:{ts:number,type:string,text:string}[], itemLog:{ts:number,actorName:string,itemName:string,itemId:string,done:boolean}[]}} */
function getState() {
  try { return JSON.parse(game.settings.get(MODULE_ID, "sessionState")); }
  catch { return { active: false, playerIds: [], sceneId: null, startedAt: null, liveNotes: [], itemLog: [] }; }
}

/** @param {object} patch */
async function patchState(patch) {
  const state = { ...getState(), ...patch };
  await game.settings.set(MODULE_ID, "sessionState", JSON.stringify(state));
  SPT.log("verbose", "State", "Patched:", patch);
}

async function pushNote(type, text) {
  const state = getState();
  state.liveNotes.push({ ts: Date.now(), type, text });
  await game.settings.set(MODULE_ID, "sessionState", JSON.stringify(state));
}

async function pushItemLog(entry) {
  const state = getState();
  state.itemLog.push({ ts: Date.now(), done: false, ...entry });
  await game.settings.set(MODULE_ID, "sessionState", JSON.stringify(state));
}

function getHooks() { try { return JSON.parse(game.settings.get(MODULE_ID, "hookBank")); } catch { return []; } }
function getTimeline() { try { return JSON.parse(game.settings.get(MODULE_ID, "timeline")); } catch { return []; } }
function getConditions() { try { return JSON.parse(game.settings.get(MODULE_ID, "conditions")); } catch { return []; } }
function getLoot() { try { return JSON.parse(game.settings.get(MODULE_ID, "lootLog")); } catch { return []; } }

// ---------------------------------------------------------------------------
// Item tracking hook
// ---------------------------------------------------------------------------

function registerItemHook() {
  if (game.settings.get(MODULE_ID, "disableItemHook")) {
    SPT.log("info", "ItemHook", "Disabled by setting.");
    return;
  }

  Hooks.on("createItem", (item, options, userId) => {
    if (!game.user.isGM) return;
    if (userId !== game.user.id) return;         // only react to our own actions
    const actor = item.parent;
    if (!actor || actor.type === "npc") return;  // only player-owned actors

    SPT.log("debug", "ItemHook", "Item created on actor:", actor.name, item.name);
    pushItemLog({ actorName: actor.name, itemName: item.name, itemId: item.id, actorId: actor.id });

    // Flash the sidebar badge
    if (window._sptSidebar) window._sptSidebar.refreshBadge();
  });

  SPT.log("info", "ItemHook", "Registered.");
}

// ---------------------------------------------------------------------------
// Session Start / End
// ---------------------------------------------------------------------------

async function startSession() {
  SPT.log("info", "Session", "Start requested.");

  // Build player actor list
  const playerActors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
  if (!playerActors.length) { ui.notifications.warn(`${MODULE_TAG} | No player characters found.`); return; }

  const scenes = [...game.scenes];

  const actorChecks = playerActors.map(a =>
    `<label class="spt-player-check"><input type="checkbox" value="${a.id}" checked> ${a.name}</label>`
  ).join("");

  const sceneOptions = scenes.map(s =>
    `<option value="${s.id}" ${s.active ? "selected" : ""}>${s.name}</option>`
  ).join("");

  const content = `
    <div class="spt-start-dialog">
      <p><strong>Who is playing today?</strong></p>
      <div class="spt-player-list">${actorChecks}</div>
      <p style="margin-top:10px"><strong>Starting scene</strong></p>
      <select id="spt-scene-select" style="width:100%">${sceneOptions}</select>
    </div>`;

  const dialog = new Dialog({
    title: "Start Session",
    content,
    buttons: {
      start: {
        label: "Start Session",
        callback: async (html) => {
          const playerIds = [...html.querySelectorAll("input[type=checkbox]:checked")].map(c => c.value);
          const sceneId   = html.querySelector("#spt-scene-select")?.value ?? null;

          if (!playerIds.length) { ui.notifications.warn(`${MODULE_TAG} | Select at least one player.`); return; }

          // Activate scene
          if (sceneId && !game.settings.get(MODULE_ID, "disableSceneHook")) {
            const scene = game.scenes.get(sceneId);
            if (scene) {
              await SPT.safe("Session", `Activate scene: ${scene.name}`, () => scene.activate());
            }
          }

          await patchState({ active: true, playerIds, sceneId, startedAt: Date.now(), liveNotes: [], itemLog: [] });
          await pushNote("system", `Session started. Players: ${playerIds.map(id => game.actors.get(id)?.name ?? id).join(", ")}`);

          // Open and stack player sheets
          await openPlayerSheets(playerIds);

          // Log to timeline
          const tl = getTimeline();
          tl.push({ id: foundry.utils.randomID(16), date: new Date().toISOString(), summary: "Session started", playerIds, notes: [] });
          await game.settings.set(MODULE_ID, "timeline", JSON.stringify(tl));

          ui.notifications.info(`${MODULE_TAG} | Session started!`);
          if (window._sptSidebar) window._sptSidebar.render();
          SPT.log("info", "Session", "Started. Players:", playerIds, "Scene:", sceneId);
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "start",
  }, { width: 360 });

  dialog.render(true);
}

async function endSession() {
  SPT.log("info", "Session", "End requested.");
  const state = getState();
  if (!state.active) { ui.notifications.warn(`${MODULE_TAG} | No active session.`); return; }

  const confirmed = await Dialog.confirm({
    title: "End Session",
    content: `<p>End the current session and export notes to journal?</p>`,
  });
  if (!confirmed) return;

  await exportNotesToJournal(state);

  await patchState({ active: false });
  ui.notifications.info(`${MODULE_TAG} | Session ended. Notes exported.`);
  if (window._sptSidebar) window._sptSidebar.render();
  SPT.log("info", "Session", "Ended.");
}

async function openPlayerSheets(playerIds) {
  if (game.settings.get(MODULE_ID, "mockSession")) {
    SPT.log("info", "Session", "[MOCK] Would open sheets for:", playerIds);
    return;
  }

  const W = 560, H = 680, PAD = 30;
  let x = PAD, y = PAD;

  for (const id of playerIds) {
    const actor = game.actors.get(id);
    if (!actor) { SPT.log("warn", "Session", "Actor not found:", id); continue; }

    // Close existing sheet if open so we can reposition
    actor.sheet?.close({ force: true });
    await new Promise(r => setTimeout(r, 80));

    actor.sheet.render(true, { left: x, top: y, width: W, height: H });
    SPT.log("debug", "Session", "Opened sheet:", actor.name, "at", x, y);

    x += PAD;
    y += PAD;
  }
}

// ---------------------------------------------------------------------------
// Export session notes to journal
// ---------------------------------------------------------------------------

async function exportNotesToJournal(state) {
  const lines = state.liveNotes.map(n => {
    const time = new Date(n.ts).toLocaleTimeString();
    return `<li><strong>[${time}] ${n.type}:</strong> ${n.text}</li>`;
  }).join("");

  const itemRows = state.itemLog.map(e => {
    const time = new Date(e.ts).toLocaleTimeString();
    return `<li>[${time}] <strong>${e.actorName}</strong> received <em>${e.itemName}</em>${e.done ? " ✓" : " ⚠ pending"}</li>`;
  }).join("");

  const date   = new Date(state.startedAt ?? Date.now()).toLocaleDateString();
  const header = `<h2>Session Notes — ${date}</h2>`;
  const notesSection  = lines    ? `<h3>Live Notes</h3><ul>${lines}</ul>`    : "";
  const itemsSection  = itemRows ? `<h3>Item Log</h3><ul>${itemRows}</ul>` : "";
  const content = header + notesSection + itemsSection;

  await SPT.safe("Export", `Create journal entry: Session ${date}`, async () => {
    const entry = await JournalEntry.create({ name: `Session Notes — ${date}`, folder: null });
    await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name: `Session ${date}`, type: "text", text: { content },
    }]);
    entry.sheet.render(true);
  });
}

// ---------------------------------------------------------------------------
// Tension timer state
// ---------------------------------------------------------------------------

const _timers = [];
let   _timerInterval = null;

function addTimer(label, total) {
  const t = { id: foundry.utils.randomID(16), label, total, current: total };
  _timers.push(t);
  SPT.log("debug", "Timer", "Added:", label, total);
  _startTimerTick();
  return t;
}

function _startTimerTick() {
  if (_timerInterval) return;
  _timerInterval = setInterval(() => {
    if (window._sptSidebar) window._sptSidebar.refreshTimers();
  }, 1000);
}

// ---------------------------------------------------------------------------
// Sidebar ApplicationV2
// ---------------------------------------------------------------------------

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class SPTSidebar extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "spt-sidebar",
    classes: ["spt-sidebar"],
    window: { title: "Session Prep", resizable: false, minimizable: true },
    position: { width: 300, height: "auto", top: 80, left: window.innerWidth - 320 },
  };

  static PARTS = { main: { template: null } };

  constructor() {
    super({});
    this._tab         = "notes";
    this._addTimerOpen = false;
  }

  async _renderHTML(context, options) {
    const el = document.createElement("div");
    el.classList.add("spt-wrap");
    el.innerHTML = this._build();
    return { main: el };
  }

  _replaceHTML(result, content, options) {
    this.element.querySelector(".window-content").replaceChildren(result.main);
    this._listen();
  }

  // ---- builders ------------------------------------------------------------

  _build() {
    const state   = getState();
    const pending = state.itemLog.filter(e => !e.done).length;

    const tabs = [
      { id: "notes",   label: "Notes" },
      { id: "items",   label: `Items${pending ? ` <span class="spt-badge">${pending}</span>` : ""}` },
      { id: "loot",    label: "Loot" },
      { id: "cond",    label: "Conditions" },
      { id: "tables",  label: "Tables" },
      ...(game.settings.get(MODULE_ID, "showDebugPanel") ? [{ id: "debug", label: "Debug" }] : []),
    ].map(t => `<button class="spt-tab ${this._tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");

    const sessionBtn = state.active
      ? `<button id="spt-end-btn"   class="spt-btn spt-btn-danger">End Session</button>`
      : `<button id="spt-start-btn" class="spt-btn spt-btn-go">Start Session</button>`;

    const pullBtn = state.active
      ? `<button id="spt-pull-btn" class="spt-btn spt-btn-secondary">Pull Sheets</button>`
      : "";

    const openFullBtn = `<button id="spt-full-btn" class="spt-btn spt-btn-secondary">Full Prep Window ↗</button>`;

    return `
      <div class="spt-header">
        <div class="spt-session-status ${state.active ? "active" : "inactive"}">
          ${state.active ? `● Session Active` : "○ No Session"}
        </div>
        <div class="spt-header-btns">${sessionBtn}${pullBtn}</div>
      </div>
      <div class="spt-tabs">${tabs}</div>
      <div class="spt-tab-content">${this._buildTab(state)}</div>
      <div class="spt-footer">${openFullBtn}</div>`;
  }

  _buildTab(state) {
    switch (this._tab) {
      case "notes":  return this._buildNotes(state);
      case "items":  return this._buildItems(state);
      case "loot":   return this._buildLoot();
      case "cond":   return this._buildConditions();
      case "tables": return this._buildTables();
      case "debug":  return this._buildDebug();
    }
  }

  _buildNotes(state) {
    const stamps = [
      { type: "Item Given",    icon: "🎁" },
      { type: "NPC Met",       icon: "🧍" },
      { type: "Decision",      icon: "⚖️" },
      { type: "Combat",        icon: "⚔️" },
      { type: "Discovery",     icon: "🔍" },
      { type: "Note",          icon: "📝" },
    ].map(s => `<button class="spt-stamp-btn" data-type="${s.type}">${s.icon} ${s.type}</button>`).join("");

    const notes = [...(state.liveNotes ?? [])].reverse().slice(0, 30).map(n => {
      const time = new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<div class="spt-note-entry spt-note-${n.type.toLowerCase().replace(/\s/g,"-")}">
        <span class="spt-note-time">${time}</span>
        <span class="spt-note-type">${n.type}</span>
        <span class="spt-note-text">${n.text}</span>
      </div>`;
    }).join("") || `<p class="spt-empty">No notes yet.</p>`;

    // Tension timers
    const timerHtml = _timers.map(t => `
      <div class="spt-timer" data-id="${t.id}">
        <span class="spt-timer-label">${t.label}</span>
        <div class="spt-timer-controls">
          <button class="spt-timer-dec" data-id="${t.id}">-</button>
          <span class="spt-timer-val ${t.current <= 2 ? "urgent" : ""}">${t.current}</span>
          <button class="spt-timer-inc" data-id="${t.id}">+</button>
          <button class="spt-timer-del" data-id="${t.id}">✕</button>
        </div>
      </div>`).join("");

    return `
      <div class="spt-stamps">${stamps}</div>
      <div class="spt-quick-input">
        <input id="spt-note-input" type="text" placeholder="Quick note... (Enter to stamp)">
        <select id="spt-note-type">
          <option>Note</option><option>NPC Met</option><option>Decision</option>
          <option>Item Given</option><option>Combat</option><option>Discovery</option>
        </select>
      </div>
      <div class="spt-notes-log">${notes}</div>
      ${_timers.length ? `<div class="spt-timers">${timerHtml}</div>` : ""}
      <div class="spt-timer-add">
        ${this._addTimerOpen ? `
          <input id="spt-timer-label" type="text" placeholder="Timer label">
          <input id="spt-timer-count" type="number" min="1" value="5" style="width:60px">
          <button id="spt-timer-confirm" class="spt-btn">Add</button>
          <button id="spt-timer-cancel" class="spt-btn spt-btn-secondary">✕</button>
        ` : `<button id="spt-timer-open" class="spt-btn spt-btn-secondary">+ Tension Timer</button>`}
      </div>`;
  }

  _buildItems(state) {
    const items = state.itemLog ?? [];
    if (!items.length) return `<p class="spt-empty">No items logged this session.</p>`;

    const rows = [...items].reverse().map((e, ri) => {
      const idx  = items.length - 1 - ri;
      const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<div class="spt-item-row ${e.done ? "done" : "pending"}">
        <input type="checkbox" class="spt-item-check" data-idx="${idx}" ${e.done ? "checked" : ""}>
        <span class="spt-item-actor">${e.actorName}</span>
        <span class="spt-item-name">${e.itemName}</span>
        <span class="spt-item-time">${time}</span>
      </div>`;
    }).join("");

    return `
      <div class="spt-item-legend">
        <span class="spt-pending-dot">● Pending</span>
        <span class="spt-done-dot">● Done</span>
      </div>
      <div class="spt-item-list">${rows}</div>`;
  }

  _buildLoot() {
    const loot = getLoot();
    const rows = loot.map((e, i) => `
      <div class="spt-loot-row ${e.distributed ? "done" : ""}">
        <input type="checkbox" class="spt-loot-check" data-idx="${i}" ${e.distributed ? "checked" : ""}>
        <span class="spt-loot-text">${e.text}</span>
        <button class="spt-loot-del" data-idx="${i}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No loot logged.</p>`;

    return `
      <div class="spt-loot-list">${rows}</div>
      <div class="spt-loot-add">
        <input id="spt-loot-input" type="text" placeholder="e.g. 200gp, a silver ring...">
        <button id="spt-loot-add-btn" class="spt-btn">Add</button>
      </div>`;
  }

  _buildConditions() {
    const conds = getConditions();
    const rows = conds.map((c, i) => `
      <div class="spt-cond-row ${c.active ? "active" : "inactive"}">
        <button class="spt-cond-toggle" data-idx="${i}">${c.active ? "●" : "○"}</button>
        <span class="spt-cond-text">${c.text}</span>
        <button class="spt-cond-del" data-idx="${i}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No conditions.</p>`;

    return `
      <div class="spt-cond-list">${rows}</div>
      <div class="spt-cond-add">
        <input id="spt-cond-input" type="text" placeholder="e.g. Party is wanted in Thornwall">
        <button id="spt-cond-add-btn" class="spt-btn">Add</button>
      </div>`;
  }

  _buildTables() {
    const tables = [...game.tables].map(t =>
      `<option value="${t.id}">${t.name}</option>`
    ).join("");

    if (!tables) return `<p class="spt-empty">No roll tables in this world.</p>`;

    return `
      <div class="spt-tables">
        <select id="spt-table-select" style="width:100%">${tables}</select>
        <button id="spt-table-roll" class="spt-btn">Roll</button>
        <div id="spt-table-result" class="spt-table-result"></div>
      </div>`;
  }

  _buildDebug() {
    const state = getState();
    const logs  = SPT._log.slice(-40).reverse().map(e => {
      const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `<div class="spt-dbg-row spt-dbg-${e.level}">
        <span class="spt-dbg-time">${time}</span>
        <span class="spt-dbg-level">${e.level}</span>
        <span class="spt-dbg-ctx">[${e.ctx}]</span>
        <span class="spt-dbg-msg">${e.msg}</span>
      </div>`;
    }).join("") || `<p class="spt-empty">No log entries.</p>`;

    const hooks = Hooks._hooks ? [...Hooks._hooks].filter(([, v]) => v.some(f => f.toString().includes(MODULE_ID))).map(([k]) => k) : [];

    return `
      <div class="spt-debug">
        <div class="spt-dbg-actions">
          <button id="spt-dbg-copy-state" class="spt-btn spt-btn-secondary">Copy State</button>
          <button id="spt-dbg-reset"      class="spt-btn spt-btn-danger">Reset State</button>
        </div>
        <div class="spt-dbg-info">
          <strong>Active hooks:</strong> ${hooks.join(", ") || "none"}<br>
          <strong>Session active:</strong> ${state.active}<br>
          <strong>Players:</strong> ${(state.playerIds ?? []).map(id => game.actors.get(id)?.name ?? id).join(", ") || "none"}<br>
          <strong>Pending items:</strong> ${(state.itemLog ?? []).filter(e => !e.done).length}
        </div>
        <div class="spt-dbg-log">${logs}</div>
      </div>`;
  }

  // ---- listeners -----------------------------------------------------------

  _listen() {
    const el = this.element;

    el.querySelector("#spt-start-btn")?.addEventListener("click", () => startSession());
    el.querySelector("#spt-end-btn")?.addEventListener("click",   () => endSession());
    el.querySelector("#spt-pull-btn")?.addEventListener("click",  () => {
      const state = getState();
      if (state.playerIds?.length) openPlayerSheets(state.playerIds);
    });
    el.querySelector("#spt-full-btn")?.addEventListener("click",  () => { injectStyles(); new SPTFullWindow().render(true); });

    // Tab switching
    el.querySelectorAll(".spt-tab").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(); })
    );

    // Quick note input
    el.querySelector("#spt-note-input")?.addEventListener("keydown", async e => {
      if (e.key !== "Enter") return;
      const text = e.target.value.trim();
      if (!text) return;
      const type = el.querySelector("#spt-note-type")?.value ?? "Note";
      await pushNote(type, text);
      e.target.value = "";
      this.render();
    });

    // Stamp buttons
    el.querySelectorAll(".spt-stamp-btn").forEach(btn =>
      btn.addEventListener("click", async () => {
        const type = btn.dataset.type;
        const text = await new Promise(res => {
          new Dialog({
            title: type,
            content: `<input id="spt-stamp-val" type="text" placeholder="${type}..." style="width:100%">`,
            buttons: {
              ok: { label: "Add", callback: h => res(h.querySelector("#spt-stamp-val")?.value?.trim() ?? "") },
              cancel: { label: "Cancel", callback: () => res("") },
            },
            default: "ok",
            render: h => setTimeout(() => h.querySelector("#spt-stamp-val")?.focus(), 50),
          }).render(true);
        });
        if (text) { await pushNote(type, text); this.render(); }
      })
    );

    // Item checkboxes
    el.querySelectorAll(".spt-item-check").forEach(cb =>
      cb.addEventListener("change", async () => {
        const state = getState();
        const idx   = parseInt(cb.dataset.idx);
        state.itemLog[idx].done = cb.checked;
        await game.settings.set(MODULE_ID, "sessionState", JSON.stringify(state));
        this.render();
      })
    );

    // Loot
    el.querySelector("#spt-loot-add-btn")?.addEventListener("click", async () => {
      const input = el.querySelector("#spt-loot-input");
      const text  = input?.value?.trim();
      if (!text) return;
      const loot = getLoot();
      loot.push({ ts: Date.now(), text, distributed: false });
      await SPT.safe("Loot", `Add loot: ${text}`, () => game.settings.set(MODULE_ID, "lootLog", JSON.stringify(loot)));
      if (input) input.value = "";
      this.render();
    });
    el.querySelectorAll(".spt-loot-check").forEach(cb =>
      cb.addEventListener("change", async () => {
        const loot = getLoot();
        loot[parseInt(cb.dataset.idx)].distributed = cb.checked;
        await game.settings.set(MODULE_ID, "lootLog", JSON.stringify(loot));
        this.render();
      })
    );
    el.querySelectorAll(".spt-loot-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        const loot = getLoot();
        loot.splice(parseInt(btn.dataset.idx), 1);
        await game.settings.set(MODULE_ID, "lootLog", JSON.stringify(loot));
        this.render();
      })
    );

    // Conditions
    el.querySelector("#spt-cond-add-btn")?.addEventListener("click", async () => {
      const input = el.querySelector("#spt-cond-input");
      const text  = input?.value?.trim();
      if (!text) return;
      const conds = getConditions();
      conds.push({ text, active: true });
      await game.settings.set(MODULE_ID, "conditions", JSON.stringify(conds));
      if (input) input.value = "";
      this.render();
    });
    el.querySelectorAll(".spt-cond-toggle").forEach(btn =>
      btn.addEventListener("click", async () => {
        const conds = getConditions();
        const idx   = parseInt(btn.dataset.idx);
        conds[idx].active = !conds[idx].active;
        await game.settings.set(MODULE_ID, "conditions", JSON.stringify(conds));
        this.render();
      })
    );
    el.querySelectorAll(".spt-cond-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        const conds = getConditions();
        conds.splice(parseInt(btn.dataset.idx), 1);
        await game.settings.set(MODULE_ID, "conditions", JSON.stringify(conds));
        this.render();
      })
    );

    // Table roller
    el.querySelector("#spt-table-roll")?.addEventListener("click", async () => {
      const id    = el.querySelector("#spt-table-select")?.value;
      const table = game.tables.get(id);
      if (!table) return;
      const roll   = await table.roll();
      const result = roll.results?.[0]?.text ?? "(no result)";
      const resEl  = el.querySelector("#spt-table-result");
      if (resEl) resEl.innerHTML = `<strong>${table.name}:</strong> ${result}`;
      await pushNote("Table Roll", `${table.name}: ${result}`);
      SPT.log("info", "Tables", `Rolled ${table.name}: ${result}`);
    });

    // Timers
    el.querySelector("#spt-timer-open")?.addEventListener("click",   () => { this._addTimerOpen = true;  this.render(); });
    el.querySelector("#spt-timer-cancel")?.addEventListener("click", () => { this._addTimerOpen = false; this.render(); });
    el.querySelector("#spt-timer-confirm")?.addEventListener("click", () => {
      const label = el.querySelector("#spt-timer-label")?.value?.trim();
      const count = parseInt(el.querySelector("#spt-timer-count")?.value ?? "5");
      if (!label) return;
      addTimer(label, count);
      this._addTimerOpen = false;
      this.render();
    });
    el.querySelectorAll(".spt-timer-dec").forEach(btn =>
      btn.addEventListener("click", () => {
        const t = _timers.find(t => t.id === btn.dataset.id);
        if (t) { t.current = Math.max(0, t.current - 1); this.render(); }
      })
    );
    el.querySelectorAll(".spt-timer-inc").forEach(btn =>
      btn.addEventListener("click", () => {
        const t = _timers.find(t => t.id === btn.dataset.id);
        if (t) { t.current++; this.render(); }
      })
    );
    el.querySelectorAll(".spt-timer-del").forEach(btn =>
      btn.addEventListener("click", () => {
        const idx = _timers.findIndex(t => t.id === btn.dataset.id);
        if (idx > -1) { _timers.splice(idx, 1); this.render(); }
      })
    );

    // Debug actions
    el.querySelector("#spt-dbg-copy-state")?.addEventListener("click", () => {
      navigator.clipboard.writeText(JSON.stringify({ state: getState(), log: SPT._log.slice(-50) }, null, 2));
      ui.notifications.info("State copied.");
    });
    el.querySelector("#spt-dbg-reset")?.addEventListener("click", async () => {
      const ok = await Dialog.confirm({ title: "Reset Module State", content: "<p>Wipe all session state?</p>" });
      if (!ok) return;
      await game.settings.set(MODULE_ID, "sessionState", "{}");
      SPT._log.length = 0;
      this.render();
      SPT.log("info", "Debug", "State reset.");
    });
  }

  /** Refresh timer display without full re-render */
  refreshTimers() {
    this.element.querySelectorAll(".spt-timer").forEach(el => {
      const t = _timers.find(t => t.id === el.dataset.id);
      if (!t) return;
      const val = el.querySelector(".spt-timer-val");
      if (val) { val.textContent = t.current; val.classList.toggle("urgent", t.current <= 2); }
    });
  }

  refreshBadge() { this.render(); }
}

// ---------------------------------------------------------------------------
// Full prep window (stub for Pass 2)
// ---------------------------------------------------------------------------

class SPTFullWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "spt-full",
    classes: ["spt-full"],
    window: { title: "Session Prep — Full", resizable: true },
    position: { width: 860, height: 680 },
  };

  static PARTS = { main: { template: null } };

  async _renderHTML() {
    const el = document.createElement("div");
    el.style.cssText = "padding:24px;color:#aaa;";
    el.innerHTML = `<h2>Full Prep Window</h2><p>Pass 2 tools (Hook Bank, Timeline, Prep Checklist, Secrets, Relationship Web, Weather) will live here.</p>`;
    return { main: el };
  }

  _replaceHTML(r, c) { this.element.querySelector(".window-content").replaceChildren(r.main); }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById("spt-styles")) return;
  const s = document.createElement("style");
  s.id = "spt-styles";
  s.textContent = `
    /* Shared dark theme vars — referenced by all SPT modules */
    :root {
      --spt-bg:         #111318;
      --spt-bg2:        #1a1d24;
      --spt-bg3:        #22262f;
      --spt-border:     #2e3340;
      --spt-text:       #c8cdd8;
      --spt-text-dim:   #6b7280;
      --spt-accent:     #5a2d82;
      --spt-accent2:    #7a4da2;
      --spt-go:         #1a5c2a;
      --spt-go2:        #2a7c3a;
      --spt-danger:     #5c1a1a;
      --spt-danger2:    #7c2a2a;
      --spt-ok:         #1a3a1a;
      --spt-ok-text:    #7ddb7d;
      --spt-warn:       #3a2a00;
      --spt-warn-text:  #ddb97d;
      --spt-err:        #3a0d0d;
      --spt-err-text:   #db7d7d;
      --spt-radius:     4px;
    }

    /* Sidebar window */
    .spt-sidebar .window-content { padding:0; background:var(--spt-bg); color:var(--spt-text); }
    .spt-wrap          { display:flex; flex-direction:column; height:100%; }

    /* Header */
    .spt-header        { padding:8px 10px 6px; border-bottom:1px solid var(--spt-border); display:flex; flex-direction:column; gap:6px; }
    .spt-session-status { font-size:0.8em; font-weight:bold; letter-spacing:0.04em; }
    .spt-session-status.active   { color:var(--spt-ok-text); }
    .spt-session-status.inactive { color:var(--spt-text-dim); }
    .spt-header-btns   { display:flex; gap:6px; }

    /* Tabs */
    .spt-tabs          { display:flex; border-bottom:1px solid var(--spt-border); background:var(--spt-bg2); flex-shrink:0; overflow-x:auto; }
    .spt-tab           { padding:5px 10px; border:none; background:none; color:var(--spt-text-dim); cursor:pointer; font-size:0.78em; white-space:nowrap; border-bottom:2px solid transparent; }
    .spt-tab:hover     { color:var(--spt-text); }
    .spt-tab.active    { color:#fff; border-bottom-color:var(--spt-accent2); }
    .spt-badge         { background:var(--spt-accent); color:#fff; border-radius:8px; padding:0 5px; font-size:0.85em; }

    /* Tab content */
    .spt-tab-content   { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:6px; }
    .spt-empty         { color:var(--spt-text-dim); font-size:0.82em; text-align:center; padding:16px 0; }

    /* Buttons */
    .spt-btn           { padding:4px 12px; border-radius:var(--spt-radius); border:none; cursor:pointer; font-size:0.82em; color:#fff; background:var(--spt-accent); white-space:nowrap; }
    .spt-btn:hover     { background:var(--spt-accent2); }
    .spt-btn:disabled  { opacity:0.4; cursor:not-allowed; }
    .spt-btn-secondary { background:var(--spt-bg3); color:var(--spt-text); }
    .spt-btn-secondary:hover { background:var(--spt-border); }
    .spt-btn-go        { background:var(--spt-go); }
    .spt-btn-go:hover  { background:var(--spt-go2); }
    .spt-btn-danger    { background:var(--spt-danger); }
    .spt-btn-danger:hover { background:var(--spt-danger2); }

    /* Inputs */
    .spt-tab-content input[type=text],
    .spt-tab-content input[type=number],
    .spt-tab-content select {
      background:var(--spt-bg3); color:var(--spt-text); border:1px solid var(--spt-border);
      border-radius:var(--spt-radius); padding:3px 6px; font-size:0.82em; width:100%;
    }

    /* Notes tab */
    .spt-stamps        { display:flex; flex-wrap:wrap; gap:4px; }
    .spt-stamp-btn     { padding:3px 8px; border-radius:12px; border:1px solid var(--spt-border); background:var(--spt-bg3); color:var(--spt-text); cursor:pointer; font-size:0.78em; }
    .spt-stamp-btn:hover { border-color:var(--spt-accent2); }
    .spt-quick-input   { display:flex; gap:4px; }
    .spt-quick-input input { flex:1; }
    .spt-quick-input select { width:auto; }
    .spt-notes-log     { display:flex; flex-direction:column; gap:3px; max-height:220px; overflow-y:auto; }
    .spt-note-entry    { display:grid; grid-template-columns:40px 80px 1fr; gap:4px; font-size:0.78em; padding:3px 5px; border-radius:3px; background:var(--spt-bg2); }
    .spt-note-time     { color:var(--spt-text-dim); }
    .spt-note-type     { color:var(--spt-accent2); font-weight:bold; }

    /* Timers */
    .spt-timers        { display:flex; flex-direction:column; gap:4px; }
    .spt-timer         { display:flex; align-items:center; justify-content:space-between; background:var(--spt-bg2); border:1px solid var(--spt-border); border-radius:var(--spt-radius); padding:4px 8px; }
    .spt-timer-label   { font-size:0.82em; flex:1; }
    .spt-timer-controls { display:flex; align-items:center; gap:4px; }
    .spt-timer-val     { min-width:28px; text-align:center; font-weight:bold; font-size:1em; }
    .spt-timer-val.urgent { color:var(--spt-err-text); }
    .spt-timer-dec, .spt-timer-inc, .spt-timer-del { padding:1px 7px; font-size:0.85em; border-radius:3px; border:1px solid var(--spt-border); background:var(--spt-bg3); color:var(--spt-text); cursor:pointer; }
    .spt-timer-add     { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }

    /* Items */
    .spt-item-legend   { display:flex; gap:10px; font-size:0.75em; }
    .spt-pending-dot   { color:var(--spt-warn-text); }
    .spt-done-dot      { color:var(--spt-ok-text); }
    .spt-item-list     { display:flex; flex-direction:column; gap:3px; }
    .spt-item-row      { display:grid; grid-template-columns:18px 90px 1fr 40px; gap:4px; align-items:center; font-size:0.8em; padding:3px 5px; border-radius:3px; }
    .spt-item-row.pending { background:var(--spt-warn); }
    .spt-item-row.done    { background:var(--spt-ok); opacity:0.6; }
    .spt-item-actor    { font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .spt-item-time     { color:var(--spt-text-dim); font-size:0.9em; }

    /* Loot */
    .spt-loot-list     { display:flex; flex-direction:column; gap:3px; max-height:200px; overflow-y:auto; }
    .spt-loot-row      { display:flex; align-items:center; gap:6px; font-size:0.82em; padding:3px 5px; border-radius:3px; background:var(--spt-bg2); }
    .spt-loot-row.done { opacity:0.5; text-decoration:line-through; }
    .spt-loot-text     { flex:1; }
    .spt-loot-del      { background:none; border:none; cursor:pointer; color:var(--spt-text-dim); font-size:0.85em; }
    .spt-loot-add      { display:flex; gap:4px; }

    /* Conditions */
    .spt-cond-list     { display:flex; flex-direction:column; gap:3px; max-height:200px; overflow-y:auto; }
    .spt-cond-row      { display:flex; align-items:center; gap:6px; font-size:0.82em; padding:3px 5px; border-radius:3px; background:var(--spt-bg2); }
    .spt-cond-row.inactive { opacity:0.5; }
    .spt-cond-text     { flex:1; }
    .spt-cond-toggle   { background:none; border:none; cursor:pointer; font-size:1em; color:var(--spt-ok-text); width:20px; }
    .spt-cond-del      { background:none; border:none; cursor:pointer; color:var(--spt-text-dim); }
    .spt-cond-add      { display:flex; gap:4px; }

    /* Table roller */
    .spt-tables        { display:flex; flex-direction:column; gap:6px; }
    .spt-table-result  { background:var(--spt-bg2); border:1px solid var(--spt-border); border-radius:var(--spt-radius); padding:8px; font-size:0.85em; min-height:36px; }

    /* Debug */
    .spt-debug         { display:flex; flex-direction:column; gap:6px; }
    .spt-dbg-actions   { display:flex; gap:6px; }
    .spt-dbg-info      { font-size:0.78em; background:var(--spt-bg2); border:1px solid var(--spt-border); border-radius:var(--spt-radius); padding:6px; line-height:1.7; }
    .spt-dbg-log       { display:flex; flex-direction:column; gap:2px; max-height:240px; overflow-y:auto; font-family:monospace; font-size:0.72em; }
    .spt-dbg-row       { display:grid; grid-template-columns:52px 44px 80px 1fr; gap:3px; padding:2px 4px; border-radius:2px; }
    .spt-dbg-error     { background:var(--spt-err); }
    .spt-dbg-warn      { background:var(--spt-warn); }
    .spt-dbg-time      { color:var(--spt-text-dim); }
    .spt-dbg-level     { font-weight:bold; text-transform:uppercase; font-size:0.9em; }
    .spt-dbg-ctx       { color:var(--spt-accent2); }

    /* Footer */
    .spt-footer        { padding:6px 8px; border-top:1px solid var(--spt-border); background:var(--spt-bg2); }
    .spt-footer .spt-btn { width:100%; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

Hooks.once("init",  () => { registerSettings(); SPT.log("info", "Init", "Module init."); });

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  injectStyles();
  registerItemHook();

  const sidebar = new SPTSidebar();
  window._sptSidebar = sidebar;
  sidebar.render(true);

  game.modules.get(MODULE_ID).api = {
    open:      () => sidebar.render(true),
    openFull:  () => new SPTFullWindow().render(true),
    getState,
    pushNote,
    SPT,
  };

  SPT.log("info", "Ready", "Module ready.");
});
