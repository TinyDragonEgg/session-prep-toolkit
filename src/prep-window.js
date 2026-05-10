/**
 * Session Prep Toolkit — Pass 2: Full Prep Window (no AI)
 * Depends on: session-prep.js (Pass 1) being loaded first.
 * Adds: Hook Bank, Timeline, Prep Checklist, Secrets, Relationship Web,
 *       Weather, Session Goals, Name Generator.
 * Replaces the SPTFullWindow stub from Pass 1.
 */

// ---------------------------------------------------------------------------
// Data helpers — all stored in game.settings, keyed by module
// ---------------------------------------------------------------------------

const P2_KEYS = {
  HOOKS:     "p2-hooks",
  TIMELINE:  "timeline",   // shared with Pass 1
  CHECKLIST: "p2-checklist",
  SECRETS:   "p2-secrets",
  RELATIONS: "p2-relations",
  GOALS:     "p2-goals",
};

function registerP2Settings() {
  const defs = [
    { key: P2_KEYS.HOOKS,     default: "[]" },
    { key: P2_KEYS.CHECKLIST, default: "[]" },
    { key: P2_KEYS.SECRETS,   default: "[]" },
    { key: P2_KEYS.RELATIONS, default: "[]" },
    { key: P2_KEYS.GOALS,     default: JSON.stringify({ dm: "", players: "", world: "" }) },
  ];
  for (const d of defs) {
    try {
      game.settings.register(MODULE_ID, d.key, { scope: "world", config: false, type: String, default: d.default });
    } catch { /* already registered */ }
  }
  SPT.log("info", "P2Settings", "Registered.");
}

const load  = (key) => { try { return JSON.parse(game.settings.get(MODULE_ID, key)); } catch { return []; } };
const save  = (key, val) => game.settings.set(MODULE_ID, key, JSON.stringify(val));
const loadGoals = () => { try { return JSON.parse(game.settings.get(MODULE_ID, P2_KEYS.GOALS)); } catch { return { dm: "", players: "", world: "" }; } };

// ---------------------------------------------------------------------------
// Weather roller — pure random, no AI
// ---------------------------------------------------------------------------

const WEATHER_TABLES = {
  conditions: ["Clear skies", "Overcast", "Light rain", "Heavy rain", "Thunderstorm", "Fog", "Snow flurries", "Blizzard", "Scorching heat", "Biting cold", "Hail", "Eerie calm"],
  timeOfDay:  ["Dawn", "Morning", "Midday", "Afternoon", "Dusk", "Evening", "Midnight", "Dead of night"],
  mood:       ["Tense", "Melancholic", "Hopeful", "Ominous", "Festive", "Desolate", "Mysterious", "Peaceful", "Chaotic", "Oppressive"],
  wind:       ["Still", "Light breeze", "Gusty", "Strong winds", "Gale force"],
};

function rollWeather() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  return {
    condition: pick(WEATHER_TABLES.conditions),
    time:      pick(WEATHER_TABLES.timeOfDay),
    mood:      pick(WEATHER_TABLES.mood),
    wind:      pick(WEATHER_TABLES.wind),
  };
}

// ---------------------------------------------------------------------------
// Name generator — syllable tables, expandable in settings later
// ---------------------------------------------------------------------------

const NAME_TABLES = {
  "Generic Fantasy": {
    pre:  ["Al","Bel","Cor","Dal","El","Far","Gar","Hal","Il","Jor","Kal","Lor","Mir","Nor","Or","Pel","Qua","Ral","Ser","Tor","Ul","Val","Wyr","Xan","Yor","Zan"],
    mid:  ["a","e","i","o","u","an","en","in","on","ar","er","ir","or","al","el","il","ol"],
    suf:  ["dor","wyn","ath","ian","iel","ara","orn","eth","ir","os","as","en","iel","oth","ax","us"],
  },
  "Northern/Harsh": {
    pre:  ["Bryn","Drak","Grar","Hroth","Krag","Mord","Skar","Thor","Ulfr","Vrak","Wulf","Ygr"],
    mid:  ["","a","i","u","ar","or","ur"],
    suf:  ["gar","mir","ulf","nar","dar","grim","stein","helm","bjorn","var","dun","rak"],
  },
  "Elvish/Flowing": {
    pre:  ["Aer","Cael","Dae","El","Fael","Gal","Il","Lael","Mae","Nae","Oel","Pael","Rae","Sael","Tael","Uel","Vael","Yael","Zael"],
    mid:  ["a","e","i","ae","ei","ia","ie","ea","ai"],
    suf:  ["rian","iel","wen","diel","niel","thiel","rias","rial","riel","lien","mien","thien"],
  },
  "Desert/Arid": {
    pre:  ["Az","Bah","Dal","Ezz","Faz","Gar","Haz","Izz","Jal","Kaz","Mal","Naz","Paz","Raz","Sal","Tal","Uzz","Vaz","Waz","Zal"],
    mid:  ["a","i","u","ah","eh","ir","ur","al","ul"],
    suf:  ["zir","mir","nar","dar","sar","tar","var","war","zar","kal","mal","nal"],
  },
};

