const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
    RateLimiter,
    WriteQueue,
    createRateLimitConfig
} = require('../server/utils/concurrency');

const tempDirs = [];

after(async () => {
    await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

test('WriteQueue resolves superseded writes and persists the latest payload', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-radar-write-queue-'));
    tempDirs.push(tempDir);

    const targetFile = path.join(tempDir, 'views.json');
    const queue = new WriteQueue({ debounceTime: 20, maxConcurrent: 1 });

    let firstResolved = false;
    const firstWrite = queue.scheduleWrite(targetFile, { value: 1 }).then(() => {
        firstResolved = true;
    });
    const secondWrite = queue.scheduleWrite(targetFile, { value: 2 });

    await Promise.all([firstWrite, secondWrite]);

    const written = JSON.parse(await fs.readFile(targetFile, 'utf8'));
    assert.equal(firstResolved, true);
    assert.deepEqual(written, { value: 2 });
});

test('RateLimiter enforces normal limits and can be disabled for load tests', () => {
    const normalLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: {
            read: 2,
            write: 1
        }
    });

    assert.equal(normalLimiter.isAllowed('127.0.0.1', 'read'), true);
    assert.equal(normalLimiter.isAllowed('127.0.0.1', 'read'), true);
    assert.equal(normalLimiter.isAllowed('127.0.0.1', 'read'), false);

    const loadTestLimiter = new RateLimiter(createRateLimitConfig({ loadTestMode: true }));
    for (let i = 0; i < 1000; i += 1) {
        assert.equal(loadTestLimiter.isAllowed('127.0.0.1', 'read'), true);
        assert.equal(loadTestLimiter.isAllowed('127.0.0.1', 'write'), true);
    }
});
