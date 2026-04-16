const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const fs = require('node:fs/promises');

const { createContentsSandbox, createServerHarness, readJson } = require('./helpers/server-harness');

describe('Persistence contract', () => {
    let sandbox;
    let harness;

    before(async () => {
        sandbox = await createContentsSandbox();
        harness = await createServerHarness({
            contentsDir: sandbox.contentsDir,
            sandboxRoot: sandbox.sandboxRoot,
            preserveSandbox: true
        });
    });

    after(async () => {
        await harness.cleanup();
        await fs.rm(sandbox.sandboxRoot, { recursive: true, force: true });
    });

    test('persists views and likes across graceful restart', async () => {
        const volumes = await readJson(await harness.request('/api/volumes'));
        assert.ok(volumes.length > 0);
        const vol = volumes[0].vol;

        const contributions = await readJson(await harness.request(`/api/contributions/${vol}`));
        assert.ok(contributions.length > 0);
        const articleId = `${vol}-${contributions[0]}`;

        const beforeViews = await readJson(await harness.request(`/api/views/${vol}`));
        const beforeLikes = await readJson(await harness.request('/api/likes'));
        const initialLikes = beforeLikes[articleId] || 0;

        const updatedViews = await readJson(await harness.request(`/api/views/${vol}`, { method: 'POST' }));
        const updatedLikes = await readJson(await harness.request(`/api/likes/${articleId}`, { method: 'POST' }));

        assert.equal(updatedViews.views, beforeViews.views + 1);
        assert.equal(updatedLikes.likes, initialLikes + 1);
        assert.equal(updatedLikes.userLiked, true);

        await harness.cleanup();

        const persistedViews = await fs.readFile(`${sandbox.contentsDir}/data/views.json`, 'utf8');
        const persistedLikes = await fs.readFile(`${sandbox.contentsDir}/data/likes.json`, 'utf8');
        const persistedLikeIps = await fs.readFile(`${sandbox.contentsDir}/data/like-ips.json`, 'utf8');

        const viewsJson = JSON.parse(persistedViews);
        const likesJson = JSON.parse(persistedLikes);
        const likeIpsJson = JSON.parse(persistedLikeIps);

        assert.equal(viewsJson[vol], updatedViews.views);
        assert.equal(likesJson[articleId], updatedLikes.likes);
        assert.equal(likeIpsJson[articleId].length, updatedLikes.likes);

        harness = await createServerHarness({
            contentsDir: sandbox.contentsDir,
            sandboxRoot: sandbox.sandboxRoot,
            preserveSandbox: true
        });

        const restartedViews = await readJson(await harness.request(`/api/views/${vol}`));
        const restartedLikes = await readJson(await harness.request('/api/likes'));
        const restartedUserLikes = await readJson(await harness.request('/api/user-likes'));

        assert.equal(restartedViews.views, updatedViews.views);
        assert.equal(restartedLikes[articleId], updatedLikes.likes);
        assert.ok(restartedUserLikes.likedArticles.includes(articleId));
    });
});
