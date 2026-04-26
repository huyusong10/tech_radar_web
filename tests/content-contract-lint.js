#!/usr/bin/env node

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENTS_DIR = process.env.SITE_CONTENTS_DIR
    ? path.resolve(process.env.SITE_CONTENTS_DIR)
    : path.join(PROJECT_ROOT, 'contents');
const STRICT_RUNTIME = process.argv.includes('--strict-runtime');
const ADMIN_DRAFT_STATUSES = new Set(['editing', 'review_requested', 'changes_requested', 'approved', 'published', 'rejected']);
const SUBMISSION_STATUSES = new Set(['submitted', 'in_editing', 'in_technical_review', 'changes_requested', 'approved', 'published', 'rejected']);
const ADMIN_ROLES = new Set(['chief_editor', 'editor', 'tech_reviewer']);

const errors = [];
const warnings = [];

function relativePath(filePath) {
    const normalized = path.resolve(filePath);
    if (normalized === CONTENTS_DIR || normalized.startsWith(CONTENTS_DIR + path.sep)) {
        return `contents/${path.relative(CONTENTS_DIR, normalized).replace(/\\/g, '/')}`;
    }
    return path.relative(PROJECT_ROOT, normalized).replace(/\\/g, '/');
}

function addError(message, filePath) {
    errors.push(filePath ? `${relativePath(filePath)}: ${message}` : message);
}

function addWarning(message, filePath) {
    warnings.push(filePath ? `${relativePath(filePath)}: ${message}` : message);
}

function addRuntimeIssue(message, filePath) {
    if (STRICT_RUNTIME) {
        addError(message, filePath);
    } else {
        addWarning(message, filePath);
    }
}

function exists(filePath) {
    return fs.existsSync(filePath);
}

async function readJson(filePath) {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
}

function parseFrontmatter(raw, filePath) {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

    if (!match) {
        return { metadata: {}, content: normalized };
    }

    try {
        return {
            metadata: yaml.load(match[1]) || {},
            content: match[2] || ''
        };
    } catch (error) {
        addError(`invalid YAML frontmatter: ${error.message}`, filePath);
        return { metadata: {}, content: match[2] || '' };
    }
}

function isLocalAssetReference(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('//');
}

async function loadAuthors() {
    const authorsPath = path.join(CONTENTS_DIR, 'shared', 'authors.md');
    const authors = new Map();

    if (!exists(authorsPath)) {
        addError('missing shared authors file', authorsPath);
        return authors;
    }

    const { metadata } = parseFrontmatter(await fsPromises.readFile(authorsPath, 'utf8'), authorsPath);
    if (!Array.isArray(metadata.authors)) {
        addError('authors must be an array', authorsPath);
        return authors;
    }

    for (const author of metadata.authors) {
        if (!author || typeof author !== 'object') {
            addError('author entry must be an object', authorsPath);
            continue;
        }

        if (!author.id) {
            addError('author entry is missing id', authorsPath);
            continue;
        }

        if (authors.has(author.id)) {
            addError(`duplicate author id "${author.id}"`, authorsPath);
        }

        authors.set(author.id, author);

        if (author.avatar && author.avatar.startsWith('/contents/assets/')) {
            const avatarPath = path.join(CONTENTS_DIR, 'assets', author.avatar.replace('/contents/assets/', ''));
            if (!exists(avatarPath)) {
                addError(`avatar is not reachable for author "${author.id}": ${author.avatar}`, authorsPath);
            }
        }
    }

    return authors;
}

function validateTemporaryAuthor(author, filePath) {
    if (!author || typeof author !== 'object') {
        addError('temporary author must be an object', filePath);
        return;
    }
    if (typeof author.name !== 'string' || author.name.length === 0) {
        addError('temporary author name is required', filePath);
    }
    for (const field of ['team', 'role', 'avatar']) {
        if (author[field] !== undefined && typeof author[field] !== 'string') {
            addError(`temporary author ${field} must be a string`, filePath);
        }
    }
}

