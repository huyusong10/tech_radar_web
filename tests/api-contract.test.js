const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { createServerHarness, readJson } = require('./helpers/server-harness');

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
        sampleVolume = volumes[0].vol;

        const contributionsResponse = await harness.request(`/api/contributions/${sampleVolume}`);
        const contributions = await readJson(contributionsResponse);
        assert.ok(Array.isArray(contributions) && contributions.length > 0, 'expected at least one contribution');
        sampleContribution = contributions[0];
        sampleArticleId = `${sampleVolume}-${sampleContribution}`;
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

        body.contributionRanking.forEach(item => {
            assert.equal(typeof item.authorId, 'string');
            assert.equal(typeof item.count, 'number');
            assert.equal(typeof item.rank, 'number');
        });
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
