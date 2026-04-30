const express = require('express');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const yaml = require('js-yaml');
const chokidar = require('chokidar');

// Import utilities
const {
    Cache,
    AsyncMutex,
    RateLimiter,
    WriteQueue,
    createRateLimitConfig,
    DEFAULTS: CONFIG
} = require('./server/utils/concurrency');
const { getClientIP } = require('./server/utils/ip');
const contentUtils = require('./server/utils/content');


// Load site configuration
const siteConfig = require('./site.config.js');

const app = express();
app.set('trust proxy', siteConfig.server?.trustProxy === true);
const runtimePort = Number.parseInt(process.env.PORT || process.env.SITE_PORT || '', 10);
const PORT = Number.isFinite(runtimePort) ? runtimePort : (siteConfig.server?.port || 5090);
const configuredContentsDir = process.env.SITE_CONTENTS_DIR || siteConfig.contentsDir;
const FILE_WATCHER_ENABLED = process.env.DISABLE_FILE_WATCHER !== 'true';

// Resolve contents directory from config (support both relative and absolute paths)
const CONTENTS_DIR = path.isAbsolute(configuredContentsDir)
    ? configuredContentsDir
    : path.join(__dirname, configuredContentsDir);

// Standardized subdirectories within contents
const PUBLISHED_DIR = path.join(CONTENTS_DIR, 'published');
const DRAFT_DIR = path.join(CONTENTS_DIR, 'draft');
const SHARED_DIR = path.join(CONTENTS_DIR, 'shared');
const ASSETS_DIR = path.join(CONTENTS_DIR, 'assets');
const PUBLIC_ASSETS_DIR = path.join(__dirname, 'assets');

// Admin private data directory inside contents
const ADMIN_DIR = path.join(CONTENTS_DIR, 'admin');
const ADMIN_USERS_FILE = path.join(ADMIN_DIR, 'users.json');
const ADMIN_DRAFTS_DIR = path.join(ADMIN_DIR, 'drafts');
const ADMIN_REVIEWS_DIR = path.join(ADMIN_DIR, 'reviews');
const ADMIN_REVISIONS_DIR = path.join(ADMIN_DIR, 'revisions');
const ADMIN_SUBMISSIONS_DIR = path.join(ADMIN_DIR, 'submissions');
const ADMIN_MANUSCRIPTS_DIR = path.join(ADMIN_DIR, 'manuscripts');
const ADMIN_MANUSCRIPT_EDITS_DIR = path.join(ADMIN_DIR, 'manuscript-edits');
const ADMIN_MANUSCRIPT_REVIEWS_DIR = path.join(ADMIN_DIR, 'manuscript-reviews');
const ADMIN_ISSUE_DRAFTS_DIR = path.join(ADMIN_DIR, 'issue-drafts');
const ADMIN_UNPUBLISHED_DIR = path.join(ADMIN_DIR, 'unpublished');
const ADMIN_PUBLISHED_HISTORY_DIR = path.join(ADMIN_DIR, 'published-history');
const ADMIN_AUDIT_LOG_FILE = path.join(ADMIN_DIR, 'audit-log.json');

// Data directory inside contents (persists with content across code upgrades)
const DATA_DIR = path.join(CONTENTS_DIR, 'data');
const VIEWS_FILE = path.join(DATA_DIR, 'views.json');

// Sharded storage directories for likes (scalability optimization)
const LIKES_DIR = path.join(DATA_DIR, 'likes');
const LIKE_IPS_DIR = path.join(DATA_DIR, 'like-ips');

// Legacy files (for migration)
const LEGACY_LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const LEGACY_LIKE_IPS_FILE = path.join(DATA_DIR, 'like-ips.json');

// ==================== LOAD TEST MODE ====================
// Set LOAD_TEST_MODE=true to relax rate limits and connection limits for benchmarking
const LOAD_TEST_MODE = process.env.LOAD_TEST_MODE === 'true';
if (LOAD_TEST_MODE) {
    console.log('LOAD TEST MODE ENABLED - API rate limits and SSE connection limits are disabled');
}

// ==================== CONCURRENCY CONFIGURATION ====================
// Config loaded from utils/concurrency.js default export


// ==================== INSTANCES ====================
const cache = new Cache();
const mutex = new AsyncMutex();
const rateLimiter = new RateLimiter(createRateLimitConfig({ loadTestMode: LOAD_TEST_MODE }));
const writeQueue = new WriteQueue();

const ADMIN_ROLES = ['tech_reviewer', 'editor', 'chief_editor'];
const ADMIN_SESSIONS = new Map();
const ADMIN_COOKIE_NAME = 'tech_radar_admin_session';
const ADMIN_DRAFT_STATUSES = ['editing', 'review_requested', 'changes_requested', 'approved', 'published', 'rejected'];
const SUBMISSION_STATUSES = ['submitted', 'in_editor_review', 'changes_requested', 'accepted', 'rejected', 'published'];
const MANUSCRIPT_STATUSES = ['drafting', 'manuscript_review_requested', 'changes_requested', 'available', 'scheduled', 'published', 'archived'];
const MANUSCRIPT_EDIT_STATUSES = ['idle', 'editing', 'pending_review'];
const MANUSCRIPT_LIST_SCOPES = ['all', 'candidate', 'editing', 'scheduled', 'published', 'archived'];
const DEFAULT_MANUSCRIPT_PAGE_SIZE = 50;
const MAX_MANUSCRIPT_PAGE_SIZE = 200;
const ISSUE_DRAFT_STATUSES = ['editing', 'issue_review_requested', 'changes_requested', 'approved', 'published', 'archived'];
const REVIEW_VISIBILITIES = ['public', 'internal'];


// ==================== ASYNC FILE OPERATIONS ====================

// In-memory data store (loaded on startup, persisted periodically)
let likesData = {};
let viewsData = {};
let likeIpsData = {}; // { articleId: [ip1, ip2, ...] } - IPs that liked each article
let dataLoaded = false;

// Global watcher reference (declared here so gracefulShutdown can access it)
let fileWatcher = null;

async function ensureDataDir() {
    try {
        await fsPromises.mkdir(DATA_DIR, { recursive: true });
        await fsPromises.mkdir(LIKES_DIR, { recursive: true });
        await fsPromises.mkdir(LIKE_IPS_DIR, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.error('Failed to create data directories:', error);
        }
    }
}

// Extract volume number from articleId (e.g., "001-article-name" -> "001")
function getVolFromArticleId(articleId) {
    const match = articleId.match(/^(\d{3})-/);
    return match ? match[1] : null;
}

// Get shard file path for a volume
function getLikesShardPath(vol) {
    return path.join(LIKES_DIR, `vol-${vol}.json`);
}

function getLikeIpsShardPath(vol) {
    return path.join(LIKE_IPS_DIR, `vol-${vol}.json`);
}

async function loadDataFiles() {
    await ensureDataDir();

    // Load views (single file, relatively small)
    try {
        const viewsContent = await fsPromises.readFile(VIEWS_FILE, 'utf8');
        viewsData = JSON.parse(viewsContent);
    } catch {
        viewsData = {};
    }

    // Check for legacy data and migrate if needed
    let needsMigration = false;
    let legacyLikes = {};
    let legacyLikeIps = {};

    try {
        const legacyLikesContent = await fsPromises.readFile(LEGACY_LIKES_FILE, 'utf8');
        legacyLikes = JSON.parse(legacyLikesContent);
        needsMigration = Object.keys(legacyLikes).length > 0;
    } catch {
        // No legacy file
    }

    try {
        const legacyLikeIpsContent = await fsPromises.readFile(LEGACY_LIKE_IPS_FILE, 'utf8');
        legacyLikeIps = JSON.parse(legacyLikeIpsContent);
        needsMigration = needsMigration || Object.keys(legacyLikeIps).length > 0;
    } catch {
        // No legacy file
    }

    // Load sharded data
    likesData = {};
    likeIpsData = {};

    try {
        const likesFiles = await fsPromises.readdir(LIKES_DIR);
        for (const file of likesFiles) {
            if (file.endsWith('.json')) {
                try {
                    const content = await fsPromises.readFile(path.join(LIKES_DIR, file), 'utf8');
                    const shardData = JSON.parse(content);
                    Object.assign(likesData, shardData);
                } catch {
                    // Skip corrupted shard
                }
            }
        }
    } catch {
        // Directory may not exist yet
    }

    try {
        const likeIpsFiles = await fsPromises.readdir(LIKE_IPS_DIR);
        for (const file of likeIpsFiles) {
            if (file.endsWith('.json')) {
                try {
                    const content = await fsPromises.readFile(path.join(LIKE_IPS_DIR, file), 'utf8');
                    const shardData = JSON.parse(content);
                    // Validate arrays
                    for (const articleId of Object.keys(shardData)) {
                        if (Array.isArray(shardData[articleId])) {
                            likeIpsData[articleId] = shardData[articleId];
                        }
                    }
                } catch {
                    // Skip corrupted shard
                }
            }
        }
    } catch {
        // Directory may not exist yet
    }

    // Migrate legacy data if exists
    if (needsMigration) {
        console.log('Migrating legacy likes data to sharded storage...');

        // Merge legacy data (sharded data takes precedence for conflicts)
        for (const [articleId, count] of Object.entries(legacyLikes)) {
            if (!(articleId in likesData)) {
                likesData[articleId] = count;
            }
        }
        for (const [articleId, ips] of Object.entries(legacyLikeIps)) {
            if (!(articleId in likeIpsData) && Array.isArray(ips)) {
                likeIpsData[articleId] = ips;
            }
        }

        // Mark all shards as dirty to persist migrated data
        const volumes = new Set();
        for (const articleId of Object.keys(likesData)) {
            const vol = getVolFromArticleId(articleId);
            if (vol) volumes.add(vol);
        }
        for (const articleId of Object.keys(likeIpsData)) {
            const vol = getVolFromArticleId(articleId);
            if (vol) volumes.add(vol);
        }
        for (const vol of volumes) {
            dirtyShards.add(vol);
        }

        // Rename legacy files after successful migration
        try {
            await fsPromises.rename(LEGACY_LIKES_FILE, LEGACY_LIKES_FILE + '.migrated');
            await fsPromises.rename(LEGACY_LIKE_IPS_FILE, LEGACY_LIKE_IPS_FILE + '.migrated');
            console.log('Legacy data migration complete');
        } catch {
            // Files may not exist or already migrated
        }
    }

    // Validate consistency: ensure likesData count matches likeIpsData array length
    validateAndSyncLikesCounts();

    dataLoaded = true;
    console.log('Data files loaded into memory');
}

// Ensure likes counts are consistent with IP records
function validateAndSyncLikesCounts() {
    const correctedShards = new Set();

    // Sync from IP records to likes count
    for (const articleId of Object.keys(likeIpsData)) {
        const ipCount = likeIpsData[articleId].length;
        if (likesData[articleId] !== ipCount) {
            console.log(`Correcting likes count for ${articleId}: ${likesData[articleId] || 0} -> ${ipCount}`);
            likesData[articleId] = ipCount;
            const vol = getVolFromArticleId(articleId);
            if (vol) correctedShards.add(vol);
        }
    }

    // Remove likes entries that have no IP records
    for (const articleId of Object.keys(likesData)) {
        if (!likeIpsData[articleId] || likeIpsData[articleId].length === 0) {
            if (likesData[articleId] > 0) {
                console.log(`Removing orphan likes count for ${articleId}: ${likesData[articleId]}`);
                delete likesData[articleId];
                const vol = getVolFromArticleId(articleId);
                if (vol) correctedShards.add(vol);
            }
        }
    }

    // Mark corrected shards as dirty
    for (const vol of correctedShards) {
        dirtyShards.add(vol);
    }
}

// Periodic persistence (every 5 seconds if dirty)
let viewsDirty = false;
let dirtyShards = new Set(); // Set of volume IDs with dirty data

// Mark a shard as dirty when likes data changes
function markShardDirty(articleId) {
    const vol = getVolFromArticleId(articleId);
    if (vol) {
        dirtyShards.add(vol);
    }
}

async function persistData() {
    if (viewsDirty) {
        const viewsSnapshot = { ...viewsData };
        try {
            await writeQueue.scheduleWrite(VIEWS_FILE, viewsSnapshot);
            viewsDirty = JSON.stringify(viewsData) !== JSON.stringify(viewsSnapshot);
        } catch (error) {
            console.error('Failed to persist views:', error);
        }
    }

    // Persist dirty shards
    if (dirtyShards.size > 0) {
        const shardsToPersist = [...dirtyShards];
        dirtyShards.clear();

        for (const vol of shardsToPersist) {
            try {
                // Collect data for this shard
                const shardLikes = {};
                const shardLikeIps = {};

                for (const [articleId, count] of Object.entries(likesData)) {
                    if (getVolFromArticleId(articleId) === vol) {
                        shardLikes[articleId] = count;
                    }
                }

                for (const [articleId, ips] of Object.entries(likeIpsData)) {
                    if (getVolFromArticleId(articleId) === vol) {
                        shardLikeIps[articleId] = ips;
                    }
                }

                // Write shard files
                await writeQueue.scheduleWrite(getLikesShardPath(vol), shardLikes);
                await writeQueue.scheduleWrite(getLikeIpsShardPath(vol), shardLikeIps);
            } catch (error) {
                console.error(`Failed to persist shard vol-${vol}:`, error);
                // Re-add to dirty set to retry later
                dirtyShards.add(vol);
            }
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
    try {
        return contentUtils.parseYamlFrontmatter(content);
    } catch (e) {
        console.error('Failed to parse YAML:', e);
        return {};
    }
}

// Helper to get content directory based on draft mode
function getVolumesDir(isDraft) {
    return isDraft ? DRAFT_DIR : PUBLISHED_DIR;
}

// ==================== IP-BASED LIKE TRACKING ====================
// IP Utilities are now imported


// Check if an IP has already liked an article
function hasIPLiked(articleId, ip) {
    const likedIPs = likeIpsData[articleId] || [];
    return likedIPs.includes(ip);
}

// Record IP's like for an article
function recordIPLike(articleId, ip) {
    if (!likeIpsData[articleId]) {
        likeIpsData[articleId] = [];
    }
    if (!likeIpsData[articleId].includes(ip)) {
        likeIpsData[articleId].push(ip);
        markShardDirty(articleId);
        return true;
    }
    return false;
}

// Remove IP's like from an article
function removeIPLike(articleId, ip) {
    if (likeIpsData[articleId]) {
        const index = likeIpsData[articleId].indexOf(ip);
        if (index > -1) {
            likeIpsData[articleId].splice(index, 1);
            markShardDirty(articleId);
            return true;
        }
    }
    return false;
}

// Get all articles liked by an IP
function getIPLikedArticles(ip) {
    const likedArticles = [];
    for (const [articleId, ips] of Object.entries(likeIpsData)) {
        if (ips.includes(ip)) {
            likedArticles.push(articleId);
        }
    }
    return likedArticles;
}

// ==================== ADMIN UTILITIES ====================

async function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

async function writeJsonFile(filePath, data) {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
}

function hashAdminPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

function verifyAdminPassword(password, passwordHash) {
    const [scheme, salt, expectedHash] = String(passwordHash || '').split(':');
    if (scheme !== 'scrypt' || !salt || !expectedHash) return false;

    const actualHash = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    return expected.length === actualHash.length && crypto.timingSafeEqual(expected, actualHash);
}

function createAccessToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function hashAccessToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function verifyAccessToken(token, tokenHash) {
    const actual = Buffer.from(hashAccessToken(token), 'hex');
    const expected = Buffer.from(String(tokenHash || ''), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function ensureAdminDir() {
    await fsPromises.mkdir(ADMIN_DRAFTS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_REVIEWS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_REVISIONS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_SUBMISSIONS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_MANUSCRIPTS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_MANUSCRIPT_EDITS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_MANUSCRIPT_REVIEWS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_ISSUE_DRAFTS_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_UNPUBLISHED_DIR, { recursive: true });
    await fsPromises.mkdir(ADMIN_PUBLISHED_HISTORY_DIR, { recursive: true });

    if (!fs.existsSync(ADMIN_USERS_FILE)) {
        const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
        const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin';
        const role = ADMIN_ROLES.includes(process.env.ADMIN_BOOTSTRAP_ROLE)
            ? process.env.ADMIN_BOOTSTRAP_ROLE
            : 'chief_editor';
        const user = {
            username,
            displayName: process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME || 'Chief Editor',
            role,
            passwordHash: hashAdminPassword(password),
            createdAt: new Date().toISOString()
        };
        await writeJsonFile(ADMIN_USERS_FILE, { users: [user] });
        console.log(`Admin user initialized: ${username}`);
    }

    if (!fs.existsSync(ADMIN_AUDIT_LOG_FILE)) {
        await writeJsonFile(ADMIN_AUDIT_LOG_FILE, []);
    }
}

function legacyDraftStatusToManuscriptStatus(status) {
    const map = {
        approved: 'available',
        review_requested: 'available',
        changes_requested: 'available',
        editing: 'available',
        published: 'published',
        rejected: 'archived'
    };
    return map[status] || 'available';
}

async function migrateLegacyDraftsToManuscripts() {
    if (!fs.existsSync(ADMIN_DRAFTS_DIR)) return;
    const entries = await fsPromises.readdir(ADMIN_DRAFTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const legacyDir = getDraftDir(entry.name);
        const legacyMeta = await readJsonFile(path.join(legacyDir, 'meta.json'), null);
        if (!legacyMeta) continue;
        const manuscriptId = legacyMeta.migratedManuscriptId || legacyMeta.draftId || entry.name;
        const manuscriptDir = getManuscriptDir(manuscriptId);
        if (fs.existsSync(manuscriptDir)) continue;
        await fsPromises.mkdir(manuscriptDir, { recursive: true });
        const files = await collectFiles(legacyDir, { skip: relative => relative === 'meta.json' });
        for (const file of files) {
            const source = path.join(legacyDir, file.path);
            const target = assertInside(manuscriptDir, path.join(manuscriptDir, file.path));
            await fsPromises.mkdir(path.dirname(target), { recursive: true });
            await fsPromises.copyFile(source, target);
        }
        const now = new Date().toISOString();
        const manuscriptMeta = {
            manuscriptId,
            legacyDraftId: legacyMeta.draftId || entry.name,
            sourceSubmissionId: '',
            status: legacyDraftStatusToManuscriptStatus(legacyMeta.status),
            editStatus: 'idle',
            assignee: legacyMeta.assignee || '',
            reviewers: [],
            scheduledIssueDraftId: '',
            publishedArticleId: legacyMeta.publishedArticleId || '',
            createdBy: legacyMeta.createdBy || 'migration',
            updatedBy: legacyMeta.updatedBy || 'migration',
            createdAt: legacyMeta.createdAt || now,
            updatedAt: legacyMeta.updatedAt || now
        };
        await writeJsonFile(path.join(manuscriptDir, 'meta.json'), manuscriptMeta);
        const legacyReviewPath = path.join(ADMIN_REVIEWS_DIR, `${entry.name}.json`);
        const manuscriptReviewPath = path.join(ADMIN_MANUSCRIPT_REVIEWS_DIR, `${manuscriptId}.json`);
        if (fs.existsSync(legacyReviewPath) && !fs.existsSync(manuscriptReviewPath)) {
            const review = await readJsonFile(legacyReviewPath, { history: [] });
            await writeJsonFile(manuscriptReviewPath, { manuscriptId, history: review.history || [] });
        }
    }
}

function publicAdminUser(user) {
    if (!user) return null;
    return {
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role,
        disabled: user.disabled === true
    };
}

async function readAdminUsers() {
    const data = await readJsonFile(ADMIN_USERS_FILE, { users: [] });
    return Array.isArray(data.users) ? data.users : [];
}

async function writeAdminUsers(users) {
    await writeJsonFile(ADMIN_USERS_FILE, { users });
}

function normalizeAdminUserInput(input, existingUsername) {
    const username = sanitizeSlug(existingUsername || input.username, '');
    if (!username) {
        throw new Error('Username is required');
    }
    if (!ADMIN_ROLES.includes(input.role)) {
        throw new Error('Admin role is invalid');
    }
    return {
        username,
        displayName: input.displayName || username,
        role: input.role
    };
}

async function createOrUpdateAdminUser(userInput, existingUsername) {
    const users = await readAdminUsers();
    const user = normalizeAdminUserInput(userInput, existingUsername);
    const existingIndex = users.findIndex(item => item.username === user.username);

    if (existingUsername && existingIndex === -1) {
        return { error: 'Admin user not found' };
    }
    if (!existingUsername && existingIndex !== -1) {
        return { error: 'Admin user already exists' };
    }
    if (!existingUsername && !userInput.password) {
        throw new Error('Password is required');
    }

    if (existingIndex >= 0) {
        users[existingIndex] = {
            ...users[existingIndex],
            ...user,
            ...(userInput.password ? { passwordHash: hashAdminPassword(userInput.password) } : {}),
            ...(typeof userInput.disabled === 'boolean' ? { disabled: userInput.disabled } : {}),
            updatedAt: new Date().toISOString()
        };
    } else {
        users.push({
            ...user,
            passwordHash: hashAdminPassword(userInput.password),
            disabled: userInput.disabled === true,
            createdAt: new Date().toISOString()
        });
    }

    await writeAdminUsers(users);
    const savedUser = existingIndex >= 0 ? users[existingIndex] : users[users.length - 1];
    return { user: publicAdminUser(savedUser) };
}

async function disableAdminUser(username) {
    const users = await readAdminUsers();
    const index = users.findIndex(item => item.username === username);
    if (index === -1) {
        return { error: 'Admin user not found' };
    }
    users[index] = {
        ...users[index],
        disabled: true,
        updatedAt: new Date().toISOString()
    };
    await writeAdminUsers(users);
    return { user: publicAdminUser(users[index]) };
}

async function enableAdminUser(username) {
    const users = await readAdminUsers();
    const index = users.findIndex(item => item.username === username);
    if (index === -1) {
        return { error: 'Admin user not found' };
    }
    users[index] = {
        ...users[index],
        disabled: false,
        updatedAt: new Date().toISOString()
    };
    await writeAdminUsers(users);
    return { user: publicAdminUser(users[index]) };
}

function parseCookies(req) {
    const cookies = {};
    const rawCookie = req.headers.cookie || '';
    rawCookie.split(';').forEach(part => {
        const [name, ...valueParts] = part.trim().split('=');
        if (name) cookies[name] = decodeURIComponent(valueParts.join('=') || '');
    });
    return cookies;
}

function createAdminSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    ADMIN_SESSIONS.set(token, {
        user: publicAdminUser(user),
        createdAt: Date.now()
    });
    return token;
}

function setAdminSessionCookie(res, token) {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearAdminSessionCookie(res) {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getAdminSession(req) {
    const token = parseCookies(req)[ADMIN_COOKIE_NAME];
    if (!token) return null;
    const session = ADMIN_SESSIONS.get(token);
    return session ? { token, ...session } : null;
}

function adminPermissions(role) {
    return {
        canImportDraft: role === 'editor' || role === 'chief_editor',
        canEditDraft: role === 'editor' || role === 'chief_editor',
        canRequestReview: role === 'editor' || role === 'chief_editor',
        canReview: role === 'tech_reviewer' || role === 'chief_editor',
        canReviewIssueDraft: role === 'tech_reviewer' || role === 'chief_editor',
        canManageIssueDrafts: role === 'editor' || role === 'chief_editor',
        canPublish: role === 'chief_editor',
        canDeleteDraft: role === 'chief_editor',
        canListAuthors: role === 'editor' || role === 'chief_editor',
        canManageAuthors: role === 'editor' || role === 'chief_editor',
        canManageVolumes: role === 'chief_editor',
        canManageUsers: role === 'chief_editor',
        canRunLint: role === 'editor' || role === 'chief_editor' || role === 'tech_reviewer',
        canRejectDraft: role === 'editor' || role === 'chief_editor',
        canAssignDraft: role === 'editor' || role === 'chief_editor',
        canIssueStatusLink: role === 'editor' || role === 'chief_editor',
        canEditPublished: role === 'editor' || role === 'chief_editor',
        canUnpublish: role === 'editor' || role === 'chief_editor',
        canViewPublishedHistory: role === 'chief_editor',
        canRollbackPublished: role === 'chief_editor',
        canViewAuditLog: role === 'chief_editor'
    };
}

function requireAdmin(req, res, next) {
    const session = getAdminSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Admin login required' });
    }
    readAdminUsers()
        .then(users => {
            const user = users.find(item => item.username === session.user.username);
            if (!user || user.disabled === true) {
                ADMIN_SESSIONS.delete(session.token);
                clearAdminSessionCookie(res);
                return res.status(401).json({ error: 'Admin login required' });
            }
            req.adminSession = session;
            req.adminUser = publicAdminUser(user);
            next();
        })
        .catch(next);
}

function requireAdminPermission(permission) {
    return (req, res, next) => {
        const permissions = adminPermissions(req.adminUser?.role);
        if (!permissions[permission]) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
}

function sanitizeSlug(value, fallback = 'draft') {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || fallback;
}

function normalizeVolumeId(value) {
    const vol = String(value || '').trim();
    if (!/^\d{3,10}$/.test(vol)) return null;
    return vol;
}

function assertInside(baseDir, targetPath) {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new Error('Path escapes allowed directory');
    }
    return resolvedTarget;
}

function safeRelativePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') {
        throw new Error('File path is required');
    }
    const normalized = path.posix.normalize(rawPath.replace(/\\/g, '/').trim());
    if (
        normalized === '.' ||
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        normalized.startsWith('/') ||
        normalized.length > 200
    ) {
        throw new Error(`Invalid file path: ${rawPath}`);
    }
    if (normalized === 'meta.json') {
        throw new Error('meta.json is reserved');
    }
    return normalized;
}

function parseMarkdownDocument(raw) {
    try {
        return contentUtils.parseMarkdownDocument(raw);
    } catch (error) {
        const parseError = new Error(`Invalid YAML frontmatter: ${error.message}`);
        parseError.statusCode = 400;
        throw parseError;
    }
}

function stringifyMarkdownDocument(metadata, body) {
    return `---\n${yaml.dump(metadata || {}, { lineWidth: -1 })}---\n${body || ''}`;
}

function normalizeSubmitter(input = {}) {
    return {
        name: String(input.name || '').trim(),
        team: String(input.team || '').trim(),
        role: String(input.role || '').trim(),
        contact: String(input.contact || '').trim(),
        authorId: String(input.authorId || '').trim()
    };
}

function normalizeReviewVisibility(value, fallback = 'internal') {
    return REVIEW_VISIBILITIES.includes(value) ? value : fallback;
}

function normalizeManuscriptEditStatus(value) {
    return MANUSCRIPT_EDIT_STATUSES.includes(value) ? value : 'idle';
}

function normalizeManuscriptScope(value) {
    return MANUSCRIPT_LIST_SCOPES.includes(value) ? value : 'all';
}

function normalizePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

function deriveManuscriptLifecycle(meta = {}, issueDraftIds = []) {
    const status = String(meta.status || '');
    const scheduledIssueDraftId = String(meta.scheduledIssueDraftId || '');
    const referencedIssueDraftId = scheduledIssueDraftId || String(issueDraftIds[0] || '');
    const publishedArticleId = String(meta.publishedArticleId || '');
    const assetStatus = status === 'archived' ? 'archived' : 'active';
    const usageStatus = publishedArticleId || status === 'published'
        ? 'published'
        : (referencedIssueDraftId || status === 'scheduled' ? 'scheduled' : 'unassigned');
    const editStatus = normalizeManuscriptEditStatus(meta.editStatus);
    const isUnreferenced = assetStatus === 'active' && usageStatus === 'unassigned';
    const isArchiveRestorable = assetStatus === 'archived' && usageStatus === 'unassigned' && editStatus === 'idle';
    return {
        assetStatus,
        usageStatus,
        scheduledIssueDraftId: referencedIssueDraftId,
        issueDraftIds,
        publishedArticleId,
        editStatus,
        canJoinIssue: isUnreferenced,
        canDelete: isUnreferenced,
        canArchive: isUnreferenced && editStatus === 'idle',
        canRestore: isArchiveRestorable
    };
}

function canReviseSubmissionStatus(status) {
    return !['accepted', 'published'].includes(status);
}

function validateSubmitter(submitter, metadata) {
    const errors = [];
    const hasKnownAuthor = typeof metadata.author_id === 'string' && metadata.author_id.trim().length > 0;
    if (hasKnownAuthor) {
        return errors;
    }
    if (!submitter.name) {
        errors.push('submitter name is required');
    }
    return errors;
}

function normalizeIdentityValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/[\s._-]+/g, '');
}

