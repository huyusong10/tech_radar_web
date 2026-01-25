const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const VIEWS_FILE = path.join(DATA_DIR, 'views.json');

// Lock management for concurrent write operations
const locks = new Map();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Ensure data directory exists
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }
}

// Acquire lock for a resource
async function acquireLock(resource) {
    while (locks.has(resource)) {
        // Wait for lock to be released
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    locks.set(resource, true);
}

// Release lock for a resource
function releaseLock(resource) {
    locks.delete(resource);
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

// Parse YAML frontmatter from markdown using js-yaml
function parseYamlFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    try {
        return yaml.load(match[1]) || {};
    } catch (e) {
        console.error('Failed to parse YAML:', e);
        return {};
    }
}

// GET /api/config - Get site configuration
app.get('/api/config', (req, res) => {
    const configPath = path.join(__dirname, 'content', 'config.md');

    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            const config = parseYamlFrontmatter(content);
            res.json(config);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Failed to read config:', error);
        res.json({});
    }
});

// GET /api/authors - Get all authors from unified authors.md
app.get('/api/authors', (req, res) => {
    const authorsPath = path.join(__dirname, 'content', 'authors.md');

    try {
        const authors = {};

        if (fs.existsSync(authorsPath)) {
            const content = fs.readFileSync(authorsPath, 'utf8');
            const data = parseYamlFrontmatter(content);

            if (data.authors && Array.isArray(data.authors)) {
                data.authors.forEach(author => {
                    if (author.id) {
                        authors[author.id] = author;
                    }
                });
            }
        }

        res.json(authors);
    } catch (error) {
        console.error('Failed to read authors:', error);
        res.json({});
    }
});

// GET /api/authors/:authorId - Get specific author from unified authors.md
app.get('/api/authors/:authorId', (req, res) => {
    const { authorId } = req.params;
    const authorsPath = path.join(__dirname, 'content', 'authors.md');

    try {
        if (fs.existsSync(authorsPath)) {
            const content = fs.readFileSync(authorsPath, 'utf8');
            const data = parseYamlFrontmatter(content);

            if (data.authors && Array.isArray(data.authors)) {
                const author = data.authors.find(a => a.id === authorId);
                if (author) {
                    res.json(author);
                    return;
                }
            }
        }
        res.status(404).json({ error: 'Author not found' });
    } catch (error) {
        console.error('Failed to read author:', error);
        res.status(500).json({ error: 'Failed to read author' });
    }
});

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

// POST /api/likes/:articleId - Toggle like for an article (with concurrency control)
app.post('/api/likes/:articleId', async (req, res) => {
    const { articleId } = req.params;
    const { action } = req.body; // 'like' or 'unlike'

    const lockKey = `likes-${articleId}`;

    try {
        // Acquire lock for this article's likes
        await acquireLock(lockKey);

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
    } catch (error) {
        console.error('Error updating likes:', error);
        res.status(500).json({ error: 'Failed to update likes' });
    } finally {
        // Always release lock
        releaseLock(lockKey);
    }
});

// GET /api/views/:vol - Get views for a volume
app.get('/api/views/:vol', (req, res) => {
    const { vol } = req.params;
    const views = readViews();
    res.json({ vol, views: views[vol] || 0 });
});

// POST /api/views/:vol - Increment views for a volume (with concurrency control)
app.post('/api/views/:vol', async (req, res) => {
    const { vol } = req.params;
    const lockKey = `views-${vol}`;

    try {
        // Acquire lock for this volume's views
        await acquireLock(lockKey);

        const views = readViews();

        if (!views[vol]) {
            views[vol] = 0;
        }
        views[vol]++;

        writeViews(views);
        res.json({ vol, views: views[vol] });
    } catch (error) {
        console.error('Error updating views:', error);
        res.status(500).json({ error: 'Failed to update views' });
    } finally {
        // Always release lock
        releaseLock(lockKey);
    }
});

app.listen(PORT, () => {
    console.log(`Tech Radar server running at http://localhost:${PORT}`);
});
