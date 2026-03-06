// ====================================================================
//  Clicker Builder — Editor Logic
//
//  A single-page editor that manages game projects via a REST API.
//  Projects are stored as JSON with *Code properties for JS snippets.
//  The editor provides preset dropdowns for common patterns and
//  raw textarea editing for custom JavaScript.
// ====================================================================

// -----------------------------------------------------------------------
//  STATE
// -----------------------------------------------------------------------

let projects = [];        // { name, title, updatedAt }[]
let currentName = null;   // selected project name
let project = null;       // full project JSON
let saveTimeout = null;
let dirty = false;

// -----------------------------------------------------------------------
//  API
// -----------------------------------------------------------------------

async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return res.text();
}

// -----------------------------------------------------------------------
//  PRESET DEFINITIONS
//  Each preset has { label, code } and optionally { params: [...] }
//  for template substitution.
// -----------------------------------------------------------------------

const PRESETS = {
    onBuy: [
        { label: '(none)', code: '' },
        { label: 'Add to resource', code: 'g.resources.${resource} = Math.min(${max}, g.resources.${resource} + ${amount});', params: ['resource', 'max', 'amount'] },
        { label: 'Set custom flag', code: 'g.custom.${flag} = true;', params: ['flag'] },
        { label: 'Log a message', code: 'g.log(${message}, ${logType});', params: ['message', 'logType'] },
        { label: 'Earn bonus currency', code: 'g.earn(${currency}, ${amount});', params: ['currency', 'amount'] },
        { label: 'Custom JS...', code: null },
    ],
    visible: [
        { label: '(always visible)', code: '' },
        { label: 'Phase >= N', code: 'g.phase >= ${phase}', params: ['phase'] },
        { label: 'Total primary >= N', code: 'g.totalPrimary >= ${amount}', params: ['amount'] },
        { label: 'Custom flag is set', code: 'g.custom.${flag} === true', params: ['flag'] },
        { label: 'Owns upgrade', code: 'g.owned.${upgradeId} > 0', params: ['upgradeId'] },
        { label: 'Custom JS...', code: null },
    ],
    enabled: [
        { label: '(always enabled)', code: '' },
        { label: 'Has enough currency', code: 'g.currencies.${currency} >= ${amount}', params: ['currency', 'amount'] },
        { label: 'Phase >= N', code: 'g.phase >= ${phase}', params: ['phase'] },
        { label: 'Custom JS...', code: null },
    ],
    canActivate: [
        { label: '(never)', code: '' },
        { label: 'Primary >= N', code: 'g.currencies.${currency} >= ${amount}', params: ['currency', 'amount'] },
        { label: 'Total primary >= N', code: 'g.totalPrimary >= ${amount}', params: ['amount'] },
        { label: 'Custom flag is set', code: 'g.custom.${flag} === true', params: ['flag'] },
        { label: 'Custom JS...', code: null },
    ],
    onActivate: [
        { label: '(empty)', code: '' },
        { label: 'Set rate multiplier', code: "g.setRateMultiplier(${currency}, ${multiplier});\ng.log(${message}, ${logType});", params: ['currency', 'multiplier', 'message', 'logType'] },
        { label: 'Earn currency', code: 'g.earn(${currency}, ${amount});\ng.log(${message}, ${logType});', params: ['currency', 'amount', 'message', 'logType'] },
        { label: 'Add to resource', code: 'g.resources.${resource} = Math.min(${max}, g.resources.${resource} + ${amount});', params: ['resource', 'max', 'amount'] },
        { label: 'Custom JS...', code: null },
    ],
    onDeactivate: [
        { label: '(empty)', code: '' },
        { label: 'Reset rate multiplier', code: "g.setRateMultiplier(${currency}, 1);\ng.log(${message}, 'system');", params: ['currency', 'message'] },
        { label: 'Custom JS...', code: null },
    ],
    statusText: [
        { label: '(none)', code: '' },
        { label: 'Show custom value', code: "'${label}: ' + (g.custom.${field} || 0).toLocaleString()", params: ['label', 'field'] },
        { label: 'Show resource', code: "'${label}: ' + Math.floor(g.resources.${resource} || 0) + '%'", params: ['label', 'resource'] },
        { label: 'Custom JS...', code: null },
    ],
    onTick: [
        { label: '(none)', code: '' },
        { label: 'Drain/fill resource over time', code: "if (g.actionStates.${action}?.active) {\n  g.resources.${resource} = Math.min(${max}, g.resources.${resource} + ${rate} * dt);\n}", params: ['action', 'resource', 'max', 'rate'] },
        { label: 'Apply visual effect from resource', code: "var desat = Math.min(g.resources.${resource} * ${factor}, ${maxEffect});\ndocument.body.style.filter = 'saturate(' + (100 - desat) + '%)';", params: ['resource', 'factor', 'maxEffect'] },
        { label: 'Custom JS...', code: null },
    ],
    valueStat: [
        { label: 'Format currency', code: "formatNumber(g.currencies.${currency} || 0)", params: ['currency'] },
        { label: 'Format duration', code: "formatDuration(g.currencies.${currency} || 0)", params: ['currency'] },
        { label: 'Resource percentage', code: "Math.floor(g.resources.${resource} || 0) + '%'", params: ['resource'] },
        { label: 'Custom JS...', code: null },
    ],
    calcReward: [
        { label: 'Logarithmic', code: "Math.floor(Math.log10(Math.max(1, g.totalPrimary)) * ${multiplier})", params: ['multiplier'] },
        { label: 'Square root', code: "Math.floor(Math.sqrt(g.totalPrimary / ${divisor}))", params: ['divisor'] },
        { label: 'Custom JS...', code: null },
    ],
    buttonText: [
        { label: '(static label)', code: '' },
        { label: 'Show cost', code: "'${label} (' + formatNumber(${cost}) + ' ${abbr})'", params: ['label', 'cost', 'abbr'] },
        { label: 'Show reward', code: "'${label} (+' + formatNumber(g.config.prestige ? g.config.prestige.calcReward(g) : 0) + ' ${abbr})'", params: ['label', 'abbr'] },
        { label: 'Custom JS...', code: null },
    ],
    onLoad: [
        { label: '(none)', code: '' },
        { label: 'Welcome message', code: "if (!wasRestored) {\n  g.log(${message}, 'system');\n}", params: ['message'] },
        { label: 'Restore toggle state', code: "if (g.actionStates.${action}?.active) {\n  g.setRateMultiplier(${currency}, ${multiplier});\n}", params: ['action', 'currency', 'multiplier'] },
        { label: 'Custom JS...', code: null },
    ],
    onTickGlobal: [
        { label: '(none)', code: '' },
        { label: 'Custom JS...', code: null },
    ],
};

