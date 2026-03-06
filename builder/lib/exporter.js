/**
 * Exporter — compiles a project JSON into a standalone single-file HTML game.
 *
 * Reads clicker-framework.js and clicker-framework.css from the repo root,
 * converts *Code properties into real JavaScript functions, and assembles
 * everything into one self-contained HTML file.
 */

const fs = require('fs');
const path = require('path');

const FRAMEWORK_JS = path.join(__dirname, '..', '..', 'clicker-framework.js');
const FRAMEWORK_CSS = path.join(__dirname, '..', '..', 'clicker-framework.css');

/**
 * Wrap a code string as a function body. If the string looks like an expression
 * (no semicolons, no braces, no return), wrap it with `return`.
 */
function wrapAsExpression(code) {
    const trimmed = (code || '').trim();
    if (!trimmed) return null;
    // Heuristic: if it doesn't contain { or ; or return, treat as expression
    const isExpression = !trimmed.includes('{') && !trimmed.includes(';') && !trimmed.startsWith('return');
    if (isExpression) return `return ${trimmed};`;
    // If it already has return, use as-is
    if (trimmed.includes('return')) return trimmed;
    // Otherwise it's a statement block, just use as-is
    return trimmed;
}

/**
 * Build a function source string from a code body and parameter list.
 * Returns null if code is empty.
 */
function buildFunc(params, code) {
    const body = wrapAsExpression(code);
    if (!body) return null;
    return `function(${params}) { ${body} }`;
}

/**
 * Build the theme CSS override block from the project theme object.
 */
function buildThemeCSS(theme) {
    if (!theme) return '';
    const map = {
        accent: '--cf-accent',
        accentDim: '--cf-accent-dim',
        bg: '--cf-bg',
        surface: '--cf-surface',
        surface2: '--cf-surface2',
        border: '--cf-border',
        text: '--cf-text',
        textDim: '--cf-text-dim',
        red: '--cf-red',
        amber: '--cf-amber',
        cyan: '--cf-cyan',
        pink: '--cf-pink',
        purple: '--cf-purple',
        gold: '--cf-gold',
    };
    const lines = [];
    for (const [key, cssVar] of Object.entries(map)) {
        if (theme[key]) lines.push(`    ${cssVar}: ${theme[key]};`);
    }
    return lines.length ? `:root {\n${lines.join('\n')}\n}` : '';
}

/**
 * Compile a single upgrade definition into JS source.
 */
function compileUpgrade(u) {
    const parts = [];
    parts.push(`id: ${JSON.stringify(u.id)}`);
    parts.push(`name: ${JSON.stringify(u.name)}`);
    parts.push(`tier: ${u.tier}`);
    if (u.desc) parts.push(`desc: ${JSON.stringify(u.desc)}`);
    if (u.flavor) parts.push(`flavor: ${JSON.stringify(u.flavor)}`);
    parts.push(`baseCost: ${u.baseCost}`);
    if (u.costMultiplier) parts.push(`costMultiplier: ${u.costMultiplier}`);
    if (u.costCurrency) parts.push(`costCurrency: ${JSON.stringify(u.costCurrency)}`);
    parts.push(`type: ${JSON.stringify(u.type)}`);
    if (u.clickPower) parts.push(`clickPower: ${u.clickPower}`);
    if (u.passiveRate) parts.push(`passiveRate: ${u.passiveRate}`);
    if (u.bonuses && Object.keys(u.bonuses).length) parts.push(`bonuses: ${JSON.stringify(u.bonuses)}`);
    if (u.clickBonuses && Object.keys(u.clickBonuses).length) parts.push(`clickBonuses: ${JSON.stringify(u.clickBonuses)}`);
    if (u.unlockAt !== undefined && u.unlockAt !== null) parts.push(`unlockAt: ${u.unlockAt}`);
    if (u.maxOwned !== undefined && u.maxOwned !== null) parts.push(`maxOwned: ${u.maxOwned}`);

    const onBuy = buildFunc('g, u', u.onBuyCode);
    if (onBuy) parts.push(`onBuy: ${onBuy}`);

    const unlockWhen = buildFunc('g', u.unlockWhenCode);
    if (unlockWhen) parts.push(`unlockWhen: ${unlockWhen}`);

    return `{\n            ${parts.join(',\n            ')}\n        }`;
}

