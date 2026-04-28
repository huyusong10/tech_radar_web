const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const contentUtils = require('../server/utils/content');

let tempDirs = [];

async function makeTempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tech-radar-content-utils-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
});

describe('Content utilities', () => {
    test('parses Markdown documents with CRLF frontmatter without touching body text', () => {
        const document = contentUtils.parseMarkdownDocument('---\r\ntitle: Demo\r\n---\r\nLine one\r\nLine two');

        assert.deepEqual(document.metadata, { title: 'Demo' });
        assert.equal(document.body, 'Line one\nLine two');
    });

    test('normalizes volume summary dates to strings and preserves public shape', async () => {
        const contentsDir = await makeTempDir();
        const publishedDir = path.join(contentsDir, 'published');
        await mkdir(path.join(publishedDir, 'vol-002'), { recursive: true });
        await mkdir(path.join(publishedDir, 'vol-001'), { recursive: true });
        await writeFile(path.join(publishedDir, 'vol-002', 'radar.md'), '---\ndate: 2026-04-28\n---\n', 'utf8');
        await writeFile(path.join(publishedDir, 'vol-001', 'radar.md'), '---\ndate: "2026.01.04"\n---\n', 'utf8');

        const summaries = await contentUtils.readVolumeSummaries(publishedDir, {
            viewsData: { '001': 3, '999': 10 }
        });

        assert.deepEqual(summaries, [
            { vol: '002', date: '2026-04-28', views: 0 },
            { vol: '001', date: '2026.01.04', views: 3 }
        ]);
    });

    test('builds search and stats through the shared content repository helpers', async () => {
        const contentsDir = await makeTempDir();
        const publishedDir = path.join(contentsDir, 'published');
        const contributionDir = path.join(publishedDir, 'vol-001', 'contributions', 'demo');
        const practiceDir = path.join(publishedDir, 'vol-001', 'best-practices', 'practice');
        await mkdir(contributionDir, { recursive: true });
        await mkdir(practiceDir, { recursive: true });
        await writeFile(
            path.join(publishedDir, 'vol-001', 'radar.md'),
            '---\ndate: "2026.01.04"\n---\n### [AI] Searchable Radar\nDetails\n',
            'utf8'
        );
        await writeFile(
            path.join(contributionDir, 'index.md'),
            '---\ntitle: Searchable Article\ndescription: Demo\nauthor_id: alice\n---\nBody text\n',
            'utf8'
        );
        await writeFile(
            path.join(practiceDir, 'index.md'),
            '---\ntitle: Searchable Practice\ndescription: Demo\nauthor_ids:\n  - alice\n  - bob\n---\nPractice body\n',
            'utf8'
        );

        const search = await contentUtils.searchPublishedContent(publishedDir, 'searchable', 10);
        assert.deepEqual(search.results.map(result => result.type), ['trending', 'contribution', 'best-practice']);

        const stats = await contentUtils.buildPublishedStats(publishedDir, {
            likesData: { '001-demo': 2 },
            viewsData: { '001': 5, '999': 100 }
        });
        assert.equal(stats.totalContributions, 1);
        assert.equal(stats.totalLikes, 2);
        assert.equal(stats.totalViews, 5);
        assert.deepEqual(stats.contributionRanking, [{ authorId: 'alice', count: 1, rank: 1 }]);
    });
});