function normalizeAuthorAliases(author) {
    if (Array.isArray(author.aliases)) {
        return author.aliases.filter(Boolean).map(String);
    }
    if (typeof author.aliases === 'string') {
        return author.aliases.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function scoreAuthorForQuery(author, rawQuery) {
    const query = normalizeIdentityValue(rawQuery);
    if (!query) return null;

    const identityFields = [
        ['姓名', author.name],
        ['作者 ID', author.id],
        ['拼音', author.pinyin],
        ['首字母', author.initials],
        ...normalizeAuthorAliases(author).map(alias => ['别名', alias])
    ];
    const contextFields = [
        ['团队', author.team],
        ['角色', author.role]
    ];

    let best = null;
    for (const [label, value] of identityFields) {
        const normalized = normalizeIdentityValue(value);
        if (!normalized) continue;
        let score = 0;
        if (normalized === query) score = 100;
        else if (normalized.startsWith(query)) score = 82;
        else if (normalized.includes(query)) score = 64;
        if (score > (best?.score || 0)) {
            best = { score, match: `${label}匹配` };
        }
    }

    for (const [label, value] of contextFields) {
        const normalized = normalizeIdentityValue(value);
        if (!normalized) continue;
        const score = normalized.includes(query) ? 36 : 0;
        if (score > (best?.score || 0)) {
            best = { score, match: `${label}匹配` };
        }
    }

    return best;
}

function searchSubmissionAuthors(authors, query, limit = 20) {
    if (!query) {
        return authors.slice(0, limit).map(author => ({ author, score: 0, match: '' }));
    }

    return authors
        .map(author => ({ author, ...scoreAuthorForQuery(author, query) }))
        .filter(result => Number.isFinite(result.score) && result.score > 0)
        .sort((a, b) => b.score - a.score || String(a.author.id).localeCompare(String(b.author.id)))
        .slice(0, limit);
}

function resolveSubmitterAuthorId(submitter, authors) {
    if (submitter.authorId) return submitter.authorId;
    const matches = searchSubmissionAuthors(authors, submitter.name, 3);
    const [first, second] = matches;
    if (first && first.score >= 95 && (!second || second.score < 95)) {
        return first.author.id;
    }
    return '';
}

function isPublicReviewEntry(entry) {
    return normalizeReviewVisibility(entry.visibility, 'internal') === 'public';
}

function publicSubmissionDetail(detail, token = '') {
    const reviewHistory = (detail.review?.history || []).filter(isPublicReviewEntry);
    return {
        submissionId: detail.meta.submissionId,
        status: detail.meta.status,
        revision: detail.meta.revision || 1,
        submittedAt: detail.meta.submittedAt,
        updatedAt: detail.meta.updatedAt,
        publishedArticleId: detail.meta.publishedArticleId || '',
        manuscriptId: detail.meta.manuscriptId || '',
        submitter: detail.meta.submitter || null,
        indexContent: detail.indexContent,
        files: detail.files.map(file => ({
            ...file,
            assetUrl: file.path === 'index.md'
                ? null
                : `/api/submissions/${encodeURIComponent(detail.meta.submissionId)}/assets/${file.path}?token=${encodeURIComponent(token)}`
        })),
        review: {
            history: reviewHistory.map(entry => ({
                action: entry.action,
                role: entry.role,
                comment: entry.comment || '',
                visibility: 'public',
                at: entry.at
            }))
        }
    };
}

function publicManuscriptEditDetail(detail, token = '') {
    const source = detail.pendingEdit || detail;
    const summary = summarizeManuscriptDetail({
        meta: detail.meta,
        indexContent: source.indexContent || detail.indexContent || ''
    });
    return {
        manuscriptId: detail.meta.manuscriptId,
        status: detail.meta.status,
        editStatus: normalizeManuscriptEditStatus(detail.meta.editStatus),
        title: summary.title || detail.meta.manuscriptId,
        description: summary.description || '',
        submittedAt: detail.meta.editSubmittedAt || '',
        updatedAt: detail.meta.updatedAt,
        pending: Boolean(detail.pendingEdit),
        indexContent: source.indexContent || '',
        files: (source.files || []).map(file => ({
            ...file,
            assetUrl: file.path === 'index.md'
                ? null
                : `/api/manuscript-edits/${encodeURIComponent(detail.meta.manuscriptId)}/assets/${file.path}?token=${encodeURIComponent(token)}`
        }))
    };
}

async function requireSubmissionDetail(submissionId, token) {
    const detail = await readSubmissionDetail(submissionId);
    if (!detail) {
        return { status: 404, body: { error: 'Submission not found' } };
    }
    if (!token || !verifyAccessToken(token, detail.meta.submitterTokenHash)) {
        return { status: 403, body: { error: 'Invalid submission token' } };
    }
    return { detail };
}

async function requireManuscriptEditDetail(manuscriptId, token) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) {
        return { status: 404, body: { error: 'Manuscript not found' } };
    }
    if (!token || !detail.meta.editTokenHash || !verifyAccessToken(token, detail.meta.editTokenHash)) {
        return { status: 403, body: { error: 'Invalid manuscript edit token' } };
    }
    return { detail };
}

function defaultRadarContent(vol) {
    const now = new Date();
    const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    return `---\nvol: "${vol}"\ndate: "${date}"\neditors: []\n---\n\n## Trending\n\n`;
}

function findPayloadIndexFile(files = []) {
    return files.find(file => {
        try {
            return safeRelativePath(file.path) === 'index.md';
        } catch {
            return false;
        }
    });
}

function payloadFileToString(file) {
    if (!file) return '';
    if (file.type === 'base64') {
        return Buffer.from(String(file.content || ''), 'base64').toString('utf8');
    }
    return String(file.content || '');
}

function isTextPayloadFile(filePath) {
    return /\.(md|txt|json|ya?ml|svg|css|js|html?)$/i.test(filePath);
}

async function readContentFilesAsPayload(rootDir) {
    const files = await collectFiles(rootDir, { skip: relative => relative === 'meta.json' });
    return Promise.all(files.map(async file => {
        const filePath = path.join(rootDir, file.path);
        if (isTextPayloadFile(file.path)) {
            return { path: file.path, type: 'text', content: await fsPromises.readFile(filePath, 'utf8') };
        }
        return { path: file.path, type: 'base64', content: (await fsPromises.readFile(filePath)).toString('base64') };
    }));
}

async function replaceManagedContent(rootDir, files) {
    await clearDraftContentFiles(rootDir);
    return writeDraftFiles(rootDir, files);
}

const ZIP_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let value = n;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[n] = value >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function buildZipArchive(rootDir, files) {
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;

    for (const file of files) {
        const relative = safeRelativePath(file.path);
        const name = Buffer.from(relative, 'utf8');
        const data = await fsPromises.readFile(assertInside(rootDir, path.join(rootDir, relative)));
        const checksum = crc32(data);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(name.length, 26);
        localHeader.writeUInt16LE(0, 28);
        chunks.push(localHeader, name, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(name.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralDirectory.push(centralHeader, name);
        offset += localHeader.length + name.length + data.length;
    }

    const centralSize = centralDirectory.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...chunks, ...centralDirectory, end]);
}

function extractFirstHeading(markdownBody) {
    const match = String(markdownBody || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
}

function buildSubmissionDraftId(document, submitter) {
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const baseSlug = sanitizeSlug(
        document.metadata.title || extractFirstHeading(document.body) || submitter.name || 'submission',
        'submission'
    );
    let draftId = `${timestamp}-${baseSlug}`;
    if (fs.existsSync(getSubmissionDir(draftId)) || fs.existsSync(getDraftDir(draftId))) {
        draftId = `${draftId}-${crypto.randomBytes(3).toString('hex')}`;
    }
    return draftId;
}

function validateRadarContent(vol, radarContent) {
    const document = parseMarkdownDocument(radarContent);
    if (document.metadata.vol !== vol) {
        throw new Error('radar vol must match target volume');
    }
    if (typeof document.metadata.date !== 'string' || document.metadata.date.length === 0) {
        throw new Error('radar date is required');
    }
    if (document.metadata.editors !== undefined && !Array.isArray(document.metadata.editors)) {
        throw new Error('radar editors must be an array');
    }
}

async function listAdminVolumes() {
    if (!fs.existsSync(PUBLISHED_DIR)) return [];
    const entries = await fsPromises.readdir(PUBLISHED_DIR, { withFileTypes: true });
    const volumes = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('vol-')) continue;
        const vol = entry.name.replace(/^vol-/, '');
        const radarPath = path.join(PUBLISHED_DIR, entry.name, 'radar.md');
        const radarContent = fs.existsSync(radarPath)
            ? await fsPromises.readFile(radarPath, 'utf8')
            : defaultRadarContent(vol);
        const contributionDir = path.join(PUBLISHED_DIR, entry.name, 'contributions');
        const contributions = fs.existsSync(contributionDir)
            ? (await fsPromises.readdir(contributionDir, { withFileTypes: true })).filter(item => item.isDirectory()).length
            : 0;
        volumes.push({ vol, radarContent, contributions });
    }
    return volumes.sort((a, b) => b.vol.localeCompare(a.vol));
}

async function createOrUpdateVolume(vol, radarContent, options = {}) {
    const normalizedVol = normalizeVolumeId(vol);
    if (!normalizedVol) {
        throw new Error('Invalid volume id');
    }

    const volumeDir = assertInside(PUBLISHED_DIR, path.join(PUBLISHED_DIR, `vol-${normalizedVol}`));
    if (options.create && fs.existsSync(volumeDir)) {
        return { status: 409, body: { error: 'Volume already exists' } };
    }
    if (!options.create && !fs.existsSync(volumeDir)) {
        return { status: 404, body: { error: 'Volume not found' } };
    }

    const content = radarContent || defaultRadarContent(normalizedVol);
    validateRadarContent(normalizedVol, content);
    await fsPromises.mkdir(path.join(volumeDir, 'contributions'), { recursive: true });
    await fsPromises.writeFile(path.join(volumeDir, 'radar.md'), content, 'utf8');
    await generateArchiveJson(false);
    cache.invalidatePattern('volumes');
    cache.invalidatePattern('search:');
    cache.invalidate('stats');
    notifyHotReload('admin-volume', volumeDir);
    return { status: options.create ? 201 : 200, body: { vol: normalizedVol, radarContent: content } };
}

function getDraftDir(draftId) {
    return assertInside(ADMIN_DRAFTS_DIR, path.join(ADMIN_DRAFTS_DIR, draftId));
}

function getSubmissionDir(submissionId) {
    return assertInside(ADMIN_SUBMISSIONS_DIR, path.join(ADMIN_SUBMISSIONS_DIR, submissionId));
}

function getManuscriptDir(manuscriptId) {
    return assertInside(ADMIN_MANUSCRIPTS_DIR, path.join(ADMIN_MANUSCRIPTS_DIR, manuscriptId));
}

function getManuscriptEditDir(manuscriptId) {
    return assertInside(ADMIN_MANUSCRIPT_EDITS_DIR, path.join(ADMIN_MANUSCRIPT_EDITS_DIR, manuscriptId));
}

function getIssueDraftDir(issueDraftId) {
    return assertInside(ADMIN_ISSUE_DRAFTS_DIR, path.join(ADMIN_ISSUE_DRAFTS_DIR, issueDraftId));
}

async function collectFiles(rootDir, options = {}) {
    const files = [];
    async function walk(dir) {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const filePath = path.join(dir, entry.name);
            const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
            if (options.skip && options.skip(relative, entry)) continue;
            if (entry.isDirectory()) {
                await walk(filePath);
            } else if (entry.isFile()) {
                const stat = await fsPromises.stat(filePath);
                files.push({ path: relative, size: stat.size });
            }
        }
    }
    await walk(rootDir);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

function getRevisionDir(draftId) {
    return assertInside(ADMIN_REVISIONS_DIR, path.join(ADMIN_REVISIONS_DIR, draftId));
}

async function saveSubmissionRevision(draftId, revision, indexContent) {
    if (!revision || Number(revision) < 1) return;
    const revisionDir = getRevisionDir(draftId);
    await fsPromises.mkdir(revisionDir, { recursive: true });
    await fsPromises.writeFile(path.join(revisionDir, `revision-${revision}.md`), String(indexContent || ''), 'utf8');
}

async function listSubmissionRevisions(draftId) {
    const revisionDir = getRevisionDir(draftId);
    if (!fs.existsSync(revisionDir)) return [];
    const entries = await fsPromises.readdir(revisionDir, { withFileTypes: true });
    const revisions = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = entry.name.match(/^revision-(\d+)\.md$/);
        if (!match) continue;
        const filePath = path.join(revisionDir, entry.name);
        const stat = await fsPromises.stat(filePath);
        revisions.push({
            revision: Number(match[1]),
            size: stat.size,
            updatedAt: stat.mtime.toISOString()
        });
    }
    return revisions.sort((a, b) => a.revision - b.revision);
}

function buildLineDiffSummary(previousContent, currentContent) {
    const previousLines = String(previousContent || '').split('\n');
    const currentLines = String(currentContent || '').split('\n');
    const previousSet = new Map();
    previousLines.forEach(line => previousSet.set(line, (previousSet.get(line) || 0) + 1));

    let added = 0;
    for (const line of currentLines) {
        const count = previousSet.get(line) || 0;
        if (count > 0) {
            previousSet.set(line, count - 1);
        } else {
            added += 1;
        }
    }
    const removed = Array.from(previousSet.values()).reduce((sum, count) => sum + count, 0);
    return { addedLines: added, removedLines: removed };
}

