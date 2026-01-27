const express = require('express');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');

// Load site configuration
const siteConfig = require('./site.config.js');

const app = express();
const PORT = siteConfig.server?.port || 5090;

// Resolve contents directory from config (support both relative and absolute paths)
const CONTENTS_DIR = path.isAbsolute(siteConfig.contentsDir)
    ? siteConfig.contentsDir
    : path.join(__dirname, siteConfig.contentsDir);

// Standardized subdirectories within contents
const PUBLISHED_DIR = path.join(CONTENTS_DIR, 'published');
const DRAFT_DIR = path.join(CONTENTS_DIR, 'draft');
const SHARED_DIR = path.join(CONTENTS_DIR, 'shared');
const ASSETS_DIR = path.join(CONTENTS_DIR, 'assets');

// Data directory inside contents (persists with content across code upgrades)
const DATA_DIR = path.join(CONTENTS_DIR, 'data');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const VIEWS_FILE = path.join(DATA_DIR, 'views.json');

// ==================== CONCURRENCY CONFIGURATION ====================
const CONFIG = {
    // Cache TTL in milliseconds
    CACHE_TTL: {
        config: 60000,      // 1 minute for site config
        authors: 60000,     // 1 minute for authors
        volumes: 30000,     // 30 seconds for volumes list
        contributions: 30000 // 30 seconds for contributions
    },
    // Rate limiting
    RATE_LIMIT: {
        windowMs: 60000,    // 1 minute window
        maxRequests: {
            read: 240,      // 100 read requests per minute per IP
            write: 20       // 20 write requests per minute per IP
        }
    },
    // Lock timeout in milliseconds
    LOCK_TIMEOUT: 5000,
    // Write debounce interval
    WRITE_DEBOUNCE: 100,
    // Maximum concurrent file writes
    MAX_CONCURRENT_WRITES: 10
};

// ==================== IN-MEMORY CACHE ====================
class Cache {
    constructor() {
        this.store = new Map();
    }

    get(key) {
        const item = this.store.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
            this.store.delete(key);
            return null;
        }
        return item.value;
    }

    set(key, value, ttl) {
        this.store.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    invalidate(key) {
        this.store.delete(key);
    }

    invalidatePattern(pattern) {
        for (const key of this.store.keys()) {
            if (key.includes(pattern)) {
                this.store.delete(key);
            }
        }
    }
}

const cache = new Cache();

// ==================== ASYNC MUTEX IMPLEMENTATION ====================
class AsyncMutex {
    constructor() {
        this.locks = new Map();
    }

    async acquire(resource, timeout = CONFIG.LOCK_TIMEOUT) {
        const startTime = Date.now();

        while (this.locks.has(resource)) {
            if (Date.now() - startTime > timeout) {
                throw new Error(`Lock timeout for resource: ${resource}`);
            }
            // Wait for the existing lock's promise to resolve
            await this.locks.get(resource).promise;
        }

        // Create a new lock with a resolvable promise
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        this.locks.set(resource, { promise, resolve });

        return () => {
            const lock = this.locks.get(resource);
            if (lock) {
                this.locks.delete(resource);
                lock.resolve();
            }
        };
    }
}

const mutex = new AsyncMutex();

// ==================== RATE LIMITER ====================
class RateLimiter {
    constructor() {
        this.requests = new Map();
        // Clean up old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }

    isAllowed(ip, type = 'read') {
        const key = `${ip}:${type}`;
        const now = Date.now();
        const windowStart = now - CONFIG.RATE_LIMIT.windowMs;

        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }

        const timestamps = this.requests.get(key);
        // Remove old timestamps
        const recent = timestamps.filter(t => t > windowStart);
        this.requests.set(key, recent);

        const maxRequests = CONFIG.RATE_LIMIT.maxRequests[type] || CONFIG.RATE_LIMIT.maxRequests.read;

        if (recent.length >= maxRequests) {
            return false;
        }

        recent.push(now);
        return true;
    }

