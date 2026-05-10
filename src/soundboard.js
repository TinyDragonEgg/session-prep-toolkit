/**
 * Session Prep Toolkit — Pass 4: Soundboard Library
 * Depends on: session-prep.js (Pass 1) loaded first.
 * Adds: Freesound.org search, preview, download to Foundry data,
 *       auto-population of a Foundry Playlist, soundboard tab in sidebar.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const P4_KEYS = {
  FREESOUND_KEY: "p4-freesound-key",
  DOWNLOAD_PATH: "p4-download-path",
  SAVED_SOUNDS:  "p4-saved-sounds",
  PLAYLIST_ID:   "p4-playlist-id",
};

function registerP4Settings() {
  const defs = [
    {
      key: P4_KEYS.FREESOUND_KEY, type: String, default: "", config: true,
      name: "Freesound API Key",
      hint: "Get a free key at freesound.org/apiv2/apply. Required for sound search.",
    },
    {
      key: P4_KEYS.DOWNLOAD_PATH, type: String, default: "audio/spt", config: true,
      name: "Sound Download Folder",
      hint: "Path inside your Foundry Data folder where sounds are saved (e.g. audio/spt).",
    },
    { key: P4_KEYS.SAVED_SOUNDS, type: String, default: "[]",  config: false },
    { key: P4_KEYS.PLAYLIST_ID,  type: String, default: "",    config: false },
  ];

  for (const d of defs) {
    try {
      const cfg = { scope: "world", config: !!d.config, type: d.type, default: d.default, restricted: true };
      if (d.name) cfg.name = d.name;
      if (d.hint) cfg.hint = d.hint;
      game.settings.register(MODULE_ID, d.key, cfg);
    } catch { /* already registered */ }
  }
  SPT.log("info", "P4Settings", "Registered.");
}

const getFreesoundKey  = () => game.settings.get(MODULE_ID, P4_KEYS.FREESOUND_KEY);
const getDownloadPath  = () => game.settings.get(MODULE_ID, P4_KEYS.DOWNLOAD_PATH).replace(/^\/|\/$/g, "");
const getSavedSounds   = () => { try { return JSON.parse(game.settings.get(MODULE_ID, P4_KEYS.SAVED_SOUNDS)); } catch { return []; } };
const getPlaylistId    = () => game.settings.get(MODULE_ID, P4_KEYS.PLAYLIST_ID);

// ---------------------------------------------------------------------------
// Freesound API
// ---------------------------------------------------------------------------

const FREESOUND_BASE = "https://freesound.org/apiv2";

/**
 * Search Freesound for sounds matching a query.
 * @param {string} query
 * @param {number} [page=1]
 * @returns {Promise<{results: object[], count: number, next: string|null}>}
 */
async function searchFreesound(query, page = 1) {
  const key = getFreesoundKey();
  if (!key) throw new Error("No Freesound API key. Set it in Module Settings.");

  const params = new URLSearchParams({
    query,
    page,
    page_size: 12,
    fields: "id,name,duration,previews,license,username,tags,avg_rating",
    filter: "duration:[1 TO 300]",  // 1 sec to 5 min
    sort: "rating_desc",
  });

  SPT.log("debug", "Freesound", "Searching:", query, "page:", page);

  const res = await fetch(`${FREESOUND_BASE}/search/text/?${params}`, {
    headers: { Authorization: `Token ${key}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Freesound error ${res.status}`);
  }

  const data = await res.json();
  SPT.log("info", "Freesound", `Found ${data.count} results for "${query}"`);
  return { results: data.results ?? [], count: data.count ?? 0, next: data.next ?? null };
}

/**
 * Download a sound file from Freesound's HQ preview URL and save it
 * to the Foundry data folder. Returns the saved path.
 * @param {{id:number, name:string, previews: object}} sound
 * @returns {Promise<string>} Saved path relative to Foundry Data
 */
async function downloadSound(sound) {
  const key = getFreesoundKey();
  if (!key) throw new Error("No Freesound API key.");

  const previewUrl = sound.previews?.["preview-hq-mp3"] ?? sound.previews?.["preview-lq-mp3"];
  if (!previewUrl) throw new Error("No preview URL available for this sound.");

  const folder   = getDownloadPath();
  const safeName = sound.name.replace(/[^a-z0-9_\-]/gi, "_").substring(0, 60);
  const filename = `fs_${sound.id}_${safeName}.mp3`;
  const fullPath = `${folder}/${filename}`;

  SPT.log("debug", "Download", "Fetching:", previewUrl);

  // Fetch the audio blob
  const res = await fetch(previewUrl);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: "audio/mpeg" });

  // Ensure folder exists
  await FilePicker.createDirectory("data", folder).catch(() => {
    SPT.log("debug", "Download", "Folder already exists or creation skipped.");
  });

  // Upload to Foundry data
  const upload = await FilePicker.upload("data", folder, file, {});
  if (!upload?.path) throw new Error("Upload failed — no path returned.");

  SPT.log("info", "Download", "Saved:", upload.path);
  return upload.path;
}

