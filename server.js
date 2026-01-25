const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const VIEWS_FILE = path.join(DATA_DIR, 'views.json');

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Ensure data directory exists
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }
}

// Generic read/write functions
function readJsonFile(filePath) {
    ensureDataDir();
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({}));
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
}

function writeJsonFile(filePath, data) {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Read/Write likes data
function readLikes() {
    return readJsonFile(LIKES_FILE);
}

function writeLikes(data) {
    writeJsonFile(LIKES_FILE, data);
}

// Read/Write views data
function readViews() {
    return readJsonFile(VIEWS_FILE);
}

function writeViews(data) {
    writeJsonFile(VIEWS_FILE, data);
}

// GET /api/volumes - Get list of available volumes
app.get('/api/volumes', (req, res) => {
    const contentDir = path.join(__dirname, 'content');
    const views = readViews();

    try {
        const dirs = fs.readdirSync(contentDir, { withFileTypes: true });
        const volumes = dirs
            .filter(dir => dir.isDirectory() && dir.name.startsWith('vol-'))
            .map(dir => {
                const vol = dir.name.replace('vol-', '');
                const radarPath = path.join(contentDir, dir.name, 'radar.md');
                let date = '';

                // Try to read date from radar.md frontmatter
                if (fs.existsSync(radarPath)) {
                    const content = fs.readFileSync(radarPath, 'utf8');
                    const dateMatch = content.match(/date:\s*"?([^"\n]+)"?/);
                    if (dateMatch) {
                        date = dateMatch[1].trim();
                    }
                }

                return { vol, date, views: views[vol] || 0 };
            })
            .sort((a, b) => b.vol.localeCompare(a.vol)); // Sort descending

        res.json(volumes);
    } catch (error) {
        console.error('Failed to read volumes:', error);
        res.json([]);
    }
});

// GET /api/likes - Get all likes
app.get('/api/likes', (req, res) => {
    const likes = readLikes();
    res.json(likes);
});

// POST /api/likes/:articleId - Toggle like for an article
app.post('/api/likes/:articleId', (req, res) => {
    const { articleId } = req.params;
    const { action } = req.body; // 'like' or 'unlike'

    const likes = readLikes();

    if (!likes[articleId]) {
        likes[articleId] = 0;
    }

    if (action === 'like') {
        likes[articleId]++;
    } else if (action === 'unlike' && likes[articleId] > 0) {
        likes[articleId]--;
    }

    writeLikes(likes);
    res.json({ articleId, likes: likes[articleId] });
});

// GET /api/views/:vol - Get views for a volume
app.get('/api/views/:vol', (req, res) => {
    const { vol } = req.params;
    const views = readViews();
    res.json({ vol, views: views[vol] || 0 });
});

// POST /api/views/:vol - Increment views for a volume
app.post('/api/views/:vol', (req, res) => {
    const { vol } = req.params;
    const views = readViews();

    if (!views[vol]) {
        views[vol] = 0;
    }
    views[vol]++;

    writeViews(views);
    res.json({ vol, views: views[vol] });
});

app.listen(PORT, () => {
    console.log(`Tech Radar server running at http://localhost:${PORT}`);
});