/**
 * Compile an action definition into JS source.
 */
function compileAction(a) {
    const parts = [];
    parts.push(`id: ${JSON.stringify(a.id)}`);
    parts.push(`label: ${JSON.stringify(a.label)}`);
    if (a.style) parts.push(`style: ${JSON.stringify(a.style)}`);
    if (a.color) parts.push(`color: ${JSON.stringify(a.color)}`);
    if (a.cooldown) parts.push(`cooldown: ${a.cooldown}`);

    const vis = buildFunc('g', a.visibleCode);
    if (vis) parts.push(`visible: ${vis}`);
    const en = buildFunc('g', a.enabledCode);
    if (en) parts.push(`enabled: ${en}`);
    const act = buildFunc('g', a.onActivateCode);
    if (act) parts.push(`onActivate: ${act}`);
    else parts.push(`onActivate: function(g) {}`);
    const deact = buildFunc('g', a.onDeactivateCode);
    if (deact) parts.push(`onDeactivate: ${deact}`);
    const st = buildFunc('g', a.statusTextCode);
    if (st) parts.push(`statusText: ${st}`);

    return `{\n            ${parts.join(',\n            ')}\n        }`;
}

/**
 * Compile a resource definition into JS source.
 */
function compileResource(r) {
    const parts = [];
    parts.push(`id: ${JSON.stringify(r.id)}`);
    parts.push(`label: ${JSON.stringify(r.label)}`);
    if (r.min !== undefined) parts.push(`min: ${r.min}`);
    if (r.max !== undefined) parts.push(`max: ${r.max}`);
    if (r.initial !== undefined) parts.push(`initial: ${r.initial}`);
    if (r.barColorStart) parts.push(`barColorStart: ${JSON.stringify(r.barColorStart)}`);
    if (r.barColorEnd) parts.push(`barColorEnd: ${JSON.stringify(r.barColorEnd)}`);
    const tick = buildFunc('g, dt', r.onTickCode);
    if (tick) parts.push(`onTick: ${tick}`);
    return `{\n            ${parts.join(',\n            ')}\n        }`;
}

/**
 * Compile a stat definition into JS source.
 */
function compileStat(s) {
    const parts = [];
    parts.push(`id: ${JSON.stringify(s.id)}`);
    parts.push(`label: ${JSON.stringify(s.label)}`);
    if (s.color) parts.push(`color: ${JSON.stringify(s.color)}`);
    const val = buildFunc('g', s.valueCode);
    if (val) parts.push(`value: ${val}`);
    else parts.push(`value: function(g) { return ''; }`);
    return `{ ${parts.join(', ')} }`;
}

/**
 * Main export function. Takes a project JSON object and returns a
 * complete standalone HTML string.
 */