    cleanup() {
        const now = Date.now();
        const windowStart = now - CONFIG.RATE_LIMIT.windowMs;

        for (const [key, timestamps] of this.requests.entries()) {
            const recent = timestamps.filter(t => t > windowStart);
            if (recent.length === 0) {
                this.requests.delete(key);
            } else {
                this.requests.set(key, recent);
            }
        }
    }
}

const rateLimiter = new RateLimiter();

// ==================== DEBOUNCED WRITE QUEUE ====================
class WriteQueue {
    constructor() {
        this.pendingWrites = new Map();
        this.writeCount = 0;
    }

    async scheduleWrite(filePath, data) {
        // Cancel any pending write for this file
        if (this.pendingWrites.has(filePath)) {
            clearTimeout(this.pendingWrites.get(filePath).timeout);
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(async () => {
                this.pendingWrites.delete(filePath);
                try {
                    // Wait if too many concurrent writes
                    while (this.writeCount >= CONFIG.MAX_CONCURRENT_WRITES) {
                        await new Promise(r => setTimeout(r, 10));
                    }
                    this.writeCount++;
                    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
                    this.writeCount--;
                    resolve();
                } catch (error) {
                    this.writeCount--;
                    reject(error);
                }
            }, CONFIG.WRITE_DEBOUNCE);

            this.pendingWrites.set(filePath, { timeout, resolve, reject });
        });
    }
}

const writeQueue = new WriteQueue();

// ==================== ASYNC FILE OPERATIONS ====================

// In-memory data store (loaded on startup, persisted periodically)
let likesData = {};
let viewsData = {};
let dataLoaded = false;

// Global watcher reference (declared here so gracefulShutdown can access it)
let fileWatcher = null;

async function ensureDataDir() {
    try {
        await fsPromises.access(DATA_DIR);
    } catch {
        await fsPromises.mkdir(DATA_DIR, { recursive: true });
    }
}

async function loadDataFiles() {
    await ensureDataDir();

    try {
        const likesContent = await fsPromises.readFile(LIKES_FILE, 'utf8');
        likesData = JSON.parse(likesContent);
    } catch {
        likesData = {};
    }

    try {
        const viewsContent = await fsPromises.readFile(VIEWS_FILE, 'utf8');
        viewsData = JSON.parse(viewsContent);
    } catch {
        viewsData = {};
    }

    dataLoaded = true;
    console.log('Data files loaded into memory');
}

// Periodic persistence (every 5 seconds if dirty)
let likesDirty = false;
let viewsDirty = false;

async function persistData() {
    if (likesDirty) {
        try {
            await writeQueue.scheduleWrite(LIKES_FILE, likesData);
            likesDirty = false;
        } catch (error) {
            console.error('Failed to persist likes:', error);
        }
    }

    if (viewsDirty) {
        try {
            await writeQueue.scheduleWrite(VIEWS_FILE, viewsData);
            viewsDirty = false;
        } catch (error) {
            console.error('Failed to persist views:', error);
        }
    }
}

// Start periodic persistence
setInterval(persistData, 5000);