async function readRevisionSummary(draftId, revision) {
    if (!revision || revision <= 1) return null;
    const revisionDir = getRevisionDir(draftId);
    const previousPath = path.join(revisionDir, `revision-${revision - 1}.md`);
    const currentPath = path.join(revisionDir, `revision-${revision}.md`);
    if (!fs.existsSync(previousPath) || !fs.existsSync(currentPath)) return null;
    const [previousContent, currentContent] = await Promise.all([
        fsPromises.readFile(previousPath, 'utf8'),
        fsPromises.readFile(currentPath, 'utf8')
    ]);
    return {
        fromRevision: revision - 1,
        toRevision: revision,
        ...buildLineDiffSummary(previousContent, currentContent)
    };
}

async function readDraftDetail(draftId) {
    const draftDir = getDraftDir(draftId);
    const metaPath = path.join(draftDir, 'meta.json');
    const indexPath = path.join(draftDir, 'index.md');

    if (!fs.existsSync(metaPath)) {
        return null;
    }

    const meta = await readJsonFile(metaPath, null);
    const indexContent = fs.existsSync(indexPath)
        ? await fsPromises.readFile(indexPath, 'utf8')
        : '';
    const files = await collectFiles(draftDir, {
        skip: relative => relative === 'meta.json'
    });
    const review = await readJsonFile(path.join(ADMIN_REVIEWS_DIR, `${draftId}.json`), {
        draftId,
        history: []
    });

    const revisions = meta?.source === 'submission'
        ? await listSubmissionRevisions(draftId)
        : [];

    return {
        meta,
        lifecycle: detail?.lifecycle || deriveManuscriptLifecycle(meta),
        indexContent,
        files: files.map(file => ({
            ...file,
            assetUrl: file.path === 'index.md' ? null : `/api/admin/drafts/${encodeURIComponent(draftId)}/assets/${file.path}`
        })),
        review,
        revisions,
        revisionSummary: meta?.source === 'submission'
            ? await readRevisionSummary(draftId, Number(meta.revision || 1))
            : null
    };
}