// ---------------------------------------------------------------------------
// Foundry Playlist management
// ---------------------------------------------------------------------------

/**
 * Get or create the SPT Soundboard playlist.
 * @returns {Promise<Playlist>}
 */
async function getOrCreatePlaylist() {
  const existingId = getPlaylistId();
  if (existingId) {
    const pl = game.playlists.get(existingId);
    if (pl) return pl;
  }

  SPT.log("info", "Playlist", "Creating SPT Soundboard playlist.");
  const pl = await SPT.safe("Playlist", "Create SPT Soundboard playlist", () =>
    Playlist.create({ name: "SPT Soundboard", mode: -1, playing: false })
  );
  await game.settings.set(MODULE_ID, P4_KEYS.PLAYLIST_ID, pl.id);
  return pl;
}

/**
 * Add a downloaded sound to the SPT playlist.
 * @param {string} path - Foundry data path
 * @param {string} name
 * @returns {Promise<PlaylistSound>}
 */
async function addToPlaylist(path, name) {
  const pl = await getOrCreatePlaylist();
  return SPT.safe("Playlist", `Add sound: ${name}`, () =>
    pl.createEmbeddedDocuments("PlaylistSound", [{
      name,
      path,
      volume: 0.5,
      repeat: false,
      playing: false,
    }])
  );
}

/**
 * Play a sound from the SPT playlist by path.
 * @param {string} path
 */
async function playSound(path) {
  const pl = game.playlists.get(getPlaylistId());
  if (!pl) { ui.notifications.warn("SPT Soundboard playlist not found."); return; }

  const sound = pl.sounds.find(s => s.path === path);
  if (!sound) { ui.notifications.warn("Sound not found in playlist."); return; }

  await SPT.safe("Playlist", `Play: ${sound.name}`, () => pl.playSound(sound));
  SPT.log("info", "Playlist", "Playing:", sound.name);
}

/**
 * Stop all playing sounds in the SPT playlist.
 */
async function stopAll() {
  const pl = game.playlists.get(getPlaylistId());
  if (!pl) return;
  await SPT.safe("Playlist", "Stop all sounds", () => pl.stopAll());
  SPT.log("info", "Playlist", "Stopped all.");
}

// ---------------------------------------------------------------------------
// Saved sounds store
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SavedSound
 * @property {number}  id        Freesound ID
 * @property {string}  name
 * @property {string}  path      Foundry data path
 * @property {string}  tags
 * @property {string}  license
 * @property {string}  category  User-assigned category
 * @property {number}  duration
 */