// -----------------------------------------------------------------------
//  HELPERS
// -----------------------------------------------------------------------

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function markDirty() {
    dirty = true;
    $('#saveStatus').textContent = 'Unsaved';
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveProject, 2000);
}

async function saveProject() {
    if (!currentName || !project) return;
    try {
        await api('PUT', '/projects/' + currentName, project);
        dirty = false;
        $('#saveStatus').textContent = 'Saved';
        setTimeout(() => { if (!dirty) $('#saveStatus').textContent = ''; }, 2000);
    } catch (e) {
        $('#saveStatus').textContent = 'Save failed!';
    }
}

function generateId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 30) || 'item';
}

// -----------------------------------------------------------------------
//  RENDER HELPERS
// -----------------------------------------------------------------------

/**
 * Build a code field with preset dropdown + textarea.
 * presetKey: key into PRESETS object.
 * currentCode: current code string.
 * onUpdate: (newCode) => void
 */
function renderCodeField(label, presetKey, currentCode, onUpdate) {
    const presets = PRESETS[presetKey] || [{ label: 'Custom JS...', code: null }];
    const id = 'cf_' + Math.random().toString(36).substr(2, 6);

    let html = `<div class="code-field">`;
    html += `<label>${escHtml(label)}</label>`;
    html += `<div class="code-field-controls">`;
    html += `<select id="preset_${id}">`;
    for (let i = 0; i < presets.length; i++) {
        html += `<option value="${i}">${escHtml(presets[i].label)}</option>`;
    }
    html += `</select>`;
    html += `</div>`;
    html += `<textarea class="code" id="code_${id}" rows="3">${escHtml(currentCode || '')}</textarea>`;
    html += `</div>`;

    // Return html + a function to bind events after DOM insertion
    return {
        html,
        bind: () => {
            const select = document.getElementById('preset_' + id);
            const textarea = document.getElementById('code_' + id);
            if (!select || !textarea) return;

            select.addEventListener('change', () => {
                const idx = parseInt(select.value);
                const preset = presets[idx];
                if (preset.code === null) {
                    // Custom JS — leave textarea as-is for editing
                    textarea.focus();
                    return;
                }
                if (!preset.params || !preset.params.length) {
                    textarea.value = preset.code;
                    onUpdate(preset.code);
                    return;
                }
                // Prompt for each parameter
                let code = preset.code;
                for (const param of preset.params) {
                    const val = prompt(`Enter value for "${param}":`, '');
                    if (val === null) return; // cancelled
                    // If value looks like a string literal need, wrap in quotes
                    const needsQuotes = ['message', 'logType', 'flag', 'label'].includes(param) ||
                        param.endsWith('Id') || param === 'currency' || param === 'action' || param === 'resource';
                    const replacement = needsQuotes && !val.startsWith("'") && !val.startsWith('"')
                        ? `'${val}'` : val;
                    code = code.split('${' + param + '}').join(replacement);
                }
                textarea.value = code;
                onUpdate(code);
            });

            textarea.addEventListener('input', () => {
                // Switch dropdown to "Custom JS..."
                const customIdx = presets.findIndex(p => p.code === null);
                if (customIdx >= 0) select.value = customIdx;
                onUpdate(textarea.value);
            });
        }
    };
}

function textField(label, value, onInput, opts = {}) {
    const type = opts.type || 'text';
    const placeholder = opts.placeholder || '';
    const hint = opts.hint || '';
    const id = 'f_' + Math.random().toString(36).substr(2, 6);
    let html = `<div class="field">`;
    html += `<label for="${id}">${escHtml(label)}</label>`;
    if (type === 'textarea') {
        html += `<textarea id="${id}" rows="${opts.rows || 3}" placeholder="${escHtml(placeholder)}">${escHtml(value || '')}</textarea>`;
    } else {
        const step = opts.step ? ` step="${opts.step}"` : '';
        html += `<input type="${type}" id="${id}" value="${escHtml(String(value ?? ''))}" placeholder="${escHtml(placeholder)}"${step}>`;
    }
    if (hint) html += `<div class="hint">${escHtml(hint)}</div>`;
    html += `</div>`;
    return {
        html,
        bind: () => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                let v = el.value;
                if (type === 'number') v = v === '' ? null : parseFloat(v);
                onInput(v);
                markDirty();
            });
        }
    };
}

function selectField(label, value, options, onInput) {
    const id = 'f_' + Math.random().toString(36).substr(2, 6);
    let html = `<div class="field"><label for="${id}">${escHtml(label)}</label>`;
    html += `<select id="${id}">`;
    for (const [val, text] of options) {
        const sel = val === value ? ' selected' : '';
        html += `<option value="${escHtml(val)}"${sel}>${escHtml(text)}</option>`;
    }
    html += `</select></div>`;
    return {
        html,
        bind: () => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => { onInput(el.value); markDirty(); });
        }
    };
}

// -----------------------------------------------------------------------
//  TAB RENDERERS
// -----------------------------------------------------------------------

const tabRenderers = {};
let binders = []; // collect bind() calls for after DOM update

function setTabContent(html) {
    const el = $('#tabContent');
    el.innerHTML = html;
    binders.forEach(b => b());
    binders = [];
}

function pushBinder(field) {
    binders.push(field.bind);
    return field.html;
}

// ---- GENERAL TAB ----