function draftMatchesFilters(meta, filters = {}) {
    if (filters.source && meta.source !== filters.source) return false;
    if (filters.status && meta.status !== filters.status) return false;
    if (filters.submissionStatus && meta.submissionStatus !== filters.submissionStatus) return false;
    if (filters.assignee && String(meta.assignee || '') !== filters.assignee) return false;
    if (filters.q) {
        const haystack = [
            meta.draftId,
            meta.folderName,
            meta.targetVol,
            meta.source,
            meta.status,
            meta.submissionStatus,
            meta.assignee,
            meta.submitter?.name,
            meta.submitter?.team,
            meta.submitter?.contact
        ].join(' ').toLowerCase();
        if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    return true;
}

async function listAdminDrafts(filters = {}) {
    if (!fs.existsSync(ADMIN_DRAFTS_DIR)) return [];
    const entries = await fsPromises.readdir(ADMIN_DRAFTS_DIR, { withFileTypes: true });
    const drafts = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const detail = await readDraftDetail(entry.name);
        if (detail?.meta && draftMatchesFilters(detail.meta, filters)) drafts.push(detail.meta);
    }
    const sort = filters.sort || 'updatedAt';
    return drafts.sort((a, b) => {
        if (sort === 'submittedAt') {
            return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
        }
        if (sort === 'status') {
            return String(a.status || '').localeCompare(String(b.status || ''));
        }
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}

function submissionMatchesFilters(meta, filters = {}) {
    const hiddenFromQueue = meta.removedFromQueue === true || ['accepted', 'published'].includes(meta.status);
    if (!filters.status && hiddenFromQueue) return false;
    if (meta.removedFromQueue === true && !filters.includeRemoved) return false;
    if (filters.status && meta.status !== filters.status) return false;
    if (filters.assignee && String(meta.assignee || '') !== filters.assignee) return false;
    if (filters.q) {
        const haystack = [
            meta.submissionId,
            meta.status,
            meta.assignee,
            meta.submitter?.name,
            meta.submitter?.team,
            meta.submitter?.contact
        ].join(' ').toLowerCase();
        if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    return true;
}

function manuscriptMatchesScope(summary, scope = 'all') {
    const lifecycle = summary.lifecycle || deriveManuscriptLifecycle(summary);
    const editStatus = lifecycle.editStatus || normalizeManuscriptEditStatus(summary.editStatus);
    if (scope === 'candidate') {
        return lifecycle.assetStatus === 'active' && lifecycle.usageStatus === 'unassigned';
    }
    if (scope === 'editing') {
        return ['editing', 'pending_review'].includes(editStatus);
    }
    if (scope === 'scheduled') {
        return lifecycle.assetStatus === 'active' && lifecycle.usageStatus === 'scheduled';
    }
    if (scope === 'published') {
        return lifecycle.usageStatus === 'published';
    }
    if (scope === 'archived') {
        return lifecycle.assetStatus === 'archived';
    }
    return true;
}

function buildManuscriptCounts(summaries = []) {
    return {
        all: summaries.length,
        candidate: summaries.filter(item => manuscriptMatchesScope(item, 'candidate')).length,
        editing: summaries.filter(item => manuscriptMatchesScope(item, 'editing')).length,
        scheduled: summaries.filter(item => manuscriptMatchesScope(item, 'scheduled')).length,
        published: summaries.filter(item => manuscriptMatchesScope(item, 'published')).length,
        archived: summaries.filter(item => manuscriptMatchesScope(item, 'archived')).length,
        pendingReview: summaries.filter(item => (item.lifecycle?.editStatus || item.editStatus) === 'pending_review').length,
        publishedEditing: summaries.filter(item => {
            const lifecycle = item.lifecycle || deriveManuscriptLifecycle(item);
            return lifecycle.usageStatus === 'published' && ['editing', 'pending_review'].includes(lifecycle.editStatus);
        }).length
    };
}

function manuscriptMatchesFilters(meta, filters = {}) {
    if (filters.status && meta.status !== filters.status) return false;
    if (filters.assignee && String(meta.assignee || '') !== filters.assignee) return false;
    if (filters.q) {
        const haystack = [
            meta.manuscriptId,
            meta.status,
            meta.assignee,
            meta.sourceSubmissionId,
            meta.scheduledIssueDraftId,
            meta.publishedArticleId,
            meta.title,
            meta.description,
            Array.isArray(meta.authorIds) ? meta.authorIds.join(' ') : ''
        ].join(' ').toLowerCase();
        if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    if (filters.scope && !manuscriptMatchesScope(meta, normalizeManuscriptScope(filters.scope))) return false;
    return true;
}

function summarizeManuscriptDetail(detail) {
    const document = parseMarkdownDocument(detail?.indexContent || '');
    const authorIds = Array.isArray(document.metadata.author_ids)
        ? document.metadata.author_ids
        : (document.metadata.author_id ? [document.metadata.author_id] : []);
    const meta = detail?.meta || {};
    return {
        ...meta,
        editStatus: normalizeManuscriptEditStatus(meta.editStatus),
        lifecycle: detail?.lifecycle || deriveManuscriptLifecycle(meta),
        title: document.metadata.title || extractFirstHeading(document.body) || '',
        description: document.metadata.description || '',
        authorIds
    };
}

function issueDraftMatchesFilters(meta, filters = {}) {
    if (filters.status && meta.status !== filters.status) return false;
    if (filters.vol && meta.vol !== filters.vol) return false;
    if (filters.q) {
        const haystack = [
            meta.issueDraftId,
            meta.status,
            meta.vol,
            meta.title,
            meta.manuscripts?.map(item => item.manuscriptId).join(' ')
        ].join(' ').toLowerCase();
        if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    return true;
}

async function readSubmissionDetail(submissionId) {
    const submissionDir = getSubmissionDir(submissionId);
    const metaPath = path.join(submissionDir, 'meta.json');
    const indexPath = path.join(submissionDir, 'index.md');
    if (!fs.existsSync(metaPath)) return null;
    const meta = await readJsonFile(metaPath, null);
    const indexContent = fs.existsSync(indexPath) ? await fsPromises.readFile(indexPath, 'utf8') : '';
    const files = await collectFiles(submissionDir, {
        skip: relative => relative === 'meta.json' || relative.startsWith('revisions/')
    });
    const revisionsDir = path.join(submissionDir, 'revisions');
    const revisions = fs.existsSync(revisionsDir)
        ? (await collectFiles(revisionsDir)).filter(file => /^revision-\d+\.md$/.test(file.path))
        : [];
    return {
        meta,
        indexContent,
        files: files.map(file => ({
            ...file,
            assetUrl: file.path === 'index.md' ? null : `/api/admin/submissions/${encodeURIComponent(submissionId)}/assets/${file.path}`
        })),
        review: { history: Array.isArray(meta?.history) ? meta.history : [] },
        revisions
    };
}

async function listAdminSubmissions(filters = {}) {
    if (!fs.existsSync(ADMIN_SUBMISSIONS_DIR)) return [];
    const entries = await fsPromises.readdir(ADMIN_SUBMISSIONS_DIR, { withFileTypes: true });
    const submissions = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const detail = await readSubmissionDetail(entry.name);
        if (detail?.meta && submissionMatchesFilters(detail.meta, filters)) submissions.push(detail.meta);
    }
    return submissions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function updateSubmissionMeta(submissionId, patch, operator = { username: 'system' }) {
    const submissionDir = getSubmissionDir(submissionId);
    const metaPath = path.join(submissionDir, 'meta.json');
    const meta = await readJsonFile(metaPath, null);
    if (!meta) return null;
    const updated = {
        ...meta,
        ...patch,
        updatedAt: new Date().toISOString(),
        updatedBy: operator.username
    };
    await writeJsonFile(metaPath, updated);
    return updated;
}

async function appendSubmissionHistory(submissionId, entry) {
    const detail = await readSubmissionDetail(submissionId);
    if (!detail) return null;
    const history = Array.isArray(detail.meta.history) ? detail.meta.history : [];
    history.push({
        ...entry,
        visibility: normalizeReviewVisibility(entry.visibility, 'internal'),
        at: new Date().toISOString()
    });
    return updateSubmissionMeta(submissionId, { history }, { username: entry.actor || 'system' });
}

async function saveSubmissionRevisionV2(submissionId, revision, indexContent) {
    if (!revision || Number(revision) < 1) return;
    const revisionDir = assertInside(getSubmissionDir(submissionId), path.join(getSubmissionDir(submissionId), 'revisions'));
    await fsPromises.mkdir(revisionDir, { recursive: true });
    await fsPromises.writeFile(path.join(revisionDir, `revision-${revision}.md`), String(indexContent || ''), 'utf8');
}

async function readManuscriptEditPackage(manuscriptId) {
    const editDir = getManuscriptEditDir(manuscriptId);
    if (!fs.existsSync(editDir)) return null;
    const meta = await readJsonFile(path.join(editDir, 'meta.json'), null);
    const indexPath = path.join(editDir, 'index.md');
    const indexContent = fs.existsSync(indexPath) ? await fsPromises.readFile(indexPath, 'utf8') : '';
    const files = await collectFiles(editDir, { skip: relative => relative === 'meta.json' });
    return {
        meta: meta || { manuscriptId },
        indexContent,
        files: files.map(file => ({
            ...file,
            assetUrl: file.path === 'index.md' ? null : `/api/admin/manuscripts/${encodeURIComponent(manuscriptId)}/pending-edit/assets/${file.path}`
        }))
    };
}

async function readManuscriptDetail(manuscriptId) {
    const manuscriptDir = getManuscriptDir(manuscriptId);
    const metaPath = path.join(manuscriptDir, 'meta.json');
    const indexPath = path.join(manuscriptDir, 'index.md');
    if (!fs.existsSync(metaPath)) return null;
    const rawMeta = await readJsonFile(metaPath, null);
    const meta = {
        ...(rawMeta || {}),
        editStatus: normalizeManuscriptEditStatus(rawMeta?.editStatus)
    };
    const indexContent = fs.existsSync(indexPath) ? await fsPromises.readFile(indexPath, 'utf8') : '';
    const files = await collectFiles(manuscriptDir, {
        skip: relative => relative === 'meta.json'
    });
    const issueDraftIds = await findIssueDraftReferencesToManuscript(manuscriptId);
    const review = await readJsonFile(path.join(ADMIN_MANUSCRIPT_REVIEWS_DIR, `${manuscriptId}.json`), {
        manuscriptId,
        history: []
    });
    return {
        meta,
        lifecycle: deriveManuscriptLifecycle(meta, issueDraftIds),
        indexContent,
        files: files.map(file => ({
            ...file,
            assetUrl: file.path === 'index.md' ? null : `/api/admin/manuscripts/${encodeURIComponent(manuscriptId)}/assets/${file.path}`
        })),
        review,
        pendingEdit: await readManuscriptEditPackage(manuscriptId)
    };
}

async function listAdminManuscripts(filters = {}) {
    if (!fs.existsSync(ADMIN_MANUSCRIPTS_DIR)) return [];
    const entries = await fsPromises.readdir(ADMIN_MANUSCRIPTS_DIR, { withFileTypes: true });
    const manuscripts = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const detail = await readManuscriptDetail(entry.name);
        if (!detail?.meta) continue;
        const summary = summarizeManuscriptDetail(detail);
        if (manuscriptMatchesFilters(summary, filters)) manuscripts.push(summary);
    }
    return manuscripts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function listAdminManuscriptPage(filters = {}) {
    const scope = normalizeManuscriptScope(filters.scope);
    const page = normalizePositiveInteger(filters.page, 1);
    const pageSize = normalizePositiveInteger(filters.pageSize, DEFAULT_MANUSCRIPT_PAGE_SIZE, MAX_MANUSCRIPT_PAGE_SIZE);
    const baseFilters = {
        status: filters.status,
        assignee: filters.assignee,
        q: filters.q
    };
    const allMatching = await listAdminManuscripts(baseFilters);
    const counts = buildManuscriptCounts(allMatching);
    const scoped = allMatching.filter(item => manuscriptMatchesScope(item, scope));
    const total = scoped.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const start = (effectivePage - 1) * pageSize;
    return {
        manuscripts: scoped.slice(start, start + pageSize),
        pagination: {
            scope,
            page: effectivePage,
            pageSize,
            total,
            totalPages
        },
        counts
    };
}

async function updateManuscriptMeta(manuscriptId, patch, operator = { username: 'system' }) {
    const manuscriptDir = getManuscriptDir(manuscriptId);
    const metaPath = path.join(manuscriptDir, 'meta.json');
    const meta = await readJsonFile(metaPath, null);
    if (!meta) return null;
    const normalizedPatch = { ...patch };
    if (normalizedPatch.editStatus !== undefined) {
        normalizedPatch.editStatus = normalizeManuscriptEditStatus(normalizedPatch.editStatus);
    }
    const updated = {
        ...meta,
        ...normalizedPatch,
        updatedAt: new Date().toISOString(),
        updatedBy: operator.username
    };
    await writeJsonFile(metaPath, updated);
    return updated;
}

async function appendManuscriptReview(manuscriptId, entry) {
    const reviewPath = path.join(ADMIN_MANUSCRIPT_REVIEWS_DIR, `${manuscriptId}.json`);
    const review = await readJsonFile(reviewPath, { manuscriptId, history: [] });
    review.history = Array.isArray(review.history) ? review.history : [];
    review.history.push({
        ...entry,
        visibility: normalizeReviewVisibility(entry.visibility, 'internal'),
        at: new Date().toISOString()
    });
    await writeJsonFile(reviewPath, review);
    return review;
}

async function readIssueDraft(issueDraftId) {
    const issueDraftDir = getIssueDraftDir(issueDraftId);
    const metaPath = path.join(issueDraftDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const meta = await readJsonFile(metaPath, null);
    const review = await readJsonFile(path.join(issueDraftDir, 'issue-review.json'), {
        issueDraftId,
        history: []
    });
    return { meta, review };
}

async function listAdminIssueDrafts(filters = {}) {
    if (!fs.existsSync(ADMIN_ISSUE_DRAFTS_DIR)) return [];
    const entries = await fsPromises.readdir(ADMIN_ISSUE_DRAFTS_DIR, { withFileTypes: true });
    const issueDrafts = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const detail = await readIssueDraft(entry.name);
        if (detail?.meta && issueDraftMatchesFilters(detail.meta, filters)) issueDrafts.push(detail.meta);
    }
    return issueDrafts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function updateIssueDraftMeta(issueDraftId, patch, operator) {
    const issueDraftDir = getIssueDraftDir(issueDraftId);
    const metaPath = path.join(issueDraftDir, 'meta.json');
    const meta = await readJsonFile(metaPath, null);
    if (!meta) return null;
    const updated = {
        ...meta,
        ...patch,
        updatedAt: new Date().toISOString(),
        updatedBy: operator.username
    };
    await writeJsonFile(metaPath, updated);
    return updated;
}

async function appendIssueDraftReview(issueDraftId, entry) {
    const issueDraftDir = getIssueDraftDir(issueDraftId);
    const reviewPath = path.join(issueDraftDir, 'issue-review.json');
    const review = await readJsonFile(reviewPath, { issueDraftId, history: [] });
    review.history = Array.isArray(review.history) ? review.history : [];
    review.history.push({
        ...entry,
        visibility: normalizeReviewVisibility(entry.visibility, 'internal'),
        at: new Date().toISOString()
    });
    await writeJsonFile(reviewPath, review);
    return review;
}

function validateDraftMetadata(metadata, options = {}) {
    const errors = [];
    if (typeof metadata.title !== 'string' || metadata.title.trim().length === 0) {
        errors.push('title is required');
    }
    if (typeof metadata.description !== 'string' || metadata.description.trim().length === 0) {
        errors.push('description is required');
    }

    const hasAuthorId = typeof metadata.author_id === 'string' && metadata.author_id.trim().length > 0;
    const hasAuthorIds = Array.isArray(metadata.author_ids);
    const hasTemporaryAuthor = metadata.author && typeof metadata.author === 'object';
    const authorShapeCount = [hasAuthorId, hasAuthorIds, hasTemporaryAuthor].filter(Boolean).length;

    if (authorShapeCount !== 1) {
        errors.push('exactly one author shape is required');
    }

    if (hasAuthorIds && metadata.author_ids.length > 2) {
        errors.push('author_ids may contain at most 2 authors');
    }

    if (hasTemporaryAuthor && !options.allowTemporaryAuthor) {
        errors.push('temporary author must be normalized before publishing');
    }

    return errors;
}

async function readAuthorsArray() {
    return contentUtils.readAuthorsArray(SHARED_DIR);
}

async function writeAuthorsArray(authors) {
    const authorsPath = path.join(SHARED_DIR, 'authors.md');
    const content = `---\n${yaml.dump({ authors }, { lineWidth: -1 })}---\n`;
    await fsPromises.writeFile(authorsPath, content);
    cache.invalidate('authors');
    cache.invalidate('stats');
}

async function appendAuditLog(entry) {
    const auditLog = await readJsonFile(ADMIN_AUDIT_LOG_FILE, []);
    auditLog.push({
        ...entry,
        at: new Date().toISOString()
    });
    await writeJsonFile(ADMIN_AUDIT_LOG_FILE, auditLog);
}

async function writeDraftFiles(draftDir, files) {
    let hasIndex = false;

    for (const file of files) {
        const relative = safeRelativePath(file.path);
        const target = assertInside(draftDir, path.join(draftDir, relative));
        await fsPromises.mkdir(path.dirname(target), { recursive: true });

        if (relative === 'index.md') {
            hasIndex = true;
        }

        if (file.type === 'base64') {
            await fsPromises.writeFile(target, Buffer.from(String(file.content || ''), 'base64'));
        } else if (file.type === 'text') {
            await fsPromises.writeFile(target, String(file.content || ''), 'utf8');
        } else {
            throw new Error(`Unsupported file type for ${relative}`);
        }
    }

    return hasIndex;
}

async function deleteManagedFiles(rootDir, files = []) {
    if (!Array.isArray(files) || files.length === 0) return [];
    const deleted = [];
    for (const rawPath of files) {
        const relative = safeRelativePath(rawPath);
        if (relative === 'index.md') {
            throw new Error('index.md cannot be deleted');
        }
        const target = assertInside(rootDir, path.join(rootDir, relative));
        if (fs.existsSync(target)) {
            await fsPromises.rm(target, { force: true });
            deleted.push(relative);
        }
    }
    return deleted;
}

async function clearDraftContentFiles(draftDir) {
    const entries = await fsPromises.readdir(draftDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'meta.json') continue;
        if (entry.name === 'revisions') continue;
        await fsPromises.rm(path.join(draftDir, entry.name), { recursive: true, force: true });
    }
}

function normalizeAdminAuthorInput(input, existingId) {
    const id = sanitizeSlug(existingId || input.id || input.name, '');
    if (!id) {
        throw new Error('Author id is required');
    }
    if (!input.name || typeof input.name !== 'string') {
        throw new Error('Author name is required');
    }
    return {
        id,
        name: input.name,
        team: input.team || '',
        role: input.role || '',
        avatar: input.avatar || ''
    };
}

async function saveAuthorAvatar(author, avatarFile) {
    if (!avatarFile || !avatarFile.content) return author;

    const safeName = safeRelativePath(avatarFile.filename || `${author.id}.png`);
    const ext = path.extname(safeName).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) {
        throw new Error('Unsupported avatar file type');
    }

    const avatarDir = path.join(ASSETS_DIR, 'images', 'avatars');
    await fsPromises.mkdir(avatarDir, { recursive: true });
    const avatarPath = path.join(avatarDir, `${author.id}${ext}`);
    await fsPromises.writeFile(avatarPath, Buffer.from(String(avatarFile.content), 'base64'));
    return {
        ...author,
        avatar: `/contents/assets/images/avatars/${author.id}${ext}`
    };
}

async function createOrUpdateAuthor(authorInput, avatarFile, existingId) {
    const authors = await readAuthorsArray();
    let author = normalizeAdminAuthorInput(authorInput, existingId);
    const existingIndex = authors.findIndex(item => item.id === author.id);
    if (existingId && existingIndex === -1) {
        return { error: 'Author not found' };
    }
    if (!existingId && existingIndex !== -1) {
        return { error: 'Author already exists' };
    }
    if (existingIndex >= 0 && !authorInput.avatar && !avatarFile?.content) {
        author.avatar = authors[existingIndex].avatar || '';
    }

    author = await saveAuthorAvatar(author, avatarFile);

    if (existingIndex >= 0) {
        authors[existingIndex] = { ...authors[existingIndex], ...author };
    } else {
        authors.push(author);
    }

    await writeAuthorsArray(authors);
    return { author };
}

function collectAuthorIdsFromMetadata(metadata) {
    if (Array.isArray(metadata.author_ids)) return metadata.author_ids.filter(Boolean);
    if (metadata.author_id) return [metadata.author_id];
    return [];
}

function replaceAuthorReference(metadata, sourceId, targetId) {
    const updated = { ...metadata };
    let changed = false;
    if (updated.author_id === sourceId) {
        updated.author_id = targetId;
        changed = true;
    }
    if (Array.isArray(updated.author_ids)) {
        const nextIds = [];
        for (const authorId of updated.author_ids) {
            const nextId = authorId === sourceId ? targetId : authorId;
            if (!nextIds.includes(nextId)) nextIds.push(nextId);
            if (nextId !== authorId) changed = true;
        }
        updated.author_ids = nextIds;
    }
    return { metadata: updated, changed };
}

async function rewriteAuthorReferencesInRoot(rootDir, sourceId, targetId) {
    if (!fs.existsSync(rootDir)) return 0;
    const files = await collectFiles(rootDir);
    let changedCount = 0;
    for (const file of files) {
        if (file.path !== 'index.md' && !file.path.endsWith('/index.md')) continue;
        const indexPath = path.join(rootDir, file.path);
        const document = parseMarkdownDocument(await fsPromises.readFile(indexPath, 'utf8'));
        const replaced = replaceAuthorReference(document.metadata, sourceId, targetId);
        if (!replaced.changed) continue;
        await fsPromises.writeFile(indexPath, stringifyMarkdownDocument(replaced.metadata, document.body), 'utf8');
        changedCount += 1;
    }
    return changedCount;
}

async function countPublishedAuthorUsage() {
    const usage = {};
    if (!fs.existsSync(PUBLISHED_DIR)) return usage;
    const files = await collectFiles(PUBLISHED_DIR);
    for (const file of files) {
        if (file.path !== 'index.md' && !file.path.endsWith('/index.md')) continue;
        if (!file.path.includes('/contributions/')) continue;
        const document = parseMarkdownDocument(await fsPromises.readFile(path.join(PUBLISHED_DIR, file.path), 'utf8'));
        for (const authorId of collectAuthorIdsFromMetadata(document.metadata)) {
            usage[authorId] = (usage[authorId] || 0) + 1;
        }
    }
    return usage;
}

function enrichAuthorRecords(authors, usageCounts = {}) {
    const groups = new Map();
    for (const author of authors) {
        const key = `${String(author.name || '').trim().toLowerCase()}::${String(author.team || '').trim().toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(author.id);
    }
    return authors.map(author => {
        const key = `${String(author.name || '').trim().toLowerCase()}::${String(author.team || '').trim().toLowerCase()}`;
        return {
            ...author,
            usageCount: usageCounts[author.id] || 0,
            duplicateHints: (groups.get(key) || []).filter(id => id !== author.id)
        };
    });
}

async function mergeAuthors(sourceId, targetId, operator) {
    const source = sanitizeSlug(sourceId, '');
    const target = sanitizeSlug(targetId, '');
    if (!source || !target || source === target) {
        return { status: 400, body: { error: 'sourceId and targetId are required and must differ' } };
    }

    const authors = await readAuthorsArray();
    if (!authors.some(author => author.id === source) || !authors.some(author => author.id === target)) {
        return { status: 404, body: { error: 'Author not found' } };
    }

    const changedPublished = await rewriteAuthorReferencesInRoot(PUBLISHED_DIR, source, target);
    const changedDrafts = await rewriteAuthorReferencesInRoot(ADMIN_DRAFTS_DIR, source, target);
    const changedSubmissions = await rewriteAuthorReferencesInRoot(ADMIN_SUBMISSIONS_DIR, source, target);
    const changedManuscripts = await rewriteAuthorReferencesInRoot(ADMIN_MANUSCRIPTS_DIR, source, target);
    const changedUnpublished = await rewriteAuthorReferencesInRoot(ADMIN_UNPUBLISHED_DIR, source, target);
    await writeAuthorsArray(authors.filter(author => author.id !== source));

    const lintResult = await runContentLint();
    if (!lintResult.ok) {
        return {
            status: 400,
            body: { error: 'Content check failed after author merge', stdout: lintResult.stdout, stderr: lintResult.stderr }
        };
    }

    await appendAuditLog({
        action: 'merge_author',
        actor: operator.username,
        authorId: source,
        targetAuthorId: target,
        changedPublished,
        changedDrafts,
        changedSubmissions,
        changedManuscripts,
        changedUnpublished
    });
    cache.invalidate('authors');
    cache.invalidate('stats');
    cache.invalidatePattern('search:');
    return {
        status: 200,
        body: { sourceId: source, targetId: target, changedPublished, changedDrafts, changedSubmissions, changedManuscripts, changedUnpublished }
    };
}

async function resolveTemporaryAuthor(metadata, resolution) {
    if (!metadata.author) return metadata;
    if (!resolution || !resolution.mode) {
        throw new Error('Temporary author must be resolved before publishing');
    }

    const authors = await readAuthorsArray();
    let authorId;

    if (resolution.mode === 'existing') {
        authorId = resolution.authorId;
        if (!authors.some(author => author.id === authorId)) {
            throw new Error('Selected author does not exist');
        }
    } else if (resolution.mode === 'create') {
        const result = await createOrUpdateAuthor(resolution.author || metadata.author, resolution.avatarFile);
        if (result.error) throw new Error(result.error);
        authorId = result.author.id;
    } else {
        throw new Error('Unsupported author resolution mode');
    }

    const normalized = { ...metadata };
    delete normalized.author;
    normalized.author_id = authorId;
    return normalized;
}

async function validatePublishedAuthorReferences(metadata) {
    const authors = await readAuthorsArray();
    const authorIds = metadata.author_ids || (metadata.author_id ? [metadata.author_id] : []);
    if (!Array.isArray(authorIds) || authorIds.length === 0 || authorIds.length > 2) {
        throw new Error('Published content requires 1-2 official authors');
    }
    for (const authorId of authorIds) {
        if (!authors.some(author => author.id === authorId)) {
            throw new Error(`Unknown author: ${authorId}`);
        }
    }
}

function buildManuscriptId(document, fallback = 'manuscript') {
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const baseSlug = sanitizeSlug(document.metadata.title || extractFirstHeading(document.body) || fallback, 'manuscript');
    let manuscriptId = `${timestamp}-${baseSlug}`;
    if (fs.existsSync(getManuscriptDir(manuscriptId))) {
        manuscriptId = `${manuscriptId}-${crypto.randomBytes(3).toString('hex')}`;
    }
    return manuscriptId;
}

function buildIssueDraftId(vol, title = '') {
    const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const baseSlug = sanitizeSlug(title || `vol-${vol}`, 'issue-draft');
    let issueDraftId = `${timestamp}-${baseSlug}`;
    if (fs.existsSync(getIssueDraftDir(issueDraftId))) {
        issueDraftId = `${issueDraftId}-${crypto.randomBytes(3).toString('hex')}`;
    }
    return issueDraftId;
}

async function resolveManuscriptAuthorMetadata(metadata, resolution) {
    if (!metadata.author) {
        await validatePublishedAuthorReferences(metadata);
        return metadata;
    }
    return resolveTemporaryAuthor(metadata, resolution);
}

async function createManuscriptFromSubmission(submissionId, operator, authorResolution = {}) {
    const submission = await readSubmissionDetail(submissionId);
    if (!submission) {
        return { status: 404, body: { error: 'Submission not found' } };
    }
    if (!canReviseSubmissionStatus(submission.meta.status)) {
        return { status: 400, body: { error: 'Submission cannot be accepted from this status' } };
    }

    const submissionDir = getSubmissionDir(submissionId);
    const indexPath = path.join(submissionDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
        return { status: 400, body: { error: 'Submission is missing index.md' } };
    }

    const document = parseMarkdownDocument(await fsPromises.readFile(indexPath, 'utf8'));
    let metadata;
    try {
        metadata = await resolveManuscriptAuthorMetadata(document.metadata, authorResolution);
        const validationErrors = validateDraftMetadata(metadata, { allowTemporaryAuthor: false });
        if (validationErrors.length > 0) {
            return { status: 400, body: { error: 'Manuscript frontmatter is invalid', details: validationErrors } };
        }
        await validatePublishedAuthorReferences(metadata);
    } catch (error) {
        return { status: 400, body: { error: error.message } };
    }

    const manuscriptId = buildManuscriptId(document, submission.meta.submitter?.name || submissionId);
    const manuscriptDir = getManuscriptDir(manuscriptId);
    await fsPromises.mkdir(manuscriptDir, { recursive: true });
    const files = await collectFiles(submissionDir, {
        skip: relative => relative === 'meta.json' || relative.startsWith('revisions/')
    });
    for (const file of files) {
        const source = path.join(submissionDir, file.path);
        const target = assertInside(manuscriptDir, path.join(manuscriptDir, file.path));
        await fsPromises.mkdir(path.dirname(target), { recursive: true });
        if (file.path === 'index.md') {
            await fsPromises.writeFile(target, stringifyMarkdownDocument(metadata, document.body), 'utf8');
        } else {
            await fsPromises.copyFile(source, target);
        }
    }

    const now = new Date().toISOString();
    const meta = {
        manuscriptId,
        sourceSubmissionId: submissionId,
        status: 'available',
        editStatus: 'idle',
        assignee: '',
        reviewers: [],
        scheduledIssueDraftId: '',
        publishedArticleId: '',
        createdBy: operator.username,
        updatedBy: operator.username,
        createdAt: now,
        updatedAt: now
    };
    await writeJsonFile(path.join(manuscriptDir, 'meta.json'), meta);
    await writeJsonFile(path.join(ADMIN_MANUSCRIPT_REVIEWS_DIR, `${manuscriptId}.json`), { manuscriptId, history: [] });
    if (authorResolution?.mode === 'create' && metadata.author_id) {
        await appendAuditLog({
            action: 'create_author',
            actor: operator.username,
            authorId: metadata.author_id,
            source: 'accept_submission',
            submissionId
        });
    }
    await updateSubmissionMeta(submissionId, {
        status: 'accepted',
        manuscriptId
    }, operator);
    await appendSubmissionHistory(submissionId, {
        action: 'accepted',
        actor: operator.username,
        role: operator.role,
        comment: 'Accepted into manuscript pool',
        visibility: 'public'
    });
    await appendAuditLog({
        action: 'accept_submission',
        actor: operator.username,
        submissionId,
        manuscriptId
    });

    return { status: 201, body: await readManuscriptDetail(manuscriptId) };
}

async function removeSubmissionFromQueue(submissionId, operator) {
    const detail = await readSubmissionDetail(submissionId);
    if (!detail) return { status: 404, body: { error: 'Submission not found' } };
    if (!canReviseSubmissionStatus(detail.meta.status)) {
        return { status: 409, body: { error: 'Accepted or published submissions are already out of the review queue' } };
    }
    await updateSubmissionMeta(submissionId, {
        removedFromQueue: true,
        removedAt: new Date().toISOString(),
        removedBy: operator.username
    }, operator);
    await appendSubmissionHistory(submissionId, {
        action: 'remove_from_queue',
        actor: operator.username,
        role: operator.role,
        comment: '',
        visibility: 'internal'
    });
    await appendAuditLog({
        action: 'remove_submission_from_queue',
        actor: operator.username,
        submissionId
    });
    return { status: 200, body: await readSubmissionDetail(submissionId) };
}

async function updateManuscriptContent(manuscriptId, payload = {}, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    if (['scheduled', 'published'].includes(detail.meta.status)) {
        return { status: 400, body: { error: 'Scheduled or published manuscripts are locked' } };
    }
    const manuscriptDir = getManuscriptDir(manuscriptId);
    try {
        if (typeof payload.indexContent === 'string') {
            const { metadata } = parseMarkdownDocument(payload.indexContent);
            const validationErrors = validateDraftMetadata(metadata, { allowTemporaryAuthor: false });
            if (validationErrors.length > 0) {
                return { status: 400, body: { error: 'Manuscript frontmatter is invalid', details: validationErrors } };
            }
            await validatePublishedAuthorReferences(metadata);
            await fsPromises.writeFile(path.join(manuscriptDir, 'index.md'), payload.indexContent, 'utf8');
        }
        if (Array.isArray(payload.files) && payload.files.length > 0) {
            await writeDraftFiles(manuscriptDir, payload.files);
        }
        if (Array.isArray(payload.deleteFiles) && payload.deleteFiles.length > 0) {
            await deleteManagedFiles(manuscriptDir, payload.deleteFiles);
        }
        await updateManuscriptMeta(manuscriptId, {
            status: detail.meta.status,
            assignee: payload.assignee !== undefined ? sanitizeSlug(payload.assignee, '') : detail.meta.assignee
        }, operator);
        await appendAuditLog({
            action: 'update_manuscript',
            actor: operator.username,
            manuscriptId
        });
        return { status: 200, body: await readManuscriptDetail(manuscriptId) };
    } catch (error) {
        return { status: 400, body: { error: error.message } };
    }
}

async function reviewManuscript(manuscriptId, payload = {}, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    return { status: 410, body: { error: 'Single manuscript review is retired; review issue drafts instead' } };
}

async function validateManuscriptPackage(packageDir, label = 'Manuscript') {
    const indexPath = path.join(packageDir, 'index.md');
    if (!fs.existsSync(indexPath)) {
        return { error: 'index.md is required' };
    }
    const indexContent = await fsPromises.readFile(indexPath, 'utf8');
    const { metadata, body } = parseMarkdownDocument(indexContent);
    const validationErrors = validateDraftMetadata(metadata, { allowTemporaryAuthor: false });
    if (validationErrors.length > 0) {
        return { error: `${label} frontmatter is invalid`, details: validationErrors };
    }
    try {
        await validatePublishedAuthorReferences(metadata);
    } catch (error) {
        return { error: error.message };
    }
    const missingAssets = validateMarkdownAssetReferences(body, packageDir);
    if (missingAssets.length > 0) {
        return { error: `${label} references missing assets`, details: missingAssets };
    }
    return { indexContent, metadata, body };
}

async function createManuscriptEditLink(manuscriptId, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    if (detail.meta.status === 'archived') {
        return { status: 400, body: { error: 'Archived manuscripts cannot be edited' } };
    }
    const token = createAccessToken();
    const nextEditStatus = detail.meta.editStatus === 'pending_review' ? 'pending_review' : 'editing';
    await updateManuscriptMeta(manuscriptId, {
        editStatus: nextEditStatus,
        editTokenHash: hashAccessToken(token),
        editRequestedAt: new Date().toISOString(),
        editRequestedBy: operator.username
    }, operator);
    await appendAuditLog({
        action: 'issue_manuscript_edit_link',
        actor: operator.username,
        manuscriptId
    });
    return {
        status: 200,
        body: {
            manuscriptId,
            accessToken: token,
            editUrl: `/submit?manuscript=${encodeURIComponent(manuscriptId)}&token=${encodeURIComponent(token)}`,
            manuscript: await readManuscriptDetail(manuscriptId)
        }
    };
}

async function submitManuscriptEditPackage(manuscriptId, payload = {}, token = '') {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    const files = Array.isArray(payload.files) ? payload.files : [];
    const hasIndexContent = typeof payload.indexContent === 'string';
    if (!hasIndexContent && files.length === 0) {
        return { status: 400, body: { error: 'files or indexContent are required' } };
    }
    if (!hasIndexContent && !findPayloadIndexFile(files)) {
        return { status: 400, body: { error: 'index.md is required' } };
    }

    const tempDir = assertInside(
        ADMIN_MANUSCRIPT_EDITS_DIR,
        path.join(
            ADMIN_MANUSCRIPT_EDITS_DIR,
            `${sanitizeSlug(manuscriptId, 'manuscript')}.upload-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
        )
    );
    const editDir = getManuscriptEditDir(manuscriptId);
    try {
        await fsPromises.mkdir(tempDir, { recursive: true });
        if (hasIndexContent && !payload.replaceFiles) {
            const sourceDir = detail.pendingEdit ? editDir : getManuscriptDir(manuscriptId);
            const sourceFiles = await collectFiles(sourceDir, { skip: relative => relative === 'meta.json' });
            for (const file of sourceFiles) {
                const source = path.join(sourceDir, file.path);
                const target = assertInside(tempDir, path.join(tempDir, file.path));
                await fsPromises.mkdir(path.dirname(target), { recursive: true });
                await fsPromises.copyFile(source, target);
            }
            await fsPromises.writeFile(path.join(tempDir, 'index.md'), payload.indexContent, 'utf8');
            if (files.length > 0) {
                await writeDraftFiles(tempDir, files);
            }
        } else {
            await writeDraftFiles(tempDir, files);
        }
        const validation = await validateManuscriptPackage(tempDir, 'Manuscript edit');
        if (validation.error) {
            await fsPromises.rm(tempDir, { recursive: true, force: true });
            return { status: 400, body: validation };
        }
        await writeJsonFile(path.join(tempDir, 'meta.json'), {
            manuscriptId,
            submittedAt: new Date().toISOString()
        });
        await fsPromises.rm(editDir, { recursive: true, force: true });
        await fsPromises.rename(tempDir, editDir);
        await updateManuscriptMeta(manuscriptId, {
            editStatus: 'pending_review',
            editSubmittedAt: new Date().toISOString()
        }, { username: 'author-link' });
        await appendAuditLog({
            action: 'submit_manuscript_edit',
            actor: 'author-link',
            manuscriptId
        });
        return { status: 200, body: publicManuscriptEditDetail(await readManuscriptDetail(manuscriptId), token) };
    } catch (error) {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
        return { status: 400, body: { error: error.message } };
    }
}

async function markIssueDraftsForManuscriptEdit(manuscriptId, operator) {
    const issueDrafts = await listAdminIssueDrafts();
    const changed = [];
    for (const issue of issueDrafts) {
        if (!(issue.manuscripts || []).some(item => item.manuscriptId === manuscriptId)) continue;
        if (['issue_review_requested', 'approved'].includes(issue.status)) {
            await updateIssueDraftMeta(issue.issueDraftId, { status: 'editing' }, operator);
            await appendIssueDraftReview(issue.issueDraftId, {
                action: 'manuscript_edit_accepted',
                actor: operator.username,
                role: operator.role,
                comment: `Manuscript ${manuscriptId} was updated and needs confirmation`,
                visibility: 'internal'
            });
            changed.push(issue.issueDraftId);
        }
    }
    return changed;
}

async function acceptManuscriptEdit(manuscriptId, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    if (!detail.pendingEdit) {
        return { status: 400, body: { error: 'No pending manuscript edit' } };
    }
    const editDir = getManuscriptEditDir(manuscriptId);
    const validation = await validateManuscriptPackage(editDir, 'Manuscript edit');
    if (validation.error) {
        return { status: 400, body: validation };
    }
    const payloadFiles = await readContentFilesAsPayload(editDir);
    const manuscriptDir = getManuscriptDir(manuscriptId);
    const changedIssueDrafts = [];

    if (detail.meta.status === 'published') {
        const articleId = detail.meta.publishedArticleId;
        if (!articleId) {
            return { status: 409, body: { error: 'Published manuscript is missing article reference' } };
        }
        const publishedResult = await updatePublishedArticle(articleId, { files: payloadFiles, replaceFiles: true }, operator);
        if (publishedResult.status !== 200) return publishedResult;
    }

    await replaceManagedContent(manuscriptDir, payloadFiles);
    changedIssueDrafts.push(...await markIssueDraftsForManuscriptEdit(manuscriptId, operator));
    await fsPromises.rm(editDir, { recursive: true, force: true });
    await updateManuscriptMeta(manuscriptId, {
        editStatus: 'idle',
        editTokenHash: '',
        editRequestedAt: '',
        editRequestedBy: '',
        editSubmittedAt: ''
    }, operator);
    await appendManuscriptReview(manuscriptId, {
        action: 'accept_edit',
        actor: operator.username,
        role: operator.role,
        comment: changedIssueDrafts.length ? `Issue drafts need confirmation: ${changedIssueDrafts.join(', ')}` : '',
        visibility: 'internal'
    });
    await appendAuditLog({
        action: 'accept_manuscript_edit',
        actor: operator.username,
        manuscriptId,
        issueDraftIds: changedIssueDrafts
    });
    return { status: 200, body: await readManuscriptDetail(manuscriptId) };
}

async function discardManuscriptEdit(manuscriptId, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    await fsPromises.rm(getManuscriptEditDir(manuscriptId), { recursive: true, force: true });
    await updateManuscriptMeta(manuscriptId, {
        editStatus: 'idle',
        editTokenHash: '',
        editRequestedAt: '',
        editRequestedBy: '',
        editSubmittedAt: ''
    }, operator);
    await appendManuscriptReview(manuscriptId, {
        action: 'discard_edit',
        actor: operator.username,
        role: operator.role,
        comment: '',
        visibility: 'internal'
    });
    await appendAuditLog({
        action: 'discard_manuscript_edit',
        actor: operator.username,
        manuscriptId
    });
    return { status: 200, body: await readManuscriptDetail(manuscriptId) };
}

async function findIssueDraftReferencesToManuscript(manuscriptId) {
    const issueDrafts = await listAdminIssueDrafts();
    return issueDrafts
        .filter(issue => (issue.manuscripts || []).some(item => item.manuscriptId === manuscriptId))
        .map(issue => issue.issueDraftId);
}

async function deleteManuscript(manuscriptId, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    const issueDraftIds = await findIssueDraftReferencesToManuscript(manuscriptId);
    const publishedArticleId = detail.meta.publishedArticleId || '';
    if (issueDraftIds.length > 0 || publishedArticleId || ['scheduled', 'published'].includes(detail.meta.status)) {
        return {
            status: 409,
            body: {
                error: 'Manuscript is referenced and cannot be deleted',
                issueDraftIds,
                publishedArticleId
            }
        };
    }
    await fsPromises.rm(getManuscriptDir(manuscriptId), { recursive: true, force: true });
    await fsPromises.rm(path.join(ADMIN_MANUSCRIPT_REVIEWS_DIR, `${manuscriptId}.json`), { force: true });
    await fsPromises.rm(getManuscriptEditDir(manuscriptId), { recursive: true, force: true });
    await appendAuditLog({
        action: 'delete_manuscript',
        actor: operator.username,
        manuscriptId
    });
    return { status: 200, body: { manuscriptId, deleted: true } };
}

async function archiveManuscript(manuscriptId, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    const lifecycle = detail.lifecycle || deriveManuscriptLifecycle(detail.meta);
    if (!lifecycle.canArchive) {
        return {
            status: 409,
            body: {
                error: 'Only unreferenced manuscripts without pending edits can be archived',
                lifecycle
            }
        };
    }
    await updateManuscriptMeta(manuscriptId, {
        status: 'archived',
        archivedAt: new Date().toISOString(),
        archivedBy: operator.username,
        archivedFromStatus: detail.meta.status || 'available'
    }, operator);
    await appendAuditLog({
        action: 'archive_manuscript',
        actor: operator.username,
        manuscriptId
    });
    return { status: 200, body: await readManuscriptDetail(manuscriptId) };
}

async function restoreManuscript(manuscriptId, operator) {
    const detail = await readManuscriptDetail(manuscriptId);
    if (!detail) return { status: 404, body: { error: 'Manuscript not found' } };
    const lifecycle = detail.lifecycle || deriveManuscriptLifecycle(detail.meta);
    if (!lifecycle.canRestore) {
        return {
            status: 409,
            body: {
                error: 'Only unreferenced archived manuscripts without pending edits can be restored',
                lifecycle
            }
        };
    }
    await updateManuscriptMeta(manuscriptId, {
        status: 'available',
        scheduledIssueDraftId: '',
        publishedArticleId: '',
        archivedAt: '',
        archivedBy: '',
        archivedFromStatus: ''
    }, operator);
    await appendAuditLog({
        action: 'restore_manuscript',
        actor: operator.username,
        manuscriptId
    });
    return { status: 200, body: await readManuscriptDetail(manuscriptId) };
}

async function createIssueDraft(payload = {}, operator) {
    const vol = normalizeVolumeId(payload.vol);
    if (!vol) return { status: 400, body: { error: 'vol is required' } };
    const issueDraftId = buildIssueDraftId(vol, payload.title);
    const issueDraftDir = getIssueDraftDir(issueDraftId);
    await fsPromises.mkdir(issueDraftDir, { recursive: true });
    const now = new Date().toISOString();
    const meta = {
        issueDraftId,
        vol,
        title: payload.title || `Vol ${vol}`,
        radarContent: payload.radarContent || defaultRadarContent(vol),
        status: 'editing',
        manuscripts: [],
        reviewers: [],
        publishedAt: '',
        createdBy: operator.username,
        updatedBy: operator.username,
        createdAt: now,
        updatedAt: now
    };
    try {
        validateRadarContent(vol, meta.radarContent);
    } catch (error) {
        await fsPromises.rm(issueDraftDir, { recursive: true, force: true });
        return { status: 400, body: { error: error.message } };
    }
    await writeJsonFile(path.join(issueDraftDir, 'meta.json'), meta);
    await writeJsonFile(path.join(issueDraftDir, 'issue-review.json'), { issueDraftId, history: [] });
    await appendAuditLog({
        action: 'create_issue_draft',
        actor: operator.username,
        issueDraftId,
        vol
    });
    return { status: 201, body: await readIssueDraft(issueDraftId) };
}

async function updateIssueDraft(issueDraftId, payload = {}, operator) {
    const detail = await readIssueDraft(issueDraftId);
    if (!detail) return { status: 404, body: { error: 'Issue draft not found' } };
    if (detail.meta.status === 'published') {
        return { status: 400, body: { error: 'Published issue drafts cannot be edited' } };
    }
    const patch = {};
    if (payload.vol !== undefined) {
        const vol = normalizeVolumeId(payload.vol);
        if (!vol) return { status: 400, body: { error: 'Invalid volume id' } };
        patch.vol = vol;
    }
    if (payload.title !== undefined) patch.title = String(payload.title || '');
    if (payload.radarContent !== undefined) {
        try {
            validateRadarContent(patch.vol || detail.meta.vol, payload.radarContent);
        } catch (error) {
            return { status: 400, body: { error: error.message } };
        }
        patch.radarContent = payload.radarContent;
    }
    if (Array.isArray(payload.manuscripts)) {
        const existingIds = new Set((detail.meta.manuscripts || []).map(item => item.manuscriptId));
        const nextIds = new Set(payload.manuscripts.map(item => item.manuscriptId));
        for (const item of payload.manuscripts) {
            if (!existingIds.has(item.manuscriptId)) {
                return { status: 400, body: { error: 'Use add manuscript API before ordering new manuscripts' } };
            }
        }
        patch.manuscripts = payload.manuscripts.map((item, index) => ({
            manuscriptId: item.manuscriptId,
            folderName: sanitizeSlug(item.folderName, item.manuscriptId),
            order: Number.isInteger(item.order) ? item.order : index
        }));
        for (const item of detail.meta.manuscripts || []) {
            if (!nextIds.has(item.manuscriptId)) {
                await updateManuscriptMeta(item.manuscriptId, { status: 'available', scheduledIssueDraftId: '' }, operator);
            }
        }
    }
    if (['issue_review_requested', 'approved'].includes(detail.meta.status)) {
        patch.status = 'editing';
    }
    await updateIssueDraftMeta(issueDraftId, patch, operator);
    await appendAuditLog({
        action: 'update_issue_draft',
        actor: operator.username,
        issueDraftId
    });
    return { status: 200, body: await readIssueDraft(issueDraftId) };
}

async function addManuscriptToIssueDraft(issueDraftId, manuscriptId, payload = {}, operator) {
    if (!manuscriptId) {
        return { status: 400, body: { error: 'manuscriptId is required' } };
    }
    const issue = await readIssueDraft(issueDraftId);
    if (!issue) return { status: 404, body: { error: 'Issue draft not found' } };
    if (issue.meta.status === 'published') {
        return { status: 400, body: { error: 'Published issue drafts cannot be edited' } };
    }
    const manuscript = await readManuscriptDetail(manuscriptId);
    if (!manuscript) return { status: 404, body: { error: 'Manuscript not found' } };
    const lifecycle = deriveManuscriptLifecycle(manuscript.meta);
    if (lifecycle.assetStatus !== 'active') {
        return { status: 400, body: { error: 'Archived manuscripts cannot be added to an issue draft' } };
    }
    if (lifecycle.usageStatus === 'published') {
        return { status: 400, body: { error: 'Published manuscripts cannot be added to an issue draft' } };
    }
    const document = parseMarkdownDocument(manuscript.indexContent || '');
    const folderName = sanitizeSlug(payload.folderName || document.metadata.title || manuscriptId, manuscriptId);
    const current = issue.meta.manuscripts || [];
    if (current.some(item => item.manuscriptId === manuscriptId)) {
        return { status: 409, body: { error: 'Manuscript is already in this issue draft' } };
    }
    const issueDraftIds = await findIssueDraftReferencesToManuscript(manuscriptId);
    const otherIssueDraftIds = issueDraftIds.filter(id => id !== issueDraftId);
    if (otherIssueDraftIds.length > 0 || lifecycle.usageStatus === 'scheduled') {
        return { status: 400, body: { error: 'Manuscript is already scheduled in another issue draft', issueDraftIds: otherIssueDraftIds.length ? otherIssueDraftIds : issueDraftIds } };
    }
    if (current.some(item => item.folderName === folderName)) {
        return { status: 409, body: { error: 'Folder name is already used in this issue draft' } };
    }
    const manuscripts = [...current, { manuscriptId, folderName, order: current.length }];
    await updateIssueDraftMeta(issueDraftId, {
        manuscripts,
        status: ['issue_review_requested', 'approved'].includes(issue.meta.status) ? 'editing' : issue.meta.status
    }, operator);
    await updateManuscriptMeta(manuscriptId, { status: 'scheduled', scheduledIssueDraftId: issueDraftId }, operator);
    await appendAuditLog({
        action: 'schedule_manuscript',
        actor: operator.username,
        issueDraftId,
        manuscriptId
    });
    return { status: 200, body: await readIssueDraft(issueDraftId) };
}

async function removeManuscriptFromIssueDraft(issueDraftId, manuscriptId, operator) {
    const issue = await readIssueDraft(issueDraftId);
    if (!issue) return { status: 404, body: { error: 'Issue draft not found' } };
    if (issue.meta.status === 'published') {
        return { status: 400, body: { error: 'Published issue drafts cannot be edited' } };
    }
    const current = issue.meta.manuscripts || [];
    const manuscripts = current.filter(item => item.manuscriptId !== manuscriptId)
        .map((item, index) => ({ ...item, order: index }));
    if (manuscripts.length === current.length) {
        return { status: 404, body: { error: 'Manuscript is not in this issue draft' } };
    }
    await updateIssueDraftMeta(issueDraftId, {
        manuscripts,
        status: ['issue_review_requested', 'approved'].includes(issue.meta.status) ? 'editing' : issue.meta.status
    }, operator);
    const manuscript = await readManuscriptDetail(manuscriptId);
    if (manuscript && manuscript.meta.status === 'scheduled' && manuscript.meta.scheduledIssueDraftId === issueDraftId) {
        await updateManuscriptMeta(manuscriptId, { status: 'available', scheduledIssueDraftId: '' }, operator);
    }
    await appendAuditLog({
        action: 'unschedule_manuscript',
        actor: operator.username,
        issueDraftId,
        manuscriptId
    });
    return { status: 200, body: await readIssueDraft(issueDraftId) };
}

async function reviewIssueDraft(issueDraftId, payload = {}, operator) {
    const detail = await readIssueDraft(issueDraftId);
    if (!detail) return { status: 404, body: { error: 'Issue draft not found' } };
    if (!['request_review', 'approve', 'request_changes'].includes(payload.action)) {
        return { status: 400, body: { error: 'Unsupported review action' } };
    }
    if (payload.action === 'request_review') {
        if (!['editing', 'changes_requested'].includes(detail.meta.status)) {
            return { status: 400, body: { error: 'Issue draft cannot be submitted for review from this status' } };
        }
        if (!Array.isArray(detail.meta.manuscripts) || detail.meta.manuscripts.length === 0) {
            return { status: 400, body: { error: 'Issue draft must contain at least one manuscript' } };
        }
    } else if (detail.meta.status !== 'issue_review_requested') {
        return { status: 400, body: { error: 'Only issue_review_requested drafts can be reviewed' } };
    }
    const statusMap = {
        request_review: 'issue_review_requested',
        approve: 'approved',
        request_changes: 'changes_requested'
    };
    const reviewers = payload.action === 'approve'
        ? Array.from(new Set([...(detail.meta.reviewers || []), operator.username]))
        : (detail.meta.reviewers || []);
    await updateIssueDraftMeta(issueDraftId, { status: statusMap[payload.action], reviewers }, operator);
    await appendIssueDraftReview(issueDraftId, {
        action: payload.action,
        actor: operator.username,
        role: operator.role,
        comment: payload.comment || '',
        visibility: normalizeReviewVisibility(payload.visibility, 'internal')
    });
    await appendAuditLog({
        action: `issue_draft_${payload.action}`,
        actor: operator.username,
        issueDraftId
    });
    return { status: 200, body: await readIssueDraft(issueDraftId) };
}

async function buildIssueDraftPreview(issueDraftId) {
    const issue = await readIssueDraft(issueDraftId);
    if (!issue) return { status: 404, body: { error: 'Issue draft not found' } };
    const manuscripts = [];
    for (const item of [...(issue.meta.manuscripts || [])].sort((a, b) => (a.order || 0) - (b.order || 0))) {
        const manuscript = await readManuscriptDetail(item.manuscriptId);
        if (!manuscript) continue;
        const document = parseMarkdownDocument(manuscript.indexContent || '');
        manuscripts.push({
            ...item,
            metadata: document.metadata,
            indexContent: manuscript.indexContent,
            files: manuscript.files
        });
    }
    return { status: 200, body: { ...issue, manuscripts } };
}

function getIssueDraftPreviewVolume(issue) {
    const vol = normalizeVolumeId(issue.meta.vol);
    const radar = parseMarkdownDocument(issue.meta.radarContent || '');
    return {
        vol,
        date: radar.metadata.date || issue.meta.date || '',
        title: issue.meta.title || radar.metadata.title || '',
        views: 0,
        preview: true
    };
}

function findIssueDraftPreviewManuscript(preview, folderName) {
    return preview.manuscripts.find(item => sanitizeSlug(item.folderName, item.manuscriptId) === folderName);
}

function assertIssueDraftPreviewVolume(issue, vol) {
    const normalizedVol = normalizeVolumeId(vol);
    return normalizedVol && normalizedVol === normalizeVolumeId(issue.meta.vol);
}

async function publishIssueDraft(issueDraftId, operator) {
    const preview = await buildIssueDraftPreview(issueDraftId);
    if (preview.status !== 200) return preview;
    const issue = preview.body;
    if (issue.meta.status !== 'approved') {
        return { status: 400, body: { error: 'Only approved issue drafts can be published' } };
    }
    const vol = normalizeVolumeId(issue.meta.vol);
    if (!vol) return { status: 400, body: { error: 'Invalid issue draft volume' } };
    if (!issue.manuscripts.length) {
        return { status: 400, body: { error: 'Issue draft must contain at least one manuscript' } };
    }

    const volumeDir = assertInside(PUBLISHED_DIR, path.join(PUBLISHED_DIR, `vol-${vol}`));
    const contributionsDir = path.join(volumeDir, 'contributions');
    const targets = [];
    for (const item of issue.manuscripts) {
        const folderName = sanitizeSlug(item.folderName, item.manuscriptId);
        const targetDir = assertInside(contributionsDir, path.join(contributionsDir, folderName));
        if (fs.existsSync(targetDir)) {
            return { status: 409, body: { error: `Published target already exists: ${folderName}` } };
        }
        const manuscriptDir = getManuscriptDir(item.manuscriptId);
        if (!fs.existsSync(path.join(manuscriptDir, 'index.md'))) {
            return { status: 400, body: { error: `Manuscript is missing index.md: ${item.manuscriptId}` } };
        }
        const manuscript = await readManuscriptDetail(item.manuscriptId);
        if (!manuscript || manuscript.meta.status === 'archived') {
            return { status: 400, body: { error: `Manuscript is not scheduled for this issue draft: ${item.manuscriptId}` } };
        }
        if (manuscript.meta.scheduledIssueDraftId && manuscript.meta.scheduledIssueDraftId !== issueDraftId) {
            return { status: 400, body: { error: `Manuscript is scheduled for another issue draft: ${item.manuscriptId}` } };
        }
        if (manuscript.meta.publishedArticleId || manuscript.meta.status === 'published') {
            return { status: 400, body: { error: `Manuscript is already published: ${item.manuscriptId}` } };
        }
        const document = parseMarkdownDocument(await fsPromises.readFile(path.join(manuscriptDir, 'index.md'), 'utf8'));
        const validationErrors = validateDraftMetadata(document.metadata, { allowTemporaryAuthor: false });
        if (validationErrors.length > 0) {
            return { status: 400, body: { error: `Manuscript is not publishable: ${item.manuscriptId}`, details: validationErrors } };
        }
        try {
            await validatePublishedAuthorReferences(document.metadata);
        } catch (error) {
            return { status: 400, body: { error: error.message } };
        }
        const missingAssets = validateMarkdownAssetReferences(document.body, manuscriptDir);
        if (missingAssets.length > 0) {
            return { status: 400, body: { error: `Manuscript references missing assets: ${item.manuscriptId}`, details: missingAssets } };
        }
        targets.push({ item, manuscriptDir, targetDir });
    }

    const radarPath = path.join(volumeDir, 'radar.md');
    const radarBackup = fs.existsSync(radarPath)
        ? await fsPromises.readFile(radarPath, 'utf8')
        : null;
    const createdDirs = [];
    try {
        await fsPromises.mkdir(contributionsDir, { recursive: true });
        await fsPromises.writeFile(radarPath, issue.meta.radarContent || defaultRadarContent(vol), 'utf8');
        for (const target of targets) {
            await fsPromises.mkdir(target.targetDir, { recursive: true });
            createdDirs.push(target.targetDir);
            const files = await collectFiles(target.manuscriptDir, { skip: relative => relative === 'meta.json' });
            for (const file of files) {
                const source = path.join(target.manuscriptDir, file.path);
                const destination = assertInside(target.targetDir, path.join(target.targetDir, file.path));
                await fsPromises.mkdir(path.dirname(destination), { recursive: true });
                await fsPromises.copyFile(source, destination);
            }
        }
        await generateArchiveJson(false);
        const lintResult = await runContentLint();
        if (!lintResult.ok) {
            throw Object.assign(new Error('Content check failed'), { lintResult });
        }
    } catch (error) {
        for (const dir of createdDirs) {
            await fsPromises.rm(dir, { recursive: true, force: true });
        }
        if (radarBackup === null) {
            await fsPromises.rm(radarPath, { force: true });
        } else {
            await fsPromises.mkdir(path.dirname(radarPath), { recursive: true });
            await fsPromises.writeFile(radarPath, radarBackup, 'utf8');
        }
        await generateArchiveJson(false);
        if (error.lintResult) {
            return { status: 400, body: { error: 'Content check failed', stdout: error.lintResult.stdout, stderr: error.lintResult.stderr } };
        }
        return { status: 400, body: { error: error.message } };
    }

    const publishedArticles = [];
    for (const target of targets) {
        const articleId = `${vol}-${target.item.folderName}`;
        publishedArticles.push(articleId);
        await updateManuscriptMeta(target.item.manuscriptId, {
            status: 'published',
            publishedArticleId: articleId
        }, operator);
        const manuscript = await readManuscriptDetail(target.item.manuscriptId);
        if (manuscript?.meta?.sourceSubmissionId) {
            await updateSubmissionMeta(manuscript.meta.sourceSubmissionId, {
                status: 'published',
                publishedArticleId: articleId
            }, operator);
        }
    }
    await updateIssueDraftMeta(issueDraftId, {
        status: 'published',
        publishedAt: new Date().toISOString(),
        publishedArticles
    }, operator);
    await appendIssueDraftReview(issueDraftId, {
        action: 'published',
        actor: operator.username,
        role: operator.role,
        comment: `Published ${publishedArticles.join(', ')}`,
        visibility: 'internal'
    });
    await appendAuditLog({
        action: 'publish_issue_draft',
        actor: operator.username,
        issueDraftId,
        vol,
        articleIds: publishedArticles
    });
    cache.invalidatePattern('volumes');
    cache.invalidatePattern('contributions');
    cache.invalidatePattern('search:');
    cache.invalidate('stats');
    cache.invalidate('authors');
    notifyHotReload('admin-publish-issue-draft', volumeDir);
    return { status: 200, body: { issueDraftId, vol, articleIds: publishedArticles } };
}

function validateMarkdownAssetReferences(markdown, baseDir) {
    const missing = [];
    const imagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of String(markdown || '').matchAll(imagePattern)) {
        const rawRef = match[1].trim();
        if (!rawRef || rawRef.startsWith('#') || rawRef.startsWith('/') || rawRef.startsWith('//')) {
            continue;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(rawRef)) {
            continue;
        }
        const localRef = rawRef.replace(/^\.\//, '');
        const assetPath = path.resolve(baseDir, localRef);
        try {
            assertInside(baseDir, assetPath);
            if (!fs.existsSync(assetPath)) {
                missing.push(rawRef);
            }
        } catch {
            missing.push(rawRef);
        }
    }
    return missing;
}

function parseArticleId(articleId) {
    const match = String(articleId || '').match(/^(\d{3,10})-(.+)$/);
    if (!match) return null;
    const folderName = sanitizeSlug(match[2], '');
    if (!folderName || folderName !== match[2]) return null;
    return { vol: match[1], folderName };
}

function getPublishedArticleDir(articleId) {
    const parsed = parseArticleId(articleId);
    if (!parsed) return null;
    return assertInside(
        PUBLISHED_DIR,
        path.join(PUBLISHED_DIR, `vol-${parsed.vol}`, 'contributions', parsed.folderName)
    );
}

function getUnpublishedArticleDir(articleId) {
    const parsed = parseArticleId(articleId);
    if (!parsed) return null;
    return assertInside(ADMIN_UNPUBLISHED_DIR, path.join(ADMIN_UNPUBLISHED_DIR, `${parsed.vol}-${parsed.folderName}`));
}

async function listPublishedArticles() {
    if (!fs.existsSync(PUBLISHED_DIR)) return [];
    const articles = [];
    const volumeDirs = await fsPromises.readdir(PUBLISHED_DIR, { withFileTypes: true });
    for (const volumeDir of volumeDirs) {
        if (!volumeDir.isDirectory() || !volumeDir.name.startsWith('vol-')) continue;
        const vol = volumeDir.name.replace(/^vol-/, '');
        const contributionsDir = path.join(PUBLISHED_DIR, volumeDir.name, 'contributions');
        if (!fs.existsSync(contributionsDir)) continue;
        const entries = await fsPromises.readdir(contributionsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const articleId = `${vol}-${entry.name}`;
            const indexPath = path.join(contributionsDir, entry.name, 'index.md');
            let metadata = {};
            if (fs.existsSync(indexPath)) {
                metadata = parseMarkdownDocument(await fsPromises.readFile(indexPath, 'utf8')).metadata;
            }
            articles.push({
                articleId,
                vol,
                folderName: entry.name,
                title: metadata.title || entry.name,
                description: metadata.description || ''
            });
        }
    }
    return articles.sort((a, b) => b.articleId.localeCompare(a.articleId));
}

async function readPublishedArticle(articleId, unpublished = false) {
    const articleDir = unpublished ? getUnpublishedArticleDir(articleId) : getPublishedArticleDir(articleId);
    if (!articleDir || !fs.existsSync(articleDir)) return null;
    const indexPath = path.join(articleDir, 'index.md');
    const indexContent = fs.existsSync(indexPath) ? await fsPromises.readFile(indexPath, 'utf8') : '';
    const files = await collectFiles(articleDir);
    return {
        articleId,
        indexContent,
        files: files.map(file => ({
            ...file,
            assetUrl: unpublished
                ? null
                : `/contents/published/vol-${parseArticleId(articleId).vol}/contributions/${parseArticleId(articleId).folderName}/${file.path}`
        }))
    };
}

async function listUnpublishedArticles() {
    if (!fs.existsSync(ADMIN_UNPUBLISHED_DIR)) return [];
    const entries = await fsPromises.readdir(ADMIN_UNPUBLISHED_DIR, { withFileTypes: true });
    const articles = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const articleId = entry.name;
        const article = await readPublishedArticle(articleId, true);
        if (!article) continue;
        const { metadata } = parseMarkdownDocument(article.indexContent || '');
        articles.push({
            articleId,
            vol: parseArticleId(articleId)?.vol || '',
            folderName: parseArticleId(articleId)?.folderName || '',
            title: metadata.title || articleId,
            description: metadata.description || '',
            files: article.files.length
        });
    }
    return articles.sort((a, b) => b.articleId.localeCompare(a.articleId));
}

function issueManagementStatus(issueDrafts, publishedArticles, unpublishedArticles) {
    if (issueDrafts.some(issue => issue.status === 'approved')) return 'approved';
    if (issueDrafts.some(issue => issue.status === 'issue_review_requested')) return 'issue_review_requested';
    if (issueDrafts.some(issue => ['editing', 'changes_requested'].includes(issue.status))) return 'editing';
    if (publishedArticles.length > 0) return 'published';
    if (unpublishedArticles.length > 0) return 'archived';
    return 'empty';
}

async function listAdminIssues() {
    const [volumes, issueDrafts, publishedArticles, unpublishedArticles] = await Promise.all([
        listAdminVolumes(),
        listAdminIssueDrafts(),
        listPublishedArticles(),
        listUnpublishedArticles()
    ]);
    const byVol = new Map();

    function ensureIssue(vol) {
        const normalizedVol = normalizeVolumeId(vol);
        if (!normalizedVol) return null;
        if (!byVol.has(normalizedVol)) {
            byVol.set(normalizedVol, {
                vol: normalizedVol,
                title: `Vol ${normalizedVol}`,
                status: 'empty',
                radarContent: '',
                issueDrafts: [],
                publishedArticles: [],
                unpublishedArticles: [],
                counts: {
                    drafts: 0,
                    published: 0,
                    unpublished: 0
                }
            });
        }
        return byVol.get(normalizedVol);
    }

    for (const volume of volumes) {
        const issue = ensureIssue(volume.vol);
        if (!issue) continue;
        issue.radarContent = volume.radarContent || '';
        issue.counts.published = Number(volume.contributions || 0);
    }

    for (const draft of issueDrafts) {
        const issue = ensureIssue(draft.vol);
        if (!issue) continue;
        issue.issueDrafts.push(draft);
        issue.counts.drafts = issue.issueDrafts.length;
        issue.title = draft.title || issue.title;
    }

    for (const article of publishedArticles) {
        const issue = ensureIssue(article.vol);
        if (!issue) continue;
        issue.publishedArticles.push(article);
        issue.counts.published = issue.publishedArticles.length;
    }

    for (const article of unpublishedArticles) {
        const issue = ensureIssue(article.vol);
        if (!issue) continue;
        issue.unpublishedArticles.push(article);
        issue.counts.unpublished = issue.unpublishedArticles.length;
    }

    for (const issue of byVol.values()) {
        issue.issueDrafts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        issue.publishedArticles.sort((a, b) => String(a.folderName || '').localeCompare(String(b.folderName || '')));
        issue.unpublishedArticles.sort((a, b) => String(a.folderName || '').localeCompare(String(b.folderName || '')));
        issue.status = issueManagementStatus(issue.issueDrafts, issue.publishedArticles, issue.unpublishedArticles);
    }

    return [...byVol.values()].sort((a, b) => b.vol.localeCompare(a.vol));
}

function getPublishedHistoryRoot(articleId) {
    const parsed = parseArticleId(articleId);
    if (!parsed) return null;
    return assertInside(ADMIN_PUBLISHED_HISTORY_DIR, path.join(ADMIN_PUBLISHED_HISTORY_DIR, `${parsed.vol}-${parsed.folderName}`));
}

async function snapshotPublishedArticle(articleId, sourceDir, reason, operator) {
    const historyRoot = getPublishedHistoryRoot(articleId);
    if (!historyRoot || !sourceDir || !fs.existsSync(sourceDir)) return null;
    const snapshotId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${sanitizeSlug(reason, 'snapshot')}-${crypto.randomBytes(3).toString('hex')}`;
    const snapshotDir = assertInside(historyRoot, path.join(historyRoot, snapshotId));
    await fsPromises.mkdir(snapshotDir, { recursive: true });
    await fsPromises.cp(sourceDir, path.join(snapshotDir, 'content'), { recursive: true });
    await writeJsonFile(path.join(snapshotDir, 'meta.json'), {
        snapshotId,
        articleId,
        reason,
        actor: operator.username,
        at: new Date().toISOString()
    });
    return snapshotId;
}

async function listPublishedHistory(articleId) {
    const historyRoot = getPublishedHistoryRoot(articleId);
    if (!historyRoot || !fs.existsSync(historyRoot)) return [];
    const entries = await fsPromises.readdir(historyRoot, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await readJsonFile(path.join(historyRoot, entry.name, 'meta.json'), null);
        if (meta) snapshots.push(meta);
    }
    return snapshots.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

async function rollbackPublishedArticle(articleId, snapshotId, operator) {
    const articleDir = getPublishedArticleDir(articleId);
    const historyRoot = getPublishedHistoryRoot(articleId);
    if (!articleDir || !historyRoot || !fs.existsSync(articleDir)) {
        return { status: 404, body: { error: 'Published article not found' } };
    }
    const safeSnapshotId = safeRelativePath(snapshotId);
    const snapshotContentDir = assertInside(historyRoot, path.join(historyRoot, safeSnapshotId, 'content'));
    if (!fs.existsSync(snapshotContentDir)) {
        return { status: 400, body: { error: 'Published snapshot not found' } };
    }

    const rollbackBackup = `${articleDir}.rollback-${Date.now()}`;
    await fsPromises.cp(articleDir, rollbackBackup, { recursive: true });
    await snapshotPublishedArticle(articleId, articleDir, 'before-rollback', operator);
    try {
        await fsPromises.rm(articleDir, { recursive: true, force: true });
        await fsPromises.cp(snapshotContentDir, articleDir, { recursive: true });
        const lintResult = await runContentLint();
        if (!lintResult.ok) {
            await fsPromises.rm(articleDir, { recursive: true, force: true });
            await fsPromises.rename(rollbackBackup, articleDir);
            return { status: 400, body: { error: 'Content check failed', stdout: lintResult.stdout, stderr: lintResult.stderr } };
        }
        await fsPromises.rm(rollbackBackup, { recursive: true, force: true });
        cache.invalidatePattern('contributions');
        cache.invalidatePattern('search:');
        cache.invalidate('stats');
        notifyHotReload('admin-rollback-published', articleDir);
        await appendAuditLog({
            action: 'rollback_published',
            actor: operator.username,
            articleId,
            snapshotId: safeSnapshotId
        });
        return { status: 200, body: await readPublishedArticle(articleId) };
    } catch (error) {
        await fsPromises.rm(articleDir, { recursive: true, force: true });
        if (fs.existsSync(rollbackBackup)) {
            await fsPromises.rename(rollbackBackup, articleDir);
        }
        return { status: 400, body: { error: error.message } };
    }
}

async function updatePublishedArticle(articleId, payload, operator) {
    const articleDir = getPublishedArticleDir(articleId);
    if (!articleDir || !fs.existsSync(articleDir)) {
        return { status: 404, body: { error: 'Published article not found' } };
    }

    const backupDir = `${articleDir}.backup-${Date.now()}`;
    await fsPromises.cp(articleDir, backupDir, { recursive: true });
    await snapshotPublishedArticle(articleId, articleDir, 'before-edit', operator);

    try {
        if (payload.replaceFiles) {
            if (!Array.isArray(payload.files) || payload.files.length === 0) {
                await fsPromises.rm(backupDir, { recursive: true, force: true });
                return { status: 400, body: { error: 'files are required when replacing published content' } };
            }
            const indexPayload = findPayloadIndexFile(payload.files);
            if (!indexPayload) {
                await fsPromises.rm(backupDir, { recursive: true, force: true });
                return { status: 400, body: { error: 'index.md is required' } };
            }
            const { metadata } = parseMarkdownDocument(payloadFileToString(indexPayload));
            const validationErrors = validateDraftMetadata(metadata, { allowTemporaryAuthor: false });
            if (validationErrors.length > 0) {
                await fsPromises.rm(backupDir, { recursive: true, force: true });
                return { status: 400, body: { error: 'Published article frontmatter is invalid', details: validationErrors } };
            }
            await validatePublishedAuthorReferences(metadata);
            await clearDraftContentFiles(articleDir);
        }
        if (typeof payload.indexContent === 'string') {
            const { metadata, body } = parseMarkdownDocument(payload.indexContent);
            const validationErrors = validateDraftMetadata(metadata, { allowTemporaryAuthor: false });
            if (validationErrors.length > 0) {
                await fsPromises.rm(backupDir, { recursive: true, force: true });
                return { status: 400, body: { error: 'Published article frontmatter is invalid', details: validationErrors } };
            }
            await validatePublishedAuthorReferences(metadata);
            await fsPromises.writeFile(path.join(articleDir, 'index.md'), stringifyMarkdownDocument(metadata, body), 'utf8');
        }
        if (Array.isArray(payload.files) && payload.files.length > 0) {
            await writeDraftFiles(articleDir, payload.files);
        }
        if (Array.isArray(payload.deleteFiles) && payload.deleteFiles.length > 0) {
            await deleteManagedFiles(articleDir, payload.deleteFiles);
        }

        const lintResult = await runContentLint();
        if (!lintResult.ok) {
            await fsPromises.rm(articleDir, { recursive: true, force: true });
            await fsPromises.rename(backupDir, articleDir);
            return {
                status: 400,
                body: { error: 'Content check failed', stdout: lintResult.stdout, stderr: lintResult.stderr }
            };
        }

        await fsPromises.rm(backupDir, { recursive: true, force: true });
        cache.invalidatePattern('contributions');
        cache.invalidatePattern('search:');
        cache.invalidate('stats');
        notifyHotReload('admin-update-published', articleDir);
        await appendAuditLog({
            action: 'update_published',
            actor: operator.username,
            articleId
        });
        return { status: 200, body: await readPublishedArticle(articleId) };
    } catch (error) {
        await fsPromises.rm(articleDir, { recursive: true, force: true });
        await fsPromises.rename(backupDir, articleDir);
        return { status: 400, body: { error: error.message } };
    }
}

async function unpublishArticle(articleId, operator) {
    const articleDir = getPublishedArticleDir(articleId);
    const targetDir = getUnpublishedArticleDir(articleId);
    if (!articleDir || !targetDir || !fs.existsSync(articleDir)) {
        return { status: 404, body: { error: 'Published article not found' } };
    }
    if (fs.existsSync(targetDir)) {
        return { status: 409, body: { error: 'Unpublished archive already exists' } };
    }
    await snapshotPublishedArticle(articleId, articleDir, 'before-unpublish', operator);
    await fsPromises.mkdir(path.dirname(targetDir), { recursive: true });
    await fsPromises.rename(articleDir, targetDir);
    await generateArchiveJson(false);
    cache.invalidatePattern('contributions');
    cache.invalidatePattern('search:');
    cache.invalidate('stats');
    notifyHotReload('admin-unpublish', targetDir);
    await appendAuditLog({
        action: 'unpublish_article',
        actor: operator.username,
        articleId
    });
    return { status: 200, body: { articleId } };
}

async function restoreArticle(articleId, operator) {
    const sourceDir = getUnpublishedArticleDir(articleId);
    const targetDir = getPublishedArticleDir(articleId);
    if (!sourceDir || !targetDir || !fs.existsSync(sourceDir)) {
        return { status: 404, body: { error: 'Unpublished article not found' } };
    }
    if (fs.existsSync(targetDir)) {
        return { status: 409, body: { error: 'Published article already exists' } };
    }
    await fsPromises.mkdir(path.dirname(targetDir), { recursive: true });
    await fsPromises.rename(sourceDir, targetDir);
    await generateArchiveJson(false);
    const lintResult = await runContentLint();
    if (!lintResult.ok) {
        await fsPromises.rename(targetDir, sourceDir);
        await generateArchiveJson(false);
        return { status: 400, body: { error: 'Content check failed', stdout: lintResult.stdout, stderr: lintResult.stderr } };
    }
    cache.invalidatePattern('contributions');
    cache.invalidatePattern('search:');
    cache.invalidate('stats');
    notifyHotReload('admin-restore', targetDir);
    await appendAuditLog({
        action: 'restore_article',
        actor: operator.username,
        articleId
    });
    return { status: 200, body: { articleId } };
}

function parseLintOutput(stdout, stderr) {
    const lines = `${stdout || ''}\n${stderr || ''}`
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const issues = lines
        .filter(line => /^[-✗!]|\b(error|warning|invalid|missing|unknown|outside)\b/i.test(line))
        .map(line => ({
            severity: /\b(warning|unknown)\b/i.test(line) ? 'warning' : 'error',
            message: line
        }));
    return {
        issueCount: issues.length,
        issues
    };
}

function runContentLint() {
    return new Promise(resolve => {
        execFile(
            process.execPath,
            [path.join(__dirname, 'tests', 'content-contract-lint.js')],
            {
                cwd: __dirname,
                env: {
                    ...process.env,
                    SITE_CONTENTS_DIR: CONTENTS_DIR
                }
            },
            (error, stdout, stderr) => {
                const parsed = parseLintOutput(stdout, stderr);
                resolve({
                    ok: !error,
                    exitCode: error ? error.code || 1 : 0,
                    stdout,
                    stderr,
                    summary: {
                        issueCount: parsed.issueCount,
                        errorCount: parsed.issues.filter(issue => issue.severity === 'error').length,
                        warningCount: parsed.issues.filter(issue => issue.severity === 'warning').length
                    },
                    issues: parsed.issues
                });
            }
        );
    });
}

// ==================== MIDDLEWARE ====================

// JSON body parser with size limit
app.use(express.json({ limit: '20mb' }));

// Rate limiting middleware
function rateLimitMiddleware(type = 'read') {
    return (req, res, next) => {
        const ip = getClientIP(req, siteConfig.server?.trustProxy) || 'unknown';
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
app.use('/contents/data', (req, res) => {
    res.status(403).json({ error: 'Forbidden' });
});
app.use('/contents/admin', (req, res) => {
    res.status(403).json({ error: 'Forbidden' });
});
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
app.use('/assets', express.static(PUBLIC_ASSETS_DIR, {
    maxAge: '1h',
    etag: true,
    immutable: true
}));

// ==================== DRAFT MODE ROUTE ====================
// Serve index.html for /draft path (draft mode via URL path instead of ?draft=true)
// Must be defined BEFORE generic static middleware
function sendIndexHtml(res) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'index.html'));
}

app.get('/', (req, res) => {
    sendIndexHtml(res);
});

app.get('/index.html', (req, res) => {
    sendIndexHtml(res);
});

app.get('/draft', (req, res) => {
    sendIndexHtml(res);
});

function sendAdminHtml(res) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
}

app.get('/admin', (req, res) => {
    sendAdminHtml(res);
});

app.get('/admin/', (req, res) => {
    sendAdminHtml(res);
});

app.get('/admin/issue-drafts/:issueDraftId/preview-page', requireAdmin, asyncRoute(async (req, res) => {
    const issue = await readIssueDraft(req.params.issueDraftId);
    if (!issue) {
        return res.status(404).send('Issue draft not found');
    }
    sendIndexHtml(res);
}));

app.use('/admin', express.static(path.join(__dirname, 'admin'), {
    maxAge: 0,
    etag: true,
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
}));

function sendSubmitHtml(res) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'submit', 'index.html'));
}

app.get('/submit', (req, res) => {
    sendSubmitHtml(res);
});

app.get('/submit/', (req, res) => {
    sendSubmitHtml(res);
});

app.use('/submit', express.static(path.join(__dirname, 'submit'), {
    maxAge: 0,
    etag: true,
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
}));

// ==================== API ROUTES ====================

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

app.get('/api/submission-authors', rateLimitMiddleware('read'), asyncRoute(async (req, res) => {
    const query = String(req.query.q || '').trim();
    const authors = await readAuthorsArray();
    const results = searchSubmissionAuthors(authors, query, 20);

    res.json({
        authors: results.map(({ author, score, match }) => ({
            id: author.id,
            name: author.name,
            team: author.team || '',
            role: author.role || '',
            avatar: author.avatar || '',
            aliases: normalizeAuthorAliases(author),
            pinyin: author.pinyin || '',
            initials: author.initials || '',
            score,
            match
        }))
    });
}));

app.post('/api/submissions', rateLimitMiddleware('write'), asyncRoute(async (req, res) => {
    const { files } = req.body || {};
    const submitter = normalizeSubmitter(req.body?.submitter || {});

    if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'files are required' });
    }

    const indexPayload = findPayloadIndexFile(files);
    if (!indexPayload) {
        return res.status(400).json({ error: 'index.md is required' });
    }
    const document = parseMarkdownDocument(payloadFileToString(indexPayload));
    const submissionId = buildSubmissionDraftId(document, submitter);
    const submissionDir = getSubmissionDir(submissionId);
    if (fs.existsSync(submissionDir)) {
        return res.status(409).json({ error: 'Submission already exists' });
    }

    await fsPromises.mkdir(submissionDir, { recursive: true });
    const hasIndex = await writeDraftFiles(submissionDir, files);
    if (!hasIndex) {
        await fsPromises.rm(submissionDir, { recursive: true, force: true });
        return res.status(400).json({ error: 'index.md is required' });
    }

    const indexPath = path.join(submissionDir, 'index.md');
    const writtenDocument = parseMarkdownDocument(await fsPromises.readFile(indexPath, 'utf8'));
    const authors = await readAuthorsArray();
    const resolvedAuthorId = resolveSubmitterAuthorId(submitter, authors);
    if (resolvedAuthorId) {
        submitter.authorId = resolvedAuthorId;
    }
    if (!writtenDocument.metadata.author_id && !writtenDocument.metadata.author_ids && !writtenDocument.metadata.author) {
        if (submitter.authorId) {
            writtenDocument.metadata.author_id = submitter.authorId;
        } else {
            writtenDocument.metadata.author = {
                name: submitter.name,
                team: submitter.team,
                role: submitter.role,
                avatar: ''
            };
        }
        await fsPromises.writeFile(indexPath, stringifyMarkdownDocument(writtenDocument.metadata, writtenDocument.body), 'utf8');
    }

    const submitterErrors = validateSubmitter(submitter, writtenDocument.metadata);
    const validationErrors = validateDraftMetadata(writtenDocument.metadata, { allowTemporaryAuthor: true });
    if (submitterErrors.length > 0 || validationErrors.length > 0) {
        await fsPromises.rm(submissionDir, { recursive: true, force: true });
        return res.status(400).json({
            error: 'Submission frontmatter is invalid',
            details: [...submitterErrors, ...validationErrors]
        });
    }

    if (writtenDocument.metadata.author_id) {
        if (!authors.some(author => author.id === writtenDocument.metadata.author_id)) {
            await fsPromises.rm(submissionDir, { recursive: true, force: true });
            return res.status(400).json({ error: 'Selected author does not exist' });
        }
        submitter.authorId = writtenDocument.metadata.author_id;
    }
    if (writtenDocument.metadata.author_id || writtenDocument.metadata.author_ids) {
        try {
            await validatePublishedAuthorReferences(writtenDocument.metadata);
        } catch (error) {
            await fsPromises.rm(submissionDir, { recursive: true, force: true });
            return res.status(400).json({ error: error.message });
        }
    }

    const token = createAccessToken();
    const now = new Date().toISOString();
    const meta = {
        submissionId,
        status: 'submitted',
        submitter,
        submitterTokenHash: hashAccessToken(token),
        submittedAt: now,
        revision: 1,
        manuscriptId: '',
        publishedArticleId: '',
        lastSubmitterReadAt: '',
        history: [],
        createdBy: 'submitter',
        updatedBy: 'submitter',
        createdAt: now,
        updatedAt: now
    };
    await writeJsonFile(path.join(submissionDir, 'meta.json'), meta);
    await saveSubmissionRevisionV2(submissionId, 1, await fsPromises.readFile(indexPath, 'utf8'));
    await appendSubmissionHistory(submissionId, {
        action: 'create_submission',
        actor: 'submitter',
        role: 'submitter-token',
        comment: `Revision 1`,
        visibility: 'internal'
    });
    await appendAuditLog({
        action: 'create_submission',
        actor: 'submitter',
        submissionId,
        revision: 1
    });

    res.status(201).json({
        submissionId,
        accessToken: token,
        statusUrl: `/submit?id=${encodeURIComponent(submissionId)}&token=${encodeURIComponent(token)}`
    });
}));

app.get('/api/submissions/:submissionId/assets/*', rateLimitMiddleware('read'), asyncRoute(async (req, res) => {
    const result = await requireSubmissionDetail(req.params.submissionId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }

    const submissionDir = getSubmissionDir(req.params.submissionId);
    const assetRelative = safeRelativePath(req.params[0] || '');
    const assetPath = assertInside(submissionDir, path.join(submissionDir, assetRelative));
    if (assetRelative === 'meta.json' || !fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }

    res.sendFile(assetPath);
}));

app.get('/api/submissions/:submissionId', rateLimitMiddleware('read'), asyncRoute(async (req, res) => {
    const result = await requireSubmissionDetail(req.params.submissionId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }
    await updateSubmissionMeta(req.params.submissionId, {
        lastSubmitterReadAt: new Date().toISOString()
    }, { username: 'submitter' });
    res.json(publicSubmissionDetail(await readSubmissionDetail(req.params.submissionId), req.query.token));
}));

app.put('/api/submissions/:submissionId', rateLimitMiddleware('write'), asyncRoute(async (req, res) => {
    const result = await requireSubmissionDetail(req.params.submissionId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }
    const detail = result.detail;
    if (!canReviseSubmissionStatus(detail.meta.status)) {
        return res.status(400).json({ error: 'Submission cannot be revised from this status' });
    }

    const { files, indexContent: payloadIndexContent, deleteFiles, replaceFiles } = req.body || {};
    if (replaceFiles && (!Array.isArray(files) || files.length === 0)) {
        return res.status(400).json({ error: 'files are required when replacing a revision' });
    }
    if (replaceFiles && !findPayloadIndexFile(files)) {
        return res.status(400).json({ error: 'index.md is required' });
    }
    if (typeof payloadIndexContent !== 'string' && (!Array.isArray(files) || files.length === 0) && (!Array.isArray(deleteFiles) || deleteFiles.length === 0)) {
        return res.status(400).json({ error: 'indexContent, files or deleteFiles are required' });
    }
    const submissionDir = getSubmissionDir(req.params.submissionId);
    if (replaceFiles) {
        await clearDraftContentFiles(submissionDir);
    }
    if (Array.isArray(deleteFiles) && deleteFiles.length > 0) {
        try {
            await deleteManagedFiles(submissionDir, deleteFiles);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    }
    if (Array.isArray(files) && files.length > 0) {
        await writeDraftFiles(submissionDir, files);
    }
    if (typeof payloadIndexContent === 'string') {
        await fsPromises.writeFile(path.join(submissionDir, 'index.md'), payloadIndexContent, 'utf8');
    }
    if (!fs.existsSync(path.join(submissionDir, 'index.md'))) {
        return res.status(400).json({ error: 'index.md is required' });
    }

    const currentIndexContent = await fsPromises.readFile(path.join(submissionDir, 'index.md'), 'utf8');
    const { metadata } = parseMarkdownDocument(currentIndexContent);
    const validationErrors = validateDraftMetadata(metadata, { allowTemporaryAuthor: true });
    if (validationErrors.length > 0) {
        return res.status(400).json({ error: 'Submission frontmatter is invalid', details: validationErrors });
    }
    if (metadata.author_id || metadata.author_ids) {
        try {
            await validatePublishedAuthorReferences(metadata);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    }

    const revision = (detail.meta.revision || 1) + 1;
    await saveSubmissionRevisionV2(req.params.submissionId, revision, currentIndexContent);
    await updateSubmissionMeta(req.params.submissionId, {
        status: 'submitted',
        revision,
        removedFromQueue: false,
        removedAt: '',
        removedBy: '',
        updatedBy: 'submitter'
    }, { username: 'submitter' });
    await appendSubmissionHistory(req.params.submissionId, {
        action: 'submitter_revision',
        actor: 'submitter',
        role: 'submitter-token',
        comment: `Revision ${revision}`,
        visibility: 'internal'
    });
    await appendAuditLog({
        action: 'revise_submission',
        actor: 'submitter',
        submissionId: req.params.submissionId,
        revision
    });

    res.json(publicSubmissionDetail(await readSubmissionDetail(req.params.submissionId), req.query.token));
}));

app.get('/api/manuscript-edits/:manuscriptId/assets/*', rateLimitMiddleware('read'), asyncRoute(async (req, res) => {
    const result = await requireManuscriptEditDetail(req.params.manuscriptId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }

    const assetRelative = safeRelativePath(req.params[0] || '');
    if (assetRelative === 'index.md' || assetRelative === 'meta.json') {
        return res.status(404).json({ error: 'Asset not found' });
    }
    const editDir = getManuscriptEditDir(req.params.manuscriptId);
    const manuscriptDir = getManuscriptDir(req.params.manuscriptId);
    const editAssetPath = assertInside(editDir, path.join(editDir, assetRelative));
    const manuscriptAssetPath = assertInside(manuscriptDir, path.join(manuscriptDir, assetRelative));
    const assetPath = fs.existsSync(editAssetPath) ? editAssetPath : manuscriptAssetPath;
    if (!fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.sendFile(assetPath);
}));

app.get('/api/manuscript-edits/:manuscriptId', rateLimitMiddleware('read'), asyncRoute(async (req, res) => {
    const result = await requireManuscriptEditDetail(req.params.manuscriptId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }
    res.json(publicManuscriptEditDetail(result.detail, req.query.token));
}));

app.get('/api/manuscript-edits/:manuscriptId/source.zip', rateLimitMiddleware('read'), asyncRoute(async (req, res) => {
    const result = await requireManuscriptEditDetail(req.params.manuscriptId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }
    const rootDir = result.detail.pendingEdit
        ? getManuscriptEditDir(req.params.manuscriptId)
        : getManuscriptDir(req.params.manuscriptId);
    const files = await collectFiles(rootDir, { skip: relative => relative === 'meta.json' });
    const archive = await buildZipArchive(rootDir, files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeSlug(req.params.manuscriptId, 'manuscript')}-source.zip"`);
    res.send(archive);
}));

