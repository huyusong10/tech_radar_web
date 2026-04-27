const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

function normalizeLineEndings(raw) {
    return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseYamlFrontmatter(content) {
    const normalizedContent = normalizeLineEndings(content);
    const match = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    return yaml.load(match[1]) || {};
}

function parseMarkdownDocument(raw) {
    const normalized = normalizeLineEndings(raw);
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        return { metadata: {}, body: normalized };
    }
    return {
        metadata: yaml.load(match[1]) || {},
        body: match[2] || ''
    };
}

async function readFrontmatterFile(filePath, fallback = {}) {
    try {
        return parseYamlFrontmatter(await fsPromises.readFile(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

async function readAuthorsArray(sharedDir) {
    const data = await readFrontmatterFile(path.join(sharedDir, 'authors.md'), { authors: [] });
    return Array.isArray(data.authors) ? data.authors : [];
}

async function readAuthorsMap(sharedDir) {
    const authors = await readAuthorsArray(sharedDir);
    return authors.reduce((map, author) => {
        if (author.id) {
            map[author.id] = author;
        }
        return map;
    }, {});
}

async function listVolumeDirs(volumesDir) {
    try {
        const dirs = await fsPromises.readdir(volumesDir, { withFileTypes: true });
        return dirs
            .filter(dir => dir.isDirectory() && dir.name.startsWith('vol-'))
            .map(dir => ({
                dirName: dir.name,
                vol: dir.name.replace(/^vol-/, '')
            }));
    } catch {
        return [];
    }
}

async function readVolumeSummaries(volumesDir, options = {}) {
    const volumeDirs = await listVolumeDirs(volumesDir);
    const summaries = await Promise.all(volumeDirs.map(async ({ dirName, vol }) => {
        const radarPath = path.join(volumesDir, dirName, 'radar.md');
        let date = '';

        if (fs.existsSync(radarPath)) {
            try {
                const document = parseMarkdownDocument(await fsPromises.readFile(radarPath, 'utf8'));
                date = document.metadata.date || '';
            } catch {
                // Keep malformed radar metadata from breaking volume listing.
            }
        }

        return {
            vol,
            date,
            views: options.isDraft ? 0 : (options.viewsData?.[vol] || 0)
        };
    }));

    return summaries.sort((a, b) => b.vol.localeCompare(a.vol));
}

async function listCollectionFolders(volumesDir, vol, collectionName) {
    const collectionDir = path.join(volumesDir, `vol-${vol}`, collectionName);
    try {
        const dirs = await fsPromises.readdir(collectionDir, { withFileTypes: true });
        return dirs
            .filter(dir => dir.isDirectory())
            .map(dir => dir.name)
            .sort();
    } catch {
        return [];
    }
}

async function volumeExists(volumesDir, vol) {
    try {
        const stat = await fsPromises.stat(path.join(volumesDir, `vol-${vol}`));
        return stat.isDirectory();
    } catch {
        return false;
    }
}

module.exports = {
    normalizeLineEndings,
    parseYamlFrontmatter,
    parseMarkdownDocument,
    readFrontmatterFile,
    readAuthorsArray,
    readAuthorsMap,
    readVolumeSummaries,
    listCollectionFolders,
    volumeExists
};