// Graceful shutdown handler - consolidates all cleanup tasks
async function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Shutting down gracefully...`);

    // Stop SSE heartbeat and close all SSE connections
    if (typeof stopSSEHeartbeat === 'function') {
        stopSSEHeartbeat();
    }
    if (typeof sseClients !== 'undefined' && sseClients.size > 0) {
        console.log(`Closing ${sseClients.size} SSE connection(s)...`);
        sseClients.forEach((info, client) => {
            try { client.end(); } catch (e) { /* ignore */ }
        });
        sseClients.clear();
    }

    // Close file watcher if it exists
    if (fileWatcher) {
        console.log('Closing file watcher...');
        await fileWatcher.close();
    }

    // Persist any pending data
    console.log('Persisting data...');
    await persistData();

    console.log('Shutdown complete.');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Parse YAML frontmatter from markdown using js-yaml
// Supports both LF and CRLF line endings
function parseYamlFrontmatter(content) {
    // Normalize line endings to LF for consistent parsing
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const match = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    try {
        return yaml.load(match[1]) || {};
    } catch (e) {
        console.error('Failed to parse YAML:', e);
        return {};
    }
}

// Helper to get content directory based on draft mode
function getVolumesDir(isDraft) {
    return isDraft ? DRAFT_DIR : PUBLISHED_DIR;
}

// Get client IP (handles proxies)
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.connection.remoteAddress ||
           'unknown';
}

// ==================== MIDDLEWARE ====================

// JSON body parser with size limit
app.use(express.json({ limit: '10kb' }));

// Rate limiting middleware
function rateLimitMiddleware(type = 'read') {
    return (req, res, next) => {
        const ip = getClientIP(req);
        if (!rateLimiter.isAllowed(ip, type)) {
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil(CONFIG.RATE_LIMIT.windowMs / 1000)
            });
        }
        next();
    };
}

// Request timeout middleware
app.use((req, res, next) => {
    res.setTimeout(30000, () => {
        // Only send timeout response if headers haven't been sent yet
        if (!res.headersSent) {
            res.status(408).json({ error: 'Request timeout' });
        }
    });
    next();
});

// IMPORTANT: Serve contents directories BEFORE generic static middleware
// This ensures external contents directories work correctly
app.use('/contents/published', express.static(PUBLISHED_DIR, {
    maxAge: '5m',
    etag: true,
    lastModified: true
}));
app.use('/contents/draft', express.static(DRAFT_DIR, {
    maxAge: '1m',
    etag: true
}));
app.use('/contents/shared', express.static(SHARED_DIR, {
    maxAge: '5m',
    etag: true
}));
app.use('/contents/assets', express.static(ASSETS_DIR, {
    maxAge: '1h',
    etag: true,
    immutable: true
}));

// Generic static files (HTML, JS, CSS from project directory)
app.use(express.static(__dirname, {
    index: 'index.html',
    maxAge: '1h',
    etag: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=300');
        }
    }
}));

// ==================== API ROUTES ====================

// GET /api/site-config - Get site paths configuration for frontend
app.get('/api/site-config', rateLimitMiddleware('read'), (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
        contentsDir: '/contents',
        publishedDir: '/contents/published',
        draftDir: '/contents/draft',
        sharedDir: '/contents/shared',
        assetsDir: '/contents/assets'
    });
});

// GET /api/config - Get site configuration (from shared directory)
app.get('/api/config', rateLimitMiddleware('read'), async (req, res) => {
    const cacheKey = 'config';
    let config = cache.get(cacheKey);

    if (!config) {
        const configPath = path.join(SHARED_DIR, 'config.md');
        try {
            const content = await fsPromises.readFile(configPath, 'utf8');
            config = parseYamlFrontmatter(content);
            cache.set(cacheKey, config, CONFIG.CACHE_TTL.config);
        } catch {
            config = {};
        }
    }

    res.set('Cache-Control', 'public, max-age=60');
    res.json(config);
});

// GET /api/authors - Get all authors from shared authors.md
app.get('/api/authors', rateLimitMiddleware('read'), async (req, res) => {
    const cacheKey = 'authors';
    let authors = cache.get(cacheKey);

    if (!authors) {
        const authorsPath = path.join(SHARED_DIR, 'authors.md');
        authors = {};

        try {
            const content = await fsPromises.readFile(authorsPath, 'utf8');
            const data = parseYamlFrontmatter(content);

            if (data.authors && Array.isArray(data.authors)) {
                data.authors.forEach(author => {
                    if (author.id) {
                        authors[author.id] = author;
                    }
                });
            }
            cache.set(cacheKey, authors, CONFIG.CACHE_TTL.authors);
        } catch (error) {
            console.error('Failed to read authors:', error);
        }
    }

    res.set('Cache-Control', 'public, max-age=60');
    res.json(authors);
});

// GET /api/authors/:authorId - Get specific author from shared authors.md
app.get('/api/authors/:authorId', rateLimitMiddleware('read'), async (req, res) => {
    const { authorId } = req.params;

    // Use the cached authors data
    let authors = cache.get('authors');
    if (!authors) {
        const authorsPath = path.join(SHARED_DIR, 'authors.md');
        authors = {};

        try {
            const content = await fsPromises.readFile(authorsPath, 'utf8');
            const data = parseYamlFrontmatter(content);

            if (data.authors && Array.isArray(data.authors)) {
                data.authors.forEach(author => {
                    if (author.id) {
                        authors[author.id] = author;
                    }
                });
            }
            cache.set('authors', authors, CONFIG.CACHE_TTL.authors);
        } catch (error) {
            console.error('Failed to read authors:', error);
            return res.status(500).json({ error: 'Failed to read authors' });
        }
    }

    const author = authors[authorId];
    if (author) {
        res.set('Cache-Control', 'public, max-age=60');
        res.json(author);
    } else {
        res.status(404).json({ error: 'Author not found' });
    }
});

// GET /api/volumes - Get list of available volumes
app.get('/api/volumes', rateLimitMiddleware('read'), async (req, res) => {
    const isDraft = req.query.draft === 'true';
    const cacheKey = `volumes:${isDraft}`;

    let volumes = cache.get(cacheKey);

    if (!volumes) {
        const volumesDir = getVolumesDir(isDraft);

        try {
            await fsPromises.access(volumesDir);
        } catch {
            console.log(`Volumes directory ${volumesDir} does not exist`);
            return res.json([]);
        }

        try {
            const dirs = await fsPromises.readdir(volumesDir, { withFileTypes: true });
            const volumePromises = dirs
                .filter(dir => dir.isDirectory() && dir.name.startsWith('vol-'))
                .map(async dir => {
                    const vol = dir.name.replace('vol-', '');
                    const radarPath = path.join(volumesDir, dir.name, 'radar.md');
                    let date = '';

                    try {
                        const content = await fsPromises.readFile(radarPath, 'utf8');
                        const dateMatch = content.match(/date:\s*"?([^"\n]+)"?/);
                        if (dateMatch) {
                            date = dateMatch[1].trim();
                        }
                    } catch {
                        // File doesn't exist or can't be read
                    }

                    return { vol, date, views: isDraft ? 0 : (viewsData[vol] || 0) };
                });

            volumes = await Promise.all(volumePromises);
            volumes.sort((a, b) => b.vol.localeCompare(a.vol));
            cache.set(cacheKey, volumes, CONFIG.CACHE_TTL.volumes);
        } catch (error) {
            console.error('Failed to read volumes:', error);
            return res.json([]);
        }
    }

    res.set('Cache-Control', 'public, max-age=30');
    res.json(volumes);
});

// GET /api/contributions/:vol - Get list of contributions for a volume
app.get('/api/contributions/:vol', rateLimitMiddleware('read'), async (req, res) => {
    const { vol } = req.params;
    const isDraft = req.query.draft === 'true';
    const cacheKey = `contributions:${vol}:${isDraft}`;

    let contributions = cache.get(cacheKey);

    if (!contributions) {
        const contributionsDir = path.join(getVolumesDir(isDraft), `vol-${vol}`, 'contributions');

        try {
            const dirs = await fsPromises.readdir(contributionsDir, { withFileTypes: true });
            contributions = dirs
                .filter(dir => dir.isDirectory())
                .map(dir => dir.name)
                .sort();
            cache.set(cacheKey, contributions, CONFIG.CACHE_TTL.contributions);
        } catch {
            contributions = [];
        }
    }

    res.set('Cache-Control', 'public, max-age=30');
    res.json(contributions);
});

// GET /api/likes - Get all likes
app.get('/api/likes', rateLimitMiddleware('read'), (req, res) => {
    res.set('Cache-Control', 'private, max-age=5');
    res.json(likesData);
});

// Helper to validate article existence
async function validateArticleExists(articleId) {
    // articleId format: "vol-folderName" e.g., "001-05-architecture-diagram"
    const match = articleId.match(/^(\d+)-(.+)$/);
    if (!match) return false;

    const [, vol, folderName] = match;
    const articlePath = path.join(PUBLISHED_DIR, `vol-${vol}`, 'contributions', folderName, 'index.md');

    try {
        await fsPromises.access(articlePath);
        return true;
    } catch {
        // Also check draft directory
        const draftPath = path.join(DRAFT_DIR, `vol-${vol}`, 'contributions', folderName, 'index.md');
        try {
            await fsPromises.access(draftPath);
            return true;
        } catch {
            return false;
        }
    }
}

// POST /api/likes/:articleId - Toggle like for an article (with concurrency control)
app.post('/api/likes/:articleId', rateLimitMiddleware('write'), async (req, res) => {
    const { articleId } = req.params;
    const { action } = req.body;

    // Validate input
    if (!action || !['like', 'unlike'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    if (!articleId || articleId.length > 100) {
        return res.status(400).json({ error: 'Invalid article ID' });
    }

    // Validate that the article actually exists
    const articleExists = await validateArticleExists(articleId);
    if (!articleExists) {
        return res.status(404).json({ error: 'Article not found' });
    }

    const lockKey = `likes:${articleId}`;
    let releaseLock;

    try {
        releaseLock = await mutex.acquire(lockKey);

        if (!likesData[articleId]) {
            likesData[articleId] = 0;
        }

        if (action === 'like') {
            likesData[articleId]++;
        } else if (action === 'unlike' && likesData[articleId] > 0) {
            likesData[articleId]--;
        }

        likesDirty = true;
        res.json({ articleId, likes: likesData[articleId] });
    } catch (error) {
        if (error.message.includes('Lock timeout')) {
            return res.status(503).json({ error: 'Service busy, please retry' });
        }
        console.error('Error updating likes:', error);
        res.status(500).json({ error: 'Failed to update likes' });
    } finally {
        if (releaseLock) releaseLock();
    }
});

// GET /api/views/:vol - Get views for a volume
app.get('/api/views/:vol', rateLimitMiddleware('read'), (req, res) => {
    const { vol } = req.params;
    res.set('Cache-Control', 'private, max-age=5');
    res.json({ vol, views: viewsData[vol] || 0 });
});

// POST /api/views/:vol - Increment views for a volume (with concurrency control)
app.post('/api/views/:vol', rateLimitMiddleware('write'), async (req, res) => {
    const { vol } = req.params;

    // Validate input
    if (!vol || vol.length > 10 || !/^\d+$/.test(vol)) {
        return res.status(400).json({ error: 'Invalid volume ID' });
    }

    const lockKey = `views:${vol}`;
    let releaseLock;

    try {
        releaseLock = await mutex.acquire(lockKey);

        if (!viewsData[vol]) {
            viewsData[vol] = 0;
        }
        viewsData[vol]++;

        viewsDirty = true;

        // Invalidate volumes cache since views changed
        cache.invalidatePattern('volumes');

        res.json({ vol, views: viewsData[vol] });
    } catch (error) {
        if (error.message.includes('Lock timeout')) {
            return res.status(503).json({ error: 'Service busy, please retry' });
        }
        console.error('Error updating views:', error);
        res.status(500).json({ error: 'Failed to update views' });
    } finally {
        if (releaseLock) releaseLock();
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        dataLoaded,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    });
});

// Auto-generate archive.json for static hosting fallback
async function generateArchiveJson(isDraft = false) {
    const volumesDir = getVolumesDir(isDraft);
    const archivePath = path.join(volumesDir, 'archive.json');

    try {
        await fsPromises.access(volumesDir);
    } catch {
        console.log(`Volumes directory ${volumesDir} does not exist, skipping archive.json generation`);
        return;
    }

    try {
        const dirs = await fsPromises.readdir(volumesDir, { withFileTypes: true });
        const volumePromises = dirs
            .filter(dir => dir.isDirectory() && dir.name.startsWith('vol-'))
            .map(async dir => {
                const vol = dir.name.replace('vol-', '');
                const radarPath = path.join(volumesDir, dir.name, 'radar.md');
                let date = '';

                try {
                    const content = await fsPromises.readFile(radarPath, 'utf8');
                    const dateMatch = content.match(/date:\s*"?([^"\n]+)"?/);
                    if (dateMatch) {
                        date = dateMatch[1].trim();
                    }
                } catch {
                    // File doesn't exist
                }

                return { vol, date, views: isDraft ? 0 : (viewsData[vol] || 0) };
            });

        const volumes = await Promise.all(volumePromises);
        volumes.sort((a, b) => b.vol.localeCompare(a.vol));

        await fsPromises.writeFile(archivePath, JSON.stringify(volumes, null, 2));
        console.log(`Generated ${isDraft ? 'draft ' : ''}archive.json with ${volumes.length} volumes`);
    } catch (error) {
        console.error('Failed to generate archive.json:', error);
    }
}

// ==================== SERVER STARTUP ====================
async function startServer() {
    // Log configuration
    console.log('Site Configuration:');
    console.log(`  Contents Dir: ${CONTENTS_DIR}`);
    console.log(`    - Published: ${PUBLISHED_DIR}`);
    console.log(`    - Draft: ${DRAFT_DIR}`);
    console.log(`    - Shared: ${SHARED_DIR}`);
    console.log(`    - Assets: ${ASSETS_DIR}`);
    console.log(`    - Data: ${DATA_DIR}`);

    // Load data files into memory
    await loadDataFiles();

    // Generate archive.json
    await generateArchiveJson(false);
    await generateArchiveJson(true);

    // Start the server
    const server = app.listen(PORT, () => {
        console.log(`Tech Radar server running at http://localhost:${PORT}`);
        console.log(`Concurrency optimizations enabled:`);
        console.log(`  - In-memory caching with TTL`);
        console.log(`  - Async file I/O`);
        console.log(`  - Rate limiting (${CONFIG.RATE_LIMIT.maxRequests.read} read, ${CONFIG.RATE_LIMIT.maxRequests.write} write per minute)`);
        console.log(`  - Proper mutex-based locking`);
        console.log(`  - Debounced writes`);
    });

    // Configure server for high concurrency
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.maxConnections = 2000;
}