app.put('/api/manuscript-edits/:manuscriptId', rateLimitMiddleware('write'), asyncRoute(async (req, res) => {
    const result = await requireManuscriptEditDetail(req.params.manuscriptId, req.query.token);
    if (!result.detail) {
        return res.status(result.status).json(result.body);
    }
    const editResult = await submitManuscriptEditPackage(req.params.manuscriptId, req.body || {}, req.query.token);
    res.status(editResult.status).json(editResult.body);
}));

app.post('/api/admin/login', rateLimitMiddleware('write'), asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    const users = await readAdminUsers();
    const user = users.find(item => item.username === username);

    if (!user || user.disabled === true || !verifyAdminPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = createAdminSession(user);
    setAdminSessionCookie(res, token);
    res.json({
        user: publicAdminUser(user),
        permissions: adminPermissions(user.role)
    });
}));

app.post('/api/admin/logout', requireAdmin, (req, res) => {
    if (req.adminSession?.token) {
        ADMIN_SESSIONS.delete(req.adminSession.token);
    }
    clearAdminSessionCookie(res);
    res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({
        user: req.adminUser,
        permissions: adminPermissions(req.adminUser.role)
    });
});

app.get('/api/admin/submissions', requireAdmin, asyncRoute(async (req, res) => {
    res.json({
        submissions: await listAdminSubmissions({
            status: req.query.status,
            assignee: req.query.assignee,
            q: req.query.q
        })
    });
}));