function generateName(style = "Generic Fantasy", gender = "neutral") {
  const table = NAME_TABLES[style] ?? NAME_TABLES["Generic Fantasy"];
  const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
  const useMid = Math.random() > 0.4;
  return pick(table.pre) + (useMid ? pick(table.mid) : "") + pick(table.suf);
}

// ---------------------------------------------------------------------------
// Full Prep Window — replaces the stub from Pass 1
// ---------------------------------------------------------------------------

const { ApplicationV2 } = foundry.applications.api;

class SPTFullWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "spt-full",
    classes: ["spt-full"],
    window: { title: "Session Prep — Full Window", resizable: true },
    position: { width: 900, height: 700 },
  };

  constructor() {
    super({});
    this._tab     = "checklist";
    this._weather = null;
    this._nameStyle  = "Generic Fantasy";
    this._nameGender = "neutral";
    this._generatedNames = [];
  }

  async _renderHTML(context, options) {
    const el = document.createElement("div");
    el.classList.add("spt-full-wrap");
    el.innerHTML = this._build();
    return { main: el };
  }

  _replaceHTML(result, content, options) {
    this.element.querySelector(".window-content").replaceChildren(result.main);
    this._listen();
  }

  // ---- top-level builder ---------------------------------------------------

  _build() {
    const tabs = [
      { id: "checklist", label: "Prep Checklist" },
      { id: "goals",     label: "Session Goals" },
      { id: "hooks",     label: "Hook Bank" },
      { id: "secrets",   label: "Secrets" },
      { id: "relations", label: "Relationships" },
      { id: "timeline",  label: "Timeline" },
      { id: "weather",   label: "Weather" },
      { id: "names",     label: "Names" },
    ].map(t => `<button class="spt-tab ${this._tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");

    return `
      <div class="spt-full-tabs">${tabs}</div>
      <div class="spt-full-content">${this._buildTab()}</div>`;
  }

  _buildTab() {
    switch (this._tab) {
      case "checklist": return this._buildChecklist();
      case "goals":     return this._buildGoals();
      case "hooks":     return this._buildHooks();
      case "secrets":   return this._buildSecrets();
      case "relations": return this._buildRelations();
      case "timeline":  return this._buildTimeline();
      case "weather":   return this._buildWeather();
      case "names":     return this._buildNames();
    }
  }

  // ---- Prep Checklist ------------------------------------------------------

  _buildChecklist() {
    const items = load(P2_KEYS.CHECKLIST);
    const done  = items.filter(i => i.done).length;

    const rows = items.map((item, idx) => `
      <div class="spt-check-row ${item.done ? "done" : ""}" data-idx="${idx}">
        <input type="checkbox" class="spt-check-cb" data-idx="${idx}" ${item.done ? "checked" : ""}>
        <span class="spt-check-cat spt-cat-${item.category}">${item.category}</span>
        <span class="spt-check-text">${item.text}</span>
        <button class="spt-icon-btn spt-check-del" data-idx="${idx}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No checklist items. Add some below.</p>`;

    const cats = ["Scene", "NPC", "Item", "Encounter", "Handout", "Other"];
    const catOpts = cats.map(c => `<option value="${c}">${c}</option>`).join("");

    return `
      <div class="spt-section-header">
        <span>Prep Checklist</span>
        <span class="spt-progress">${done} / ${items.length} done</span>
        <button id="spt-check-clear-done" class="spt-btn spt-btn-secondary">Clear Done</button>
      </div>
      <div class="spt-check-list">${rows}</div>
      <div class="spt-add-row">
        <select id="spt-check-cat">${catOpts}</select>
        <input id="spt-check-input" type="text" placeholder="What needs to be prepped?">
        <button id="spt-check-add" class="spt-btn">Add</button>
      </div>`;
  }

  // ---- Session Goals -------------------------------------------------------

  _buildGoals() {
    const g = loadGoals();
    return `
      <div class="spt-goals">
        <p class="spt-hint">Set your intentions before the session. These get included in the Recap Writer context in Pass 3.</p>
        <label class="spt-goal-label">What do <strong>you (DM)</strong> want to happen?
          <textarea id="spt-goal-dm" rows="3" placeholder="The party discovers the carnival's dark secret...">${g.dm}</textarea>
        </label>
        <label class="spt-goal-label">What do <strong>the players</strong> probably want?
          <textarea id="spt-goal-players" rows="3" placeholder="Zaya wants to find her missing friend...">${g.players}</textarea>
        </label>
        <label class="spt-goal-label">What is <strong>the world</strong> doing regardless?
          <textarea id="spt-goal-world" rows="3" placeholder="The carnival moves on in 3 days...">${g.world}</textarea>
        </label>
        <button id="spt-goals-save" class="spt-btn">Save Goals</button>
      </div>`;
  }

  // ---- Hook Bank -----------------------------------------------------------

  _buildHooks() {
    const hooks = load(P2_KEYS.HOOKS);
    const STATUS = { active: "●", unused: "○", done: "✓" };
    const COLORS = { active: "spt-ok-text", unused: "spt-text-dim", done: "spt-text-dim" };

    const rows = hooks.map((h, i) => `
      <div class="spt-hook-row spt-hook-${h.status}">
        <button class="spt-icon-btn spt-hook-cycle" data-idx="${i}" title="Cycle status">${STATUS[h.status] ?? "○"}</button>
        <div class="spt-hook-body">
          <span class="spt-hook-title">${h.title}</span>
          ${h.detail ? `<span class="spt-hook-detail">${h.detail}</span>` : ""}
        </div>
        <span class="spt-hook-status-label spt-hook-label-${h.status}">${h.status}</span>
        <button class="spt-icon-btn spt-hook-del" data-idx="${i}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No hooks yet.</p>`;

    const activeCount = hooks.filter(h => h.status === "active").length;

    return `
      <div class="spt-section-header">
        <span>Hook Bank</span>
        <span class="spt-hint">${activeCount} active — active hooks will feed into AI context in Pass 3</span>
      </div>
      <div class="spt-hook-list">${rows}</div>
      <div class="spt-add-row spt-add-col">
        <input id="spt-hook-title" type="text" placeholder="Hook title (e.g. The missing merchant)">
        <textarea id="spt-hook-detail" rows="2" placeholder="Detail / notes (optional)"></textarea>
        <button id="spt-hook-add" class="spt-btn">Add Hook</button>
      </div>`;
  }

  // ---- Secrets -------------------------------------------------------------

  _buildSecrets() {
    const secrets = load(P2_KEYS.SECRETS);

    const rows = secrets.map((s, i) => `
      <div class="spt-secret-row ${s.revealed ? "revealed" : ""}">
        <button class="spt-icon-btn spt-secret-toggle" data-idx="${i}" title="${s.revealed ? "Mark hidden" : "Mark revealed"}">
          ${s.revealed ? "👁" : "🔒"}
        </button>
        <div class="spt-secret-body">
          <span class="spt-secret-text">${s.text}</span>
          ${s.revealed ? `<span class="spt-secret-revealed-tag">Revealed</span>` : ""}
        </div>
        <button class="spt-icon-btn spt-secret-del" data-idx="${i}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No secrets tracked.</p>`;

    return `
      <div class="spt-section-header">
        <span>Secrets Tracker</span>
        <span class="spt-hint">Things the players don't know yet. Mark revealed when they find out.</span>
      </div>
      <div class="spt-secret-list">${rows}</div>
      <div class="spt-add-row">
        <input id="spt-secret-input" type="text" placeholder="e.g. The ringmaster is a lich">
        <button id="spt-secret-add" class="spt-btn">Add</button>
      </div>`;
  }

  // ---- Relationship Web ----------------------------------------------------

  _buildRelations() {
    const rels = load(P2_KEYS.RELATIONS);

    const rows = rels.map((r, i) => `
      <div class="spt-rel-row">
        <span class="spt-rel-a">${r.a}</span>
        <span class="spt-rel-verb">${r.verb}</span>
        <span class="spt-rel-b">${r.b}</span>
        ${r.note ? `<span class="spt-rel-note">${r.note}</span>` : ""}
        <button class="spt-icon-btn spt-rel-del" data-idx="${i}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No relationships tracked.</p>`;

    return `
      <div class="spt-section-header">
        <span>Relationship Web</span>
        <span class="spt-hint">NPC connections. Searchable in Pass 3 AI context.</span>
      </div>
      <input id="spt-rel-search" type="text" placeholder="Search by name..." style="margin-bottom:6px">
      <div class="spt-rel-list" id="spt-rel-list">${rows}</div>
      <div class="spt-add-col">
        <div class="spt-add-row">
          <input id="spt-rel-a"    type="text" placeholder="Name A" style="flex:1">
          <input id="spt-rel-verb" type="text" placeholder="relationship" style="flex:1" value="knows">
          <input id="spt-rel-b"    type="text" placeholder="Name B" style="flex:1">
        </div>
        <div class="spt-add-row">
          <input id="spt-rel-note" type="text" placeholder="Optional note (e.g. owes a debt)" style="flex:1">
          <button id="spt-rel-add" class="spt-btn">Add</button>
        </div>
      </div>`;
  }

  // ---- Timeline ------------------------------------------------------------

  _buildTimeline() {
    const tl = load(P2_KEYS.TIMELINE);

    const rows = [...tl].reverse().map((entry, i) => {
      const idx   = tl.length - 1 - i;
      const date  = new Date(entry.date).toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      const names = (entry.playerIds ?? []).map(id => game.actors.get(id)?.name ?? id).join(", ");
      return `
        <div class="spt-tl-entry">
          <div class="spt-tl-header">
            <span class="spt-tl-date">${date}</span>
            <span class="spt-tl-players">${names || "—"}</span>
          </div>
          <div class="spt-tl-summary">${entry.summary || "(no summary)"}</div>
          ${(entry.notes ?? []).map(n => `<div class="spt-tl-note">• ${n}</div>`).join("")}
          <button class="spt-icon-btn spt-tl-add-note" data-idx="${idx}">+ Note</button>
        </div>`;
    }).join("") || `<p class="spt-empty">No sessions logged yet.</p>`;

    return `
      <div class="spt-section-header">
        <span>Session Timeline</span>
        <span class="spt-hint">${tl.length} session(s) logged</span>
      </div>
      <div class="spt-tl-list">${rows}</div>
      <div class="spt-add-col">
        <p class="spt-hint">Manual session entry (auto-populated on session end):</p>
        <div class="spt-add-row">
          <input id="spt-tl-summary" type="text" placeholder="One-line session summary" style="flex:1">
          <button id="spt-tl-add" class="spt-btn">Add Entry</button>
        </div>
      </div>`;
  }

  // ---- Weather -------------------------------------------------------------

  _buildWeather() {
    const w = this._weather;
    return `
      <div class="spt-weather">
        <button id="spt-weather-roll" class="spt-btn">Roll Weather</button>
        ${w ? `
          <div class="spt-weather-result">
            <div class="spt-weather-row"><span class="spt-weather-label">Time of Day</span><span class="spt-weather-val">${w.time}</span></div>
            <div class="spt-weather-row"><span class="spt-weather-label">Condition</span><span class="spt-weather-val">${w.condition}</span></div>
            <div class="spt-weather-row"><span class="spt-weather-label">Wind</span><span class="spt-weather-val">${w.wind}</span></div>
            <div class="spt-weather-row"><span class="spt-weather-label">Mood</span><span class="spt-weather-val">${w.mood}</span></div>
          </div>
          <div class="spt-add-row">
            <button id="spt-weather-stamp" class="spt-btn spt-btn-secondary">Stamp to Live Notes</button>
          </div>` : `<p class="spt-empty">Click Roll Weather to generate atmosphere.</p>`}
      </div>`;
  }

  // ---- Name Generator ------------------------------------------------------

  _buildNames() {
    const styles  = Object.keys(NAME_TABLES);
    const styleOpts  = styles.map(s => `<option value="${s}" ${s === this._nameStyle ? "selected" : ""}>${s}</option>`).join("");

    const nameList = this._generatedNames.map((n, i) => `
      <div class="spt-name-row">
        <span class="spt-name-val">${n}</span>
        <button class="spt-icon-btn spt-name-copy" data-name="${n}" title="Copy">⎘</button>
        <button class="spt-icon-btn spt-name-stamp" data-name="${n}" title="Stamp to notes">📝</button>
        <button class="spt-icon-btn spt-name-del" data-idx="${i}">✕</button>
      </div>`).join("") || `<p class="spt-empty">No names generated yet.</p>`;

    return `
      <div class="spt-names">
        <p class="spt-hint">Placeholder syllable tables. You can expand the NAME_TABLES object with your continent conventions in Pass 3.</p>
        <div class="spt-add-row">
          <select id="spt-name-style">${styleOpts}</select>
          <input id="spt-name-count" type="number" min="1" max="20" value="5" style="width:60px">
          <button id="spt-name-gen" class="spt-btn">Generate</button>
          <button id="spt-name-clear" class="spt-btn spt-btn-secondary">Clear</button>
        </div>
        <div class="spt-name-list">${nameList}</div>
      </div>`;
  }

  // ---- Listeners -----------------------------------------------------------

  _listen() {
    const el = this.element;

    // Tabs
    el.querySelectorAll(".spt-tab").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(); })
    );

    // Checklist
    el.querySelectorAll(".spt-check-cb").forEach(cb =>
      cb.addEventListener("change", async () => {
        const items = load(P2_KEYS.CHECKLIST);
        items[parseInt(cb.dataset.idx)].done = cb.checked;
        await SPT.safe("Checklist", `Mark item ${cb.checked ? "done" : "undone"}`, () => save(P2_KEYS.CHECKLIST, items));
        this.render();
      })
    );
    el.querySelectorAll(".spt-check-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        const items = load(P2_KEYS.CHECKLIST);
        items.splice(parseInt(btn.dataset.idx), 1);
        await SPT.safe("Checklist", "Delete item", () => save(P2_KEYS.CHECKLIST, items));
        this.render();
      })
    );
    el.querySelector("#spt-check-add")?.addEventListener("click", async () => {
      const text = el.querySelector("#spt-check-input")?.value?.trim();
      const cat  = el.querySelector("#spt-check-cat")?.value ?? "Other";
      if (!text) return;
      const items = load(P2_KEYS.CHECKLIST);
      items.push({ text, category: cat, done: false });
      await SPT.safe("Checklist", `Add: ${text}`, () => save(P2_KEYS.CHECKLIST, items));
      el.querySelector("#spt-check-input").value = "";
      this.render();
    });
    el.querySelector("#spt-check-clear-done")?.addEventListener("click", async () => {
      const items = load(P2_KEYS.CHECKLIST).filter(i => !i.done);
      await SPT.safe("Checklist", "Clear done items", () => save(P2_KEYS.CHECKLIST, items));
      this.render();
    });

    // Goals
    el.querySelector("#spt-goals-save")?.addEventListener("click", async () => {
      const goals = {
        dm:      el.querySelector("#spt-goal-dm")?.value      ?? "",
        players: el.querySelector("#spt-goal-players")?.value ?? "",
        world:   el.querySelector("#spt-goal-world")?.value   ?? "",
      };
      await SPT.safe("Goals", "Save session goals", () => game.settings.set(MODULE_ID, P2_KEYS.GOALS, JSON.stringify(goals)));
      ui.notifications.info("Session goals saved.");
      SPT.log("info", "Goals", "Saved:", goals);
    });

    // Hooks
    el.querySelector("#spt-hook-add")?.addEventListener("click", async () => {
      const title  = el.querySelector("#spt-hook-title")?.value?.trim();
      const detail = el.querySelector("#spt-hook-detail")?.value?.trim();
      if (!title) return;
      const hooks = load(P2_KEYS.HOOKS);
      hooks.push({ id: foundry.utils.randomID(16), title, detail, status: "unused" });
      await SPT.safe("Hooks", `Add hook: ${title}`, () => save(P2_KEYS.HOOKS, hooks));
      el.querySelector("#spt-hook-title").value  = "";
      el.querySelector("#spt-hook-detail").value = "";
      this.render();
    });
    el.querySelectorAll(".spt-hook-cycle").forEach(btn =>
      btn.addEventListener("click", async () => {
        const hooks  = load(P2_KEYS.HOOKS);
        const idx    = parseInt(btn.dataset.idx);
        const cycle  = { unused: "active", active: "done", done: "unused" };
        hooks[idx].status = cycle[hooks[idx].status] ?? "unused";
        await SPT.safe("Hooks", `Cycle hook status: ${hooks[idx].title}`, () => save(P2_KEYS.HOOKS, hooks));
        this.render();
      })
    );
    el.querySelectorAll(".spt-hook-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        const hooks = load(P2_KEYS.HOOKS);
        hooks.splice(parseInt(btn.dataset.idx), 1);
        await SPT.safe("Hooks", "Delete hook", () => save(P2_KEYS.HOOKS, hooks));
        this.render();
      })
    );

    // Secrets
    el.querySelector("#spt-secret-add")?.addEventListener("click", async () => {
      const text = el.querySelector("#spt-secret-input")?.value?.trim();
      if (!text) return;
      const secrets = load(P2_KEYS.SECRETS);
      secrets.push({ text, revealed: false });
      await SPT.safe("Secrets", `Add secret`, () => save(P2_KEYS.SECRETS, secrets));
      el.querySelector("#spt-secret-input").value = "";
      this.render();
    });
    el.querySelectorAll(".spt-secret-toggle").forEach(btn =>
      btn.addEventListener("click", async () => {
        const secrets = load(P2_KEYS.SECRETS);
        const idx = parseInt(btn.dataset.idx);
        secrets[idx].revealed = !secrets[idx].revealed;
        await SPT.safe("Secrets", `Toggle secret revealed`, () => save(P2_KEYS.SECRETS, secrets));
        this.render();
      })
    );
    el.querySelectorAll(".spt-secret-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        const secrets = load(P2_KEYS.SECRETS);
        secrets.splice(parseInt(btn.dataset.idx), 1);
        await SPT.safe("Secrets", "Delete secret", () => save(P2_KEYS.SECRETS, secrets));
        this.render();
      })
    );

    // Relations
    el.querySelector("#spt-rel-search")?.addEventListener("input", e => {
      const q    = e.target.value.toLowerCase();
      const list = el.querySelector("#spt-rel-list");
      if (!list) return;
      list.querySelectorAll(".spt-rel-row").forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
    el.querySelector("#spt-rel-add")?.addEventListener("click", async () => {
      const a    = el.querySelector("#spt-rel-a")?.value?.trim();
      const verb = el.querySelector("#spt-rel-verb")?.value?.trim() || "knows";
      const b    = el.querySelector("#spt-rel-b")?.value?.trim();
      const note = el.querySelector("#spt-rel-note")?.value?.trim();
      if (!a || !b) { ui.notifications.warn(`${MODULE_TAG} | Both names are required.`); return; }
      const rels = load(P2_KEYS.RELATIONS);
      rels.push({ a, verb, b, note });
      await SPT.safe("Relations", `Add relation: ${a} ${verb} ${b}`, () => save(P2_KEYS.RELATIONS, rels));
      ["#spt-rel-a","#spt-rel-b","#spt-rel-note"].forEach(sel => { const inp = el.querySelector(sel); if (inp) inp.value = ""; });
      this.render();
    });
    el.querySelectorAll(".spt-rel-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        const rels = load(P2_KEYS.RELATIONS);
        rels.splice(parseInt(btn.dataset.idx), 1);
        await SPT.safe("Relations", "Delete relation", () => save(P2_KEYS.RELATIONS, rels));
        this.render();
      })
    );

    // Timeline
    el.querySelector("#spt-tl-add")?.addEventListener("click", async () => {
      const summary = el.querySelector("#spt-tl-summary")?.value?.trim();
      if (!summary) return;
      const tl = load(P2_KEYS.TIMELINE);
      tl.push({ id: foundry.utils.randomID(16), date: new Date().toISOString(), summary, playerIds: [], notes: [] });
      await SPT.safe("Timeline", `Add entry: ${summary}`, () => save(P2_KEYS.TIMELINE, tl));
      el.querySelector("#spt-tl-summary").value = "";
      this.render();
    });
    el.querySelectorAll(".spt-tl-add-note").forEach(btn =>
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.idx);
        const note = await new Promise(res =>
          new Dialog({
            title: "Add Note",
            content: `<input id="spt-tl-note-val" type="text" placeholder="Note..." style="width:100%">`,
            buttons: {
              ok:     { label: "Add",    callback: h => res(h.querySelector("#spt-tl-note-val")?.value?.trim() ?? "") },
              cancel: { label: "Cancel", callback: () => res("") },
            },
            default: "ok",
            render:  h => setTimeout(() => h.querySelector("#spt-tl-note-val")?.focus(), 50),
          }).render(true)
        );
        if (!note) return;
        const tl = load(P2_KEYS.TIMELINE);
        tl[idx].notes = [...(tl[idx].notes ?? []), note];
        await SPT.safe("Timeline", `Add note to entry ${idx}`, () => save(P2_KEYS.TIMELINE, tl));
        this.render();
      })
    );

    // Weather
    el.querySelector("#spt-weather-roll")?.addEventListener("click", () => {
      this._weather = rollWeather();
      SPT.log("debug", "Weather", "Rolled:", this._weather);
      this.render();
    });
    el.querySelector("#spt-weather-stamp")?.addEventListener("click", async () => {
      if (!this._weather) return;
      const text = `${this._weather.time} | ${this._weather.condition} | ${this._weather.wind} | Mood: ${this._weather.mood}`;
      await pushNote("Weather", text);
      ui.notifications.info("Weather stamped to Live Notes.");
    });

    // Names
    el.querySelector("#spt-name-style")?.addEventListener("change", e => { this._nameStyle = e.target.value; });
    el.querySelector("#spt-name-gen")?.addEventListener("click", () => {
      const count = parseInt(el.querySelector("#spt-name-count")?.value ?? "5");
      const style = el.querySelector("#spt-name-style")?.value ?? this._nameStyle;
      this._nameStyle = style;
      for (let i = 0; i < count; i++) this._generatedNames.push(generateName(style));
      this.render();
    });
    el.querySelector("#spt-name-clear")?.addEventListener("click", () => { this._generatedNames = []; this.render(); });
    el.querySelectorAll(".spt-name-copy").forEach(btn =>
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.name);
        ui.notifications.info(`Copied: ${btn.dataset.name}`);
      })
    );
    el.querySelectorAll(".spt-name-stamp").forEach(btn =>
      btn.addEventListener("click", async () => {
        await pushNote("Note", `NPC name: ${btn.dataset.name}`);
        ui.notifications.info(`Stamped: ${btn.dataset.name}`);
      })
    );
    el.querySelectorAll(".spt-name-del").forEach(btn =>
      btn.addEventListener("click", () => {
        this._generatedNames.splice(parseInt(btn.dataset.idx), 1);
        this.render();
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Pass 2 styles — appended to existing spt-styles
// ---------------------------------------------------------------------------

function injectP2Styles() {
  if (document.getElementById("spt-p2-styles")) return;
  const s = document.createElement("style");
  s.id = "spt-p2-styles";
  s.textContent = `
    /* Full window layout */
    .spt-full .window-content { background:var(--spt-bg); color:var(--spt-text); padding:0; }
    .spt-full-wrap    { display:flex; flex-direction:column; height:100%; }
    .spt-full-tabs    { display:flex; flex-wrap:wrap; gap:2px; padding:6px 8px 0; border-bottom:1px solid var(--spt-border); background:var(--spt-bg2); flex-shrink:0; }
    .spt-full-content { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }

    /* Shared section pieces */
    .spt-section-header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .spt-section-header > span:first-child { font-weight:bold; font-size:0.95em; }
    .spt-progress     { font-size:0.8em; color:var(--spt-ok-text); margin-left:auto; }
    .spt-hint         { font-size:0.78em; color:var(--spt-text-dim); }
    .spt-add-row      { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .spt-add-col      { display:flex; flex-direction:column; gap:6px; }
    .spt-icon-btn     { background:none; border:none; cursor:pointer; color:var(--spt-text-dim); font-size:0.9em; padding:0 4px; }
    .spt-icon-btn:hover { color:var(--spt-text); }

    /* Full-window inputs */
    .spt-full-content input[type=text],
    .spt-full-content input[type=number],
    .spt-full-content select,
    .spt-full-content textarea {
      background:var(--spt-bg3); color:var(--spt-text); border:1px solid var(--spt-border);
      border-radius:var(--spt-radius); padding:4px 7px; font-size:0.83em; width:100%;
    }
    .spt-full-content textarea { resize:vertical; }

    /* Checklist */
    .spt-check-list   { display:flex; flex-direction:column; gap:3px; max-height:380px; overflow-y:auto; }
    .spt-check-row    { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:var(--spt-radius); background:var(--spt-bg2); font-size:0.83em; }
    .spt-check-row.done { opacity:0.5; text-decoration:line-through; }
    .spt-check-text   { flex:1; }
    .spt-check-cat    { font-size:0.75em; padding:1px 6px; border-radius:8px; background:var(--spt-bg3); border:1px solid var(--spt-border); white-space:nowrap; }
    .spt-cat-Scene    { border-color:#4a4a8a; color:#9999dd; }
    .spt-cat-NPC      { border-color:#4a6a4a; color:#99bb99; }
    .spt-cat-Item     { border-color:#6a4a2a; color:#bbaa99; }
    .spt-cat-Encounter{ border-color:#6a2a2a; color:#dd9999; }
    .spt-cat-Handout  { border-color:#2a4a5a; color:#99bbcc; }

    /* Goals */
    .spt-goals        { display:flex; flex-direction:column; gap:10px; }
    .spt-goal-label   { display:flex; flex-direction:column; gap:4px; font-size:0.85em; }

    /* Hooks */
    .spt-hook-list    { display:flex; flex-direction:column; gap:4px; max-height:340px; overflow-y:auto; }
    .spt-hook-row     { display:flex; align-items:flex-start; gap:8px; padding:6px 8px; border-radius:var(--spt-radius); background:var(--spt-bg2); border-left:3px solid var(--spt-border); }
    .spt-hook-active  { border-left-color:var(--spt-ok-text); }
    .spt-hook-done    { border-left-color:var(--spt-text-dim); opacity:0.5; }
    .spt-hook-body    { flex:1; display:flex; flex-direction:column; gap:2px; }
    .spt-hook-title   { font-size:0.85em; font-weight:bold; }
    .spt-hook-detail  { font-size:0.78em; color:var(--spt-text-dim); }
    .spt-hook-status-label { font-size:0.72em; text-transform:uppercase; letter-spacing:0.05em; padding:1px 5px; border-radius:3px; }
    .spt-hook-label-active { background:var(--spt-ok); color:var(--spt-ok-text); }
    .spt-hook-label-unused { background:var(--spt-bg3); color:var(--spt-text-dim); }
    .spt-hook-label-done   { background:var(--spt-bg3); color:var(--spt-text-dim); }

    /* Secrets */
    .spt-secret-list  { display:flex; flex-direction:column; gap:4px; max-height:340px; overflow-y:auto; }
    .spt-secret-row   { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:var(--spt-radius); background:var(--spt-bg2); font-size:0.83em; }
    .spt-secret-row.revealed { opacity:0.55; }
    .spt-secret-body  { flex:1; display:flex; align-items:center; gap:8px; }
    .spt-secret-text  { flex:1; }
    .spt-secret-revealed-tag { font-size:0.72em; background:var(--spt-ok); color:var(--spt-ok-text); padding:1px 6px; border-radius:3px; }

    /* Relations */
    .spt-rel-list     { display:flex; flex-direction:column; gap:3px; max-height:300px; overflow-y:auto; }
    .spt-rel-row      { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:var(--spt-radius); background:var(--spt-bg2); font-size:0.82em; flex-wrap:wrap; }
    .spt-rel-a, .spt-rel-b { font-weight:bold; color:var(--spt-accent2); }
    .spt-rel-verb     { color:var(--spt-text-dim); font-style:italic; }
    .spt-rel-note     { color:var(--spt-text-dim); font-size:0.9em; flex-basis:100%; padding-left:10px; }

    /* Timeline */
    .spt-tl-list      { display:flex; flex-direction:column; gap:8px; max-height:380px; overflow-y:auto; }
    .spt-tl-entry     { background:var(--spt-bg2); border:1px solid var(--spt-border); border-radius:var(--spt-radius); padding:8px 10px; display:flex; flex-direction:column; gap:4px; }
    .spt-tl-header    { display:flex; gap:10px; align-items:baseline; }
    .spt-tl-date      { font-weight:bold; font-size:0.85em; }
    .spt-tl-players   { font-size:0.78em; color:var(--spt-text-dim); flex:1; }
    .spt-tl-summary   { font-size:0.85em; }
    .spt-tl-note      { font-size:0.78em; color:var(--spt-text-dim); padding-left:10px; }

    /* Weather */
    .spt-weather      { display:flex; flex-direction:column; gap:10px; }
    .spt-weather-result { background:var(--spt-bg2); border:1px solid var(--spt-border); border-radius:var(--spt-radius); padding:12px; display:flex; flex-direction:column; gap:8px; }
    .spt-weather-row  { display:flex; justify-content:space-between; align-items:center; font-size:0.88em; }
    .spt-weather-label { color:var(--spt-text-dim); }
    .spt-weather-val  { font-weight:bold; }

    /* Names */
    .spt-names        { display:flex; flex-direction:column; gap:8px; }
    .spt-name-list    { display:flex; flex-direction:column; gap:3px; max-height:380px; overflow-y:auto; }
    .spt-name-row     { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:var(--spt-radius); background:var(--spt-bg2); font-size:0.88em; }
    .spt-name-val     { flex:1; font-family:serif; font-size:1.05em; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Boot — appended to existing module lifecycle
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  registerP2Settings();
  injectP2Styles();

  // Expose updated api
  const api = game.modules.get(MODULE_ID).api ?? {};
  api.openFull     = () => { injectP2Styles(); new SPTFullWindow().render(true); };
  api.loadGoals    = loadGoals;
  api.loadHooks    = () => load(P2_KEYS.HOOKS);
  api.loadConditions = () => load(P2_KEYS.CHECKLIST); // for Pass 3 context
  game.modules.get(MODULE_ID).api = api;

  SPT.log("info", "P2Ready", "Pass 2 loaded.");
});