tabRenderers.general = () => {
    const c = project.config;
    let html = '<div class="section"><div class="section-title">Game Identity</div>';
    html += '<div class="field-row">';
    html += pushBinder(textField('Title', c.title, v => { c.title = v; }));
    html += pushBinder(textField('Tagline', c.tagline, v => { c.tagline = v; }));
    html += '</div><div class="field-row">';
    html += pushBinder(textField('Log Title', c.logTitle, v => { c.logTitle = v; }, { placeholder: 'Event Log' }));
    html += pushBinder(textField('Save Key', c.saveKey, v => { c.saveKey = v; }, { placeholder: 'auto-generated from title', hint: 'localStorage key for save data' }));
    html += '</div>';

    const currencyOpts = Object.entries(c.currencies).map(([id, def]) => [id, `${def.name} (${id})`]);
    html += pushBinder(selectField('Primary Currency', c.primaryCurrency, currencyOpts, v => { c.primaryCurrency = v; }));

    html += '</div>';
    setTabContent(html);
};

// ---- THEME TAB ----

tabRenderers.theme = () => {
    const t = project.config.theme;
    const colors = [
        ['accent', 'Accent'], ['accentDim', 'Accent Dark'],
        ['bg', 'Background'], ['surface', 'Surface'], ['surface2', 'Surface 2'],
        ['border', 'Border'], ['text', 'Text'], ['textDim', 'Text Dim'],
        ['red', 'Red'], ['amber', 'Amber'], ['cyan', 'Cyan'],
        ['pink', 'Pink'], ['purple', 'Purple'], ['gold', 'Gold'],
    ];
    let html = '<div class="section"><div class="section-title">Color Theme</div>';
    html += '<div class="color-row">';
    for (const [key, label] of colors) {
        const id = 'color_' + key;
        html += `<div class="color-field">
            <input type="color" id="${id}" value="${t[key] || '#000000'}">
            <div><div class="color-field-label">${label}</div>
            <div class="color-field-value" id="${id}_val">${t[key] || ''}</div></div>
        </div>`;
        binders.push(() => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(id + '_val');
            if (!el) return;
            el.addEventListener('input', () => {
                t[key] = el.value;
                valEl.textContent = el.value;
                markDirty();
            });
        });
    }
    html += '</div></div>';
    setTabContent(html);
};

// ---- CURRENCIES TAB ----

tabRenderers.currencies = () => {
    const currs = project.config.currencies;
    let html = '<div class="section"><div class="section-title">Currencies</div>';

    for (const [id, def] of Object.entries(currs)) {
        html += `<div class="list-item" data-currency-id="${id}">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(id)}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-currency" data-id="${id}" title="Delete">&times;</button></div></div>`;
        html += '<div class="field-row">';
        html += pushBinder(textField('Name', def.name, v => { def.name = v; }));
        html += pushBinder(textField('Abbreviation', def.abbr, v => { def.abbr = v; }));
        html += pushBinder(textField('Color', def.color, v => { def.color = v; }, { placeholder: 'var(--cf-accent)' }));
        html += pushBinder(textField('Initial', def.initial, v => { def.initial = v; }, { type: 'number' }));
        html += '</div></div>';
    }

    html += `<button class="add-btn" id="addCurrency">+ Add Currency</button>`;
    html += '</div>';
    setTabContent(html);

    document.querySelectorAll('.btn-del-currency').forEach(btn => {
        btn.addEventListener('click', () => {
            if (Object.keys(currs).length <= 1) return alert('Need at least one currency');
            const id = btn.dataset.id;
            if (project.config.primaryCurrency === id) return alert('Cannot delete primary currency');
            if (confirm(`Delete currency "${id}"?`)) {
                delete currs[id];
                markDirty();
                tabRenderers.currencies();
            }
        });
    });

    document.getElementById('addCurrency')?.addEventListener('click', () => {
        const id = prompt('Currency ID (e.g. "gold"):');
        if (!id) return;
        const clean = id.replace(/[^a-zA-Z0-9_]/g, '');
        if (currs[clean]) return alert('Already exists');
        currs[clean] = { name: clean, abbr: clean[0].toUpperCase(), color: 'var(--cf-accent)', initial: 0 };
        markDirty();
        tabRenderers.currencies();
    });
};

// ---- CLICKER TAB ----

tabRenderers.clicker = () => {
    const cl = project.config.clicker;
    let html = '<div class="section"><div class="section-title">Click Button</div>';
    html += '<div class="field-row">';
    html += pushBinder(textField('Button Label', cl.label, v => { cl.label = v; }, { hint: 'Supports HTML, e.g. TAKE<br>VITAMINS' }));
    html += pushBinder(textField('Base Power', cl.basePower, v => { cl.basePower = v; }, { type: 'number' }));
    html += '</div></div>';

    // Per-click bonuses
    html += '<div class="section"><div class="section-title">Per-Click Bonuses</div>';
    html += '<div class="hint" style="margin-bottom:12px">Award extra currencies on each click (besides the primary currency)</div>';
    cl.perClick = cl.perClick || {};
    for (const [cid, amt] of Object.entries(cl.perClick)) {
        const rid = 'pcb_' + cid;
        html += `<div class="field-row">`;
        html += `<div class="field"><label>Currency</label><input type="text" value="${escHtml(cid)}" readonly></div>`;
        html += pushBinder(textField('Amount per click', amt, v => { cl.perClick[cid] = v; }, { type: 'number', step: '0.0001' }));
        html += `<div class="field"><label>&nbsp;</label><button class="btn btn-small btn-danger" id="del_${rid}">Remove</button></div>`;
        html += `</div>`;
        binders.push(() => {
            document.getElementById('del_' + rid)?.addEventListener('click', () => {
                delete cl.perClick[cid];
                markDirty();
                tabRenderers.clicker();
            });
        });
    }
    html += `<button class="add-btn" id="addPerClick">+ Add Per-Click Bonus</button>`;
    html += '</div>';
    setTabContent(html);

    document.getElementById('addPerClick')?.addEventListener('click', () => {
        const cid = prompt('Currency ID:');
        if (!cid) return;
        cl.perClick[cid] = 0;
        markDirty();
        tabRenderers.clicker();
    });
};