async function saveSound(sound, foundryPath) {
  const sounds = getSavedSounds();
  if (sounds.find(s => s.id === sound.id)) return; // already saved
  sounds.push({
    id: sound.id,
    name: sound.name,
    path: foundryPath,
    tags: (sound.tags ?? []).slice(0, 6).join(", "),
    license: sound.license ?? "",
    category: "Uncategorized",
    duration: Math.round(sound.duration ?? 0),
  });
  await game.settings.set(MODULE_ID, P4_KEYS.SAVED_SOUNDS, JSON.stringify(sounds));
  SPT.log("info", "Library", "Saved sound:", sound.name);
}

async function removeSound(id) {
  const sounds = getSavedSounds().filter(s => s.id !== id);
  await game.settings.set(MODULE_ID, P4_KEYS.SAVED_SOUNDS, JSON.stringify(sounds));
  SPT.log("info", "Library", "Removed sound id:", id);
}

async function setCategoryFor(id, category) {
  const sounds = getSavedSounds();
  const s = sounds.find(s => s.id === id);
  if (s) s.category = category;
  await game.settings.set(MODULE_ID, P4_KEYS.SAVED_SOUNDS, JSON.stringify(sounds));
}

// ---------------------------------------------------------------------------
// Soundboard tab — patched into SPTSidebar
// ---------------------------------------------------------------------------

/**
 * We patch SPTSidebar's prototype to add the Sounds tab after Pass 1 has loaded.
 * Same isolation pattern used in Pass 3.
 */