// ==================== HOT RELOAD WITH FILE WATCHING ====================

// Store SSE clients for hot reload notifications
const sseClients = new Map(); // Map<response, { connectedAt, ip }>
const SSE_CONFIG = {
    MAX_CLIENTS_TOTAL: 1000,   // Maximum total SSE connections (for high concurrency)
    MAX_CLIENTS_PER_IP: 5,     // Maximum SSE connections per IP (prevent single client abuse)
    HEARTBEAT_INTERVAL: 30000  // Send heartbeat every 30 seconds
};

// Count connections per IP
function getConnectionCountByIP(ip) {
    let count = 0;
    sseClients.forEach((info) => {
        if (info.ip === ip) count++;
    });
    return count;
}

// Periodic heartbeat to detect dead connections
let sseHeartbeatInterval = null;

function startSSEHeartbeat() {
    if (sseHeartbeatInterval) return;

    sseHeartbeatInterval = setInterval(() => {
        const now = Date.now();
        const deadClients = [];

        sseClients.forEach((info, client) => {
            try {
                // Send heartbeat
                client.write(':heartbeat\n\n');
            } catch (e) {
                // Client is dead, mark for removal
                deadClients.push(client);
            }
        });

        // Remove dead clients
        deadClients.forEach(client => {
            sseClients.delete(client);
            try { client.end(); } catch (e) { /* ignore */ }
        });

        if (deadClients.length > 0) {
            console.log(`Cleaned up ${deadClients.length} dead SSE client(s). Total clients: ${sseClients.size}`);
        }
    }, SSE_CONFIG.HEARTBEAT_INTERVAL);
}