// ---- UPGRADES TAB ----

tabRenderers.upgrades = () => {
    const ups = project.config.upgrades;
    let html = '<div class="section"><div class="section-title">Upgrades (' + ups.length + ')</div>';

    for (let i = 0; i < ups.length; i++) {
        const u = ups[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(u.name || u.id)}</span>`;
        html += `<div class="list-item-actions">`;
        if (i > 0) html += `<button class="btn-icon btn-move-up" data-idx="${i}" title="Move up">&uarr;</button>`;
        if (i < ups.length - 1) html += `<button class="btn-icon btn-move-down" data-idx="${i}" title="Move down">&darr;</button>`;
        html += `<button class="btn-icon btn-dup-upgrade" data-idx="${i}" title="Duplicate">&#x2398;</button>`;
        html += `<button class="btn-icon btn-del-upgrade" data-idx="${i}" title="Delete">&times;</button>`;
        html += `</div></div>`;

        html += '<div class="field-row">';
        html += pushBinder(textField('ID', u.id, v => { u.id = v; }));
        html += pushBinder(textField('Name', u.name, v => { u.name = v; }));
        html += pushBinder(textField('Tier', u.tier, v => { u.tier = parseInt(v) || 1; }, { type: 'number' }));
        html += pushBinder(selectField('Type', u.type, [['click', 'Click'], ['passive', 'Passive']], v => { u.type = v; }));
        html += '</div><div class="field-row">';
        html += pushBinder(textField('Description', u.desc, v => { u.desc = v; }));
        html += pushBinder(textField('Flavor Text', u.flavor, v => { u.flavor = v; }));
        html += '</div><div class="field-row">';
        html += pushBinder(textField('Base Cost', u.baseCost, v => { u.baseCost = v; }, { type: 'number' }));
        html += pushBinder(textField('Cost Multiplier', u.costMultiplier, v => { u.costMultiplier = v; }, { type: 'number', step: '0.01' }));
        html += pushBinder(textField('Click Power', u.clickPower, v => { u.clickPower = v; }, { type: 'number' }));
        html += pushBinder(textField('Passive Rate', u.passiveRate, v => { u.passiveRate = v; }, { type: 'number', step: '0.1' }));
        html += '</div><div class="field-row">';
        html += pushBinder(textField('Unlock At (total primary)', u.unlockAt, v => { u.unlockAt = v; }, { type: 'number' }));
        html += pushBinder(textField('Max Owned', u.maxOwned, v => { u.maxOwned = v === '' || v === null ? null : parseInt(v); }, { type: 'number', placeholder: 'unlimited' }));
        html += '</div>';

        // Bonuses (JSON inline for simplicity)
        html += '<div class="field-row">';
        html += pushBinder(textField('Bonuses (JSON)', JSON.stringify(u.bonuses || {}), v => {
            try { u.bonuses = JSON.parse(v); } catch(e) {}
        }, { placeholder: '{"lifespan": 0.001}', hint: 'Per-second bonuses to other currencies, as JSON object' }));
        html += pushBinder(textField('Click Bonuses (JSON)', JSON.stringify(u.clickBonuses || {}), v => {
            try { u.clickBonuses = JSON.parse(v); } catch(e) {}
        }, { placeholder: '{"lifespan": 0.0001}', hint: 'Per-click bonuses to other currencies, as JSON object' }));
        html += '</div>';

        // onBuy code
        const cf = renderCodeField('On Buy Hook', 'onBuy', u.onBuyCode, v => { u.onBuyCode = v; markDirty(); });
        html += cf.html;
        binders.push(cf.bind);

        html += `</div>`;
    }

    html += `<button class="add-btn" id="addUpgrade">+ Add Upgrade</button>`;
    html += '</div>';
    setTabContent(html);

    // Event bindings for list actions
    document.querySelectorAll('.btn-del-upgrade').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            if (confirm(`Delete upgrade "${ups[idx].name}"?`)) {
                ups.splice(idx, 1);
                markDirty();
                tabRenderers.upgrades();
            }
        });
    });
    document.querySelectorAll('.btn-dup-upgrade').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            const copy = JSON.parse(JSON.stringify(ups[idx]));
            copy.id = copy.id + '_copy';
            copy.name = copy.name + ' (Copy)';
            ups.splice(idx + 1, 0, copy);
            markDirty();
            tabRenderers.upgrades();
        });
    });
    document.querySelectorAll('.btn-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            [ups[idx - 1], ups[idx]] = [ups[idx], ups[idx - 1]];
            markDirty();
            tabRenderers.upgrades();
        });
    });
    document.querySelectorAll('.btn-move-down').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            [ups[idx], ups[idx + 1]] = [ups[idx + 1], ups[idx]];
            markDirty();
            tabRenderers.upgrades();
        });
    });
    document.getElementById('addUpgrade')?.addEventListener('click', () => {
        ups.push({
            id: 'upgrade_' + (ups.length + 1),
            name: 'New Upgrade',
            tier: 1,
            desc: '',
            flavor: '',
            baseCost: 10,
            costMultiplier: 1.15,
            type: 'passive',
            clickPower: 0,
            passiveRate: 1,
            bonuses: {},
            clickBonuses: {},
            unlockAt: 0,
            maxOwned: null,
            onBuyCode: '',
        });
        markDirty();
        tabRenderers.upgrades();
    });
};

// ---- PHASES TAB ----

