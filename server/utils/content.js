const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

function normalizeLineEndings(raw) {
    return String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function metadataValueToString(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return value.toISOString().slice(0, 10);
    }
    if (value === undefined || value === null) return '';
    return String(value);
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
                date = metadataValueToString(document.metadata.date);
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

async function readCollectionDocuments(volumesDir, vol, collectionName) {
    const collectionDir = path.join(volumesDir, `vol-${vol}`, collectionName);
    let dirs;
    try {
        dirs = await fsPromises.readdir(collectionDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const documents = [];
    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const indexPath = path.join(collectionDir, dir.name, 'index.md');
        try {
            const raw = await fsPromises.readFile(indexPath, 'utf8');
            const document = parseMarkdownDocument(raw);
            documents.push({
                vol,
                folderName: dir.name,
                indexPath,
                metadata: document.metadata,
                body: document.body
            });
        } catch {
            // Skip entries without a readable index.md or valid frontmatter.
        }
    }

    return documents;
}

function extractSnippet(text, query, maxLength = 120) {
    if (!text || !query) return null;

    const lowerText = String(text).toLowerCase();
    const lowerQuery = String(query).toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return null;

    const halfLength = Math.floor((maxLength - query.length) / 2);
    let start = Math.max(0, index - halfLength);
    let end = Math.min(String(text).length, index + query.length + halfLength);

    if (start > 0) {
        const spaceIndex = String(text).indexOf(' ', start);
        if (spaceIndex !== -1 && spaceIndex < index) {
            start = spaceIndex + 1;
        }
    }
    if (end < String(text).length) {
        const spaceIndex = String(text).lastIndexOf(' ', end);
        if (spaceIndex > index + query.length) {
            end = spaceIndex;
        }
    }

    let snippet = String(text).substring(start, end).trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < String(text).length) snippet = snippet + '...';
    return snippet;
}

function collectionDocumentToSearchResult(document, resultType, query) {
    const { metadata, body, vol, folderName } = document;
    const title = metadata.title || folderName;
    const description = metadata.description || '';
    const authorIds = metadata.author_ids || (metadata.author_id ? [metadata.author_id] : []);
    const searchText = `${title} ${description} ${authorIds.join(' ')} ${body}`.toLowerCase();

    if (!searchText.includes(query)) return null;

    return {
        type: resultType,
        vol,
        title,
        description: description.length > 100 ? description.substring(0, 100) + '...' : description,
        authorIds,
        articleId: resultType === 'best-practice' ? `bp-${vol}-${folderName}` : `${vol}-${folderName}`,
        folderName,
        snippet: extractSnippet(title, query) ||
            extractSnippet(description, query) ||
            extractSnippet(body, query)
    };
}

async function searchArticleCollection(volumesDir, vol, collectionName, resultType, query) {
    const documents = await readCollectionDocuments(volumesDir, vol, collectionName);
    return documents
        .map(document => collectionDocumentToSearchResult(document, resultType, query))
        .filter(Boolean);
}

function parseTrendingItems(rawRadarContent) {
    const lines = normalizeLineEndings(rawRadarContent).split('\n');
    const items = [];
    let currentItem = null;

    for (const line of lines) {
        const headerMatch = line.match(/^###\s+\[(.+?)\]\s+(.+)$/);
        if (headerMatch) {
            if (currentItem) items.push(currentItem);
            currentItem = {
                badge: headerMatch[1],
                title: headerMatch[2].trim(),
                content: ''
            };
        } else if (currentItem && line.trim() && !line.startsWith('#')) {
            currentItem.content += (currentItem.content ? ' ' : '') + line.trim();
        }
    }
    if (currentItem) items.push(currentItem);
    return items;
}

async function searchPublishedContent(volumesDir, query, limit = 20) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const results = [];
    const volumes = (await listVolumeDirs(volumesDir))
        .map(item => item.vol)
        .sort((a, b) => b.localeCompare(a));

    for (const vol of volumes) {
        const radarPath = path.join(volumesDir, `vol-${vol}`, 'radar.md');
        try {
            const radarContent = await fsPromises.readFile(radarPath, 'utf8');
            const radarFrontmatter = parseYamlFrontmatter(radarContent);
            for (const item of parseTrendingItems(radarContent)) {
                const searchText = `${item.title} ${item.badge} ${item.content}`.toLowerCase();
                if (searchText.includes(normalizedQuery)) {
                    results.push({
                        type: 'trending',
                        vol,
                        title: item.title,
                        badge: item.badge,
                        date: metadataValueToString(radarFrontmatter.date),
                        articleId: null,
                        snippet: extractSnippet(item.title, normalizedQuery) ||
                            extractSnippet(item.content, normalizedQuery)
                    });
                }
            }
        } catch {
            // radar.md may be absent or malformed.
        }

        results.push(...await searchArticleCollection(volumesDir, vol, 'contributions', 'contribution', normalizedQuery));
        results.push(...await searchArticleCollection(volumesDir, vol, 'best-practices', 'best-practice', normalizedQuery));

        if (results.length >= limit) break;
    }

    return {
        results: results.slice(0, limit),
        query: normalizedQuery,
        total: results.length
    };
}

function rankedCounts(entries) {
    return entries
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((item, index, arr) => ({
            ...item,
            rank: arr.findIndex(candidate => candidate.count === item.count) + 1
        }));
}

async function buildPublishedStats(volumesDir, { likesData = {}, viewsData = {} } = {}) {
    const volumes = (await listVolumeDirs(volumesDir)).map(item => item.vol);
    const authorStats = {};
    let totalContributions = 0;
    let totalLikes = 0;

    for (const vol of volumes) {
        const documents = await readCollectionDocuments(volumesDir, vol, 'contributions');
        for (const document of documents) {
            const authorIds = document.metadata.author_ids || (document.metadata.author_id ? [document.metadata.author_id] : []);
            const articleId = `${vol}-${document.folderName}`;
            const articleLikes = likesData[articleId] || 0;
            totalContributions += 1;
            totalLikes += articleLikes;

            for (const authorId of authorIds) {
                if (!authorStats[authorId]) {
                    authorStats[authorId] = { contributions: 0, likes: 0 };
                }
                authorStats[authorId].contributions += 1;
                authorStats[authorId].likes += articleLikes;
            }
        }
    }

    const contributionRanking = rankedCounts(
        Object.entries(authorStats).map(([authorId, data]) => ({ authorId, count: data.contributions }))
    );
    const likeRanking = rankedCounts(
        Object.entries(authorStats).map(([authorId, data]) => ({ authorId, count: data.likes }))
    );
    const totalViews = volumes.reduce((sum, vol) => {
        const count = viewsData[vol];
        return sum + (Number.isInteger(count) && count > 0 ? count : 0);
    }, 0);
    const totalAuthors = Object.keys(authorStats).length;
    const totalVolumes = volumes.length;

    return {
        contributionRanking,
        likeRanking,
        totalContributions,
        totalLikes,
        totalViews,
        totalAuthors,
        totalVolumes,
        avgLikesPerArticle: totalContributions > 0 ? (totalLikes / totalContributions).toFixed(1) : 0,
        avgViewsPerVolume: totalVolumes > 0 ? Math.round(totalViews / totalVolumes) : 0,
        avgArticlesPerVolume: totalVolumes > 0 ? (totalContributions / totalVolumes).toFixed(1) : 0
    };
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
    metadataValueToString,
    parseYamlFrontmatter,
    parseMarkdownDocument,
    readFrontmatterFile,
    readAuthorsArray,
    readAuthorsMap,
    listVolumeDirs,
    readVolumeSummaries,
    listCollectionFolders,
    readCollectionDocuments,
    searchPublishedContent,
    buildPublishedStats,
    volumeExists
};