function validateAuthorFields(metadata, filePath, authors, options = {}) {
    const hasAuthorId = typeof metadata.author_id === 'string' && metadata.author_id.length > 0;
    const hasAuthorIds = Array.isArray(metadata.author_ids);
    const hasTemporaryAuthor = metadata.author && typeof metadata.author === 'object';

    if ([hasAuthorId, hasAuthorIds, hasTemporaryAuthor].filter(Boolean).length !== 1) {
        addError(options.allowTemporaryAuthor
            ? 'exactly one of author_id, author_ids or author is required'
            : 'exactly one of author_id or author_ids is required', filePath);
        return;
    }

    if (hasTemporaryAuthor) {
        if (!options.allowTemporaryAuthor) {
            addError('temporary author is not allowed outside admin drafts', filePath);
            return;
        }
        validateTemporaryAuthor(metadata.author, filePath);
        return;
    }

    const authorIds = hasAuthorIds ? metadata.author_ids : [metadata.author_id];
    if (authorIds.length > 2) {
        addError('author_ids may contain at most 2 authors', filePath);
    }

    for (const authorId of authorIds) {
        if (typeof authorId !== 'string' || authorId.length === 0) {
            addError('author id must be a non-empty string', filePath);
            continue;
        }

        if (!authors.has(authorId)) {
            addError(`unknown author id "${authorId}"`, filePath);
        }
    }
}

function validateRelativeAssets(markdown, entryDir, filePath) {
    const imagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of markdown.matchAll(imagePattern)) {
        const rawRef = match[1].trim();
        if (!isLocalAssetReference(rawRef)) {
            continue;
        }

        const localRef = rawRef.replace(/^\.\//, '');
        const assetPath = path.resolve(entryDir, localRef);
        if (!assetPath.startsWith(entryDir + path.sep) && assetPath !== entryDir) {
            addError(`relative asset escapes its article folder: ${rawRef}`, filePath);
            continue;
        }

        if (!exists(assetPath)) {
            addError(`relative asset is missing: ${rawRef}`, filePath);
        }
    }
}

async function validateCollectionEntry(entryDir, authors) {
    const indexPath = path.join(entryDir, 'index.md');
    if (!exists(indexPath)) {
        addError('missing index.md', entryDir);
        return;
    }

    const { metadata, content } = parseFrontmatter(await fsPromises.readFile(indexPath, 'utf8'), indexPath);

    if (typeof metadata.title !== 'string' || metadata.title.length === 0) {
        addError('title is required', indexPath);
    }

    if (typeof metadata.description !== 'string' || metadata.description.length === 0) {
        addError('description is required', indexPath);
    }

    validateAuthorFields(metadata, indexPath, authors);
    validateRelativeAssets(content, entryDir, indexPath);
}

async function validateVolumeRoot(rootName, authors) {
    const rootDir = path.join(CONTENTS_DIR, rootName);
    const volumes = new Set();

    if (!exists(rootDir)) {
        addWarning(`missing ${rootName} volume root`, rootDir);
        return volumes;
    }

    const entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
    const volumeDirs = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith('vol-'))
        .map(entry => entry.name)
        .sort();

    for (const volumeDirName of volumeDirs) {
        const volumeId = volumeDirName.replace(/^vol-/, '');
        const volumeDir = path.join(rootDir, volumeDirName);
        volumes.add(volumeId);

        const radarPath = path.join(volumeDir, 'radar.md');
        if (exists(radarPath)) {
            const { metadata } = parseFrontmatter(await fsPromises.readFile(radarPath, 'utf8'), radarPath);

            if (typeof metadata.vol !== 'string' || metadata.vol.length === 0) {
                addError('radar vol is required', radarPath);
            } else if (metadata.vol !== volumeId) {
                addError(`radar vol "${metadata.vol}" does not match directory vol "${volumeId}"`, radarPath);
            }

            if (typeof metadata.date !== 'string' || metadata.date.length === 0) {
                addError('radar date is required', radarPath);
            }

            if (Array.isArray(metadata.editors)) {
                for (const editor of metadata.editors) {
                    if (!editor || typeof editor !== 'object') {
                        addError('editor entry must be an object', radarPath);
                        continue;
                    }
                    if (!editor.author_id || !authors.has(editor.author_id)) {
                        addError(`unknown editor author_id "${editor.author_id || ''}"`, radarPath);
                    }
                    if (!editor.role) {
                        addError(`editor "${editor.author_id || ''}" is missing role`, radarPath);
                    }
                }
            }
        }

        for (const collectionName of ['contributions', 'best-practices']) {
            const collectionDir = path.join(volumeDir, collectionName);
            if (!exists(collectionDir)) {
                continue;
            }

            const collectionEntries = await fsPromises.readdir(collectionDir, { withFileTypes: true });
            for (const entry of collectionEntries) {
                if (entry.isDirectory()) {
                    await validateCollectionEntry(path.join(collectionDir, entry.name), authors);
                }
            }
        }
    }

    await validateArchive(rootDir, rootName, volumeDirs);
    return volumes;
}