tabRenderers.phases = () => {
    const phases = project.config.phases;
    let html = '<div class="section"><div class="section-title">Phases</div>';
    html += '<div class="hint" style="margin-bottom:12px">Phases change the header label and can swap the clicker button text at total-primary-currency thresholds.</div>';

    for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">Phase ${p.id}: ${escHtml(p.name)}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-phase" data-idx="${i}" title="Delete">&times;</button></div></div>`;
        html += '<div class="field-row">';
        html += pushBinder(textField('ID', p.id, v => { p.id = parseInt(v) || 1; }, { type: 'number' }));
        html += pushBinder(textField('Name', p.name, v => { p.name = v; }));
        html += pushBinder(textField('Threshold', p.threshold, v => { p.threshold = v; }, { type: 'number' }));
        html += pushBinder(textField('Clicker Label', p.clickerLabel, v => { p.clickerLabel = v; }, { hint: 'Override click button text' }));
        html += '</div></div>';
    }

    html += `<button class="add-btn" id="addPhase">+ Add Phase</button>`;
    html += '</div>';

    // Tier names
    html += '<div class="section"><div class="section-title">Tier Names</div>';
    html += '<div class="hint" style="margin-bottom:12px">Display names for upgrade tier groupings</div>';
    const tierNames = project.config.tierNames || {};
    for (const [tier, name] of Object.entries(tierNames)) {
        html += '<div class="field-row">';
        html += `<div class="field"><label>Tier ${tier}</label><input type="text" value="${escHtml(name)}" readonly></div>`;
        html += pushBinder(textField('Display Name', name, v => { tierNames[tier] = v; }));
        html += `</div>`;
    }
    html += `<button class="add-btn" id="addTier">+ Add Tier Name</button>`;
    html += '</div>';

    setTabContent(html);

    document.querySelectorAll('.btn-del-phase').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            phases.splice(idx, 1);
            markDirty();
            tabRenderers.phases();
        });
    });
    document.getElementById('addPhase')?.addEventListener('click', () => {
        const nextId = phases.length ? Math.max(...phases.map(p => p.id)) + 1 : 1;
        phases.push({ id: nextId, name: `Phase ${nextId}`, threshold: 0, clickerLabel: '' });
        markDirty();
        tabRenderers.phases();
    });
    document.getElementById('addTier')?.addEventListener('click', () => {
        const tier = prompt('Tier number:');
        if (!tier) return;
        tierNames[tier] = `Tier ${tier}`;
        markDirty();
        tabRenderers.phases();
    });
};

// ---- NARRATIVE TAB ----

tabRenderers.narrative = () => {
    const n = project.config.narrative;
    let html = '<div class="section"><div class="section-title">Narrative Channels</div>';
    html += '<div class="hint" style="margin-bottom:12px">Random messages that appear in the event log. Each channel has a type (CSS class), weight, and list of messages.</div>';

    for (let i = 0; i < (n.channels || []).length; i++) {
        const ch = n.channels[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(ch.type)}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-channel" data-idx="${i}">&times;</button></div></div>`;
        html += '<div class="field-row">';
        html += pushBinder(textField('Type (CSS class)', ch.type, v => { ch.type = v; }));
        html += pushBinder(textField('Weight', ch.weight, v => { ch.weight = parseFloat(v) || 1; }, { type: 'number', step: '0.5' }));
        html += '</div>';
        html += pushBinder(textField('Messages', (ch.messages || []).join('\n'), v => {
            ch.messages = v.split('\n').filter(l => l.trim());
        }, { type: 'textarea', rows: 6, hint: 'One message per line' }));
        html += `</div>`;
    }
    html += `<button class="add-btn" id="addChannel">+ Add Channel</button>`;
    html += '</div>';

    // Milestones
    html += '<div class="section"><div class="section-title">Milestones</div>';
    html += '<div class="hint" style="margin-bottom:12px">Messages triggered when a stat reaches a threshold</div>';

    for (let i = 0; i < (n.milestones || []).length; i++) {
        const m = n.milestones[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(m.stat)}:${m.threshold}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-milestone" data-idx="${i}">&times;</button></div></div>`;
        html += '<div class="field-row">';
        html += pushBinder(textField('Stat Path', m.stat, v => { m.stat = v; }, { placeholder: 'resources.soulFatigue' }));
        html += pushBinder(textField('Threshold', m.threshold, v => { m.threshold = parseFloat(v) || 0; }, { type: 'number' }));
        html += pushBinder(textField('Log Type', m.logType, v => { m.logType = v; }, { placeholder: 'system' }));
        html += '</div>';
        html += pushBinder(textField('Message', m.message, v => { m.message = v; }));
        html += `</div>`;
    }
    html += `<button class="add-btn" id="addMilestone">+ Add Milestone</button>`;
    html += '</div>';

    // Settings
    html += '<div class="section"><div class="section-title">Timing Settings</div>';
    html += '<div class="field-row">';
    html += pushBinder(textField('Base Interval (sec)', n.baseInterval, v => { n.baseInterval = v; }, { type: 'number' }));
    html += pushBinder(textField('Min Interval (sec)', n.minInterval, v => { n.minInterval = v; }, { type: 'number' }));
    html += pushBinder(textField('Min Total to Start', n.minTotalToStart, v => { n.minTotalToStart = v; }, { type: 'number' }));
    html += '</div><div class="field-row">';
    html += pushBinder(textField('Interval Scale Stat', n.intervalScaleStat, v => { n.intervalScaleStat = v; }, { placeholder: 'resources.soulFatigue' }));
    html += pushBinder(textField('Interval Scale Factor', n.intervalScaleFactor, v => { n.intervalScaleFactor = v; }, { type: 'number', step: '0.01' }));
    html += '</div></div>';

    setTabContent(html);

    document.querySelectorAll('.btn-del-channel').forEach(btn => {
        btn.addEventListener('click', () => {
            n.channels.splice(parseInt(btn.dataset.idx), 1);
            markDirty();
            tabRenderers.narrative();
        });
    });
    document.getElementById('addChannel')?.addEventListener('click', () => {
        n.channels = n.channels || [];
        n.channels.push({ type: 'system', messages: [], weight: 1 });
        markDirty();
        tabRenderers.narrative();
    });
    document.querySelectorAll('.btn-del-milestone').forEach(btn => {
        btn.addEventListener('click', () => {
            n.milestones.splice(parseInt(btn.dataset.idx), 1);
            markDirty();
            tabRenderers.narrative();
        });
    });
    document.getElementById('addMilestone')?.addEventListener('click', () => {
        n.milestones = n.milestones || [];
        n.milestones.push({ stat: '', threshold: 0, message: '', logType: 'system' });
        markDirty();
        tabRenderers.narrative();
    });
};

