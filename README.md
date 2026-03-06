# ClickerFramework

A configurable, extendable engine for building clicker/incremental games. Provides the complete mechanical scaffolding — clicking, upgrades, automation, prestige, narrative events, save/load — so designers only need to supply their own theme, content, and flavor.

Includes a **visual builder app** (Node.js) for designing games through a web UI and exporting them as standalone single-file HTML games.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Using the Framework Directly](#using-the-framework-directly)
  - [Minimal Example](#minimal-example)
  - [Configuration Reference](#configuration-reference)
  - [Game Instance API](#game-instance-api)
  - [CSS Theming](#css-theming)
  - [Log Entry Types](#log-entry-types)
- [Using the Builder App](#using-the-builder-app)
  - [Installation](#installation)
  - [Editor Tabs](#editor-tabs)
  - [Code Presets](#code-presets)
  - [Import / Export JSON](#import--export-json)
  - [Exporting a Standalone HTML Game](#exporting-a-standalone-html-game)
  - [Builder API Endpoints](#builder-api-endpoints)
- [Architecture](#architecture)
- [Examples](#examples)

---

## Quick Start

### Option A: Use the framework directly

Create an HTML file, include the framework, and pass a config object:

```html
<link rel="stylesheet" href="clicker-framework.css">
<div id="clicker-game"></div>
<script src="clicker-framework.js"></script>
<script>
const game = new ClickerGame({
    title: 'My Game',
    currencies: { gold: { name: 'Gold', abbr: 'G', initial: 0 } },
    primaryCurrency: 'gold',
    clicker: { label: 'DIG', basePower: 1 },
    upgrades: [
        { id: 'pick', name: 'Pickaxe', tier: 1, baseCost: 10, type: 'click', clickPower: 1, unlockAt: 0 },
        { id: 'miner', name: 'Miner', tier: 1, baseCost: 25, type: 'passive', passiveRate: 0.5, unlockAt: 10 },
    ],
    tierNames: { 1: 'Tier I' },
});
game.start();
</script>
```

### Option B: Use the visual builder

```bash
cd builder
npm install
npm start
# Open http://localhost:3000
```

Create a project, fill in the tabs, click **Export HTML** to download a standalone game file.

---

## Project Structure

```
clicker-framework/
├── clicker-framework.js        Core game engine (vanilla JS, no dependencies)
├── clicker-framework.css       Default styles with CSS custom properties
├── sample.html                 Original hand-coded example game (ETERNAL.LY)
├── example-eternally.html      ETERNAL.LY rebuilt using the framework
├── starter-template.html       Minimal boilerplate for a new game
├── builder/
│   ├── package.json
│   ├── server.js               Express server + REST API
│   ├── lib/
│   │   └── exporter.js         Compiles project JSON → standalone HTML
│   ├── public/
│   │   ├── index.html          Builder SPA shell
│   │   ├── builder.js          Editor logic
│   │   └── builder.css         Editor styles (dark/light themes)
│   ├── projects/               Saved project JSON files (gitignored)
│   └── exports/                Exported HTML files (gitignored)
└── README.md
```

---

## Using the Framework Directly

### Minimal Example

See `starter-template.html` for a complete minimal game. The pattern is:

1. Include `clicker-framework.css` and `clicker-framework.js`
2. Add a container `<div id="clicker-game"></div>`
3. Create a `new ClickerGame(config)` and call `.start()`

The framework builds all UI (header, stats bar, three-panel layout, upgrade cards, event log) inside the container element.

### Configuration Reference

The `ClickerGame` constructor accepts a single configuration object. All game content — names, numbers, descriptions, colors, and behavior hooks — is defined here.

#### Core Identity

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `title` | `string` | *required* | Game title displayed in the header. Supports HTML. |
| `tagline` | `string` | `''` | Subtitle text below the title. |
| `containerId` | `string` | `'clicker-game'` | ID of the HTML element to build the UI in. |
| `logTitle` | `string` | `'Event Log'` | Header text for the right-panel event log. |
| `saveKey` | `string` | *auto from title* | localStorage key for save data. |
| `saveInterval` | `number` | `10000` | Milliseconds between auto-saves. |
| `maxLogEntries` | `number` | `100` | Max entries kept in the event log. |

#### Currencies

```js
currencies: {
    gold:     { name: 'Gold',     abbr: 'G',  color: 'var(--cf-accent)', initial: 0 },
    lifespan: { name: 'Lifespan', abbr: 's',  color: 'var(--cf-amber)',  initial: 0 },
},
primaryCurrency: 'gold',
```

| Property | Type | Description |
|----------|------|-------------|
| `currencies` | `Object.<string, CurrencyDef>` | Map of currency ID to definition. At least one required. |
| `primaryCurrency` | `string` | Which currency is earned by clicking and used for upgrade costs by default. |

**CurrencyDef:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | — | Display name. |
| `abbr` | `string` | — | Short abbreviation (e.g. "LF", "G"). |
| `color` | `string` | `'var(--cf-accent)'` | CSS color for the stats bar display. |
| `initial` | `number` | `0` | Starting balance. |

#### Clicker

```js
clicker: {
    label: 'TAKE<br>VITAMINS',
    basePower: 1,
    perClick: { lifespan: 0.0001 },
},
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | `string` | — | Click button text. Supports HTML. |
| `basePower` | `number` | `1` | Base primary currency earned per click. |
| `perClick` | `Object.<string, number>` | `{}` | Extra per-click bonuses to other currencies. |

#### Stats Bar

Additional stats displayed in the top bar (primary currency, per-sec rate, and total clicks are always shown automatically).

```js
stats: [
    {
        id: 'lifespan',
        label: 'Lifespan Gained',
        color: 'var(--cf-amber)',
        value: (game) => formatDuration(game.currencies.lifespan || 0),
    },
],
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. |
| `label` | `string` | Display label. |
| `color` | `string` | CSS color. |
| `value` | `function(game): string` | Returns the display text. Called every frame. |

#### Upgrades

```js
upgrades: [
    {
        id: 'vitamins',
        name: 'Vitamin Megadose',
        tier: 1,
        desc: 'If one is good, forty must be transcendent.',
        flavor: 'Your pee is now fluorescent yellow.',
        baseCost: 15,
        costMultiplier: 1.14,
        type: 'click',
        clickPower: 1,
        clickBonuses: { lifespan: 0.00005 },
        unlockAt: 0,
        onBuy: (game, upgrade) => {
            game.resources.soulFatigue = Math.min(100, game.resources.soulFatigue + 0.3);
        },
    },
],
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | — | Unique identifier. |
| `name` | `string` | — | Display name. |
| `tier` | `number` | — | Tier grouping (1, 2, 3...). |
| `desc` | `string` | `''` | Short description shown on the card. |
| `flavor` | `string` | `''` | Flavor text logged on first purchase. |
| `baseCost` | `number` | — | Cost of the first purchase. |
| `costMultiplier` | `number` | `1.15` | Each purchase multiplies cost by this. |
| `costCurrency` | `string` | *primaryCurrency* | Which currency to spend. |
| `type` | `'click'\|'passive'` | — | Click upgrades add to click power; passive adds per-second income. |
| `clickPower` | `number` | `0` | Added to primary click power per purchase. |
| `passiveRate` | `number` | `0` | Added to primary per-second rate per purchase. |
| `bonuses` | `Object.<string, number>` | `{}` | Per-second bonuses to other currencies per purchase. |
| `clickBonuses` | `Object.<string, number>` | `{}` | Per-click bonuses to other currencies per purchase. |
| `unlockAt` | `number` | `0` | Total primary currency earned before this upgrade is visible. |
| `unlockWhen` | `function(game): boolean` | — | Dynamic unlock condition (overrides `unlockAt`). |
| `maxOwned` | `number` | *unlimited* | Maximum times this can be purchased. |
| `onBuy` | `function(game, upgrade): void` | — | Hook called after each purchase. |

#### Tier Names

```js
tierNames: {
    1: 'Tier I — The Wellness Journey',
    2: 'Tier II — The Protocol',
},
```

Maps tier numbers to display names shown as section headers in the upgrades panel.

#### Phases

```js
phases: [
    { id: 1, name: 'Phase I: The Beginning', threshold: 0, clickerLabel: 'DIG' },
    { id: 2, name: 'Phase II: The Expansion', threshold: 500, clickerLabel: 'MINE' },
],
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `number` | — | Phase number (1-based). |
| `name` | `string` | — | Display name shown in the header. |
| `threshold` | `number` | `0` | Total primary currency to unlock this phase. |
| `clickerLabel` | `string` | — | Override the click button text (supports HTML). |
| `onEnter` | `function(game): void` | — | Hook called when phase is entered. |

#### Narrative System

```js
narrative: {
    channels: [
        { type: 'intrusive', messages: ['Message 1', 'Message 2'], weight: 3.5 },
        { type: 'news',      messages: ['Breaking: ...'],          weight: 2 },
    ],
    milestones: [
        { stat: 'resources.soulFatigue', threshold: 50, message: 'Halfway there...', logType: 'soul' },
    ],
    baseInterval: 25,
    minInterval: 8,
    intervalScaleStat: 'resources.soulFatigue',
    intervalScaleFactor: 0.15,
    minTotalToStart: 30,
},
```

**Channels** — Random messages that periodically appear in the event log:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `string` | — | CSS class applied to log entries. |
| `messages` | `string[]` | — | Pool of messages. Used without repeating until exhausted. |
| `weight` | `number` | `1` | Relative probability weight. |

**Milestones** — One-time messages triggered when a stat reaches a threshold:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `stat` | `string` | — | Dot-path to a game state value (e.g. `'resources.soulFatigue'`, `'totalClicks'`). |
| `threshold` | `number` | — | Value that triggers the message. |
| `message` | `string` | — | The message to log. |
| `logType` | `string` | `'system'` | CSS class for the log entry. |

**Timing:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseInterval` | `number` | `25` | Base seconds between random narrative events. |
| `minInterval` | `number` | `8` | Fastest possible interval. |
| `intervalScaleStat` | `string` | — | Dot-path to a stat that shortens the interval. |
| `intervalScaleFactor` | `number` | `0.15` | How much `intervalScaleStat` shortens the interval. |
| `minTotalToStart` | `number` | `30` | Don't fire events until this much primary currency has been earned. |

#### Custom Actions

Extra buttons displayed in the clicker panel. Two styles: cooldown buttons and toggles.

```js
actions: [
    {
        id: 'social',
        label: 'Post to Social Media',
        style: 'button',
        color: 'var(--cf-pink)',
        cooldown: 20,
        visible: (game) => game.phase >= 2,
        onActivate: (game) => { /* ... */ },
        statusText: (game) => 'Followers: ' + (game.custom.followers || 0),
    },
    {
        id: 'sellData',
        label: 'Sell Biometric Data',
        style: 'toggle',
        color: 'var(--cf-cyan)',
        visible: (game) => game.phase >= 3,
        onActivate: (game) => { game.setRateMultiplier('gold', 1.5); },
        onDeactivate: (game) => { game.setRateMultiplier('gold', 1); },
    },
],
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | — | Unique identifier. |
| `label` | `string` | — | Button text. |
| `style` | `'button'\|'toggle'` | `'button'` | Cooldown button or on/off toggle. |
| `color` | `string` | `'var(--cf-accent)'` | CSS color for border and text. |
| `cooldown` | `number` | `0` | Seconds between uses (button style only). |
| `visible` | `function(game): boolean` | `() => true` | When to show the button. |
| `enabled` | `function(game): boolean` | `() => true` | When the button is clickable. |
| `onActivate` | `function(game): void` | — | Called when clicked (button) or toggled on (toggle). |
| `onDeactivate` | `function(game): void` | — | Called when toggled off (toggle style only). |
| `statusText` | `function(game): string` | — | Dynamic sub-label shown below the button. |

#### Secondary Resources

Progress bars displayed at the bottom of the clicker panel (e.g. fatigue, energy, corruption).

```js
resources: [
    {
        id: 'soulFatigue',
        label: 'Soul Fatigue',
        min: 0,
        max: 100,
        initial: 0,
        barColorStart: 'var(--cf-purple)',
        barColorEnd: 'var(--cf-red)',
        onTick: (game, dt) => {
            if (game.actionStates.sellData?.active) {
                game.resources.soulFatigue = Math.min(100, game.resources.soulFatigue + 0.02 * dt);
            }
        },
    },
],
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | — | Unique identifier. Also the key in `game.resources`. |
| `label` | `string` | — | Display label. |
| `min` | `number` | `0` | Minimum value. |
| `max` | `number` | `100` | Maximum value. |
| `initial` | `number` | `0` | Starting value. |
| `barColorStart` | `string` | `'var(--cf-accent)'` | Left side of the gradient fill. |
| `barColorEnd` | `string` | — | Right side of the gradient fill. |
| `onTick` | `function(game, dt): void` | — | Called every frame with delta time in seconds. |

#### Endgame

A final button + cinematic sequence + end screen overlay.

```js
endgame: {
    buttonLabel: 'Upload Consciousness',
    color: 'var(--cf-gold)',
    visible: (game) => game.custom.hasConsciousness === true,
    canActivate: (game) => game.currencies.gold >= 1e11,
    buttonText: (game) => 'UPLOAD (' + formatNumber(1e11) + ' G)',
    sequence: [
        'Uploading...',
        'Compressing memories...',
        'Upload complete.',
    ],
    buildEndScreen: (game) => ({
        title: 'THE END',
        paragraphs: ['You did it.', 'Was it worth it?'],
        statsHtml: 'Total gold: <span>' + formatNumber(game.totalPrimary) + '</span>',
        kicker: 'Thanks for playing.',
    }),
},
```

| Field | Type | Description |
|-------|------|-------------|
| `buttonLabel` | `string` | Button text in the clicker panel. |
| `color` | `string` | Button border/text color. |
| `visible` | `function(game): boolean` | When to show the button. |
| `canActivate` | `function(game): boolean` | When the button is clickable. |
| `buttonText` | `function(game): string` | Dynamic label override. |
| `sequence` | `string[]` | Lines logged one-by-one before the end screen. |
| `buildEndScreen` | `function(game): EndScreen` | Returns the end screen content. |

**EndScreen object:**

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Large heading. |
| `paragraphs` | `string[]` | Body text paragraphs. |
| `statsHtml` | `string` | HTML for final stats display. Wrap values in `<span>` for accent color. |
| `kicker` | `string` | Final message in red. |

#### Prestige

Reset progress in exchange for a permanent bonus currency. The prestige button appears in the clicker panel.

```js
prestige: {
    buttonLabel: 'Ascend',
    color: 'var(--cf-gold)',
    currencyId: 'prestige_points',
    visible: (game) => game.totalPrimary >= 10000,
    canActivate: (game) => game.totalPrimary >= 10000,
    calcReward: (game) => Math.floor(Math.sqrt(game.totalPrimary / 1000)),
    buttonText: (game) => 'Ascend (+' + game.config.prestige.calcReward(game) + ' PP)',
    onPrestige: (game) => { /* extra reset logic */ },
    keepCurrencies: ['prestige_points'],
    keepResources: [],
},
```

| Field | Type | Description |
|-------|------|-------------|
| `buttonLabel` | `string` | Button text. |
| `color` | `string` | Button color. |
| `currencyId` | `string` | Which currency to award (must exist in `currencies`). |
| `visible` | `function(game): boolean` | When to show the button. |
| `canActivate` | `function(game): boolean` | When the button is clickable. |
| `calcReward` | `function(game): number` | How much prestige currency to award. |
| `buttonText` | `function(game): string` | Dynamic label. |
| `onPrestige` | `function(game): void` | Extra logic after reset. |
| `keepCurrencies` | `string[]` | Currency IDs that survive the reset. |
| `keepResources` | `string[]` | Resource IDs that survive the reset. |

**What prestige resets:** all currencies (except kept ones + prestige currency), all upgrade ownership, all resources (except kept), click power, passive rates, multipliers, phase, total clicks, narrative state. The `prestigeCount` increments.

#### Lifecycle Hooks

```js
onTick: (game, dt) => { /* called every frame */ },
onLoad: (game, wasRestored) => {
    if (!wasRestored) {
        game.log('Welcome!', 'system');
    }
},
```

| Hook | Parameters | Description |
|------|-----------|-------------|
| `onTick` | `(game, dt)` | Called every animation frame. `dt` is delta time in seconds. |
| `onLoad` | `(game, wasRestored)` | Called after initialization. `wasRestored` is true if a save was loaded. |

---

### Game Instance API

After creating a game with `new ClickerGame(config)`, the instance exposes these methods and properties.

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `void` | Build the UI and start the game loop. Call once. |
| `earn(currencyId, amount)` | `void` | Award currency, tracking lifetime totals. |
| `spend(currencyId, amount)` | `boolean` | Spend currency. Returns `false` if insufficient. |
| `setRateMultiplier(currencyId, multiplier)` | `void` | Set a multiplier on a currency's passive rate. |
| `getUpgradeCost(upgradeDef)` | `number` | Get the current cost of an upgrade. |
| `buyUpgrade(id)` | `boolean` | Attempt to purchase an upgrade. |
| `doClick()` | `void` | Execute a click (called automatically by the button). |
| `triggerAction(id)` | `void` | Trigger a custom action button/toggle. |
| `doPrestige()` | `void` | Execute prestige reset. |
| `triggerEndgame()` | `void` | Start the endgame sequence. |
| `log(message, type?)` | `void` | Add a message to the event log. Default type: `'system'`. |
| `save()` | `void` | Save to localStorage. |
| `load()` | `boolean` | Load from localStorage. Returns true if a save existed. |
| `hardReset()` | `void` | Clear save data and reload the page. |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `config` | `object` | The original configuration object. |
| `currencies` | `object` | Current balances. `currencies.gold`, etc. |
| `totalEarned` | `object` | Lifetime earned amounts per currency. |
| `clickPower` | `number` | Current click value for primary currency. |
| `clickBonuses` | `object` | Per-click bonuses for non-primary currencies. |
| `passiveRates` | `object` | Per-second generation rates per currency. |
| `passiveRateMultipliers` | `object` | Multipliers applied to passive rates. |
| `owned` | `object` | Upgrade purchase counts. `owned.pickaxe`, etc. |
| `phase` | `number` | Current phase ID. |
| `totalClicks` | `number` | Lifetime click count. |
| `startTime` | `number` | `Date.now()` when the game started. |
| `ended` | `boolean` | Whether the endgame has been triggered. |
| `prestigeCount` | `number` | How many times the player has prestiged. |
| `resources` | `object` | Secondary resource values. `resources.soulFatigue`, etc. |
| `actionStates` | `object` | Per-action state: `{ active: boolean, cooldown: number }`. |
| `custom` | `object` | Free-form bag for game-specific state. Persisted in saves. |

**Convenience accessors:**

| Accessor | Type | Description |
|----------|------|-------------|
| `primary` | `number` | Get/set the primary currency balance. |
| `totalPrimary` | `number` | Get/set the total primary currency ever earned. |
| `primaryPerSec` | `number` (read-only) | Current primary per-second rate (base rate × multiplier). |

#### Utility Functions

Available globally (on `window`) after including the framework:

| Function | Signature | Description |
|----------|-----------|-------------|
| `formatNumber` | `(n: number): string` | Format with suffixes: K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc. |
| `formatDuration` | `(seconds: number): string` | Format as `+Xs`, `+X min`, `+X hrs`, `+X days`, or `+X yrs`. |

---

### CSS Theming

Override these CSS custom properties on `:root` or `.cf-root` to re-theme the game without changing the framework stylesheet.

| Variable | Default | Description |
|----------|---------|-------------|
| `--cf-bg` | `#0a0a0c` | Main background |
| `--cf-surface` | `#111118` | Panel/card background |
| `--cf-surface2` | `#1a1a24` | Hover/secondary surface |
| `--cf-border` | `#2a2a3a` | Border color |
| `--cf-text` | `#e0e0e8` | Primary text |
| `--cf-text-dim` | `#7a7a8e` | Muted/secondary text |
| `--cf-accent` | `#00e676` | Primary accent (buttons, values, click button) |
| `--cf-accent-dim` | `#004d25` | Dark accent (click button gradient) |
| `--cf-red` | `#ff1744` | Negative/can't-afford |
| `--cf-amber` | `#ffab00` | Warning color |
| `--cf-cyan` | `#00e5ff` | Info/stats color |
| `--cf-pink` | `#f50057` | Social accent |
| `--cf-purple` | `#d500f9` | Secondary resource accent |
| `--cf-gold` | `#ffd600` | Endgame/prestige accent |
| `--cf-font` | `'Inter', system-ui, sans-serif` | Primary font family |
| `--cf-mono` | `'IBM Plex Mono', 'Fira Code', monospace` | Monospace font family |

Example — change to a blue theme:

```css
:root {
    --cf-accent: #4fc3f7;
    --cf-accent-dim: #0d3d5c;
}
```

### Log Entry Types

The framework applies CSS classes to log entries based on their `type` parameter. Built-in styled types:

| Type | Color | Description |
|------|-------|-------------|
| `system` | Dim text | Default system messages |
| `purchase` | Accent | Upgrade purchases |
| `flavor` | Cyan | First-purchase flavor text |
| `phase` | Amber, bold | Phase transitions |
| `ending` | White, bold | Endgame sequence |
| `intrusive` | Orange italic | Intrusive thoughts |
| `techno` | Cyan | Tech/fatalism messages |
| `news` | Red | News flashes |
| `achievement` | Gold | Achievements |
| `social` | Pink | Social media posts |
| `soul` | Purple | Soul/resource milestones |

Add custom types by defining CSS rules: `.cf-log-entry.mytype { color: #abc; }`

---

## Using the Builder App

### Installation

```bash
cd builder
npm install
npm start
```

Opens at `http://localhost:3000`. The only dependency is Express.

### Editor Tabs

| Tab | What You Configure |
|-----|-------------------|
| **General** | Title, tagline, log title, save key, primary currency |
| **Theme** | Color pickers for all 14 CSS variables |
| **Currencies** | Add/edit/remove currencies (name, abbreviation, color, initial value) |
| **Clicker** | Button label, base power, per-click bonuses to secondary currencies |
| **Upgrades** | Full upgrade editor — all fields plus onBuy hook with presets. Supports reordering, duplicating, and deleting. |
| **Phases** | Progression phases with thresholds and clicker label overrides. Also tier display names. |
| **Narrative** | Message channels (type, weight, message list), milestones, timing settings |
| **Actions** | Custom buttons/toggles with preset dropdowns for all code fields (visible, enabled, activate, deactivate, statusText) |
| **Resources** | Progress bars with min/max/initial, gradient colors, and onTick hooks |
| **Endgame** | Enable/disable. Button label, conditions, cinematic sequence lines, end screen content |
| **Prestige** | Enable/disable. Prestige currency, conditions, reward formula, kept currencies/resources |
| **Hooks** | Global onLoad and onTick hooks. Custom stats bar entries with value expressions. |

Projects auto-save every 2 seconds.

### Code Presets

For code fields (like `onBuy`, `visible`, `onActivate`), the builder provides preset dropdowns with common patterns. Select a preset, fill in the prompted values, and the code is auto-generated. Select **"Custom JS..."** to write raw JavaScript.

Available preset categories:

| Preset Key | Used For | Example Presets |
|------------|----------|-----------------|
| `onBuy` | Upgrade purchase hooks | Add to resource, Set custom flag, Log a message, Earn bonus currency |
| `visible` | Visibility conditions | Phase >= N, Total primary >= N, Custom flag is set, Owns upgrade |
| `enabled` | Enabled conditions | Has enough currency, Phase >= N |
| `canActivate` | Endgame/prestige conditions | Primary >= N, Total primary >= N, Custom flag is set |
| `onActivate` | Action activate callbacks | Set rate multiplier, Earn currency, Add to resource |
| `onDeactivate` | Action deactivate callbacks | Reset rate multiplier |
| `statusText` | Action status display | Show custom value, Show resource percentage |
| `onTick` | Resource tick updates | Drain/fill resource over time, Apply visual effect |
| `valueStat` | Stat display expressions | Format currency, Format duration, Resource percentage |
| `calcReward` | Prestige reward formulas | Logarithmic, Square root |
| `buttonText` | Dynamic button labels | Show cost, Show reward |
| `onLoad` | Game initialization | Welcome message, Restore toggle state |

Each preset prompts for parameter values (e.g. "Enter resource name:", "Enter amount:") and generates the code with those values substituted in.

### Import / Export JSON

**Export JSON** — Click the "Export JSON" button in the sidebar to download the full project as a `.json` file. This captures all configuration, including code snippets, theme colors, and narrative content.

**Import JSON** — Click "Import JSON" and select a `.json` file previously exported from the builder. The project is created with the same name (auto-suffixed if a name collision occurs) and opened for editing.

Use these to back up projects, share them between machines, or version-control your game definitions.

### Dark / Light Mode

Click the sun/moon icon in the bottom-right of the sidebar to toggle between dark and light themes. The preference is persisted in localStorage.

### Exporting a Standalone HTML Game

Click **Export HTML** in the toolbar. The builder:

1. Reads `clicker-framework.js` and `clicker-framework.css` from the repo root
2. Inlines both into a single HTML file
3. Compiles all `*Code` properties (stored as strings in the project JSON) into real JavaScript functions
4. Generates CSS variable overrides from the theme colors
5. Downloads the result as `projectname.html`

The exported file is **completely standalone** — no server, no external files, no dependencies. Open it directly in any browser.

### Builder API Endpoints

The builder server exposes a REST API if you want to integrate with other tools:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List all projects `[{ name, title, updatedAt }]` |
| `POST` | `/api/projects` | Create project. Body: `{ name: string }` |
| `GET` | `/api/projects/:name` | Load full project JSON |
| `PUT` | `/api/projects/:name` | Save project JSON |
| `DELETE` | `/api/projects/:name` | Delete project and its export |
| `POST` | `/api/projects/:name/duplicate` | Copy project. Body: `{ name?: string }` |
| `POST` | `/api/projects/:name/export` | Export to HTML (returns file download) |
| `GET` | `/api/projects/:name/preview` | Get compiled HTML for preview |

---

## Architecture

### Framework (`clicker-framework.js`)

The `ClickerGame` class is the entire engine. It:

- Validates the config on construction
- Builds all HTML inside the container element on `.start()`
- Runs a `requestAnimationFrame` game loop with delta-time calculation
- Manages currencies, upgrades, passive income, and click power as plain objects
- Fires narrative events on a timer with weighted random selection
- Checks milestones every time resources change
- Auto-saves to localStorage on an interval
- Exposes a `custom` object for game-specific state that gets persisted with saves

### Builder (`builder/`)

The builder is a standard Express app serving a vanilla JS SPA:

- **Server** (`server.js`) — CRUD operations on JSON files in `projects/`. No database.
- **Exporter** (`lib/exporter.js`) — String concatenation to assemble HTML. Converts `*Code` strings to function sources using heuristics (expression detection, return wrapping).
- **Editor** (`public/builder.js`) — Renders form UIs for each tab, binds form inputs to the in-memory project object, and debounces saves to the API. Preset dropdowns use prompt() for parameter collection.

### Export Pipeline

```
Project JSON (with *Code strings)
        │
        ▼
    exporter.js
        │
        ├── Read clicker-framework.js  ──┐
        ├── Read clicker-framework.css  ──┤
        ├── Compile *Code → functions     │
        ├── Generate theme CSS overrides  │
        │                                 │
        ▼                                 │
    Single HTML file ◄────────────────────┘
    (fully standalone)
```

---

## Examples

### `sample.html`

The original ETERNAL.LY game — a satirical anti-aging clicker — written as a single monolithic HTML file before the framework existed. Useful as a reference for what a complete game looks like.

### `example-eternally.html`

The same ETERNAL.LY game rebuilt using the framework. Demonstrates:

- Multiple currencies (Life Force + Lifespan)
- 19 upgrades across 5 tiers with escalating costs
- 5 phases with clicker label changes
- Soul Fatigue resource with visual desaturation effect
- Social media posting action with cooldown and follower tracking
- Data selling toggle with rate multiplier
- 3 narrative channels with ~60 messages
- 11 soul fatigue milestones
- Endgame consciousness upload sequence

All of this is expressed as a single config object — no manual DOM manipulation, no game loop code, no save/load logic.

### `starter-template.html`

Minimal boilerplate for starting a new game. Has:

- One currency (Gold)
- One click upgrade, five passive upgrades across 3 tiers
- 3 phases
- One narrative channel with 4 messages
- An `onLoad` welcome message

Copy this file, replace the content with your theme, and you have a working game.
