const express = require('express');
const fs = require('fs');
const path = require('path');
const { compileProject } = require('./lib/exporter');

const app = express();
const PORT = process.env.PORT || 3000;

const PROJECTS_DIR = path.join(__dirname, 'projects');
const EXPORTS_DIR = path.join(__dirname, 'exports');

// Ensure directories exist
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------
//  HELPERS
// -----------------------------------------------------------------------

function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 80);
}

function projectPath(name) {
    return path.join(PROJECTS_DIR, sanitizeName(name) + '.json');
}

function listProjects() {
    const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
        const raw = fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8');
        const data = JSON.parse(raw);
        return {
            name: path.basename(f, '.json'),
            title: data.config?.title || 'Untitled',
            updatedAt: data.meta?.updatedAt || null,
        };
    }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function newProjectTemplate(name) {
    return {
        meta: {
            name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        config: {
            title: 'My Clicker Game',
            tagline: '',
            logTitle: 'Event Log',
            saveKey: '',
            theme: {
                accent: '#00e676',
                accentDim: '#004d25',
                bg: '#0a0a0c',
                surface: '#111118',
                surface2: '#1a1a24',
                border: '#2a2a3a',
                text: '#e0e0e8',
                textDim: '#7a7a8e',
                red: '#ff1744',
                amber: '#ffab00',
                cyan: '#00e5ff',
                pink: '#f50057',
                purple: '#d500f9',
                gold: '#ffd600',
            },
            currencies: {
                gold: { name: 'Gold', abbr: 'G', color: 'var(--cf-accent)', initial: 0 },
            },
            primaryCurrency: 'gold',
            clicker: {
                label: 'CLICK',
                basePower: 1,
                perClick: {},
            },
            stats: [],
            tierNames: { '1': 'Tier I' },
            upgrades: [],
            phases: [
                { id: 1, name: 'Phase I', threshold: 0, clickerLabel: '' },
            ],
            narrative: {
                channels: [],
                milestones: [],
                baseInterval: 25,
                minInterval: 8,
                intervalScaleStat: '',
                intervalScaleFactor: 0.15,
                minTotalToStart: 30,
            },
            actions: [],
            resources: [],
            endgame: null,
            prestige: null,
            onLoadCode: '',
            onTickCode: '',
        },
    };
}

// -----------------------------------------------------------------------
//  API ROUTES
// -----------------------------------------------------------------------

// List projects
app.get('/api/projects', (req, res) => {
    res.json(listProjects());
});

// Create project
app.post('/api/projects', (req, res) => {
    const name = sanitizeName(req.body.name || 'untitled');
    if (!name) return res.status(400).json({ error: 'Invalid name' });
    const fp = projectPath(name);
    if (fs.existsSync(fp)) return res.status(409).json({ error: 'Project already exists' });
    const project = newProjectTemplate(name);
    fs.writeFileSync(fp, JSON.stringify(project, null, 2));
    res.status(201).json({ name });
});

// Load project
app.get('/api/projects/:name', (req, res) => {
    const fp = projectPath(req.params.name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
});

// Save project
app.put('/api/projects/:name', (req, res) => {
    const name = sanitizeName(req.params.name);
    const fp = projectPath(name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    const data = req.body;
    data.meta = data.meta || {};
    data.meta.name = name;
    data.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    res.json({ ok: true });
});

// Delete project
app.delete('/api/projects/:name', (req, res) => {
    const fp = projectPath(req.params.name);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    const expFp = path.join(EXPORTS_DIR, sanitizeName(req.params.name) + '.html');
    if (fs.existsSync(expFp)) fs.unlinkSync(expFp);
    res.json({ ok: true });
});

// Duplicate project
app.post('/api/projects/:name/duplicate', (req, res) => {
    const srcFp = projectPath(req.params.name);
    if (!fs.existsSync(srcFp)) return res.status(404).json({ error: 'Not found' });
    const newName = sanitizeName(req.body.name || req.params.name + '-copy');
    const destFp = projectPath(newName);
    if (fs.existsSync(destFp)) return res.status(409).json({ error: 'Name taken' });
    const data = JSON.parse(fs.readFileSync(srcFp, 'utf8'));
    data.meta.name = newName;
    data.meta.createdAt = new Date().toISOString();
    data.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(destFp, JSON.stringify(data, null, 2));
    res.status(201).json({ name: newName });
});

// Export to standalone HTML
app.post('/api/projects/:name/export', (req, res) => {
    const fp = projectPath(req.params.name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    try {
        const project = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const html = compileProject(project);
        const exportFp = path.join(EXPORTS_DIR, sanitizeName(req.params.name) + '.html');
        fs.writeFileSync(exportFp, html);
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizeName(req.params.name)}.html"`);
        res.send(html);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Preview (returns HTML for iframe)
app.get('/api/projects/:name/preview', (req, res) => {
    const fp = projectPath(req.params.name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    try {
        const project = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const html = compileProject(project);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// -----------------------------------------------------------------------
//  START
// -----------------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`Clicker Builder running at http://localhost:${PORT}`);
    console.log(`Projects dir: ${PROJECTS_DIR}`);
});