// ---- ACTIONS TAB ----

tabRenderers.actions = () => {
    const actions = project.config.actions;
    let html = '<div class="section"><div class="section-title">Custom Actions</div>';
    html += '<div class="hint" style="margin-bottom:12px">Extra buttons in the clicker panel (cooldown buttons, toggles)</div>';

    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(a.label || a.id)}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-action" data-idx="${i}">&times;</button></div></div>`;

        html += '<div class="field-row">';
        html += pushBinder(textField('ID', a.id, v => { a.id = v; }));
        html += pushBinder(textField('Label', a.label, v => { a.label = v; }));
        html += pushBinder(selectField('Style', a.style || 'button', [['button', 'Button (cooldown)'], ['toggle', 'Toggle']], v => { a.style = v; }));
        html += pushBinder(textField('Color', a.color, v => { a.color = v; }, { placeholder: 'var(--cf-pink)' }));
        html += pushBinder(textField('Cooldown (sec)', a.cooldown, v => { a.cooldown = v; }, { type: 'number' }));
        html += '</div>';

        let cf;
        cf = renderCodeField('Visible When', 'visible', a.visibleCode, v => { a.visibleCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Enabled When', 'enabled', a.enabledCode, v => { a.enabledCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('On Activate', 'onActivate', a.onActivateCode, v => { a.onActivateCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('On Deactivate', 'onDeactivate', a.onDeactivateCode, v => { a.onDeactivateCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Status Text', 'statusText', a.statusTextCode, v => { a.statusTextCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);

        html += `</div>`;
    }

    html += `<button class="add-btn" id="addAction">+ Add Action</button>`;
    html += '</div>';
    setTabContent(html);

    document.querySelectorAll('.btn-del-action').forEach(btn => {
        btn.addEventListener('click', () => {
            actions.splice(parseInt(btn.dataset.idx), 1);
            markDirty();
            tabRenderers.actions();
        });
    });
    document.getElementById('addAction')?.addEventListener('click', () => {
        actions.push({
            id: 'action_' + (actions.length + 1),
            label: 'New Action',
            style: 'button',
            color: '',
            cooldown: 0,
            visibleCode: '',
            enabledCode: '',
            onActivateCode: '',
            onDeactivateCode: '',
            statusTextCode: '',
        });
        markDirty();
        tabRenderers.actions();
    });
};

// ---- RESOURCES TAB ----