async function validateArchive(rootDir, rootName, volumeDirs) {
    const archivePath = path.join(rootDir, 'archive.json');
    if (!exists(archivePath)) {
        addWarning(`${rootName} archive.json is missing; run the server once to regenerate it`, archivePath);
        return;
    }

    try {
        const archive = await readJson(archivePath);
        const archivedVolumes = Array.isArray(archive)
            ? archive.map(item => `vol-${item.vol}`).sort()
            : [];
        if (JSON.stringify(archivedVolumes) !== JSON.stringify(volumeDirs)) {
            addWarning(`${rootName} archive.json does not match current volume directories`, archivePath);
        }
    } catch (error) {
        addWarning(`archive.json is not valid JSON: ${error.message}`, archivePath);
    }
}

async function validateRuntimeData(publishedVolumes) {
    const dataDir = path.join(CONTENTS_DIR, 'data');
    if (!exists(dataDir)) {
        return;
    }

    const viewsPath = path.join(dataDir, 'views.json');
    if (exists(viewsPath)) {
        try {
            const views = await readJson(viewsPath);
            for (const [vol, count] of Object.entries(views)) {
                if (!publishedVolumes.has(vol)) {
                    addRuntimeIssue(`views contain unknown published volume "${vol}"`, viewsPath);
                }
                if (!Number.isInteger(count) || count < 0) {
                    addRuntimeIssue(`views count for "${vol}" must be a non-negative integer`, viewsPath);
                }
            }
        } catch (error) {
            addRuntimeIssue(`views.json is not valid JSON: ${error.message}`, viewsPath);
        }
    }

    await validateLikeShards(dataDir, publishedVolumes);
}

async function validateAdminContent(authors) {
    const adminDir = path.join(CONTENTS_DIR, 'admin');
    if (!exists(adminDir)) {
        return;
    }

    const allowedEntries = new Set(['users.json', 'audit-log.json', 'drafts', 'reviews', 'unpublished']);
    const entries = await fsPromises.readdir(adminDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!allowedEntries.has(entry.name)) {
            addError(`admin entry is outside the documented contract: ${entry.name}`, path.join(adminDir, entry.name));
        }
    }

    await validateAdminUsers(path.join(adminDir, 'users.json'));
    await validateAdminAuditLog(path.join(adminDir, 'audit-log.json'));
    await validateAdminDrafts(path.join(adminDir, 'drafts'), path.join(adminDir, 'reviews'), authors);
    await validateUnpublishedArticles(path.join(adminDir, 'unpublished'), authors);
}

async function validateAdminUsers(usersPath) {
    if (!exists(usersPath)) {
        addError('missing admin users.json', usersPath);
        return;
    }

    try {
        const data = await readJson(usersPath);
        if (!Array.isArray(data.users)) {
            addError('users must be an array', usersPath);
            return;
        }
        const usernames = new Set();
        for (const user of data.users) {
            if (!user || typeof user !== 'object') {
                addError('admin user entry must be an object', usersPath);
                continue;
            }
            if (!user.username || typeof user.username !== 'string') {
                addError('admin user username is required', usersPath);
            } else if (usernames.has(user.username)) {
                addError(`duplicate admin username "${user.username}"`, usersPath);
            } else {
                usernames.add(user.username);
            }
            if (!ADMIN_ROLES.has(user.role)) {
                addError(`admin user role is invalid: ${user.role || ''}`, usersPath);
            }
            if (!user.passwordHash || typeof user.passwordHash !== 'string') {
                addError(`admin user "${user.username || ''}" is missing passwordHash`, usersPath);
            }
            if (user.disabled !== undefined && typeof user.disabled !== 'boolean') {
                addError(`admin user "${user.username || ''}" disabled must be boolean`, usersPath);
            }
        }
    } catch (error) {
        addError(`users.json is not valid JSON: ${error.message}`, usersPath);
    }
}

