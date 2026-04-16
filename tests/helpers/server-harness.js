const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_CONTENTS_DIR = path.join(PROJECT_ROOT, 'contents');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : null;
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

async function createContentsSandbox() {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-radar-web-'));
    const contentsDir = path.join(sandboxRoot, 'contents');
    await fs.cp(SOURCE_CONTENTS_DIR, contentsDir, { recursive: true });

    return { sandboxRoot, contentsDir };
}

async function waitForServer(baseUrl, timeoutMs, outputBuffer) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(new URL('/api/health', baseUrl));
            if (response.ok) {
                const body = await response.json();
                if (body.status === 'ok') {
                    return;
                }
            }
        } catch {
            // Server not ready yet.
        }

        await delay(100);
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms\n${outputBuffer.join('')}`);
}

async function stopChildProcess(child) {
    if (!child || child.exitCode !== null) {
        return;
    }

    child.kill('SIGTERM');
    const exitResult = await Promise.race([
        once(child, 'exit'),
        delay(5000).then(() => null)
    ]);

    if (!exitResult && child.exitCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
    }
}

async function createServerHarness(options = {}) {
    const sandbox = options.contentsDir
        ? {
            contentsDir: options.contentsDir,
            sandboxRoot: options.sandboxRoot || path.dirname(options.contentsDir)
        }
        : await createContentsSandbox();
    const port = options.port || await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const outputBuffer = [];
    const preserveSandbox = options.preserveSandbox === true;

    const child = spawn(process.execPath, ['server.js'], {
        cwd: PROJECT_ROOT,
        env: {
            ...process.env,
            PORT: String(port),
            SITE_CONTENTS_DIR: sandbox.contentsDir,
            DISABLE_FILE_WATCHER: 'true',
            ...options.env
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', chunk => {
        outputBuffer.push(chunk.toString());
    });

    child.stderr.on('data', chunk => {
        outputBuffer.push(chunk.toString());
    });

    try {
        await waitForServer(baseUrl, options.timeoutMs || 15000, outputBuffer);
    } catch (error) {
        await stopChildProcess(child);
        await fs.rm(sandbox.sandboxRoot, { recursive: true, force: true });
        throw error;
    }

    return {
        baseUrl,
        contentsDir: sandbox.contentsDir,
        logs: outputBuffer,
        async request(pathname, init) {
            return fetch(new URL(pathname, baseUrl), init);
        },
        async readJson(relativePath) {
            const filePath = path.join(sandbox.contentsDir, relativePath);
            const raw = await fs.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        },
        async cleanup() {
            await stopChildProcess(child);
            if (!preserveSandbox) {
                await fs.rm(sandbox.sandboxRoot, { recursive: true, force: true });
            }
        }
    };
}

async function readJson(response) {
    const contentType = response.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'), `Expected JSON response but got ${contentType}`);
    return response.json();
}

module.exports = {
    createServerHarness,
    createContentsSandbox,
    readJson
};
