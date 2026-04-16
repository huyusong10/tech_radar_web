const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { createServerHarness, readJson } = require('./helpers/server-harness');

describe('Reader journey contract', () => {
    let harness;

    before(async () => {
        harness = await createServerHarness();
    });

    after(async () => {
        await harness.cleanup();
    });

    test('supports the main published reading flow through public contracts', async () => {
        const siteConfig = await readJson(await harness.request('/api/site-config'));
        const [volumes, authors, likes, userLikes] = await Promise.all([
            readJson(await harness.request('/api/volumes')),
            readJson(await harness.request('/api/authors')),
            readJson(await harness.request('/api/likes')),
            readJson(await harness.request('/api/user-likes'))
        ]);

        assert.ok(Array.isArray(volumes) && volumes.length > 0);
        assert.equal(typeof authors, 'object');
        assert.equal(typeof likes, 'object');
        assert.ok(Array.isArray(userLikes.likedArticles));

        const activeVolume = volumes[0];
        const radarResponse = await harness.request(`${siteConfig.publishedDir}/vol-${activeVolume.vol}/radar.md`);
        assert.equal(radarResponse.status, 200);
        const radarMarkdown = await radarResponse.text();
        assert.ok(radarMarkdown.startsWith('---'));

        const contributions = await readJson(await harness.request(`/api/contributions/${activeVolume.vol}`));
        if (contributions.length === 0) {
            return;
        }

        const firstFolder = contributions[0];
        const contributionResponse = await harness.request(`${siteConfig.publishedDir}/vol-${activeVolume.vol}/contributions/${firstFolder}/index.md`);
        assert.equal(contributionResponse.status, 200);
        const contributionMarkdown = await contributionResponse.text();
        assert.ok(contributionMarkdown.includes('title:'));

        const articleId = `${activeVolume.vol}-${firstFolder}`;
        const viewBefore = await readJson(await harness.request(`/api/views/${activeVolume.vol}`));
        const viewAfter = await readJson(await harness.request(`/api/views/${activeVolume.vol}`, { method: 'POST' }));
        assert.equal(viewAfter.views, viewBefore.views + 1);

        const likeAfter = await readJson(await harness.request(`/api/likes/${articleId}`, { method: 'POST' }));
        assert.equal(likeAfter.articleId, articleId);
        assert.equal(typeof likeAfter.likes, 'number');
        assert.equal(typeof likeAfter.userLiked, 'boolean');

        const stats = await readJson(await harness.request('/api/stats'));
        assert.ok(stats.totalVolumes >= 1);
        assert.ok(stats.totalContributions >= contributions.length);
    });

    test('exposes draft volumes independently from published volumes', async () => {
        const published = await readJson(await harness.request('/api/volumes'));
        const drafts = await readJson(await harness.request('/api/volumes?draft=true'));

        assert.ok(Array.isArray(published));
        assert.ok(Array.isArray(drafts));
        assert.ok(drafts.length >= 1);

        const draftVolume = drafts[0];
        const draftRadarResponse = await harness.request(`/contents/draft/vol-${draftVolume.vol}/radar.md`);
        assert.equal(draftRadarResponse.status, 200);

        drafts.forEach(item => {
            assert.equal(item.views, 0);
        });
    });

    test('keeps static asset references reachable for contribution folders', async () => {
        const volumes = await readJson(await harness.request('/api/volumes'));

        for (const volume of volumes) {
            const folders = await readJson(await harness.request(`/api/contributions/${volume.vol}`));
            for (const folder of folders) {
                const contributionResponse = await harness.request(`/contents/published/vol-${volume.vol}/contributions/${folder}/index.md`);
                const markdown = await contributionResponse.text();
                const imageMatch = markdown.match(/!\[[^\]]*\]\(\.\/([^)]+)\)/);

                if (!imageMatch) {
                    continue;
                }

                const assetResponse = await harness.request(`/contents/published/vol-${volume.vol}/contributions/${folder}/${imageMatch[1]}`);
                assert.equal(assetResponse.status, 200);
                return;
            }
        }

        assert.fail('expected at least one contribution asset reference in sample content');
    });
});
