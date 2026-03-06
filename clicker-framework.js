/**
 * ClickerFramework — A configurable, extendable engine for clicker/incremental games.
 *
 * Usage:
 *   const game = new ClickerGame({ ...config });
 *   game.start();
 *
 * The framework handles:
 *   - Core game loop with delta-time ticking
 *   - Multiple currencies with large-number formatting
 *   - Click mechanic with floating text feedback
 *   - Tiered upgrades with exponential cost scaling
 *   - Passive automation / generators
 *   - Phase progression (unlocking new tiers, changing UI)
 *   - Narrative event system (timed random messages, milestones)
 *   - Custom actions (toggles, cooldown buttons, etc.)
 *   - Prestige / endgame system
 *   - Save/load via localStorage
 *   - Responsive three-panel layout (clicker | upgrades | log)
 *
 * All theme content — names, descriptions, flavor text, colors —
 * is provided through the configuration object so the engine is
 * completely decoupled from any specific game theme.
 */

// ---------------------------------------------------------------------------
//  NUMBER FORMATTING
// ---------------------------------------------------------------------------

/**
 * Format a large number with suffix notation (K, M, B, T, ...).
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
    if (n < 0) return '-' + formatNumber(-n);
    if (n < 1000) return n.toFixed(n < 10 && n !== Math.floor(n) ? 1 : 0);
    const suffixes = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    const tier = Math.floor(Math.log10(Math.abs(n)) / 3);
    if (tier === 0) return n.toFixed(0);
    const suffix = suffixes[tier] || ('e' + tier * 3);
    const scale = Math.pow(10, tier * 3);
    const scaled = n / scale;
    return scaled.toFixed(scaled < 10 ? 2 : 1) + suffix;
}

/**
 * Format a duration in seconds into a human-friendly string.
 * @param {number} s – seconds
 * @returns {string}
 */
function formatDuration(s) {
    if (s < 60) return '+' + s.toFixed(4) + 's';
    if (s < 3600) return '+' + (s / 60).toFixed(2) + ' min';
    if (s < 86400) return '+' + (s / 3600).toFixed(2) + ' hrs';
    if (s < 31536000) return '+' + (s / 86400).toFixed(2) + ' days';
    return '+' + (s / 31536000).toFixed(2) + ' yrs';
}

// ---------------------------------------------------------------------------
//  CLICKER GAME ENGINE
// ---------------------------------------------------------------------------