function patchSidebar() {
  const proto = SPTSidebar.prototype;

  // Add "sounds" to the tab bar by wrapping _build
  const _origBuild = proto._build;
  proto._build = function() {
    const html = _origBuild.call(this);
    // Inject tab button before closing tabs div
    return html.replace(
      `...(game.settings.get(MODULE_ID, "showDebugPanel") ? [{ id: "debug", label: "Debug" }] : []),`,
      `...(game.settings.get(MODULE_ID, "showDebugPanel") ? [{ id: "debug", label: "Debug" }] : []),
      { id: "sounds", label: "🔊" },`
    );
  };

  // Rather than wrapping the tab array (which is inline), we override _buildTab
  const _origBuildTab = proto._buildTab;
  proto._buildTab = function(state) {
    if (this._tab === "sounds") return this._buildSounds();
    return _origBuildTab.call(this, state);
  };

  // Soundboard state
  proto._sbQuery    = "";
  proto._sbResults  = [];
  proto._sbPage     = 1;
  proto._sbLoading  = false;
  proto._sbFilter   = "all";
  proto._sbPreview  = null; // currently previewing sound id
  proto._sbCount    = 0;

  proto._buildSounds = function() {
    const saved    = getSavedSounds();
    const cats     = ["all", ...new Set(saved.map(s => s.category))];
    const filtered = this._sbFilter === "all" ? saved : saved.filter(s => s.category === this._sbFilter);

    const catBtns = cats.map(c =>
      `<button class="spt-sb-filter ${this._sbFilter === c ? "active" : ""}" data-cat="${c}">${c}</button>`
    ).join("");

    const libraryRows = filtered.map(s => `
      <div class="spt-sb-row" data-id="${s.id}">
        <button class="spt-sb-play" data-path="${s.path}" title="Play">▶</button>
        <div class="spt-sb-info">
          <span class="spt-sb-name">${s.name}</span>
          <span class="spt-sb-meta">${s.duration}s · ${s.tags}</span>
        </div>
        <select class="spt-sb-cat-sel" data-id="${s.id}">
          ${["Uncategorized","Ambience","Combat","Nature","Urban","Magic","Horror","Travel"].map(c =>
            `<option value="${c}" ${s.category === c ? "selected" : ""}>${c}</option>`
          ).join("")}
        </select>
        <button class="spt-sb-del" data-id="${s.id}" title="Remove">✕</button>
      </div>`).join("") || `<p class="spt-empty">No sounds saved yet. Search below.</p>`;

    const searchRows = this._sbResults.map(r => {
      const dur      = Math.round(r.duration ?? 0);
      const saved    = getSavedSounds().find(s => s.id === r.id);
      const isPrev   = this._sbPreview === r.id;
      return `
        <div class="spt-sb-result">
          <div class="spt-sb-result-info">
            <span class="spt-sb-name">${r.name}</span>
            <span class="spt-sb-meta">${dur}s · ${r.username}</span>
          </div>
          <div class="spt-sb-result-btns">
            <button class="spt-sb-prev-btn ${isPrev ? "active" : ""}" data-id="${r.id}" data-url="${r.previews?.["preview-hq-mp3"] ?? ""}" title="Preview">
              ${isPrev ? "⏹" : "▶"}
            </button>
            ${saved
              ? `<span class="spt-sb-saved-badge">✓ Saved</span>`
              : `<button class="spt-sb-dl-btn" data-idx="${this._sbResults.indexOf(r)}" title="Download & Save">⬇ Save</button>`
            }
          </div>
        </div>`;
    }).join("");

    const hasKey = !!getFreesoundKey();

    return `
      <div class="spt-sb-library">
        <div class="spt-sb-header">
          <span>Library (${saved.length})</span>
          <button id="spt-sb-stop-all" class="spt-btn spt-btn-secondary spt-btn-sm">■ Stop All</button>
        </div>
        <div class="spt-sb-cats">${catBtns}</div>
        <div class="spt-sb-list">${libraryRows}</div>
      </div>

      <div class="spt-sb-search">
        ${!hasKey ? `<p class="spt-sb-warn">Set your Freesound API key in Module Settings to search.</p>` : ""}
        <div class="spt-sb-search-row">
          <input id="spt-sb-query" type="text" placeholder="Search sounds... (e.g. rain cave)" value="${this._sbQuery}" ${!hasKey ? "disabled" : ""}>
          <button id="spt-sb-search-btn" class="spt-btn" ${this._sbLoading || !hasKey ? "disabled" : ""}>
            ${this._sbLoading ? "..." : "Search"}
          </button>
        </div>
        ${this._sbResults.length ? `
          <div class="spt-sb-results">${searchRows}</div>
          ${this._sbCount > 12 ? `
            <div class="spt-sb-pages">
              <button id="spt-sb-prev-page" class="spt-btn spt-btn-secondary spt-btn-sm" ${this._sbPage <= 1 ? "disabled" : ""}>◀</button>
              <span>Page ${this._sbPage}</span>
              <button id="spt-sb-next-page" class="spt-btn spt-btn-secondary spt-btn-sm">▶</button>
            </div>` : ""}` : ""}
      </div>`;
  };

  // Extend _listen
  const _origListen = proto._listen;
  proto._listen = function() {
    _origListen.call(this);
    if (this._tab !== "sounds") return;
    const el = this.element;

    // Stop all
    el.querySelector("#spt-sb-stop-all")?.addEventListener("click", () => {
      stopAll();
      this._sbPreview = null;
      if (this._currentAudio) { this._currentAudio.pause(); this._currentAudio = null; }
    });

    // Category filter
    el.querySelectorAll(".spt-sb-filter").forEach(btn =>
      btn.addEventListener("click", () => { this._sbFilter = btn.dataset.cat; this.render(); })
    );

    // Play saved sound
    el.querySelectorAll(".spt-sb-play").forEach(btn =>
      btn.addEventListener("click", () => playSound(btn.dataset.path))
    );

    // Category reassign
    el.querySelectorAll(".spt-sb-cat-sel").forEach(sel =>
      sel.addEventListener("change", async () => {
        await setCategoryFor(parseInt(sel.dataset.id), sel.value);
        this.render();
      })
    );

    // Remove from library
    el.querySelectorAll(".spt-sb-del").forEach(btn =>
      btn.addEventListener("click", async () => {
        await removeSound(parseInt(btn.dataset.id));
        this.render();
      })
    );

    // Search
    el.querySelector("#spt-sb-query")?.addEventListener("keydown", e => {
      if (e.key === "Enter") el.querySelector("#spt-sb-search-btn")?.click();
    });
    el.querySelector("#spt-sb-search-btn")?.addEventListener("click", async () => {
      const q = el.querySelector("#spt-sb-query")?.value?.trim();
      if (!q) return;
      this._sbQuery   = q;
      this._sbPage    = 1;
      this._sbLoading = true;
      await this.render();
      try {
        const data = await searchFreesound(q, 1);
        this._sbResults = data.results;
        this._sbCount   = data.count;
      } catch (e) {
        SPT.log("error", "Freesound", "Search failed:", e);
        ui.notifications.error(`Freesound search failed: ${e.message}`);
        this._sbResults = [];
      }
      this._sbLoading = false;
      await this.render();
    });

    // Pagination
    el.querySelector("#spt-sb-prev-page")?.addEventListener("click", async () => {
      if (this._sbPage <= 1) return;
      this._sbPage--;
      this._sbLoading = true;
      await this.render();
      const data = await searchFreesound(this._sbQuery, this._sbPage).catch(() => ({ results: [], count: 0 }));
      this._sbResults = data.results;
      this._sbLoading = false;
      await this.render();
    });
    el.querySelector("#spt-sb-next-page")?.addEventListener("click", async () => {
      this._sbPage++;
      this._sbLoading = true;
      await this.render();
      const data = await searchFreesound(this._sbQuery, this._sbPage).catch(() => ({ results: [], count: 0 }));
      this._sbResults = data.results;
      this._sbLoading = false;
      await this.render();
    });

    // Preview (browser Audio, not Foundry)
    el.querySelectorAll(".spt-sb-prev-btn").forEach(btn =>
      btn.addEventListener("click", () => {
        const id  = parseInt(btn.dataset.id);
        const url = btn.dataset.url;

        // Stop current preview if any
        if (this._currentAudio) { this._currentAudio.pause(); this._currentAudio = null; }

        if (this._sbPreview === id) {
          // Toggle off
          this._sbPreview = null;
          this.render();
          return;
        }

        if (!url) { ui.notifications.warn("No preview available for this sound."); return; }

        this._sbPreview   = id;
        this._currentAudio = new Audio(url);
        this._currentAudio.volume = 0.6;
        this._currentAudio.play().catch(e => {
          SPT.log("error", "Preview", "Playback failed:", e);
          ui.notifications.error("Preview playback failed. Check browser audio permissions.");
        });
        this._currentAudio.onended = () => { this._sbPreview = null; this._currentAudio = null; this.render(); };
        this.render();
        SPT.log("debug", "Preview", "Previewing id:", id);
      })
    );

    // Download & save
    el.querySelectorAll(".spt-sb-dl-btn").forEach(btn =>
      btn.addEventListener("click", async () => {
        const idx   = parseInt(btn.dataset.idx);
        const sound = this._sbResults[idx];
        if (!sound) return;

        btn.disabled    = true;
        btn.textContent = "...";
        SPT.log("info", "Download", "Starting download:", sound.name);

        try {
          const path = await downloadSound(sound);
          await saveSound(sound, path);
          await addToPlaylist(path, sound.name);
          ui.notifications.info(`"${sound.name}" saved and added to SPT Soundboard playlist.`);
          await this.render();
        } catch (e) {
          SPT.log("error", "Download", "Failed:", e);
          ui.notifications.error(`Download failed: ${e.message}`);
          btn.disabled    = false;
          btn.textContent = "⬇ Save";
        }
      })
    );
  };

  SPT.log("info", "P4Patch", "SPTSidebar patched with Sounds tab.");
}