async function validateAdminAuditLog(auditLogPath) {
    if (!exists(auditLogPath)) {
        addError('missing admin audit-log.json', auditLogPath);
        return;
    }

    try {
        const auditLog = await readJson(auditLogPath);
        if (!Array.isArray(auditLog)) {
            addError('audit log must be an array', auditLogPath);
        }
    } catch (error) {
        addError(`audit-log.json is not valid JSON: ${error.message}`, auditLogPath);
    }
}

async function validateAdminDrafts(draftsDir, reviewsDir, authors) {
    if (!exists(draftsDir)) {
        addError('missing admin drafts directory', draftsDir);
        return;
    }

    const draftIds = new Set();
    const draftEntries = await fsPromises.readdir(draftsDir, { withFileTypes: true });
    for (const entry of draftEntries) {
        if (!entry.isDirectory()) {
            addError('admin drafts may only contain draft directories', path.join(draftsDir, entry.name));
            continue;
        }
        draftIds.add(entry.name);
        await validateAdminDraft(path.join(draftsDir, entry.name), entry.name, authors);
    }

    if (!exists(reviewsDir)) {
        addError('missing admin reviews directory', reviewsDir);
        return;
    }

    const reviewEntries = await fsPromises.readdir(reviewsDir, { withFileTypes: true });
    for (const entry of reviewEntries) {
        const reviewPath = path.join(reviewsDir, entry.name);
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            addError('admin reviews may only contain JSON files', reviewPath);
            continue;
        }
        const draftId = entry.name.replace(/\.json$/, '');
        if (!draftIds.has(draftId)) {
            addWarning(`review file does not match an admin draft: ${entry.name}`, reviewPath);
        }
        try {
            const review = await readJson(reviewPath);
            if (!Array.isArray(review.history)) {
                addError('review history must be an array', reviewPath);
            }
        } catch (error) {
            addError(`review file is not valid JSON: ${error.message}`, reviewPath);
        }
    }
}

async function validateAdminDraft(draftDir, draftId, authors) {
    if (!/^\d{14}-[a-z0-9._-]+$/.test(draftId)) {
        addError('draft id must use timestamp + slug', draftDir);
    }

    const metaPath = path.join(draftDir, 'meta.json');
    const indexPath = path.join(draftDir, 'index.md');

    if (!exists(metaPath)) {
        addError('admin draft is missing meta.json', draftDir);
    } else {
        try {
            const meta = await readJson(metaPath);
            if (meta.draftId !== draftId) {
                addError('meta draftId must match directory name', metaPath);
            }
            if (!ADMIN_DRAFT_STATUSES.has(meta.status)) {
                addError(`draft status is invalid: ${meta.status || ''}`, metaPath);
            }
            if (meta.source !== undefined && !['admin', 'submission'].includes(meta.source)) {
                addError(`draft source is invalid: ${meta.source || ''}`, metaPath);
            }
            if (meta.source === 'submission') {
                if (!SUBMISSION_STATUSES.has(meta.submissionStatus)) {
                    addError(`submission status is invalid: ${meta.submissionStatus || ''}`, metaPath);
                }
                if (!meta.submitter || typeof meta.submitter !== 'object') {
                    addError('submission submitter is required', metaPath);
                }
                if (!meta.submitterTokenHash || typeof meta.submitterTokenHash !== 'string') {
                    addError('submission token hash is required', metaPath);
                }
                if (!Number.isInteger(meta.revision) || meta.revision < 1) {
                    addError('submission revision must be a positive integer', metaPath);
                }
            }
            if (typeof meta.targetVol !== 'string' || !/^\d{3,10}$/.test(meta.targetVol)) {
                addError('draft targetVol must be a volume id string', metaPath);
            }
            if (typeof meta.folderName !== 'string' || !/^[a-z0-9._-]+$/.test(meta.folderName)) {
                addError('draft folderName must be a slug', metaPath);
            }
        } catch (error) {
            addError(`meta.json is not valid JSON: ${error.message}`, metaPath);
        }
    }

    if (!exists(indexPath)) {
        addError('admin draft is missing index.md', draftDir);
        return;
    }

    const { metadata, content } = parseFrontmatter(await fsPromises.readFile(indexPath, 'utf8'), indexPath);
    if (typeof metadata.title !== 'string' || metadata.title.length === 0) {
        addError('title is required', indexPath);
    }
    if (typeof metadata.description !== 'string' || metadata.description.length === 0) {
        addError('description is required', indexPath);
    }
    validateAuthorFields(metadata, indexPath, authors, { allowTemporaryAuthor: true });
    validateRelativeAssets(content, draftDir, indexPath);
}