app.get('/api/admin/submissions/:submissionId/assets/*', requireAdmin, asyncRoute(async (req, res) => {
    const submissionDir = getSubmissionDir(req.params.submissionId);
    const assetRelative = safeRelativePath(req.params[0] || '');
    const assetPath = assertInside(submissionDir, path.join(submissionDir, assetRelative));
    if (assetRelative === 'meta.json' || assetRelative.startsWith('revisions/') || !fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.sendFile(assetPath);
}));

app.get('/api/admin/submissions/:submissionId', requireAdmin, asyncRoute(async (req, res) => {
    const detail = await readSubmissionDetail(req.params.submissionId);
    if (!detail) return res.status(404).json({ error: 'Submission not found' });
    res.json(detail);
}));

app.post(
    '/api/admin/submissions/:submissionId/accept',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await createManuscriptFromSubmission(req.params.submissionId, req.adminUser, req.body?.authorResolution || {});
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/submissions/:submissionId/remove',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await removeSubmissionFromQueue(req.params.submissionId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/submissions/:submissionId/request-changes',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        res.status(410).json({ error: 'Submission return-for-revision is retired; copy the submission link instead' });
    })
);

app.post(
    '/api/admin/submissions/:submissionId/reject',
    requireAdmin,
    requireAdminPermission('canRejectDraft'),
    asyncRoute(async (req, res) => {
        res.status(410).json({ error: 'Submission rejection is retired; leave unaccepted submissions in the queue' });
    })
);