// ---------------------------------------------------------------------------
// Pass 4 styles
// ---------------------------------------------------------------------------

function injectP4Styles() {
  if (document.getElementById("spt-p4-styles")) return;
  const s = document.createElement("style");
  s.id = "spt-p4-styles";
  s.textContent = `
    /* Soundboard layout */
    .spt-sb-library    { display:flex; flex-direction:column; gap:4px; }
    .spt-sb-header     { display:flex; align-items:center; justify-content:space-between; }
    .spt-sb-header span { font-weight:bold; font-size:0.85em; }
    .spt-btn-sm        { padding:2px 8px; font-size:0.78em; }
    .spt-sb-cats       { display:flex; flex-wrap:wrap; gap:3px; }
    .spt-sb-filter     { padding:2px 7px; border-radius:10px; border:1px solid var(--spt-border); background:var(--spt-bg3); color:var(--spt-text-dim); cursor:pointer; font-size:0.75em; }
    .spt-sb-filter:hover { border-color:var(--spt-accent2); color:var(--spt-text); }
    .spt-sb-filter.active { background:var(--spt-accent); border-color:var(--spt-accent2); color:#fff; }

    /* Library rows */
    .spt-sb-list       { display:flex; flex-direction:column; gap:3px; max-height:180px; overflow-y:auto; }
    .spt-sb-row        { display:flex; align-items:center; gap:5px; padding:3px 5px; border-radius:var(--spt-radius); background:var(--spt-bg2); font-size:0.78em; }
    .spt-sb-play       { background:var(--spt-go); border:none; color:#fff; border-radius:50%; width:20px; height:20px; cursor:pointer; font-size:0.8em; flex-shrink:0; }
    .spt-sb-play:hover { background:var(--spt-go2); }
    .spt-sb-info       { flex:1; display:flex; flex-direction:column; overflow:hidden; }
    .spt-sb-name       { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .spt-sb-meta       { color:var(--spt-text-dim); font-size:0.85em; }
    .spt-sb-cat-sel    { width:90px; font-size:0.75em; padding:1px 3px; }
    .spt-sb-del        { background:none; border:none; cursor:pointer; color:var(--spt-text-dim); font-size:0.85em; }

    /* Search section */
    .spt-sb-search     { display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--spt-border); padding-top:8px; margin-top:4px; }
    .spt-sb-search-row { display:flex; gap:4px; }
    .spt-sb-warn       { color:var(--spt-warn-text); font-size:0.78em; background:var(--spt-warn); border-radius:var(--spt-radius); padding:4px 8px; }

    /* Search results */
    .spt-sb-results    { display:flex; flex-direction:column; gap:3px; max-height:200px; overflow-y:auto; }
    .spt-sb-result     { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:4px 6px; border-radius:var(--spt-radius); background:var(--spt-bg2); font-size:0.78em; }
    .spt-sb-result-info { flex:1; display:flex; flex-direction:column; overflow:hidden; }
    .spt-sb-result-btns { display:flex; align-items:center; gap:4px; flex-shrink:0; }
    .spt-sb-prev-btn   { background:var(--spt-bg3); border:1px solid var(--spt-border); color:var(--spt-text); border-radius:3px; padding:1px 6px; cursor:pointer; font-size:0.85em; }
    .spt-sb-prev-btn.active { background:var(--spt-danger); border-color:var(--spt-danger2); }
    .spt-sb-dl-btn     { background:var(--spt-accent); border:none; color:#fff; border-radius:3px; padding:1px 6px; cursor:pointer; font-size:0.78em; }
    .spt-sb-dl-btn:hover { background:var(--spt-accent2); }
    .spt-sb-saved-badge { color:var(--spt-ok-text); font-size:0.78em; }

    /* Pagination */
    .spt-sb-pages      { display:flex; align-items:center; justify-content:center; gap:8px; font-size:0.8em; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

Hooks.once("init",  () => { registerP4Settings(); });

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  injectP4Styles();
  patchSidebar();

  const api = game.modules.get(MODULE_ID).api ?? {};
  api.playSound      = playSound;
  api.stopAll        = stopAll;
  api.searchFreesound = searchFreesound;
  game.modules.get(MODULE_ID).api = api;

  SPT.log("info", "P4Ready", "Pass 4 soundboard loaded.");
});
