#!/usr/bin/env node

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONTENTS_DIR = process.env.SITE_CONTENTS_DIR
    ? path.resolve(process.env.SITE_CONTENTS_DIR)
    : path.join(PROJECT_ROOT, 'contents');
const ALLOWED_DATA_FILES = new Set(['views.json', 'likes.json.migrated', 'like-ips.json.migrated']);
const ALLOWED_DATA_DIRS = new Set(['likes', 'like-ips']);

function parseArgs(argv) {
    const args = {
        contentsDir: DEFAULT_CONTENTS_DIR,
        write: false
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--write') {
            args.write = true;
        } else if (arg === '--contents-dir') {
            args.contentsDir = path.resolve(argv[i + 1] || '');
            i += 1;
        } else if (arg.startsWith('--contents-dir=')) {
            args.contentsDir = path.resolve(arg.slice('--contents-dir='.length));
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage: npm run repair:runtime -- [--contents-dir <path>] [--write]

Repairs runtime data drift:
  - removes views.json counters for volumes not present under published/
  - removes invalid view counters for published volumes
  - moves unsupported contents/data files to contents/admin/runtime-repair/

Default mode is dry-run. Use --write to apply changes.`);
}

async function listPublishedVolumes(contentsDir) {
    const publishedDir = path.join(contentsDir, 'published');
    try {
        const entries = await fsPromises.readdir(publishedDir, { withFileTypes: true });
        return new Set(entries
            .filter(entry => entry.isDirectory() && entry.name.startsWith('vol-'))
            .map(entry => entry.name.replace(/^vol-/, '')));
    } catch {
        return new Set();
    }
}

async function readJsonObject(filePath) {
    try {
        const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

async function writeJson(filePath, data) {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function moveAside(sourcePath, repairDir) {
    await fsPromises.mkdir(repairDir, { recursive: true });
    const baseName = path.basename(sourcePath);
    let targetPath = path.join(repairDir, baseName);
    let suffix = 1;
    while (fs.existsSync(targetPath)) {
        targetPath = path.join(repairDir, `${baseName}.${suffix}`);
        suffix += 1;
    }
    await fsPromises.rename(sourcePath, targetPath);
    return targetPath;
}

async function repairRuntimeData({ contentsDir, write }) {
    const dataDir = path.join(contentsDir, 'data');
    const repairDir = path.join(contentsDir, 'admin', 'runtime-repair', new Date().toISOString().replace(/[:.]/g, '-'));
    const publishedVolumes = await listPublishedVolumes(contentsDir);
    const summary = {
        mode: write ? 'write' : 'dry-run',
        contentsDir,
        removedViewKeys: [],
        invalidViewKeys: [],
        quarantinedFiles: []
    };

    const viewsPath = path.join(dataDir, 'views.json');
    if (fs.existsSync(viewsPath)) {
        const views = await readJsonObject(viewsPath);
        const repairedViews = {};
        for (const [vol, count] of Object.entries(views)) {
            if (!publishedVolumes.has(vol)) {
                summary.removedViewKeys.push(vol);
                continue;
            }
            if (!Number.isInteger(count) || count < 0) {
                summary.invalidViewKeys.push(vol);
                continue;
            }
            repairedViews[vol] = count;
        }
        if (write && (summary.removedViewKeys.length > 0 || summary.invalidViewKeys.length > 0)) {
            await writeJson(viewsPath, repairedViews);
        }
    }

    let dataEntries = [];
    try {
        dataEntries = await fsPromises.readdir(dataDir, { withFileTypes: true });
    } catch {
        dataEntries = [];
    }

    for (const entry of dataEntries) {
        const allowed = entry.isDirectory()
            ? ALLOWED_DATA_DIRS.has(entry.name)
            : ALLOWED_DATA_FILES.has(entry.name);
        if (allowed) continue;

        const sourcePath = path.join(dataDir, entry.name);
        const item = { name: entry.name };
        if (write) {
            item.movedTo = path.relative(contentsDir, await moveAside(sourcePath, repairDir)).replace(/\\/g, '/');
        }
        summary.quarantinedFiles.push(item);
    }

    return summary;
}

async function main() {
    try {
        const args = parseArgs(process.argv.slice(2));
        if (args.help) {
            printHelp();
            return;
        }

        const summary = await repairRuntimeData(args);
        console.log(JSON.stringify(summary, null, 2));
        if (!args.write) {
            console.log('Dry-run only. Re-run with --write to apply repairs.');
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    repairRuntimeData
};