app.post(
    '/api/admin/submissions/:submissionId/status-link',
    requireAdmin,
    requireAdminPermission('canIssueStatusLink'),
    asyncRoute(async (req, res) => {
        const detail = await readSubmissionDetail(req.params.submissionId);
        if (!detail) return res.status(404).json({ error: 'Submission not found' });
        const token = createAccessToken();
        await updateSubmissionMeta(req.params.submissionId, {
            submitterTokenHash: hashAccessToken(token),
            lastStatusLinkIssuedAt: new Date().toISOString(),
            lastStatusLinkIssuedBy: req.adminUser.username
        }, req.adminUser);
        await appendAuditLog({
            action: 'issue_submission_status_link',
            actor: req.adminUser.username,
            submissionId: req.params.submissionId
        });
        res.json({
            submissionId: req.params.submissionId,
            accessToken: token,
            statusUrl: `/submit?id=${encodeURIComponent(req.params.submissionId)}&token=${encodeURIComponent(token)}`
        });
    })
);

app.get('/api/admin/manuscripts', requireAdmin, asyncRoute(async (req, res) => {
    res.json(await listAdminManuscriptPage({
        scope: req.query.scope,
        status: req.query.status,
        assignee: req.query.assignee,
        q: req.query.q,
        page: req.query.page,
        pageSize: req.query.pageSize
    }));
}));

app.get('/api/admin/manuscripts/:manuscriptId/assets/*', requireAdmin, asyncRoute(async (req, res) => {
    const manuscriptDir = getManuscriptDir(req.params.manuscriptId);
    const assetRelative = safeRelativePath(req.params[0] || '');
    const assetPath = assertInside(manuscriptDir, path.join(manuscriptDir, assetRelative));
    if (assetRelative === 'meta.json' || !fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.sendFile(assetPath);
}));

app.get('/api/admin/manuscripts/:manuscriptId/pending-edit/assets/*', requireAdmin, asyncRoute(async (req, res) => {
    const editDir = getManuscriptEditDir(req.params.manuscriptId);
    const assetRelative = safeRelativePath(req.params[0] || '');
    const assetPath = assertInside(editDir, path.join(editDir, assetRelative));
    if (assetRelative === 'index.md' || assetRelative === 'meta.json' || !fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.sendFile(assetPath);
}));

app.get('/api/admin/manuscripts/:manuscriptId', requireAdmin, asyncRoute(async (req, res) => {
    const detail = await readManuscriptDetail(req.params.manuscriptId);
    if (!detail) return res.status(404).json({ error: 'Manuscript not found' });
    res.json(detail);
}));

app.put(
    '/api/admin/manuscripts/:manuscriptId',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        res.status(410).json({ error: 'Direct manuscript editing is retired; use manuscript edit links instead' });
    })
);