class ClickerGame {
    /**
     * @param {ClickerGameConfig} config
     *
     * @typedef {Object} ClickerGameConfig
     *
     * @property {string}  title        – Game title shown in header.
     * @property {string}  [tagline]    – Subtitle text under the title.
     * @property {string}  [containerId='clicker-game'] – Root container element id.
     *
     * @property {Object.<string, CurrencyDef>} currencies
     *   Map of currency id → definition.
     *   @typedef {Object} CurrencyDef
     *   @property {string}  name       – Display name (e.g. "Life Force").
     *   @property {string}  [abbr]     – Short abbreviation (e.g. "LF").
     *   @property {string}  [color]    – CSS color for display.
     *   @property {number}  [initial=0]
     *
     * @property {string}  primaryCurrency – Key into `currencies` used for
     *   clicking, upgrades, and main display.
     *
     * @property {ClickerDef} clicker
     *   @typedef {Object} ClickerDef
     *   @property {string}  label        – Button text (supports HTML).
     *   @property {number}  [basePower=1]
     *   @property {Object.<string,number>} [perClick] – Extra per-click bonuses
     *     keyed by currency id.
     *
     * @property {StatDef[]} [stats] – Extra stats shown in the stats bar.
     *   @typedef {Object} StatDef
     *   @property {string}  id        – Unique key.
     *   @property {string}  label     – Display label.
     *   @property {string}  [color]
     *   @property {function(ClickerGame):string} value – Returns display text.
     *
     * @property {UpgradeDef[]} upgrades
     *   @typedef {Object} UpgradeDef
     *   @property {string}  id
     *   @property {string}  name
     *   @property {number}  tier
     *   @property {string}  [desc]      – Short description.
     *   @property {string}  [flavor]    – Flavor text shown on first purchase.
     *   @property {number}  baseCost
     *   @property {number}  [costMultiplier=1.15]
     *   @property {string}  [costCurrency]  – Defaults to primaryCurrency.
     *   @property {'click'|'passive'} type
     *   @property {number}  [clickPower=0]  – Added to click power per purchase.
     *   @property {number}  [passiveRate=0] – Added to per-sec rate per purchase.
     *   @property {Object.<string,number>} [bonuses] – Per-purchase bonuses
     *     keyed by currency id (flat per-second additions).
     *   @property {Object.<string,number>} [clickBonuses] – Per-purchase per-click
     *     bonuses keyed by currency id.
     *   @property {number}  [unlockAt=0]    – Total primary currency earned to reveal.
     *   @property {function(ClickerGame):boolean} [unlockWhen] – Dynamic unlock test.
     *   @property {number}  [maxOwned]      – Optional purchase cap.
     *   @property {function(ClickerGame,UpgradeDef):void} [onBuy] – Hook.
     *
     * @property {Object.<number,string>} tierNames
     *   Map of tier number → display name.
     *
     * @property {PhaseDef[]} [phases]
     *   @typedef {Object} PhaseDef
     *   @property {number}  id            – Phase number (1-based).
     *   @property {string}  name          – Display name.
     *   @property {number}  [threshold=0] – Total primary currency to unlock.
     *   @property {string}  [clickerLabel] – Override clicker button text.
     *   @property {function(ClickerGame):void} [onEnter] – Hook when phase starts.
     *
     * @property {NarrativeConfig} [narrative]
     *   @typedef {Object} NarrativeConfig
     *   @property {NarrativeChannel[]} channels
     *     @typedef {Object} NarrativeChannel
     *     @property {string}   type    – CSS class / log type.
     *     @property {string[]} messages
     *     @property {number}   [weight=1] – Relative probability weight.
     *   @property {MilestoneDef[]} [milestones] – Messages triggered at thresholds.
     *     @typedef {Object} MilestoneDef
     *     @property {string}  stat        – Game state key to watch (dot-path).
     *     @property {number}  threshold   – Value that triggers the message.
     *     @property {string}  message
     *     @property {string}  [logType='system']
     *   @property {number}  [baseInterval=25]   – Seconds between random events.
     *   @property {number}  [minInterval=8]     – Fastest possible interval.
     *   @property {string}  [intervalScaleStat] – State key whose value shortens
     *     the interval (e.g. 'soulFatigue').
     *   @property {number}  [intervalScaleFactor=0.15]
     *   @property {number}  [minTotalToStart=30]  – Don't fire events until this
     *     much primary currency has been earned lifetime.
     *
     * @property {CustomActionDef[]} [actions] – Extra action buttons in the
     *   clicker panel.
     *   @typedef {Object} CustomActionDef
     *   @property {string}  id
     *   @property {string}  label
     *   @property {'button'|'toggle'} [style='button']
     *   @property {string}  [color]       – CSS border/text color.
     *   @property {number}  [cooldown=0]  – Seconds between uses.
     *   @property {function(ClickerGame):boolean} [visible] – Show condition.
     *   @property {function(ClickerGame):boolean} [enabled] – Enable condition.
     *   @property {function(ClickerGame):void} onActivate
     *   @property {function(ClickerGame):void} [onDeactivate] – For toggles.
     *   @property {function(ClickerGame):string} [statusText] – Dynamic sub-label.
     *
     * @property {SecondaryResourceDef[]} [resources] – Extra tracked values shown
     *   with the clicker (e.g. fatigue bar).
     *   @typedef {Object} SecondaryResourceDef
     *   @property {string}  id
     *   @property {string}  label
     *   @property {number}  [min=0]
     *   @property {number}  [max=100]
     *   @property {number}  [initial=0]
     *   @property {string}  [barColorStart]
     *   @property {string}  [barColorEnd]
     *   @property {function(ClickerGame,number):void} [onTick] – Per-tick hook
     *     receiving delta time.
     *   @property {function(ClickerGame):string} [effect] – Description of
     *     current effect (e.g. "−60% saturation").
     *
     * @property {EndgameDef} [endgame]
     *   @typedef {Object} EndgameDef
     *   @property {string}  buttonLabel
     *   @property {string}  [color]
     *   @property {function(ClickerGame):boolean} visible – When to show button.
     *   @property {function(ClickerGame):boolean} canActivate
     *   @property {function(ClickerGame):string} [buttonText] – Dynamic label.
     *   @property {string[]} [sequence] – Lines to display one by one before end.
     *   @property {function(ClickerGame):EndScreen} buildEndScreen
     *     @typedef {Object} EndScreen
     *     @property {string}  title
     *     @property {string[]} paragraphs
     *     @property {string}  [statsHtml]
     *     @property {string}  [kicker]
     *
     * @property {PrestigeDef} [prestige]
     *   @typedef {Object} PrestigeDef
     *   @property {string}  buttonLabel
     *   @property {string}  [color]
     *   @property {string}  currencyId      – Prestige currency key in `currencies`.
     *   @property {function(ClickerGame):boolean} visible
     *   @property {function(ClickerGame):boolean} canActivate
     *   @property {function(ClickerGame):number}  calcReward – How much prestige
     *     currency to award.
     *   @property {function(ClickerGame):string}  [buttonText] – Dynamic label.
     *   @property {function(ClickerGame):void}    [onPrestige] – Extra logic on reset.
     *   @property {string[]} [keepCurrencies] – Currency ids NOT reset.
     *   @property {string[]} [keepResources]  – Resource ids NOT reset.
     *
     * @property {function(ClickerGame,number):void} [onTick] – Per-tick hook.
     * @property {function(ClickerGame):void} [onLoad] – After save is restored.
     * @property {number} [saveInterval=10000] – Milliseconds between auto-saves.
     * @property {string} [saveKey] – localStorage key. Defaults to title slug.
     * @property {string} [logTitle='Event Log'] – Right panel header text.
     * @property {number} [maxLogEntries=100]
     */
    constructor(config) {
        this.config = config;
        this._validateConfig();

        // ---- State ----
        this.currencies = {};
        this.totalEarned = {};
        for (const [id, def] of Object.entries(config.currencies)) {
            this.currencies[id] = def.initial || 0;
            this.totalEarned[id] = def.initial || 0;
        }

        this.clickPower = config.clicker.basePower ?? 1;
        this.clickBonuses = {}; // currency id → per-click amount
        if (config.clicker.perClick) {
            Object.assign(this.clickBonuses, config.clicker.perClick);
        }

        this.passiveRates = {}; // currency id → per-second
        this.passiveRateMultipliers = {}; // currency id → multiplier

        this.owned = {}; // upgrade id → count
        (config.upgrades || []).forEach(u => this.owned[u.id] = 0);

        this.phase = 1;
        this.totalClicks = 0;
        this.startTime = Date.now();
        this.ended = false;
        this.prestigeCount = 0;

        // Resources (e.g. fatigue bars)
        this.resources = {};
        (config.resources || []).forEach(r => {
            this.resources[r.id] = r.initial ?? 0;
        });

        // Action state
        this.actionStates = {};  // id → { active: bool, cooldown: number }
        (config.actions || []).forEach(a => {
            this.actionStates[a.id] = { active: false, cooldown: 0 };
        });

        // Narrative state
        this._narrativeTimer = 0;
        this._usedMessages = {};  // channel type → [indices]
        (config.narrative?.channels || []).forEach(ch => {
            this._usedMessages[ch.type] = [];
        });
        this._milestonesHit = {};  // "stat:threshold" → true

        // Custom state bag for game-specific data
        this.custom = {};

        // ---- Internal ----
        this._lastTick = 0;
        this._els = {};
        this._running = false;
        this._saveKey = config.saveKey || config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    // -----------------------------------------------------------------------
    //  VALIDATION
    // -----------------------------------------------------------------------
    _validateConfig() {
        const c = this.config;
        if (!c.title) throw new Error('ClickerGame: config.title is required');
        if (!c.currencies || !Object.keys(c.currencies).length)
            throw new Error('ClickerGame: at least one currency is required');
        if (!c.primaryCurrency || !c.currencies[c.primaryCurrency])
            throw new Error('ClickerGame: primaryCurrency must reference a defined currency');
        if (!c.clicker) throw new Error('ClickerGame: config.clicker is required');
    }

    // -----------------------------------------------------------------------
    //  CONVENIENCE ACCESSORS
    // -----------------------------------------------------------------------

    /** Primary currency balance. */
    get primary() { return this.currencies[this.config.primaryCurrency]; }
    set primary(v) { this.currencies[this.config.primaryCurrency] = v; }

    /** Total primary currency ever earned. */
    get totalPrimary() { return this.totalEarned[this.config.primaryCurrency]; }
    set totalPrimary(v) { this.totalEarned[this.config.primaryCurrency] = v; }

    /** Primary currency per second (computed). */
    get primaryPerSec() {
        const id = this.config.primaryCurrency;
        const base = this.passiveRates[id] || 0;
        const mult = this.passiveRateMultipliers[id] || 1;
        return base * mult;
    }

    // -----------------------------------------------------------------------
    //  CURRENCY HELPERS
    // -----------------------------------------------------------------------

    /**
     * Award currency, tracking totals.
     * @param {string} id
     * @param {number} amount
     */
    earn(id, amount) {
        this.currencies[id] = (this.currencies[id] || 0) + amount;
        this.totalEarned[id] = (this.totalEarned[id] || 0) + amount;
    }

    /**
     * Spend currency. Returns false if insufficient.
     * @param {string} id
     * @param {number} amount
     * @returns {boolean}
     */
    spend(id, amount) {
        if ((this.currencies[id] || 0) < amount) return false;
        this.currencies[id] -= amount;
        return true;
    }

    /**
     * Set a per-second rate multiplier for a currency.
     * @param {string} currencyId
     * @param {number} multiplier
     */
    setRateMultiplier(currencyId, multiplier) {
        this.passiveRateMultipliers[currencyId] = multiplier;
    }

    // -----------------------------------------------------------------------
    //  UPGRADE SYSTEM
    // -----------------------------------------------------------------------

    /**
     * Get the current cost of an upgrade.
     * @param {UpgradeDef} u
     * @returns {number}
     */
    getUpgradeCost(u) {
        const mult = u.costMultiplier ?? 1.15;
        return Math.floor(u.baseCost * Math.pow(mult, this.owned[u.id]));
    }

    /**
     * Attempt to buy an upgrade by id.
     * @param {string} id
     * @returns {boolean} Whether purchase succeeded.
     */
    buyUpgrade(id) {
        if (this.ended) return false;
        const u = (this.config.upgrades || []).find(up => up.id === id);
        if (!u) return false;
        if (u.maxOwned !== undefined && this.owned[u.id] >= u.maxOwned) return false;

        const costCurrency = u.costCurrency || this.config.primaryCurrency;
        const cost = this.getUpgradeCost(u);
        if (!this.spend(costCurrency, cost)) return false;

        this.owned[u.id]++;

        // Apply effects
        if (u.type === 'click') {
            this.clickPower += u.clickPower || 0;
            if (u.clickBonuses) {
                for (const [cid, amt] of Object.entries(u.clickBonuses)) {
                    this.clickBonuses[cid] = (this.clickBonuses[cid] || 0) + amt;
                }
            }
        }

        // Recalculate passive rates
        this._recalcPassiveRates();

        // Log
        this.log(`Acquired: ${u.name} (x${this.owned[u.id]})`, 'purchase');
        if (this.owned[u.id] === 1 && u.flavor) {
            setTimeout(() => this.log(u.flavor, 'flavor'), 800);
        }

        // Hook
        if (u.onBuy) u.onBuy(this, u);

        this._checkMilestones();
        this._renderUpgrades();
        return true;
    }

    /**
     * Recalculate all passive per-second rates from owned upgrades.
     */
    _recalcPassiveRates() {
        const rates = {};
        const pc = this.config.primaryCurrency;
        for (const u of (this.config.upgrades || [])) {
            if (u.type === 'passive' && this.owned[u.id] > 0) {
                rates[pc] = (rates[pc] || 0) + (u.passiveRate || 0) * this.owned[u.id];
                if (u.bonuses) {
                    for (const [cid, amt] of Object.entries(u.bonuses)) {
                        rates[cid] = (rates[cid] || 0) + amt * this.owned[u.id];
                    }
                }
            }
        }
        this.passiveRates = rates;
    }

    // -----------------------------------------------------------------------
    //  CLICK
    // -----------------------------------------------------------------------

    /**
     * Execute a click.
     */
    doClick() {
        if (this.ended) return;
        const pc = this.config.primaryCurrency;
        this.earn(pc, this.clickPower);
        this.totalClicks++;

        // Extra per-click bonuses
        for (const [cid, amt] of Object.entries(this.clickBonuses)) {
            if (cid !== pc) this.earn(cid, amt);
        }

        // Floating text
        this._spawnFloatText('+' + formatNumber(this.clickPower) + ' ' +
            (this.config.currencies[pc].abbr || pc));
    }

    _spawnFloatText(text) {
        const btn = this._els.clickBtn;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const ft = document.createElement('div');
        ft.className = 'cf-float-text';
        ft.textContent = text;
        ft.style.left = (rect.left + rect.width / 2 - 30 + (Math.random() * 40 - 20)) + 'px';
        ft.style.top = (rect.top - 10) + 'px';
        document.body.appendChild(ft);
        setTimeout(() => ft.remove(), 1000);
    }

    // -----------------------------------------------------------------------
    //  PHASE SYSTEM
    // -----------------------------------------------------------------------

    _checkPhase() {
        const phases = this.config.phases || [];
        if (!phases.length) return;
        const sorted = [...phases].sort((a, b) => (a.threshold || 0) - (b.threshold || 0));
        let newPhase = sorted[0];
        for (const p of sorted) {
            if (this.totalPrimary >= (p.threshold || 0)) newPhase = p;
        }
        if (newPhase && newPhase.id !== this.phase) {
            this.phase = newPhase.id;
            if (this._els.phaseLabel) {
                this._els.phaseLabel.textContent = newPhase.name;
            }
            if (newPhase.clickerLabel && this._els.clickBtn) {
                this._els.clickBtn.innerHTML = newPhase.clickerLabel;
            }
            this.log('— ' + newPhase.name.toUpperCase() + ' UNLOCKED —', 'phase');
            if (newPhase.onEnter) newPhase.onEnter(this);
        }
    }

    // -----------------------------------------------------------------------
    //  NARRATIVE ENGINE
    // -----------------------------------------------------------------------

    _tickNarrative(dt) {
        const narr = this.config.narrative;
        if (!narr || !narr.channels || !narr.channels.length) return;
        if (this.ended) return;

        const minTotal = narr.minTotalToStart ?? 30;
        if (this.totalPrimary < minTotal) return;

        this._narrativeTimer += dt;

        let interval = narr.baseInterval ?? 25;
        if (narr.intervalScaleStat) {
            const val = this._resolvePath(narr.intervalScaleStat);
            const factor = narr.intervalScaleFactor ?? 0.15;
            interval -= val * factor;
        }
        interval = Math.max(narr.minInterval ?? 8, interval);

        if (this._narrativeTimer >= interval) {
            this._narrativeTimer = 0;
            this._fireNarrative();
        }
    }

    _fireNarrative() {
        const channels = this.config.narrative.channels;
        const totalWeight = channels.reduce((s, c) => s + (c.weight ?? 1), 0);
        let roll = Math.random() * totalWeight;
        let chosen = channels[0];
        for (const ch of channels) {
            roll -= (ch.weight ?? 1);
            if (roll <= 0) { chosen = ch; break; }
        }
        const msg = this._pickUnused(chosen.messages, this._usedMessages[chosen.type]);
        this.log(msg, chosen.type);
    }

    _pickUnused(arr, used) {
        const available = arr.filter((_, i) => !used.includes(i));
        if (available.length === 0) {
            used.length = 0;
            return this._pickUnused(arr, used);
        }
        const pick = available[Math.floor(Math.random() * available.length)];
        used.push(arr.indexOf(pick));
        return pick;
    }

    _checkMilestones() {
        const milestones = this.config.narrative?.milestones || [];
        for (const m of milestones) {
            const key = m.stat + ':' + m.threshold;
            if (this._milestonesHit[key]) continue;
            const val = this._resolvePath(m.stat);
            if (val >= m.threshold) {
                this._milestonesHit[key] = true;
                this.log(m.message, m.logType || 'system');
            }
        }
    }

    /** Resolve a dot-path like "resources.soulFatigue" against game state. */
    _resolvePath(path) {
        const parts = path.split('.');
        let obj = this;
        for (const p of parts) {
            if (obj == null) return 0;
            obj = obj[p];
        }
        return typeof obj === 'number' ? obj : 0;
    }

    // -----------------------------------------------------------------------
    //  ACTIONS (custom buttons)
    // -----------------------------------------------------------------------

    _tickActions(dt) {
        for (const action of (this.config.actions || [])) {
            const state = this.actionStates[action.id];
            if (state.cooldown > 0) {
                state.cooldown = Math.max(0, state.cooldown - dt);
            }
        }
    }

    triggerAction(id) {
        if (this.ended) return;
        const action = (this.config.actions || []).find(a => a.id === id);
        if (!action) return;
        const state = this.actionStates[id];

        if (action.style === 'toggle') {
            state.active = !state.active;
            if (state.active) {
                action.onActivate(this);
            } else if (action.onDeactivate) {
                action.onDeactivate(this);
            }
        } else {
            if (state.cooldown > 0) return;
            if (action.enabled && !action.enabled(this)) return;
            action.onActivate(this);
            state.cooldown = action.cooldown || 0;
        }
        this._renderActions();
    }

    // -----------------------------------------------------------------------
    //  PRESTIGE
    // -----------------------------------------------------------------------

    doPrestige() {
        const p = this.config.prestige;
        if (!p) return;
        if (!p.canActivate(this)) return;

        const reward = p.calcReward(this);
        this.prestigeCount++;

        // Reset currencies
        for (const id of Object.keys(this.config.currencies)) {
            if (p.keepCurrencies && p.keepCurrencies.includes(id)) continue;
            if (id === p.currencyId) continue;
            this.currencies[id] = this.config.currencies[id].initial || 0;
            this.totalEarned[id] = this.config.currencies[id].initial || 0;
        }

        // Award prestige currency
        this.earn(p.currencyId, reward);

        // Reset upgrades
        for (const u of (this.config.upgrades || [])) {
            this.owned[u.id] = 0;
        }

        // Reset resources
        for (const r of (this.config.resources || [])) {
            if (p.keepResources && p.keepResources.includes(r.id)) continue;
            this.resources[r.id] = r.initial ?? 0;
        }

        // Reset actions
        for (const a of (this.config.actions || [])) {
            this.actionStates[a.id] = { active: false, cooldown: 0 };
        }

        this.clickPower = this.config.clicker.basePower ?? 1;
        this.clickBonuses = {};
        if (this.config.clicker.perClick) {
            Object.assign(this.clickBonuses, this.config.clicker.perClick);
        }
        this.passiveRates = {};
        this.passiveRateMultipliers = {};
        this.totalClicks = 0;
        this.phase = 1;
        this._narrativeTimer = 0;
        this._milestonesHit = {};

        if (p.onPrestige) p.onPrestige(this);

        this.log('— PRESTIGE RESET —', 'phase');
        this._renderAll();
    }

    // -----------------------------------------------------------------------
    //  ENDGAME
    // -----------------------------------------------------------------------

    triggerEndgame() {
        const eg = this.config.endgame;
        if (!eg) return;
        if (!eg.canActivate(this)) return;
        this.ended = true;

        const seq = eg.sequence || [];
        if (seq.length) {
            let i = 0;
            const iv = setInterval(() => {
                if (i < seq.length) {
                    if (seq[i]) this.log(seq[i], 'ending');
                    i++;
                } else {
                    clearInterval(iv);
                    this._showEndScreen();
                }
            }, 700);
        } else {
            this._showEndScreen();
        }
    }

    _showEndScreen() {
        const eg = this.config.endgame;
        const screen = eg.buildEndScreen(this);
        const overlay = this._els.endgameOverlay;
        if (!overlay) return;

        overlay.querySelector('.cf-end-title').textContent = screen.title || 'THE END';
        const bodyEl = overlay.querySelector('.cf-end-body');
        bodyEl.innerHTML = '';
        for (const p of (screen.paragraphs || [])) {
            const el = document.createElement('p');
            el.textContent = p;
            bodyEl.appendChild(el);
        }
        if (screen.statsHtml) {
            const s = document.createElement('div');
            s.className = 'cf-end-stats';
            s.innerHTML = screen.statsHtml;
            bodyEl.appendChild(s);
        }
        if (screen.kicker) {
            const k = document.createElement('p');
            k.className = 'cf-end-kicker';
            k.textContent = screen.kicker;
            bodyEl.appendChild(k);
        }
        overlay.classList.add('visible');
    }

    // -----------------------------------------------------------------------
    //  LOGGING
    // -----------------------------------------------------------------------

    /**
     * Add a message to the narrative/event log.
     * @param {string} message
     * @param {string} [type='system']
     */
    log(message, type = 'system') {
        const feed = this._els.logFeed;
        if (!feed) return;
        const entry = document.createElement('div');
        entry.className = 'cf-log-entry ' + type;
        const ts = document.createElement('span');
        ts.className = 'cf-timestamp';
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        ts.textContent = '[' + m + ':' + s + ']';
        entry.appendChild(ts);
        entry.appendChild(document.createTextNode(' ' + message));
        feed.insertBefore(entry, feed.firstChild);
        const max = this.config.maxLogEntries ?? 100;
        while (feed.children.length > max) {
            feed.removeChild(feed.lastChild);
        }
    }

    // -----------------------------------------------------------------------
    //  SAVE / LOAD
    // -----------------------------------------------------------------------

    save() {
        const data = {
            currencies: this.currencies,
            totalEarned: this.totalEarned,
            clickPower: this.clickPower,
            clickBonuses: this.clickBonuses,
            owned: this.owned,
            phase: this.phase,
            totalClicks: this.totalClicks,
            startTime: this.startTime,
            ended: this.ended,
            prestigeCount: this.prestigeCount,
            resources: this.resources,
            actionStates: this.actionStates,
            _milestonesHit: this._milestonesHit,
            _usedMessages: this._usedMessages,
            custom: this.custom,
        };
        try {
            localStorage.setItem(this._saveKey, JSON.stringify(data));
        } catch (e) { /* quota errors, etc. */ }
    }

    load() {
        try {
            const raw = localStorage.getItem(this._saveKey);
            if (!raw) return false;
            const data = JSON.parse(raw);
            Object.assign(this.currencies, data.currencies || {});
            Object.assign(this.totalEarned, data.totalEarned || {});
            this.clickPower = data.clickPower ?? this.clickPower;
            this.clickBonuses = data.clickBonuses ?? this.clickBonuses;
            Object.assign(this.owned, data.owned || {});
            this.phase = data.phase ?? 1;
            this.totalClicks = data.totalClicks ?? 0;
            this.startTime = data.startTime ?? Date.now();
            this.ended = data.ended ?? false;
            this.prestigeCount = data.prestigeCount ?? 0;
            Object.assign(this.resources, data.resources || {});
            Object.assign(this.actionStates, data.actionStates || {});
            this._milestonesHit = data._milestonesHit || {};
            this._usedMessages = data._usedMessages || {};
            Object.assign(this.custom, data.custom || {});
            this._recalcPassiveRates();
            return true;
        } catch (e) {
            return false;
        }
    }

    /** Clear saved data and reload the page. */
    hardReset() {
        localStorage.removeItem(this._saveKey);
        location.reload();
    }

    // -----------------------------------------------------------------------
    //  GAME LOOP
    // -----------------------------------------------------------------------

    _tick(timestamp) {
        if (!this._running) return;

        if (!this._lastTick) this._lastTick = timestamp;
        const dt = Math.min((timestamp - this._lastTick) / 1000, 1); // cap to 1s
        this._lastTick = timestamp;

        if (!this.ended) {
            // Passive income
            for (const [cid, rate] of Object.entries(this.passiveRates)) {
                const mult = this.passiveRateMultipliers[cid] || 1;
                const gain = rate * mult * dt;
                if (gain > 0) this.earn(cid, gain);
            }

            // Resource ticks
            for (const r of (this.config.resources || [])) {
                if (r.onTick) r.onTick(this, dt);
            }

            // Actions
            this._tickActions(dt);

            // Narrative
            this._tickNarrative(dt);

            // Phase
            this._checkPhase();

            // Custom tick
            if (this.config.onTick) this.config.onTick(this, dt);
        }

        this._renderAll();
        requestAnimationFrame(ts => this._tick(ts));
    }

    // -----------------------------------------------------------------------
    //  UI BUILDING
    // -----------------------------------------------------------------------

    /**
     * Build the game UI inside the container and start the game loop.
     */
    start() {
        const container = document.getElementById(this.config.containerId || 'clicker-game');
        if (!container) throw new Error('ClickerGame: container element not found');
        container.classList.add('cf-root');
        container.innerHTML = this._buildHTML();
        this._cacheEls(container);
        this._bindEvents();
        this._buildUpgradeCards();

        // Load saved game
        const loaded = this.load();
        if (loaded) {
            this._checkPhase();
            this._checkMilestones();
            this.log('Session restored.', 'system');
        }
        if (this.config.onLoad) this.config.onLoad(this, loaded);

        // Auto-save
        setInterval(() => this.save(), this.config.saveInterval ?? 10000);

        // Start loop
        this._running = true;
        requestAnimationFrame(ts => this._tick(ts));
    }

    _buildHTML() {
        const c = this.config;
        const pc = c.currencies[c.primaryCurrency];
        const pcAbbr = pc.abbr || c.primaryCurrency;

        // Stats bar entries
        let statsHtml = `
            <div class="cf-stat">
                <div class="cf-stat-label">${pc.name}</div>
                <div class="cf-stat-value" data-stat="primary" style="color:${pc.color || 'var(--cf-accent)'}">&nbsp;</div>
            </div>
            <div class="cf-stat">
                <div class="cf-stat-label">${pcAbbr} / sec</div>
                <div class="cf-stat-value" data-stat="primaryPerSec" style="color:${pc.color || 'var(--cf-accent)'}">&nbsp;</div>
            </div>
            <div class="cf-stat">
                <div class="cf-stat-label">Total Clicks</div>
                <div class="cf-stat-value" data-stat="totalClicks">&nbsp;</div>
            </div>
        `;
        for (const s of (c.stats || [])) {
            statsHtml += `
                <div class="cf-stat">
                    <div class="cf-stat-label">${s.label}</div>
                    <div class="cf-stat-value" data-custom-stat="${s.id}" style="color:${s.color || ''}">&nbsp;</div>
                </div>
            `;
        }

        // Actions HTML
        let actionsHtml = '';
        for (const a of (c.actions || [])) {
            const color = a.color || 'var(--cf-accent)';
            actionsHtml += `
                <div class="cf-action-wrapper" data-action-wrapper="${a.id}" style="display:none">
                    <button class="cf-action-btn" data-action="${a.id}"
                        style="border-color:${color}; color:${color}">
                        ${a.label}
                    </button>
                    <div class="cf-action-status" data-action-status="${a.id}"></div>
                </div>
            `;
        }

        // Resources HTML (bars)
        let resourcesHtml = '';
        for (const r of (c.resources || [])) {
            const startColor = r.barColorStart || 'var(--cf-accent)';
            const endColor = r.barColorEnd || startColor;
            resourcesHtml += `
                <div class="cf-resource" data-resource="${r.id}">
                    <div class="cf-resource-header">
                        <span>${r.label}</span>
                        <span data-resource-pct="${r.id}">0%</span>
                    </div>
                    <div class="cf-bar-bg">
                        <div class="cf-bar-fill" data-resource-bar="${r.id}"
                            style="background:linear-gradient(90deg,${startColor},${endColor}); width:0%"></div>
                    </div>
                </div>
            `;
        }

        // Endgame button
        let endgameHtml = '';
        if (c.endgame) {
            const color = c.endgame.color || 'var(--cf-gold, gold)';
            endgameHtml = `
                <div class="cf-endgame-wrapper" data-endgame-wrapper style="display:none">
                    <button class="cf-endgame-btn" data-endgame-btn
                        style="border-color:${color}; color:${color}">
                        ${c.endgame.buttonLabel}
                    </button>
                </div>
            `;
        }

        // Prestige button
        let prestigeHtml = '';
        if (c.prestige) {
            const color = c.prestige.color || 'var(--cf-gold, gold)';
            prestigeHtml = `
                <div class="cf-prestige-wrapper" data-prestige-wrapper style="display:none">
                    <button class="cf-prestige-btn" data-prestige-btn
                        style="border-color:${color}; color:${color}">
                        ${c.prestige.buttonLabel}
                    </button>
                </div>
            `;
        }

        return `
            <header class="cf-header">
                <div>
                    <div class="cf-logo">${c.title}</div>
                    ${c.tagline ? `<div class="cf-tagline">${c.tagline}</div>` : ''}
                </div>
                <div class="cf-phase-label" data-phase-label></div>
            </header>

            <div class="cf-stats-bar">${statsHtml}</div>

            <div class="cf-main">
                <div class="cf-clicker-panel">
                    <button class="cf-click-btn" data-click-btn>${c.clicker.label}</button>
                    <div class="cf-click-info" data-click-info></div>
                    ${actionsHtml}
                    ${endgameHtml}
                    ${prestigeHtml}
                    <div class="cf-clicker-bottom">
                        ${resourcesHtml}
                    </div>
                </div>

                <div class="cf-upgrades-panel" data-upgrades-panel></div>

                <div class="cf-log-panel">
                    <div class="cf-log-header">${c.logTitle || 'Event Log'}</div>
                    <div class="cf-log-feed" data-log-feed></div>
                </div>
            </div>

            <div class="cf-endgame-overlay" data-endgame-overlay>
                <h1 class="cf-end-title"></h1>
                <div class="cf-end-body"></div>
            </div>
        `;
    }

    _cacheEls(root) {
        this._els = {
            root,
            phaseLabel: root.querySelector('[data-phase-label]'),
            clickBtn: root.querySelector('[data-click-btn]'),
            clickInfo: root.querySelector('[data-click-info]'),
            upgradesPanel: root.querySelector('[data-upgrades-panel]'),
            logFeed: root.querySelector('[data-log-feed]'),
            endgameOverlay: root.querySelector('[data-endgame-overlay]'),
        };
    }

    _bindEvents() {
        // Click button
        this._els.clickBtn.addEventListener('click', () => this.doClick());

        // Action buttons
        for (const a of (this.config.actions || [])) {
            const btn = this._els.root.querySelector(`[data-action="${a.id}"]`);
            if (btn) btn.addEventListener('click', () => this.triggerAction(a.id));
        }

        // Endgame button
        const egBtn = this._els.root.querySelector('[data-endgame-btn]');
        if (egBtn) egBtn.addEventListener('click', () => this.triggerEndgame());

        // Prestige button
        const pBtn = this._els.root.querySelector('[data-prestige-btn]');
        if (pBtn) pBtn.addEventListener('click', () => this.doPrestige());
    }

    // -----------------------------------------------------------------------
    //  UPGRADE CARD RENDERING
    // -----------------------------------------------------------------------

    _buildUpgradeCards() {
        const panel = this._els.upgradesPanel;
        panel.innerHTML = '';
        const tiers = {};
        for (const u of (this.config.upgrades || [])) {
            if (!tiers[u.tier]) tiers[u.tier] = [];
            tiers[u.tier].push(u);
        }
        const tierNames = this.config.tierNames || {};
        for (const tier of Object.keys(tiers).sort((a, b) => a - b)) {
            const group = document.createElement('div');
            group.className = 'cf-tier-group';
            const title = document.createElement('div');
            title.className = 'cf-tier-title';
            title.textContent = tierNames[tier] || ('Tier ' + tier);
            group.appendChild(title);

            for (const u of tiers[tier]) {
                const card = document.createElement('div');
                card.className = 'cf-upgrade-card';
                card.dataset.upgradeId = u.id;
                card.innerHTML = `
                    <div class="cf-upgrade-top">
                        <span class="cf-upgrade-name">${u.name}</span>
                        <span class="cf-upgrade-cost" data-cost="${u.id}"></span>
                    </div>
                    ${u.desc ? `<div class="cf-upgrade-desc">${u.desc}</div>` : ''}
                    <div class="cf-upgrade-stats" data-ustats="${u.id}"></div>
                    <div class="cf-upgrade-owned" data-owned="${u.id}"></div>
                `;
                card.addEventListener('click', () => this.buyUpgrade(u.id));
                group.appendChild(card);
            }
            panel.appendChild(group);
        }
    }

    _renderUpgrades() {
        const pc = this.config.primaryCurrency;
        const pcAbbr = this.config.currencies[pc].abbr || pc;
        for (const u of (this.config.upgrades || [])) {
            const card = this._els.root.querySelector(`[data-upgrade-id="${u.id}"]`);
            if (!card) continue;

            const costCurrency = u.costCurrency || pc;
            const cost = this.getUpgradeCost(u);
            const canAfford = (this.currencies[costCurrency] || 0) >= cost;

            // Visibility
            let visible = false;
            if (u.unlockWhen) {
                visible = u.unlockWhen(this);
            } else {
                visible = this.totalPrimary >= (u.unlockAt || 0);
            }
            if (u.maxOwned !== undefined && this.owned[u.id] >= u.maxOwned) {
                // Still show but mark as maxed
            }
            card.classList.toggle('visible', visible);
            card.classList.toggle('disabled', !canAfford || (u.maxOwned !== undefined && this.owned[u.id] >= u.maxOwned));

            // Cost label
            const abbr = this.config.currencies[costCurrency]?.abbr || costCurrency;
            const costEl = card.querySelector(`[data-cost="${u.id}"]`);
            if (u.maxOwned !== undefined && this.owned[u.id] >= u.maxOwned) {
                costEl.textContent = 'MAXED';
                costEl.classList.remove('cant-afford');
            } else {
                costEl.textContent = formatNumber(cost) + ' ' + abbr;
                costEl.classList.toggle('cant-afford', !canAfford);
            }

            // Stats line
            const statsEl = card.querySelector(`[data-ustats="${u.id}"]`);
            if (u.type === 'click') {
                const parts = [];
                if (u.clickPower) parts.push('+' + u.clickPower + ' ' + abbr + '/click');
                if (u.clickBonuses) {
                    for (const [cid, amt] of Object.entries(u.clickBonuses)) {
                        const ca = this.config.currencies[cid]?.abbr || cid;
                        parts.push('+' + amt + ' ' + ca + '/click');
                    }
                }
                statsEl.textContent = parts.join(' | ');
            } else {
                const parts = [];
                if (u.passiveRate) parts.push('+' + formatNumber(u.passiveRate) + ' ' + pcAbbr + '/sec');
                if (u.bonuses) {
                    for (const [cid, amt] of Object.entries(u.bonuses)) {
                        const ca = this.config.currencies[cid]?.abbr || cid;
                        parts.push('+' + amt + ' ' + ca + '/sec');
                    }
                }
                statsEl.textContent = parts.join(' | ');
            }

            // Owned count
            const ownedEl = card.querySelector(`[data-owned="${u.id}"]`);
            ownedEl.textContent = this.owned[u.id] > 0 ? 'Owned: ' + this.owned[u.id] : '';
        }
    }

    // -----------------------------------------------------------------------
    //  RENDER
    // -----------------------------------------------------------------------

    _renderAll() {
        const c = this.config;
        const pc = c.primaryCurrency;
        const pcDef = c.currencies[pc];
        const pcAbbr = pcDef.abbr || pc;

        // Stats bar
        const primaryEl = this._els.root.querySelector('[data-stat="primary"]');
        if (primaryEl) primaryEl.textContent = formatNumber(this.currencies[pc]);

        const ppsEl = this._els.root.querySelector('[data-stat="primaryPerSec"]');
        if (ppsEl) ppsEl.textContent = formatNumber(this.primaryPerSec);

        const tcEl = this._els.root.querySelector('[data-stat="totalClicks"]');
        if (tcEl) tcEl.textContent = this.totalClicks.toLocaleString();

        // Custom stats
        for (const s of (c.stats || [])) {
            const el = this._els.root.querySelector(`[data-custom-stat="${s.id}"]`);
            if (el) el.textContent = s.value(this);
        }

        // Click info
        if (this._els.clickInfo) {
            let info = `+<strong>${formatNumber(this.clickPower)}</strong> ${pcAbbr} per click`;
            for (const [cid, amt] of Object.entries(this.clickBonuses)) {
                if (cid !== pc) {
                    const ca = c.currencies[cid]?.abbr || cid;
                    info += `<br>+<strong>${amt.toFixed(4)}</strong> ${ca} per click`;
                }
            }
            this._els.clickInfo.innerHTML = info;
        }

        // Upgrades
        this._renderUpgrades();

        // Actions
        this._renderActions();

        // Resources
        this._renderResources();

        // Endgame
        this._renderEndgame();

        // Prestige
        this._renderPrestige();
    }

    _renderActions() {
        for (const a of (this.config.actions || [])) {
            const wrapper = this._els.root.querySelector(`[data-action-wrapper="${a.id}"]`);
            if (!wrapper) continue;
            const state = this.actionStates[a.id];
            const vis = a.visible ? a.visible(this) : true;
            wrapper.style.display = vis ? '' : 'none';

            const btn = wrapper.querySelector(`[data-action="${a.id}"]`);
            if (a.style === 'toggle') {
                btn.classList.toggle('active', state.active);
                btn.textContent = a.label + ': ' + (state.active ? 'ON' : 'OFF');
            } else {
                if (state.cooldown > 0) {
                    btn.disabled = true;
                    btn.textContent = a.label + ' (' + Math.ceil(state.cooldown) + 's)';
                } else {
                    const enabled = a.enabled ? a.enabled(this) : true;
                    btn.disabled = !enabled;
                    btn.textContent = a.label;
                }
            }

            const statusEl = wrapper.querySelector(`[data-action-status="${a.id}"]`);
            if (statusEl && a.statusText) {
                statusEl.textContent = a.statusText(this);
            }
        }
    }

    _renderResources() {
        for (const r of (this.config.resources || [])) {
            const wrapper = this._els.root.querySelector(`[data-resource="${r.id}"]`);
            if (!wrapper) continue;
            const val = this.resources[r.id] || 0;
            const max = r.max ?? 100;
            const min = r.min ?? 0;
            const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
            const pctEl = wrapper.querySelector(`[data-resource-pct="${r.id}"]`);
            if (pctEl) pctEl.textContent = Math.floor(pct) + '%';
            const barEl = wrapper.querySelector(`[data-resource-bar="${r.id}"]`);
            if (barEl) barEl.style.width = pct + '%';
        }
    }

    _renderEndgame() {
        const eg = this.config.endgame;
        if (!eg) return;
        const wrapper = this._els.root.querySelector('[data-endgame-wrapper]');
        if (!wrapper) return;
        const vis = eg.visible(this);
        wrapper.style.display = vis ? '' : 'none';
        if (vis) {
            const btn = wrapper.querySelector('[data-endgame-btn]');
            const canDo = eg.canActivate(this);
            btn.disabled = !canDo;
            btn.style.opacity = canDo ? '1' : '0.4';
            if (eg.buttonText) btn.textContent = eg.buttonText(this);
        }
    }

    _renderPrestige() {
        const p = this.config.prestige;
        if (!p) return;
        const wrapper = this._els.root.querySelector('[data-prestige-wrapper]');
        if (!wrapper) return;
        const vis = p.visible(this);
        wrapper.style.display = vis ? '' : 'none';
        if (vis) {
            const btn = wrapper.querySelector('[data-prestige-btn]');
            const canDo = p.canActivate(this);
            btn.disabled = !canDo;
            btn.style.opacity = canDo ? '1' : '0.4';
            if (p.buttonText) btn.textContent = p.buttonText(this);
        }
    }
}

// Export for module environments; also attach to window for script-tag usage.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ClickerGame, formatNumber, formatDuration };
}
if (typeof window !== 'undefined') {
    window.ClickerGame = ClickerGame;
    window.formatNumber = formatNumber;
    window.formatDuration = formatDuration;
}