function compileProject(project) {
    const frameworkJS = fs.readFileSync(FRAMEWORK_JS, 'utf8');
    const frameworkCSS = fs.readFileSync(FRAMEWORK_CSS, 'utf8');
    const c = project.config;
    const themeCSS = buildThemeCSS(c.theme);

    // Build the config object as JavaScript source
    const configParts = [];

    // Simple string/number properties
    configParts.push(`title: ${JSON.stringify(c.title || 'My Clicker Game')}`);
    if (c.tagline) configParts.push(`tagline: ${JSON.stringify(c.tagline)}`);
    if (c.logTitle) configParts.push(`logTitle: ${JSON.stringify(c.logTitle)}`);
    if (c.saveKey) configParts.push(`saveKey: ${JSON.stringify(c.saveKey)}`);

    // Currencies
    const currLines = Object.entries(c.currencies || {}).map(([id, def]) =>
        `${id}: ${JSON.stringify(def)}`
    );
    configParts.push(`currencies: {\n        ${currLines.join(',\n        ')}\n    }`);
    configParts.push(`primaryCurrency: ${JSON.stringify(c.primaryCurrency)}`);

    // Clicker
    configParts.push(`clicker: ${JSON.stringify(c.clicker)}`);

    // Stats
    if (c.stats && c.stats.length) {
        const statsStr = c.stats.map(compileStat).join(',\n        ');
        configParts.push(`stats: [\n        ${statsStr}\n    ]`);
    }

    // Tier names
    if (c.tierNames && Object.keys(c.tierNames).length) {
        configParts.push(`tierNames: ${JSON.stringify(c.tierNames)}`);
    }

    // Upgrades
    if (c.upgrades && c.upgrades.length) {
        const uStr = c.upgrades.map(compileUpgrade).join(',\n        ');
        configParts.push(`upgrades: [\n        ${uStr}\n    ]`);
    }

    // Phases
    if (c.phases && c.phases.length) {
        const phaseParts = c.phases.map(p => {
            const pp = [];
            pp.push(`id: ${p.id}`);
            pp.push(`name: ${JSON.stringify(p.name)}`);
            if (p.threshold !== undefined) pp.push(`threshold: ${p.threshold}`);
            if (p.clickerLabel) pp.push(`clickerLabel: ${JSON.stringify(p.clickerLabel)}`);
            const onEnter = buildFunc('g', p.onEnterCode);
            if (onEnter) pp.push(`onEnter: ${onEnter}`);
            return `{ ${pp.join(', ')} }`;
        });
        configParts.push(`phases: [\n        ${phaseParts.join(',\n        ')}\n    ]`);
    }

    // Narrative
    if (c.narrative) {
        const np = [];
        if (c.narrative.channels && c.narrative.channels.length) {
            const chStr = c.narrative.channels.map(ch =>
                `{ type: ${JSON.stringify(ch.type)}, messages: ${JSON.stringify(ch.messages)}, weight: ${ch.weight ?? 1} }`
            ).join(',\n            ');
            np.push(`channels: [\n            ${chStr}\n        ]`);
        }
        if (c.narrative.milestones && c.narrative.milestones.length) {
            np.push(`milestones: ${JSON.stringify(c.narrative.milestones)}`);
        }
        if (c.narrative.baseInterval) np.push(`baseInterval: ${c.narrative.baseInterval}`);
        if (c.narrative.minInterval) np.push(`minInterval: ${c.narrative.minInterval}`);
        if (c.narrative.intervalScaleStat) np.push(`intervalScaleStat: ${JSON.stringify(c.narrative.intervalScaleStat)}`);
        if (c.narrative.intervalScaleFactor) np.push(`intervalScaleFactor: ${c.narrative.intervalScaleFactor}`);
        if (c.narrative.minTotalToStart) np.push(`minTotalToStart: ${c.narrative.minTotalToStart}`);
        configParts.push(`narrative: {\n        ${np.join(',\n        ')}\n    }`);
    }

    // Actions
    if (c.actions && c.actions.length) {
        const aStr = c.actions.map(compileAction).join(',\n        ');
        configParts.push(`actions: [\n        ${aStr}\n    ]`);
    }

    // Resources
    if (c.resources && c.resources.length) {
        const rStr = c.resources.map(compileResource).join(',\n        ');
        configParts.push(`resources: [\n        ${rStr}\n    ]`);
    }

    // Endgame
    if (c.endgame) {
        const eg = c.endgame;
        const ep = [];
        ep.push(`buttonLabel: ${JSON.stringify(eg.buttonLabel)}`);
        if (eg.color) ep.push(`color: ${JSON.stringify(eg.color)}`);
        const vis = buildFunc('g', eg.visibleCode);
        if (vis) ep.push(`visible: ${vis}`);
        else ep.push(`visible: function(g) { return false; }`);
        const canAct = buildFunc('g', eg.canActivateCode);
        if (canAct) ep.push(`canActivate: ${canAct}`);
        else ep.push(`canActivate: function(g) { return false; }`);
        const btnText = buildFunc('g', eg.buttonTextCode);
        if (btnText) ep.push(`buttonText: ${btnText}`);
        if (eg.sequence && eg.sequence.length) {
            ep.push(`sequence: ${JSON.stringify(eg.sequence)}`);
        }
        // Build end screen function
        const esTitle = JSON.stringify(eg.endScreenTitle || 'THE END');
        const esParagraphs = JSON.stringify(eg.endScreenParagraphs || []);
        const esKicker = JSON.stringify(eg.endScreenKicker || '');
        let esStats = 'null';
        if (eg.endScreenStatsCode && eg.endScreenStatsCode.trim()) {
            esStats = `(function(g) { ${wrapAsExpression(eg.endScreenStatsCode)} })(g)`;
        }
        ep.push(`buildEndScreen: function(g) {
            var minutes = ((Date.now() - g.startTime) / 60000).toFixed(1);
            return {
                title: ${esTitle},
                paragraphs: ${esParagraphs},
                statsHtml: ${esStats},
                kicker: ${esKicker}
            };
        }`);
        configParts.push(`endgame: {\n        ${ep.join(',\n        ')}\n    }`);
    }

    // Prestige
    if (c.prestige) {
        const pr = c.prestige;
        const pp = [];
        pp.push(`buttonLabel: ${JSON.stringify(pr.buttonLabel)}`);
        if (pr.color) pp.push(`color: ${JSON.stringify(pr.color)}`);
        pp.push(`currencyId: ${JSON.stringify(pr.currencyId)}`);
        const vis = buildFunc('g', pr.visibleCode);
        if (vis) pp.push(`visible: ${vis}`);
        else pp.push(`visible: function(g) { return false; }`);
        const canAct = buildFunc('g', pr.canActivateCode);
        if (canAct) pp.push(`canActivate: ${canAct}`);
        else pp.push(`canActivate: function(g) { return false; }`);
        const calc = buildFunc('g', pr.calcRewardCode);
        if (calc) pp.push(`calcReward: ${calc}`);
        else pp.push(`calcReward: function(g) { return 0; }`);
        const btnText = buildFunc('g', pr.buttonTextCode);
        if (btnText) pp.push(`buttonText: ${btnText}`);
        const onP = buildFunc('g', pr.onPrestigeCode);
        if (onP) pp.push(`onPrestige: ${onP}`);
        if (pr.keepCurrencies) pp.push(`keepCurrencies: ${JSON.stringify(pr.keepCurrencies)}`);
        if (pr.keepResources) pp.push(`keepResources: ${JSON.stringify(pr.keepResources)}`);
        configParts.push(`prestige: {\n        ${pp.join(',\n        ')}\n    }`);
    }

    // Global hooks
    const onLoad = buildFunc('g, wasRestored', c.onLoadCode);
    if (onLoad) configParts.push(`onLoad: ${onLoad}`);
    const onTick = buildFunc('g, dt', c.onTickCode);
    if (onTick) configParts.push(`onTick: ${onTick}`);

    const configSource = `{\n    ${configParts.join(',\n\n    ')}\n}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(c.title || 'My Clicker Game')}</title>
    <style>
${frameworkCSS}
    </style>
${themeCSS ? `    <style>\n${themeCSS}\n    </style>` : ''}
</head>
<body>

<div id="clicker-game"></div>

<script>
${frameworkJS}
</script>
<script>
var game = new ClickerGame(${configSource});
game.start();
</script>

</body>
</html>`;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { compileProject };