app.post(
    '/api/admin/manuscripts/:manuscriptId/edit-link',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await createManuscriptEditLink(req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/manuscripts/:manuscriptId/pending-edit/accept',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await acceptManuscriptEdit(req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/manuscripts/:manuscriptId/pending-edit/discard',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await discardManuscriptEdit(req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/manuscripts/:manuscriptId/archive',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await archiveManuscript(req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/manuscripts/:manuscriptId/restore',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await restoreManuscript(req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/manuscripts/:manuscriptId/review',
    requireAdmin,
    asyncRoute(async (req, res) => {
        const result = await reviewManuscript(req.params.manuscriptId, req.body || {}, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.delete(
    '/api/admin/manuscripts/:manuscriptId',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    asyncRoute(async (req, res) => {
        const result = await deleteManuscript(req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get('/api/admin/issue-drafts', requireAdmin, asyncRoute(async (req, res) => {
    res.json({
        issueDrafts: await listAdminIssueDrafts({
            status: req.query.status,
            vol: req.query.vol,
            q: req.query.q
        })
    });
}));

app.post(
    '/api/admin/issue-drafts',
    requireAdmin,
    requireAdminPermission('canManageIssueDrafts'),
    asyncRoute(async (req, res) => {
        const result = await createIssueDraft(req.body || {}, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get('/api/admin/issue-drafts/:issueDraftId', requireAdmin, asyncRoute(async (req, res) => {
    const detail = await readIssueDraft(req.params.issueDraftId);
    if (!detail) return res.status(404).json({ error: 'Issue draft not found' });
    res.json(detail);
}));

app.put(
    '/api/admin/issue-drafts/:issueDraftId',
    requireAdmin,
    requireAdminPermission('canManageIssueDrafts'),
    asyncRoute(async (req, res) => {
        const result = await updateIssueDraft(req.params.issueDraftId, req.body || {}, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/issue-drafts/:issueDraftId/manuscripts',
    requireAdmin,
    requireAdminPermission('canManageIssueDrafts'),
    asyncRoute(async (req, res) => {
        const result = await addManuscriptToIssueDraft(
            req.params.issueDraftId,
            req.body?.manuscriptId,
            req.body || {},
            req.adminUser
        );
        res.status(result.status).json(result.body);
    })
);

app.delete(
    '/api/admin/issue-drafts/:issueDraftId/manuscripts/:manuscriptId',
    requireAdmin,
    requireAdminPermission('canManageIssueDrafts'),
    asyncRoute(async (req, res) => {
        const result = await removeManuscriptFromIssueDraft(req.params.issueDraftId, req.params.manuscriptId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/issue-drafts/:issueDraftId/review',
    requireAdmin,
    asyncRoute(async (req, res) => {
        const permissions = adminPermissions(req.adminUser.role);
        const action = req.body?.action;
        if (action === 'request_review' && !permissions.canManageIssueDrafts) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (action !== 'request_review' && !permissions.canReviewIssueDraft) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const result = await reviewIssueDraft(req.params.issueDraftId, req.body || {}, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get('/api/admin/issue-drafts/:issueDraftId/preview', requireAdmin, asyncRoute(async (req, res) => {
    const result = await buildIssueDraftPreview(req.params.issueDraftId);
    res.status(result.status).json(result.body);
}));

app.get('/api/admin/issue-drafts/:issueDraftId/preview-volume', requireAdmin, asyncRoute(async (req, res) => {
    const result = await buildIssueDraftPreview(req.params.issueDraftId);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.json([getIssueDraftPreviewVolume(result.body)]);
}));

app.get('/api/admin/issue-drafts/:issueDraftId/preview-contributions/:vol', requireAdmin, asyncRoute(async (req, res) => {
    const result = await buildIssueDraftPreview(req.params.issueDraftId);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    if (!assertIssueDraftPreviewVolume(result.body, req.params.vol)) {
        return res.status(404).json({ error: 'Issue draft volume not found' });
    }
    res.json(result.body.manuscripts.map(item => sanitizeSlug(item.folderName, item.manuscriptId)));
}));

app.get('/api/admin/issue-drafts/:issueDraftId/preview-content/vol-:vol/radar.md', requireAdmin, asyncRoute(async (req, res) => {
    const result = await buildIssueDraftPreview(req.params.issueDraftId);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    if (!assertIssueDraftPreviewVolume(result.body, req.params.vol)) {
        return res.status(404).send('Issue draft volume not found');
    }
    const volume = getIssueDraftPreviewVolume(result.body);
    const fallbackRadar = `---\nvol: "${volume.vol}"\ndate: "${volume.date}"\n---\n\n# ${volume.title || `Vol ${volume.vol}`}\n`;
    res.type('text/markdown').send(result.body.meta.radarContent || fallbackRadar);
}));

app.get('/api/admin/issue-drafts/:issueDraftId/preview-content/vol-:vol/contributions/:folder/index.md', requireAdmin, asyncRoute(async (req, res) => {
    const result = await buildIssueDraftPreview(req.params.issueDraftId);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    if (!assertIssueDraftPreviewVolume(result.body, req.params.vol)) {
        return res.status(404).send('Issue draft volume not found');
    }
    const manuscript = findIssueDraftPreviewManuscript(result.body, req.params.folder);
    if (!manuscript) return res.status(404).send('Manuscript not found in issue draft');
    res.type('text/markdown').send(manuscript.indexContent || '');
}));

app.get('/api/admin/issue-drafts/:issueDraftId/preview-content/vol-:vol/contributions/:folder/*', requireAdmin, asyncRoute(async (req, res) => {
    const result = await buildIssueDraftPreview(req.params.issueDraftId);
    if (result.status !== 200) return res.status(result.status).json(result.body);
    if (!assertIssueDraftPreviewVolume(result.body, req.params.vol)) {
        return res.status(404).json({ error: 'Issue draft volume not found' });
    }
    const manuscript = findIssueDraftPreviewManuscript(result.body, req.params.folder);
    if (!manuscript) return res.status(404).json({ error: 'Manuscript not found in issue draft' });

    const manuscriptDir = getManuscriptDir(manuscript.manuscriptId);
    const assetRelative = safeRelativePath(req.params[0] || '');
    const assetPath = assertInside(manuscriptDir, path.join(manuscriptDir, assetRelative));
    if (assetRelative === 'index.md' || assetRelative === 'meta.json' || !fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.sendFile(assetPath);
}));

app.post(
    '/api/admin/issue-drafts/:issueDraftId/publish',
    requireAdmin,
    requireAdminPermission('canPublish'),
    asyncRoute(async (req, res) => {
        const result = await publishIssueDraft(req.params.issueDraftId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get('/api/admin/drafts', requireAdmin, asyncRoute(async (req, res) => {
    res.json({
        drafts: await listAdminDrafts({
            source: req.query.source,
            status: req.query.status,
            submissionStatus: req.query.submissionStatus,
            assignee: req.query.assignee,
            q: req.query.q,
            sort: req.query.sort
        })
    });
}));

app.get('/api/admin/drafts/:draftId/assets/*', requireAdmin, asyncRoute(async (req, res) => {
    const draftDir = getDraftDir(req.params.draftId);
    const assetRelative = safeRelativePath(req.params[0] || '');
    const assetPath = assertInside(draftDir, path.join(draftDir, assetRelative));

    if (assetRelative === 'meta.json' || !fs.existsSync(assetPath)) {
        return res.status(404).json({ error: 'Asset not found' });
    }

    res.sendFile(assetPath);
}));

app.get('/api/admin/drafts/:draftId', requireAdmin, asyncRoute(async (req, res) => {
    const detail = await readDraftDetail(req.params.draftId);
    if (!detail) {
        return res.status(404).json({ error: 'Draft not found' });
    }
    res.json(detail);
}));

function retiredDraftMutation(req, res) {
    res.status(410).json({
        error: 'Legacy draft mutations are retired; use submissions, manuscripts and issue drafts instead'
    });
}

app.post(
    '/api/admin/drafts/import',
    requireAdmin,
    requireAdminPermission('canImportDraft'),
    retiredDraftMutation
);

app.put(
    '/api/admin/drafts/:draftId',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    retiredDraftMutation
);

app.delete(
    '/api/admin/drafts/:draftId',
    requireAdmin,
    requireAdminPermission('canDeleteDraft'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/accept',
    requireAdmin,
    requireAdminPermission('canEditDraft'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/assign',
    requireAdmin,
    requireAdminPermission('canAssignDraft'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/status-link',
    requireAdmin,
    requireAdminPermission('canIssueStatusLink'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/reject',
    requireAdmin,
    requireAdminPermission('canRejectDraft'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/review-request',
    requireAdmin,
    requireAdminPermission('canRequestReview'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/review',
    requireAdmin,
    requireAdminPermission('canReview'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/publish-check',
    requireAdmin,
    requireAdminPermission('canPublish'),
    retiredDraftMutation
);

app.post(
    '/api/admin/drafts/:draftId/publish',
    requireAdmin,
    requireAdminPermission('canPublish'),
    retiredDraftMutation
);

app.get(
    '/api/admin/authors',
    requireAdmin,
    requireAdminPermission('canListAuthors'),
    asyncRoute(async (req, res) => {
        res.json({ authors: enrichAuthorRecords(await readAuthorsArray(), await countPublishedAuthorUsage()) });
    })
);

app.post(
    '/api/admin/authors/merge',
    requireAdmin,
    requireAdminPermission('canManageAuthors'),
    asyncRoute(async (req, res) => {
        const result = await mergeAuthors(req.body?.sourceId, req.body?.targetId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/authors',
    requireAdmin,
    requireAdminPermission('canManageAuthors'),
    asyncRoute(async (req, res) => {
        try {
            const result = await createOrUpdateAuthor(req.body?.author || {}, req.body?.avatarFile);
            if (result.error) {
                return res.status(result.error.includes('exists') ? 409 : 400).json({ error: result.error });
            }
            await appendAuditLog({
                action: 'create_author',
                actor: req.adminUser.username,
                authorId: result.author.id
            });
            res.status(201).json({ author: result.author });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
);

app.put(
    '/api/admin/authors/:authorId',
    requireAdmin,
    requireAdminPermission('canManageAuthors'),
    asyncRoute(async (req, res) => {
        try {
            const result = await createOrUpdateAuthor(req.body?.author || {}, req.body?.avatarFile, req.params.authorId);
            if (result.error) {
                return res.status(404).json({ error: result.error });
            }
            await appendAuditLog({
                action: 'update_author',
                actor: req.adminUser.username,
                authorId: result.author.id
            });
            res.json({ author: result.author });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
);

app.post(
    '/api/admin/lint',
    requireAdmin,
    requireAdminPermission('canRunLint'),
    asyncRoute(async (req, res) => {
        res.json(await runContentLint());
    })
);

app.get(
    '/api/admin/audit-log',
    requireAdmin,
    requireAdminPermission('canViewAuditLog'),
    asyncRoute(async (req, res) => {
        const auditLog = await readJsonFile(ADMIN_AUDIT_LOG_FILE, []);
        res.json({ entries: auditLog.slice().reverse().slice(0, 500) });
    })
);

app.get(
    '/api/admin/issues',
    requireAdmin,
    asyncRoute(async (req, res) => {
        res.json({ issues: await listAdminIssues() });
    })
);

app.get(
    '/api/admin/published',
    requireAdmin,
    requireAdminPermission('canEditPublished'),
    asyncRoute(async (req, res) => {
        res.json({ articles: await listPublishedArticles() });
    })
);

app.get(
    '/api/admin/published/:articleId',
    requireAdmin,
    requireAdminPermission('canEditPublished'),
    asyncRoute(async (req, res) => {
        const article = await readPublishedArticle(req.params.articleId);
        if (!article) return res.status(404).json({ error: 'Published article not found' });
        res.json(article);
    })
);

app.put(
    '/api/admin/published/:articleId',
    requireAdmin,
    requireAdminPermission('canEditPublished'),
    asyncRoute(async (req, res) => {
        const result = await updatePublishedArticle(req.params.articleId, req.body || {}, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get(
    '/api/admin/published/:articleId/history',
    requireAdmin,
    requireAdminPermission('canViewPublishedHistory'),
    asyncRoute(async (req, res) => {
        res.json({ snapshots: await listPublishedHistory(req.params.articleId) });
    })
);

app.post(
    '/api/admin/published/:articleId/rollback',
    requireAdmin,
    requireAdminPermission('canRollbackPublished'),
    asyncRoute(async (req, res) => {
        const result = await rollbackPublishedArticle(req.params.articleId, req.body?.snapshotId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.post(
    '/api/admin/published/:articleId/unpublish',
    requireAdmin,
    requireAdminPermission('canUnpublish'),
    asyncRoute(async (req, res) => {
        const result = await unpublishArticle(req.params.articleId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get(
    '/api/admin/unpublished',
    requireAdmin,
    requireAdminPermission('canUnpublish'),
    asyncRoute(async (req, res) => {
        res.json({ articles: await listUnpublishedArticles() });
    })
);

app.post(
    '/api/admin/unpublished/:articleId/restore',
    requireAdmin,
    requireAdminPermission('canUnpublish'),
    asyncRoute(async (req, res) => {
        const result = await restoreArticle(req.params.articleId, req.adminUser);
        res.status(result.status).json(result.body);
    })
);

app.get(
    '/api/admin/users',
    requireAdmin,
    requireAdminPermission('canManageUsers'),
    asyncRoute(async (req, res) => {
        const users = await readAdminUsers();
        res.json({ users: users.map(publicAdminUser) });
    })
);

app.post(
    '/api/admin/users',
    requireAdmin,
    requireAdminPermission('canManageUsers'),
    asyncRoute(async (req, res) => {
        try {
            const result = await createOrUpdateAdminUser(req.body?.user || {});
            if (result.error) {
                return res.status(result.error.includes('exists') ? 409 : 400).json({ error: result.error });
            }
            await appendAuditLog({
                action: 'create_admin_user',
                actor: req.adminUser.username,
                username: result.user.username
            });
            res.status(201).json({ user: result.user });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
);

app.put(
    '/api/admin/users/:username',
    requireAdmin,
    requireAdminPermission('canManageUsers'),
    asyncRoute(async (req, res) => {
        try {
            const result = await createOrUpdateAdminUser(req.body?.user || {}, req.params.username);
            if (result.error) {
                return res.status(404).json({ error: result.error });
            }
            await appendAuditLog({
                action: 'update_admin_user',
                actor: req.adminUser.username,
                username: result.user.username
            });
            res.json({ user: result.user });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
);

app.post(
    '/api/admin/users/:username/disable',
    requireAdmin,
    requireAdminPermission('canManageUsers'),
    asyncRoute(async (req, res) => {
        const result = await disableAdminUser(req.params.username);
        if (result.error) {
            return res.status(404).json({ error: result.error });
        }
        await appendAuditLog({
            action: 'disable_admin_user',
            actor: req.adminUser.username,
            username: result.user.username
        });
        res.json({ user: result.user });
    })
);

app.post(
    '/api/admin/users/:username/enable',
    requireAdmin,
    requireAdminPermission('canManageUsers'),
    asyncRoute(async (req, res) => {
        const result = await enableAdminUser(req.params.username);
        if (result.error) {
            return res.status(404).json({ error: result.error });
        }
        await appendAuditLog({
            action: 'enable_admin_user',
            actor: req.adminUser.username,
            username: result.user.username
        });
        res.json({ user: result.user });
    })
);

app.get(
    '/api/admin/volumes',
    requireAdmin,
    requireAdminPermission('canManageVolumes'),
    asyncRoute(async (req, res) => {
        res.json({ volumes: await listAdminVolumes() });
    })
);

app.post(
    '/api/admin/volumes',
    requireAdmin,
    requireAdminPermission('canManageVolumes'),
    asyncRoute(async (req, res) => {
        try {
            const result = await createOrUpdateVolume(req.body?.vol, req.body?.radarContent, { create: true });
            if (result.status < 300) {
                await appendAuditLog({
                    action: 'create_volume',
                    actor: req.adminUser.username,
                    vol: result.body.vol
                });
            }
            res.status(result.status).json(result.body);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
);

app.put(
    '/api/admin/volumes/:vol/radar',
    requireAdmin,
    requireAdminPermission('canManageVolumes'),
    asyncRoute(async (req, res) => {
        try {
            const result = await createOrUpdateVolume(req.params.vol, req.body?.radarContent);
            if (result.status < 300) {
                await appendAuditLog({
                    action: 'update_volume_radar',
                    actor: req.adminUser.username,
                    vol: result.body.vol
                });
            }
            res.status(result.status).json(result.body);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    })
);

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
            config = await contentUtils.readFrontmatterFile(configPath, {});
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
        try {
            authors = await contentUtils.readAuthorsMap(SHARED_DIR);
            cache.set(cacheKey, authors, CONFIG.CACHE_TTL.authors);
        } catch (error) {
            console.error('Failed to read authors:', error);
            authors = {};
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
        try {
            authors = await contentUtils.readAuthorsMap(SHARED_DIR);
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
            volumes = await contentUtils.readVolumeSummaries(volumesDir, { isDraft, viewsData });
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
        contributions = await contentUtils.listCollectionFolders(getVolumesDir(isDraft), vol, 'contributions');
        cache.set(cacheKey, contributions, CONFIG.CACHE_TTL.contributions);
    }

    res.set('Cache-Control', 'public, max-age=30');
    res.json(contributions);
});

// GET /api/best-practices/:vol - Get list of best practices for a volume
app.get('/api/best-practices/:vol', rateLimitMiddleware('read'), async (req, res) => {
    const { vol } = req.params;
    const isDraft = req.query.draft === 'true';
    const cacheKey = `best-practices:${vol}:${isDraft}`;

    let bestPractices = cache.get(cacheKey);

    if (!bestPractices) {
        bestPractices = await contentUtils.listCollectionFolders(getVolumesDir(isDraft), vol, 'best-practices');
        cache.set(cacheKey, bestPractices, CONFIG.CACHE_TTL.contributions);
    }

    res.set('Cache-Control', 'public, max-age=30');
    res.json(bestPractices);
});

// GET /api/search - Search across all published volumes
// Query params: q (search query), limit (max results, default 20)
app.get('/api/search', rateLimitMiddleware('read'), async (req, res) => {
    const query = (req.query.q || '').trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!query || query.length < 2) {
        return res.json({ results: [], query: '' });
    }

    const cacheKey = `search:${query}:${limit}`;
    let cachedResults = cache.get(cacheKey);

    if (cachedResults) {
        res.set('Cache-Control', 'public, max-age=30');
        return res.json(cachedResults);
    }

    try {
        const response = await contentUtils.searchPublishedContent(PUBLISHED_DIR, query, limit);
        cache.set(cacheKey, response, 30000); // Cache for 30 seconds
        res.set('Cache-Control', 'public, max-age=30');
        res.json(response);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed', results: [] });
    }
});

// GET /api/likes - Get all likes
app.get('/api/likes', rateLimitMiddleware('read'), (req, res) => {
    res.set('Cache-Control', 'private, max-age=5');
    res.json(likesData);
});

// GET /api/user-likes - Get current user's liked articles (IP-based)
app.get('/api/user-likes', rateLimitMiddleware('read'), (req, res) => {
    const ip = getClientIP(req, siteConfig.server?.trustProxy);

    if (!ip) {
        // Can't identify user, return empty list
        res.set('Cache-Control', 'private, no-cache');
        return res.json({ likedArticles: [] });
    }

    const likedArticles = getIPLikedArticles(ip);
    res.set('Cache-Control', 'private, no-cache');
    res.json({ likedArticles });
});

// Helper to validate article existence
async function validateArticleExists(articleId, options = {}) {
    // articleId format: "vol-folderName" e.g., "001-05-architecture-diagram"
    const match = articleId.match(/^(\d+)-(.+)$/);
    if (!match) return false;

    const [, vol, folderName] = match;
    const baseDir = options.isDraft ? DRAFT_DIR : PUBLISHED_DIR;
    const articlePath = path.join(baseDir, `vol-${vol}`, 'contributions', folderName, 'index.md');

    try {
        await fsPromises.access(articlePath);
        return true;
    } catch {
        return false;
    }
}

// POST /api/likes/:articleId - Toggle like for an article (IP-based, one like per IP)
// Each IP can like/unlike an article, but only counts as one like at a time
// Draft mode: ?draft=true will not record any data
app.post('/api/likes/:articleId', rateLimitMiddleware('write'), async (req, res) => {
    const { articleId } = req.params;
    const isDraft = req.query.draft === 'true';

    // Draft mode: return fake response without recording
    if (isDraft) {
        return res.json({
            articleId,
            likes: 0,
            userLiked: false,
            draft: true
        });
    }

    // Get client IP
    const ip = getClientIP(req, siteConfig.server?.trustProxy);

    // Validate IP - must have a valid IP to like
    if (!ip) {
        return res.status(400).json({
            error: 'Unable to identify client',
            message: 'A valid IP address is required to like an article'
        });
    }

    // Validate article ID format and length
    if (!articleId || articleId.length > 100) {
        return res.status(400).json({ error: 'Invalid article ID' });
    }

    // Validate article ID format more strictly (vol-folder format)
    if (!/^\d{3}-[\w-]+$/.test(articleId)) {
        return res.status(400).json({ error: 'Invalid article ID format' });
    }

    // Validate that the article actually exists
    const articleExists = await validateArticleExists(articleId, { isDraft });
    if (!articleExists) {
        return res.status(404).json({ error: 'Article not found' });
    }

    const lockKey = `likes:${articleId}`;
    let releaseLock;

    try {
        releaseLock = await mutex.acquire(lockKey);

        // Check current like status (inside lock for consistency)
        const alreadyLiked = hasIPLiked(articleId, ip);

        if (alreadyLiked) {
            // Unlike: remove the IP from the list
            removeIPLike(articleId, ip);
        } else {
            // Like: add the IP to the list
            recordIPLike(articleId, ip);
        }

        // Update likes count (should match IP array length)
        const newCount = (likeIpsData[articleId] || []).length;
        if (newCount > 0) {
            likesData[articleId] = newCount;
        } else {
            delete likesData[articleId];
        }
        markShardDirty(articleId);
        cache.invalidate('stats');

        res.json({
            articleId,
            likes: likesData[articleId] || 0,
            userLiked: !alreadyLiked
        });
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
// Draft mode: ?draft=true will not record any data
app.post('/api/views/:vol', rateLimitMiddleware('write'), async (req, res) => {
    const vol = normalizeVolumeId(req.params.vol);
    const isDraft = req.query.draft === 'true';

    // Draft mode: return fake response without recording
    if (isDraft) {
        return res.json({ vol: req.params.vol, views: 0, draft: true });
    }

    // Validate input
    if (!vol) {
        return res.status(400).json({ error: 'Invalid volume ID' });
    }
    if (!await contentUtils.volumeExists(PUBLISHED_DIR, vol)) {
        return res.status(400).json({ error: 'Volume not found' });
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
        cache.invalidate('stats');

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

// GET /api/stats - Get author statistics (contribution count and like count rankings)
app.get('/api/stats', rateLimitMiddleware('read'), async (req, res) => {
    const cacheKey = 'stats';
    let stats = cache.get(cacheKey);

    if (!stats) {
        try {
            stats = await contentUtils.buildPublishedStats(PUBLISHED_DIR, { likesData, viewsData });
            cache.set(cacheKey, stats, CONFIG.CACHE_TTL.contributions);
        } catch (error) {
            console.error('Error generating stats:', error);
            return res.status(500).json({ error: 'Failed to generate stats' });
        }
    }

    res.set('Cache-Control', 'public, max-age=30');
    res.json(stats);
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
        const volumes = await contentUtils.readVolumeSummaries(volumesDir, { isDraft, viewsData });

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
    await ensureAdminDir();
    await migrateLegacyDraftsToManuscripts();

    // Generate archive.json
    await generateArchiveJson(false);
    await generateArchiveJson(true);

    // Start the server
    const server = app.listen(PORT, () => {
        console.log(`Tech Radar server running at http://localhost:${PORT}`);
        console.log(`Concurrency optimizations enabled:`);
        console.log(`  - In-memory caching with TTL`);
        console.log(`  - Async file I/O`);
        if (LOAD_TEST_MODE) {
            console.log(`  - Rate limiting disabled for load testing`);
        } else {
            console.log(`  - Rate limiting (${CONFIG.RATE_LIMIT.maxRequests.read} read, ${CONFIG.RATE_LIMIT.maxRequests.write} write per minute)`);
        }
        console.log(`  - Proper mutex-based locking`);
        console.log(`  - Debounced writes`);
    });

    // Configure server for high concurrency
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.maxConnections = 2000;

    return server;
}

// ==================== HOT RELOAD WITH FILE WATCHING ====================

// Store SSE clients for hot reload notifications
const sseClients = new Map(); // Map<response, { connectedAt, ip }>
const SSE_CONFIG = {
    MAX_CLIENTS_TOTAL: LOAD_TEST_MODE ? 10000 : 1000,  // Relaxed in test mode
    MAX_CLIENTS_PER_IP: LOAD_TEST_MODE ? 10000 : 5,    // Effectively unlimited per IP in test mode
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
    const clientIP = getClientIP(req, siteConfig.server?.trustProxy) || 'unknown';

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
                // Volume-related change - invalidate cached collections, search and stats
                cache.invalidatePattern('volumes');
                cache.invalidatePattern('contributions');
                cache.invalidatePattern('best-practices');
                cache.invalidatePattern('search:');
                cache.invalidate('stats');
                console.log('Cache invalidated: volumes, content collections, search, stats');
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

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }
    const status = error.status || error.statusCode || 500;
    if (status === 413) {
        return res.status(413).json({ error: 'Payload too large' });
    }
    if (status >= 400 && status < 500) {
        return res.status(status).json({ error: error.message });
    }
    console.error('Request error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

async function bootstrap() {
    await startServer();

    if (FILE_WATCHER_ENABLED) {
        fileWatcher = setupFileWatcher();
    } else {
        console.log('File watcher disabled by configuration');
    }
}

if (require.main === module) {
    bootstrap().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}

module.exports = {
    app,
    bootstrap,
    startServer
};