async function validateUnpublishedArticles(unpublishedDir, authors) {
    if (!exists(unpublishedDir)) {
        return;
    }
    const entries = await fsPromises.readdir(unpublishedDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(unpublishedDir, entry.name);
        if (!entry.isDirectory()) {
            addError('unpublished archive may only contain article directories', entryPath);
            continue;
        }
        if (!/^\d{3,10}-[a-z0-9._-]+$/.test(entry.name)) {
            addError('unpublished article id must follow <vol>-<folder>', entryPath);
        }
        await validateCollectionEntry(entryPath, authors);
    }
}

async function validateLikeShards(dataDir, publishedVolumes) {
    const likesDir = path.join(dataDir, 'likes');
    const likeIpsDir = path.join(dataDir, 'like-ips');
    const knownRuntimeFiles = new Set([
        'views.json',
        'likes.json.migrated',
        'like-ips.json.migrated'
    ]);

    for (const entry of await fsPromises.readdir(dataDir, { withFileTypes: true })) {
        if (entry.isFile() && !knownRuntimeFiles.has(entry.name)) {
            addRuntimeIssue(`runtime data file is outside the documented contract: ${entry.name}`, path.join(dataDir, entry.name));
        }
    }

    if (!exists(likesDir) && !exists(likeIpsDir)) {
        return;
    }

    const shardNames = new Set();
    for (const dir of [likesDir, likeIpsDir]) {
        if (!exists(dir)) continue;
        for (const entry of await fsPromises.readdir(dir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.json')) {
                shardNames.add(entry.name);
            }
        }
    }

    for (const shardName of shardNames) {
        const volMatch = shardName.match(/^vol-(.+)\.json$/);
        if (!volMatch) {
            addRuntimeIssue(`runtime shard name must follow vol-<vol>.json: ${shardName}`, dataDir);
            continue;
        }

        const vol = volMatch[1];
        if (!publishedVolumes.has(vol)) {
            addRuntimeIssue(`like shard references unknown published volume "${vol}"`, dataDir);
        }

        const likesPath = path.join(likesDir, shardName);
        const likeIpsPath = path.join(likeIpsDir, shardName);
        const likes = exists(likesPath) ? await readJson(likesPath) : {};
        const likeIps = exists(likeIpsPath) ? await readJson(likeIpsPath) : {};
        const articleIds = new Set([...Object.keys(likes), ...Object.keys(likeIps)]);

        for (const articleId of articleIds) {
            const count = likes[articleId] || 0;
            const ips = likeIps[articleId] || [];
            if (!Array.isArray(ips)) {
                addRuntimeIssue(`like-ips for "${articleId}" must be an array`, likeIpsPath);
                continue;
            }
            if (!Number.isInteger(count) || count < 0) {
                addRuntimeIssue(`likes for "${articleId}" must be a non-negative integer`, likesPath);
            }
            if (count !== ips.length) {
                addRuntimeIssue(`likes count for "${articleId}" does not match like-ips length`, likesPath);
            }
        }
    }
}

async function main() {
    const authors = await loadAuthors();
    const publishedVolumes = await validateVolumeRoot('published', authors);
    await validateVolumeRoot('draft', authors);
    await validateAdminContent(authors);
    await validateRuntimeData(publishedVolumes);

    if (warnings.length > 0) {
        console.warn(`Content contract lint warnings (${warnings.length}):`);
        warnings.forEach(warning => console.warn(`  - ${warning}`));
    }

    if (errors.length > 0) {
        console.error(`Content contract lint failed (${errors.length}):`);
        errors.forEach(error => console.error(`  - ${error}`));
        process.exit(1);
    }

    console.log('Content contract lint passed.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