function stopSSEHeartbeat() {
    if (sseHeartbeatInterval) {
        clearInterval(sseHeartbeatInterval);
        sseHeartbeatInterval = null;
    }
}

// SSE endpoint for hot reload notifications
app.get('/api/hot-reload', (req, res) => {
    const clientIP = getClientIP(req);

    // Check global limit
    if (sseClients.size >= SSE_CONFIG.MAX_CLIENTS_TOTAL) {
        console.log(`SSE connection rejected: max total clients (${SSE_CONFIG.MAX_CLIENTS_TOTAL}) reached`);
        return res.status(503).json({ error: 'Server busy, please try again later' });
    }

    // Check per-IP limit
    const ipConnectionCount = getConnectionCountByIP(clientIP);
    if (ipConnectionCount >= SSE_CONFIG.MAX_CLIENTS_PER_IP) {
        console.log(`SSE connection rejected: IP ${clientIP} has ${ipConnectionCount} connections (max: ${SSE_CONFIG.MAX_CLIENTS_PER_IP})`);
        return res.status(429).json({ error: 'Too many connections from your IP' });
    }

    // Disable the request timeout for SSE connections (they are long-lived)
    res.setTimeout(0);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

    // Send initial connection message
    res.write('data: {"type":"connected"}\n\n');

    // Add client to map with connection info
    sseClients.set(res, {
        connectedAt: Date.now(),
        ip: clientIP
    });
    console.log(`Hot reload client connected. Total clients: ${sseClients.size}`);

    // Start heartbeat if this is the first client
    if (sseClients.size === 1) {
        startSSEHeartbeat();
    }

    // Remove client on disconnect
    req.on('close', () => {
        sseClients.delete(res);
        console.log(`Hot reload client disconnected. Total clients: ${sseClients.size}`);

        // Stop heartbeat if no more clients
        if (sseClients.size === 0) {
            stopSSEHeartbeat();
        }
    });
});

