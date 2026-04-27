const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createContentsSandbox, createServerHarness, readJson } = require('./helpers/server-harness');

async function findContributionSample(harness) {
    const volumes = await readJson(await harness.request('/api/volumes'));
    for (const volume of volumes) {
        const contributions = await readJson(await harness.request(`/api/contributions/${volume.vol}`));
        if (Array.isArray(contributions) && contributions.length > 0) {
            return {
                vol: volume.vol,
                contribution: contributions[0],
                articleId: `${volume.vol}-${contributions[0]}`
            };
        }
    }
    return null;
}

describe('API contract', () => {
    let harness;
    let sampleVolume;
    let sampleContribution;
    let sampleArticleId;

    before(async () => {
        harness = await createServerHarness();

        const volumesResponse = await harness.request('/api/volumes');
        const volumes = await readJson(volumesResponse);
        assert.ok(Array.isArray(volumes) && volumes.length > 0, 'expected at least one published volume');
        const sample = await findContributionSample(harness);
        assert.ok(sample, 'expected at least one contribution');
        sampleVolume = sample.vol;
        sampleContribution = sample.contribution;
        sampleArticleId = sample.articleId;
    });

    after(async () => {
        await harness.cleanup();
    });

    test('exposes canonical public content paths', async () => {
        const response = await harness.request('/api/site-config');
        assert.equal(response.status, 200);

        const body = await readJson(response);
        assert.deepEqual(body, {
            contentsDir: '/contents',
            publishedDir: '/contents/published',
            draftDir: '/contents/draft',
            sharedDir: '/contents/shared',
            assetsDir: '/contents/assets'
        });
    });

    test('returns site config as a structured content object', async () => {
        const response = await harness.request('/api/config');
        assert.equal(response.status, 200);

        const body = await readJson(response);
        assert.equal(typeof body.site, 'object');
        assert.equal(typeof body.site.title, 'string');
        assert.equal(typeof body.site.slogan, 'string');
        assert.equal(typeof body.badges, 'object');
        assert.ok(Object.keys(body.badges).length > 0);
    });

    test('keeps operator-facing static resources uncached', async () => {
        const adminScript = await harness.request('/admin/js/drafts.js');
        assert.equal(adminScript.status, 200);
        assert.match(adminScript.headers.get('cache-control') || '', /no-cache/);

        const submitScript = await harness.request('/submit/js/submit.js');
        assert.equal(submitScript.status, 200);
        assert.match(submitScript.headers.get('cache-control') || '', /no-cache/);
    });

    test('returns author map and individual author lookup', async () => {
        const authorsResponse = await harness.request('/api/authors');
        assert.equal(authorsResponse.status, 200);

        const authors = await readJson(authorsResponse);
        const authorIds = Object.keys(authors);
        assert.ok(authorIds.length > 0);

        const authorId = authorIds[0];
        const authorResponse = await harness.request(`/api/authors/${authorId}`);
        assert.equal(authorResponse.status, 200);

        const author = await readJson(authorResponse);
        assert.equal(author.id, authorId);
        assert.equal(typeof author.name, 'string');
    });

    test('searches submission authors by Chinese name, pinyin and initials', async () => {
        const chineseResponse = await harness.request('/api/submission-authors?q=%E8%83%A1%E5%AE%87');
        assert.equal(chineseResponse.status, 200);
        const chineseBody = await readJson(chineseResponse);
        assert.ok(chineseBody.authors.some(author => author.id === 'huyusong'));

        const initialsResponse = await harness.request('/api/submission-authors?q=hys');
        assert.equal(initialsResponse.status, 200);
        const initialsBody = await readJson(initialsResponse);
        const matched = initialsBody.authors.find(author => author.id === 'huyusong');
        assert.ok(matched);
        assert.equal(matched.initials, 'hys');
    });

    test('returns 404 for missing author', async () => {
        const response = await harness.request('/api/authors/author-does-not-exist');
        assert.equal(response.status, 404);

        const body = await readJson(response);
        assert.equal(body.error, 'Author not found');
    });

    test('lists volumes in descending order with view counters', async () => {
        const response = await harness.request('/api/volumes');
        assert.equal(response.status, 200);

        const volumes = await readJson(response);
        assert.ok(volumes.length > 0);

        const sorted = [...volumes].sort((a, b) => b.vol.localeCompare(a.vol));
        assert.deepEqual(volumes, sorted);
        volumes.forEach(volume => {
            assert.equal(typeof volume.vol, 'string');
            assert.equal(typeof volume.date, 'string');
            assert.equal(typeof volume.views, 'number');
        });
    });

    test('lists contribution folders for a volume without leaking markdown internals', async () => {
        const response = await harness.request(`/api/contributions/${sampleVolume}`);
        assert.equal(response.status, 200);

        const contributions = await readJson(response);
        assert.ok(contributions.length > 0);
        contributions.forEach(folder => {
            assert.equal(typeof folder, 'string');
            assert.ok(!folder.includes('/'));
        });
    });

    test('lists best-practice folders without failing when a volume has none', async () => {
        const response = await harness.request('/api/best-practices/001');
        assert.equal(response.status, 200);

        const folders = await readJson(response);
        assert.ok(Array.isArray(folders));
    });

    test('search returns bounded structured results', async () => {
        const response = await harness.request('/api/search?q=架构&limit=3');
        assert.equal(response.status, 200);

        const body = await readJson(response);
        assert.equal(body.query, '架构');
        assert.ok(Array.isArray(body.results));
        assert.ok(body.results.length <= 3);
        assert.ok(body.total >= body.results.length);

        body.results.forEach(result => {
            assert.equal(typeof result.type, 'string');
            assert.equal(typeof result.vol, 'string');
            assert.equal(typeof result.title, 'string');
        });
    });

    test('search includes best-practice content in all-articles results', async () => {
        const response = await harness.request('/api/search?q=Code%20Review&limit=10');
        assert.equal(response.status, 200);

        const body = await readJson(response);
        assert.ok(
            body.results.some(result => result.type === 'best-practice'),
            'expected search results to include best-practice entries'
        );
    });

    test('increments views and reflects the new value via both endpoints', async () => {
        const beforeResponse = await harness.request(`/api/views/${sampleVolume}`);
        const beforeBody = await readJson(beforeResponse);

        const updateResponse = await harness.request(`/api/views/${sampleVolume}`, { method: 'POST' });
        assert.equal(updateResponse.status, 200);
        const updatedBody = await readJson(updateResponse);
        assert.equal(updatedBody.views, beforeBody.views + 1);

        const volumesResponse = await harness.request('/api/volumes');
        const volumes = await readJson(volumesResponse);
        const updatedVolume = volumes.find(volume => volume.vol === sampleVolume);
        assert.ok(updatedVolume);
        assert.equal(updatedVolume.views, updatedBody.views);
    });

    test('refreshes stats after likes and views change', async () => {
        const isolatedHarness = await createServerHarness();

        try {
            const sample = await findContributionSample(isolatedHarness);
            assert.ok(sample);

            const beforeStats = await readJson(await isolatedHarness.request('/api/stats'));

            const viewResponse = await isolatedHarness.request(`/api/views/${sample.vol}`, { method: 'POST' });
            assert.equal(viewResponse.status, 200);

            const likeResponse = await isolatedHarness.request(`/api/likes/${sample.articleId}`, { method: 'POST' });
            assert.equal(likeResponse.status, 200);
            const likeBody = await readJson(likeResponse);
            assert.equal(likeBody.userLiked, true);

            const afterStats = await readJson(await isolatedHarness.request('/api/stats'));
            assert.equal(afterStats.totalViews, beforeStats.totalViews + 1);
            assert.equal(afterStats.totalLikes, beforeStats.totalLikes + 1);
        } finally {
            await isolatedHarness.cleanup();
        }
    });

    test('toggles article likes and keeps user state in sync', async () => {
        const likesBeforeResponse = await harness.request('/api/likes');
        const likesBefore = await readJson(likesBeforeResponse);
        const initialLikes = likesBefore[sampleArticleId] || 0;

        const likeResponse = await harness.request(`/api/likes/${sampleArticleId}`, { method: 'POST' });
        assert.equal(likeResponse.status, 200);
        const likedBody = await readJson(likeResponse);
        assert.equal(likedBody.articleId, sampleArticleId);
        assert.equal(likedBody.likes, initialLikes + 1);
        assert.equal(likedBody.userLiked, true);

        const userLikesResponse = await harness.request('/api/user-likes');
        const userLikesBody = await readJson(userLikesResponse);
        assert.ok(userLikesBody.likedArticles.includes(sampleArticleId));

        const unlikeResponse = await harness.request(`/api/likes/${sampleArticleId}`, { method: 'POST' });
        assert.equal(unlikeResponse.status, 200);
        const unlikedBody = await readJson(unlikeResponse);
        assert.equal(unlikedBody.likes, initialLikes);
        assert.equal(unlikedBody.userLiked, false);
    });

    test('does not record likes for draft-only articles through the published endpoint', async () => {
        const sandbox = await createContentsSandbox();
        let isolatedHarness;

        try {
            const draftArticleDir = path.join(
                sandbox.contentsDir,
                'draft',
                'vol-999',
                'contributions',
                'draft-only'
            );
            await fs.mkdir(draftArticleDir, { recursive: true });
            await fs.writeFile(
                path.join(sandbox.contentsDir, 'draft', 'vol-999', 'radar.md'),
                '---\nvol: "999"\ndate: "2099.01.01"\n---\n',
                'utf8'
            );
            await fs.writeFile(
                path.join(draftArticleDir, 'index.md'),
                '---\nauthor_id: "huyusong"\ntitle: "Draft Only"\ndescription: "Draft only article"\n---\nbody\n',
                'utf8'
            );

            isolatedHarness = await createServerHarness({
                contentsDir: sandbox.contentsDir,
                sandboxRoot: sandbox.sandboxRoot
            });

            const likeResponse = await isolatedHarness.request('/api/likes/999-draft-only', { method: 'POST' });
            assert.equal(likeResponse.status, 404);

            const likes = await readJson(await isolatedHarness.request('/api/likes'));
            assert.equal(likes['999-draft-only'], undefined);
        } finally {
            if (isolatedHarness) {
                await isolatedHarness.cleanup();
            } else {
                await fs.rm(sandbox.sandboxRoot, { recursive: true, force: true });
            }
        }
    });

    test('ignores spoofed forwarding headers when trust proxy is disabled', async () => {
        const isolatedHarness = await createServerHarness();

        try {
            const sample = await findContributionSample(isolatedHarness);
            assert.ok(sample);

            const firstLike = await readJson(await isolatedHarness.request(`/api/likes/${sample.articleId}`, {
                method: 'POST',
                headers: { 'x-forwarded-for': '1.1.1.1' }
            }));
            assert.equal(firstLike.userLiked, true);
            assert.equal(firstLike.likes, 1);

            const secondLike = await readJson(await isolatedHarness.request(`/api/likes/${sample.articleId}`, {
                method: 'POST',
                headers: { 'x-forwarded-for': '2.2.2.2' }
            }));
            assert.equal(secondLike.userLiked, false);
            assert.equal(secondLike.likes, 0);
        } finally {
            await isolatedHarness.cleanup();
        }
    });

    test('rejects malformed article ids', async () => {
        const response = await harness.request('/api/likes/not-a-valid-article-id', { method: 'POST' });
        assert.equal(response.status, 400);

        const body = await readJson(response);
        assert.ok(body.error.includes('Invalid article ID'));
    });

    test('returns aggregate author statistics with rank metadata', async () => {
        const response = await harness.request('/api/stats');
        assert.equal(response.status, 200);

        const body = await readJson(response);
        assert.ok(Array.isArray(body.contributionRanking));
        assert.ok(Array.isArray(body.likeRanking));
        assert.equal(typeof body.totalContributions, 'number');
        assert.equal(typeof body.totalLikes, 'number');
        assert.equal(typeof body.totalViews, 'number');
        assert.equal(typeof body.totalAuthors, 'number');
        assert.equal(typeof body.totalVolumes, 'number');

        const volumes = await readJson(await harness.request('/api/volumes'));
        let contributionCount = 0;
        for (const volume of volumes) {
            const folders = await readJson(await harness.request(`/api/contributions/${volume.vol}`));
            contributionCount += folders.length;
        }

        const likes = await readJson(await harness.request('/api/likes'));
        const totalLikes = Object.values(likes).reduce((sum, value) => sum + value, 0);

        assert.equal(body.totalContributions, contributionCount);
        assert.equal(body.totalLikes, totalLikes);

        body.contributionRanking.forEach(item => {
            assert.equal(typeof item.authorId, 'string');
            assert.equal(typeof item.count, 'number');
            assert.equal(typeof item.rank, 'number');
        });
    });

    test('does not expose source files or runtime data over public routes', async () => {
        const sourceResponse = await harness.request('/server.js');
        assert.equal(sourceResponse.status, 404);

        const dataResponse = await harness.request('/contents/data/like-ips/vol-001.json');
        assert.equal(dataResponse.status, 403);

        const body = await readJson(dataResponse);
        assert.equal(body.error, 'Forbidden');
    });

    test('reports ready health state after startup', async () => {
        const response = await harness.request('/api/health');
        assert.equal(response.status, 200);

        const body = await readJson(response);
        assert.equal(body.status, 'ok');
        assert.equal(body.dataLoaded, true);
        assert.equal(typeof body.uptime, 'number');
    });
});
