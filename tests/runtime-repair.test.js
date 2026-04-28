const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { repairRuntimeData } = require('../scripts/repair-runtime-data');

let tempDirs = [];

async function makeContentsDir() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tech-radar-runtime-repair-'));
    tempDirs.push(root);
    const contentsDir = path.join(root, 'contents');
    await mkdir(path.join(contentsDir, 'published', 'vol-001'), { recursive: true });
    await mkdir(path.join(contentsDir, 'data'), { recursive: true });
    await writeFile(path.join(contentsDir, 'data', 'views.json'), JSON.stringify({
        '001': 7,
        '999': 11,
        bad: -1
    }));
    await writeFile(path.join(contentsDir, 'data', 'like-records.json'), '{}');
    return contentsDir;
}

afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
});

describe('Runtime data repair', () => {
    test('reports drift without mutating data in dry-run mode', async () => {
        const contentsDir = await makeContentsDir();

        const summary = await repairRuntimeData({ contentsDir, write: false });
        const views = JSON.parse(await readFile(path.join(contentsDir, 'data', 'views.json'), 'utf8'));

        assert.equal(summary.mode, 'dry-run');
        assert.deepEqual(summary.removedViewKeys.sort(), ['999', 'bad']);
        assert.deepEqual(summary.invalidViewKeys, []);
        assert.deepEqual(summary.quarantinedFiles, [{ name: 'like-records.json' }]);
        assert.equal(views['999'], 11);
    });

    test('repairs view counters and quarantines unsupported runtime files when writing', async () => {
        const contentsDir = await makeContentsDir();

        const summary = await repairRuntimeData({ contentsDir, write: true });
        const views = JSON.parse(await readFile(path.join(contentsDir, 'data', 'views.json'), 'utf8'));
        const repairRoots = await readdir(path.join(contentsDir, 'admin', 'runtime-repair'));

        assert.equal(summary.mode, 'write');
        assert.deepEqual(views, { '001': 7 });
        assert.equal(summary.quarantinedFiles.length, 1);
        assert.match(summary.quarantinedFiles[0].movedTo, /^admin\/runtime-repair\/.+\/like-records\.json$/);
        assert.equal(repairRoots.length, 1);
    });
});
