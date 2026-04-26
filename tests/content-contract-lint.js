#!/usr/bin/env node

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENTS_DIR = path.join(PROJECT_ROOT, 'contents');
const STRICT_RUNTIME = process.argv.includes('--strict-runtime');

const errors = [];
const warnings = [];

function relativePath(filePath) {
    return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
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

function validateAuthorFields(metadata, filePath, authors) {
    const hasAuthorId = typeof metadata.author_id === 'string' && metadata.author_id.length > 0;
    const hasAuthorIds = Array.isArray(metadata.author_ids);

    if (hasAuthorId === hasAuthorIds) {
        addError('exactly one of author_id or author_ids is required', filePath);
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