// Broadcast hot reload notification to all connected clients
function notifyHotReload(changeType, filePath) {
    const message = JSON.stringify({ type: changeType, path: filePath, timestamp: Date.now() });
    const deadClients = [];

    sseClients.forEach((info, client) => {
        try {
            client.write(`data: ${message}\n\n`);
        } catch (e) {
            deadClients.push(client);
        }
    });

    // Clean up dead clients
    deadClients.forEach(client => {
        sseClients.delete(client);
        try { client.end(); } catch (e) { /* ignore */ }
    });
}

// Set up file watcher for hot reload
function setupFileWatcher() {
    const watchPaths = [PUBLISHED_DIR, DRAFT_DIR, SHARED_DIR];

    // Filter to only watch existing directories
    const existingPaths = watchPaths.filter(p => {
        try {
            fs.accessSync(p);
            return true;
        } catch {
            return false;
        }
    });

    if (existingPaths.length === 0) {
        console.log('No content directories to watch');
        return null;
    }

    console.log('Setting up file watcher for:', existingPaths);

    const watcher = chokidar.watch(existingPaths, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    // Debounce cache invalidation
    let invalidationTimeout = null;
    const scheduleInvalidation = (type, filePath) => {
        if (invalidationTimeout) {
            clearTimeout(invalidationTimeout);
        }
        invalidationTimeout = setTimeout(() => {
            // Determine what cache to invalidate based on file path
            if (filePath.includes('/vol-')) {
                // Volume-related change - invalidate volumes and contributions cache
                cache.invalidatePattern('volumes');
                cache.invalidatePattern('contributions');
                console.log('Cache invalidated: volumes and contributions');
            }
            if (filePath.includes('/shared/')) {
                // Shared content change - invalidate config and authors
                cache.invalidate('config');
                cache.invalidate('authors');
                console.log('Cache invalidated: config and authors');
            }

            // Regenerate archive.json for volume changes
            if (filePath.includes('/vol-')) {
                generateArchiveJson(filePath.includes('/draft/'));
            }

            // Notify connected clients
            notifyHotReload(type, filePath);
        }, 500);
    };

    watcher
        .on('add', filePath => {
            console.log(`File added: ${filePath}`);
            scheduleInvalidation('add', filePath);
        })
        .on('change', filePath => {
            console.log(`File changed: ${filePath}`);
            scheduleInvalidation('change', filePath);
        })
        .on('unlink', filePath => {
            console.log(`File removed: ${filePath}`);
            scheduleInvalidation('unlink', filePath);
        })
        .on('addDir', dirPath => {
            console.log(`Directory added: ${dirPath}`);
            scheduleInvalidation('addDir', dirPath);
        })
        .on('unlinkDir', dirPath => {
            console.log(`Directory removed: ${dirPath}`);
            scheduleInvalidation('unlinkDir', dirPath);
        })
        .on('error', error => {
            console.error('File watcher error:', error);
        })
        .on('ready', () => {
            console.log('File watcher ready. Watching for changes...');
        });

    return watcher;
}

startServer().then(() => {
    // Set up file watcher after server starts
    fileWatcher = setupFileWatcher();
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