tabRenderers.resources = () => {
    const resources = project.config.resources;
    let html = '<div class="section"><div class="section-title">Secondary Resources</div>';
    html += '<div class="hint" style="margin-bottom:12px">Progress bars shown in the clicker panel (e.g. fatigue, energy)</div>';

    for (let i = 0; i < resources.length; i++) {
        const r = resources[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(r.label || r.id)}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-resource" data-idx="${i}">&times;</button></div></div>`;

        html += '<div class="field-row">';
        html += pushBinder(textField('ID', r.id, v => { r.id = v; }));
        html += pushBinder(textField('Label', r.label, v => { r.label = v; }));
        html += pushBinder(textField('Min', r.min, v => { r.min = v; }, { type: 'number' }));
        html += pushBinder(textField('Max', r.max, v => { r.max = v; }, { type: 'number' }));
        html += pushBinder(textField('Initial', r.initial, v => { r.initial = v; }, { type: 'number' }));
        html += '</div><div class="field-row">';
        html += pushBinder(textField('Bar Color Start', r.barColorStart, v => { r.barColorStart = v; }, { placeholder: 'var(--cf-purple)' }));
        html += pushBinder(textField('Bar Color End', r.barColorEnd, v => { r.barColorEnd = v; }, { placeholder: 'var(--cf-red)' }));
        html += '</div>';

        const cf = renderCodeField('On Tick', 'onTick', r.onTickCode, v => { r.onTickCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);

        html += `</div>`;
    }

    html += `<button class="add-btn" id="addResource">+ Add Resource</button>`;
    html += '</div>';
    setTabContent(html);

    document.querySelectorAll('.btn-del-resource').forEach(btn => {
        btn.addEventListener('click', () => {
            resources.splice(parseInt(btn.dataset.idx), 1);
            markDirty();
            tabRenderers.resources();
        });
    });
    document.getElementById('addResource')?.addEventListener('click', () => {
        resources.push({
            id: 'resource_' + (resources.length + 1),
            label: 'New Resource',
            min: 0, max: 100, initial: 0,
            barColorStart: 'var(--cf-accent)',
            barColorEnd: 'var(--cf-accent)',
            onTickCode: '',
        });
        markDirty();
        tabRenderers.resources();
    });
};

// ---- STATS TAB (embedded in general for now, but let's add to general) ----

// ---- ENDGAME TAB ----

tabRenderers.endgame = () => {
    let eg = project.config.endgame;
    const enabled = !!eg;

    let html = '<div class="section"><div class="section-title">Endgame</div>';
    const toggleId = 'toggle_endgame';
    html += `<div class="toggle-field"><input type="checkbox" id="${toggleId}" ${enabled ? 'checked' : ''}><label for="${toggleId}">Enable endgame</label></div>`;

    if (enabled) {
        html += '<div class="field-row">';
        html += pushBinder(textField('Button Label', eg.buttonLabel, v => { eg.buttonLabel = v; }));
        html += pushBinder(textField('Color', eg.color, v => { eg.color = v; }, { placeholder: 'var(--cf-gold)' }));
        html += '</div>';

        let cf;
        cf = renderCodeField('Visible When', 'visible', eg.visibleCode, v => { eg.visibleCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Can Activate When', 'canActivate', eg.canActivateCode, v => { eg.canActivateCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Button Text (dynamic)', 'buttonText', eg.buttonTextCode, v => { eg.buttonTextCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);

        html += pushBinder(textField('Sequence Lines', (eg.sequence || []).join('\n'), v => {
            eg.sequence = v.split('\n').filter(l => l.trim());
        }, { type: 'textarea', rows: 6, hint: 'Lines logged one-by-one before the end screen. One per line.' }));

        html += '<div class="field-row">';
        html += pushBinder(textField('End Screen Title', eg.endScreenTitle, v => { eg.endScreenTitle = v; }));
        html += pushBinder(textField('End Screen Kicker', eg.endScreenKicker, v => { eg.endScreenKicker = v; }));
        html += '</div>';
        html += pushBinder(textField('End Screen Paragraphs', (eg.endScreenParagraphs || []).join('\n'), v => {
            eg.endScreenParagraphs = v.split('\n').filter(l => l.trim());
        }, { type: 'textarea', rows: 4, hint: 'One paragraph per line' }));

        cf = renderCodeField('End Screen Stats HTML', 'onActivate', eg.endScreenStatsCode, v => { eg.endScreenStatsCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
    }

    html += '</div>';
    setTabContent(html);

    document.getElementById(toggleId)?.addEventListener('change', (e) => {
        if (e.target.checked) {
            project.config.endgame = {
                buttonLabel: 'End Game',
                color: 'var(--cf-gold)',
                visibleCode: '',
                canActivateCode: '',
                buttonTextCode: '',
                sequence: [],
                endScreenTitle: 'THE END',
                endScreenParagraphs: [],
                endScreenStatsCode: '',
                endScreenKicker: '',
            };
        } else {
            project.config.endgame = null;
        }
        markDirty();
        tabRenderers.endgame();
    });
};

// ---- PRESTIGE TAB ----

tabRenderers.prestige = () => {
    let pr = project.config.prestige;
    const enabled = !!pr;

    let html = '<div class="section"><div class="section-title">Prestige / New Game+</div>';
    const toggleId = 'toggle_prestige';
    html += `<div class="toggle-field"><input type="checkbox" id="${toggleId}" ${enabled ? 'checked' : ''}><label for="${toggleId}">Enable prestige system</label></div>`;

    if (enabled) {
        html += '<div class="field-row">';
        html += pushBinder(textField('Button Label', pr.buttonLabel, v => { pr.buttonLabel = v; }));
        html += pushBinder(textField('Color', pr.color, v => { pr.color = v; }, { placeholder: 'var(--cf-gold)' }));
        html += pushBinder(textField('Prestige Currency ID', pr.currencyId, v => { pr.currencyId = v; }, { hint: 'Must exist in Currencies tab' }));
        html += '</div>';

        let cf;
        cf = renderCodeField('Visible When', 'visible', pr.visibleCode, v => { pr.visibleCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Can Activate When', 'canActivate', pr.canActivateCode, v => { pr.canActivateCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Calculate Reward', 'calcReward', pr.calcRewardCode, v => { pr.calcRewardCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        cf = renderCodeField('Button Text (dynamic)', 'buttonText', pr.buttonTextCode, v => { pr.buttonTextCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);

        html += pushBinder(textField('Keep Currencies (comma-sep)', (pr.keepCurrencies || []).join(', '), v => {
            pr.keepCurrencies = v.split(',').map(s => s.trim()).filter(Boolean);
        }, { hint: 'Currency IDs that survive prestige reset' }));
        html += pushBinder(textField('Keep Resources (comma-sep)', (pr.keepResources || []).join(', '), v => {
            pr.keepResources = v.split(',').map(s => s.trim()).filter(Boolean);
        }));
    }

    html += '</div>';
    setTabContent(html);

    document.getElementById(toggleId)?.addEventListener('change', (e) => {
        if (e.target.checked) {
            project.config.prestige = {
                buttonLabel: 'Prestige',
                color: 'var(--cf-gold)',
                currencyId: '',
                visibleCode: '',
                canActivateCode: '',
                calcRewardCode: '',
                buttonTextCode: '',
                keepCurrencies: [],
                keepResources: [],
            };
        } else {
            project.config.prestige = null;
        }
        markDirty();
        tabRenderers.prestige();
    });
};

// ---- HOOKS TAB ----

tabRenderers.hooks = () => {
    const c = project.config;
    let html = '<div class="section"><div class="section-title">Lifecycle Hooks</div>';

    let cf;
    cf = renderCodeField('On Load (g, wasRestored)', 'onLoad', c.onLoadCode, v => { c.onLoadCode = v; markDirty(); });
    html += cf.html; binders.push(cf.bind);

    cf = renderCodeField('On Tick (g, dt)', 'onTickGlobal', c.onTickCode, v => { c.onTickCode = v; markDirty(); });
    html += cf.html; binders.push(cf.bind);

    html += '</div>';

    // Stats section
    html += '<div class="section"><div class="section-title">Custom Stats Bar Entries</div>';
    html += '<div class="hint" style="margin-bottom:12px">Extra statistics displayed in the top bar</div>';
    const stats = c.stats || [];
    for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        html += `<div class="list-item">`;
        html += `<div class="list-item-header"><span class="list-item-title">${escHtml(s.label || s.id)}</span>`;
        html += `<div class="list-item-actions"><button class="btn-icon btn-del-stat" data-idx="${i}">&times;</button></div></div>`;
        html += '<div class="field-row">';
        html += pushBinder(textField('ID', s.id, v => { s.id = v; }));
        html += pushBinder(textField('Label', s.label, v => { s.label = v; }));
        html += pushBinder(textField('Color', s.color, v => { s.color = v; }, { placeholder: 'var(--cf-amber)' }));
        html += '</div>';
        cf = renderCodeField('Value Expression', 'valueStat', s.valueCode, v => { s.valueCode = v; markDirty(); });
        html += cf.html; binders.push(cf.bind);
        html += `</div>`;
    }
    html += `<button class="add-btn" id="addStat">+ Add Stat</button>`;
    html += '</div>';

    setTabContent(html);

    document.querySelectorAll('.btn-del-stat').forEach(btn => {
        btn.addEventListener('click', () => {
            stats.splice(parseInt(btn.dataset.idx), 1);
            markDirty();
            tabRenderers.hooks();
        });
    });
    document.getElementById('addStat')?.addEventListener('click', () => {
        c.stats = c.stats || [];
        c.stats.push({ id: 'stat_' + (c.stats.length + 1), label: 'New Stat', color: '', valueCode: '' });
        markDirty();
        tabRenderers.hooks();
    });
};

// -----------------------------------------------------------------------
//  NAVIGATION
// -----------------------------------------------------------------------

let activeTab = 'general';

function switchTab(tabName) {
    activeTab = tabName;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    if (tabRenderers[tabName]) tabRenderers[tabName]();
}

// -----------------------------------------------------------------------
//  PROJECT MANAGEMENT
// -----------------------------------------------------------------------

async function loadProjectList() {
    projects = await api('GET', '/projects');
    renderProjectList();
}

function renderProjectList() {
    const el = $('#projectList');
    el.innerHTML = '';
    for (const p of projects) {
        const item = document.createElement('div');
        item.className = 'project-item' + (p.name === currentName ? ' active' : '');
        item.innerHTML = `
            <div class="project-item-name">${escHtml(p.title || p.name)}</div>
            <div class="project-item-date">${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : ''}</div>
        `;
        item.addEventListener('click', () => openProject(p.name));
        el.appendChild(item);
    }
}

async function openProject(name) {
    // Save current first
    if (dirty && currentName) await saveProject();

    currentName = name;
    project = await api('GET', '/projects/' + name);
    // Ensure config has all expected fields
    const c = project.config;
    c.currencies = c.currencies || {};
    c.upgrades = c.upgrades || [];
    c.phases = c.phases || [];
    c.narrative = c.narrative || { channels: [], milestones: [], baseInterval: 25, minInterval: 8, intervalScaleStat: '', intervalScaleFactor: 0.15, minTotalToStart: 30 };
    c.narrative.channels = c.narrative.channels || [];
    c.narrative.milestones = c.narrative.milestones || [];
    c.actions = c.actions || [];
    c.resources = c.resources || [];
    c.stats = c.stats || [];
    c.clicker = c.clicker || { label: 'CLICK', basePower: 1, perClick: {} };
    c.clicker.perClick = c.clicker.perClick || {};
    c.tierNames = c.tierNames || {};
    c.theme = c.theme || {};

    $('#emptyState').style.display = 'none';
    $('#editor').style.display = '';
    $('#projectNameDisplay').textContent = c.title || name;
    renderProjectList();
    switchTab(activeTab);
}

// -----------------------------------------------------------------------
//  INIT
// -----------------------------------------------------------------------

function init() {
    // Tab clicks
    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // New project dialog
    $('#btnNewProject').addEventListener('click', () => {
        $('#newProjectDialog').style.display = '';
        $('#newProjectName').value = '';
        $('#newProjectName').focus();
    });
    $('#btnCancelNew').addEventListener('click', () => {
        $('#newProjectDialog').style.display = 'none';
    });
    $('#btnConfirmNew').addEventListener('click', async () => {
        const name = $('#newProjectName').value.trim();
        if (!name) return;
        try {
            await api('POST', '/projects', { name });
            $('#newProjectDialog').style.display = 'none';
            await loadProjectList();
            await openProject(name);
        } catch (e) {
            alert(e.message);
        }
    });
    $('#newProjectName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#btnConfirmNew').click();
    });

    // Preview
    $('#btnPreview').addEventListener('click', () => {
        if (!currentName) return;
        // Save first, then open preview
        saveProject().then(() => {
            window.open('/api/projects/' + currentName + '/preview', '_blank');
        });
    });

    // Export
    $('#btnExport').addEventListener('click', async () => {
        if (!currentName) return;
        await saveProject();
        try {
            const html = await api('POST', '/projects/' + currentName + '/export');
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = currentName + '.html';
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            alert('Export failed: ' + e.message);
        }
    });

    // Delete
    $('#btnDelete').addEventListener('click', async () => {
        if (!currentName) return;
        if (!confirm(`Delete project "${currentName}"? This cannot be undone.`)) return;
        await api('DELETE', '/projects/' + currentName);
        currentName = null;
        project = null;
        $('#editor').style.display = 'none';
        $('#emptyState').style.display = '';
        await loadProjectList();
    });

    // Theme toggle (dark/light)
    const savedTheme = localStorage.getItem('builder-theme');
    if (savedTheme === 'light') document.body.classList.add('light');
    updateThemeIcon();

    $('#btnThemeToggle').addEventListener('click', () => {
        document.body.classList.toggle('light');
        const isLight = document.body.classList.contains('light');
        localStorage.setItem('builder-theme', isLight ? 'light' : 'dark');
        updateThemeIcon();
    });

    // Export project as JSON
    $('#btnExportJSON').addEventListener('click', async () => {
        if (!currentName || !project) return alert('No project selected');
        await saveProject();
        const json = JSON.stringify(project, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = currentName + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });

    // Import project from JSON
    $('#btnImportJSON').addEventListener('click', () => {
        $('#fileImportJSON').click();
    });
    $('#fileImportJSON').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.config || !data.meta) {
                throw new Error('Invalid project file: missing config or meta');
            }
            // Use the filename (without extension) as project name, fallback to meta.name
            let name = data.meta.name || file.name.replace(/\.json$/, '');
            name = name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 80);
            if (!name) name = 'imported';

            // Check if name exists, append suffix if needed
            const existing = projects.map(p => p.name);
            let finalName = name;
            let suffix = 1;
            while (existing.includes(finalName)) {
                finalName = name + '-' + suffix;
                suffix++;
            }
            data.meta.name = finalName;
            data.meta.updatedAt = new Date().toISOString();

            // Create then overwrite with imported data
            await api('POST', '/projects', { name: finalName });
            await api('PUT', '/projects/' + finalName, data);
            await loadProjectList();
            await openProject(finalName);
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
        // Reset file input so the same file can be re-imported
        e.target.value = '';
    });

    // Load projects
    loadProjectList();
}

function updateThemeIcon() {
    const btn = $('#btnThemeToggle');
    if (!btn) return;
    const isLight = document.body.classList.contains('light');
    btn.innerHTML = isLight ? '&#9789;' : '&#9788;';
    btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

init();
