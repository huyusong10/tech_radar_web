const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
const INLINE_SCRIPT = INDEX_HTML.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];

function createResponse(body, options = {}) {
    const response = {
        ok: options.ok !== false,
        status: options.status || (options.ok === false ? 500 : 200),
        async json() {
            return body;
        },
        async text() {
            return typeof body === 'string' ? body : JSON.stringify(body);
        },
        clone() {
            return createResponse(body, options);
        }
    };
    return response;
}

function createElementMock() {
    return {
        children: [],
        style: {},
        querySelectorAll() {
            return [];
        },
        appendChild(child) {
            this.children.push(child);
        },
        remove() {},
        addEventListener() {},
        set innerHTML(value) {
            this._innerHTML = String(value);
            this.firstElementChild = {
                html: this._innerHTML,
                style: {},
                remove() {}
            };
        },
        get innerHTML() {
            return this._innerHTML || '';
        },
        set textContent(value) {
            this.innerHTML = String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        },
        get textContent() {
            return this.innerHTML;
        }
    };
}

function loadFrontendContext({ pathname = '/', fetchImpl } = {}) {
    const elements = new Map();
    const context = {
        console: {
            log() {},
            warn() {},
            error() {},
            info() {},
            debug() {}
        },
        setTimeout,
        clearTimeout,
        URLSearchParams,
        fetch: fetchImpl || (async () => createResponse({})),
        window: {
            location: { pathname, search: '', origin: 'http://localhost' },
            addEventListener() {},
            history: { pushState() {} }
        },
        document: {
            addEventListener() {},
            createElement() {
                return createElementMock();
            },
            createTreeWalker() {
                return { nextNode() { return false; } };
            },
            getElementById(id) {
                if (!elements.has(id)) {
                    elements.set(id, createElementMock());
                }
                return elements.get(id);
            },
            querySelector(selector) {
                if (!elements.has(selector)) {
                    elements.set(selector, createElementMock());
                }
                return elements.get(selector);
            },
            querySelectorAll() {
                return [];
            }
        },
        marked: {
            setOptions() {},
            use() {},
            parse(markdown) {
                return markdown;
            }
        },
        hljs: {
            getLanguage() {
                return false;
            },
            highlightAuto(code) {
                return { value: code };
            },
            highlight(code) {
                return { value: code };
            }
        },
        jsyaml: {
            load() {
                return {};
            }
        },
        localStorage: {
            getItem() {},
            setItem() {}
        },
        EventSource: function EventSource() {},
        NodeFilter: { SHOW_ELEMENT: 1 },
        IntersectionObserver: function IntersectionObserver() {
            return {
                observe() {},
                disconnect() {}
            };
        }
    };

    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(INLINE_SCRIPT, context);
    context.__elements = elements;
    return context;
}

describe('Frontend contract', () => {
    test('deduplicated GET requests return independently readable responses', async () => {
        let fetchCount = 0;
        const context = loadFrontendContext({
            fetchImpl: async () => {
                fetchCount += 1;
                return createResponse({ ok: true });
            }
        });

        const [first, second] = await Promise.all([
            context.fetchDedupe('/api/config'),
            context.fetchDedupe('/api/config')
        ]);

        assert.equal(fetchCount, 1);
        assert.notEqual(first, second);
        assert.deepEqual(await first.json(), { ok: true });
        assert.deepEqual(await second.json(), { ok: true });
    });

    test('draft mode static volume fallback reads the draft archive', async () => {
        const requestedUrls = [];
        const context = loadFrontendContext({
            pathname: '/draft',
            fetchImpl: async (url) => {
                requestedUrls.push(url);
                if (url === '/api/site-config') {
                    return createResponse({
                        publishedDir: '/contents/published',
                        draftDir: '/contents/draft',
                        sharedDir: '/contents/shared',
                        assetsDir: '/contents/assets'
                    });
                }
                if (url === '/api/volumes?draft=true') {
                    return createResponse({}, { ok: false, status: 500 });
                }
                if (url === '/contents/draft/archive.json') {
                    return createResponse([{ vol: '999', date: '', views: 0 }]);
                }
                throw new Error(`Unexpected request: ${url}`);
            }
        });

        await context.loadSitePaths();
        const volumes = await context.fetchVolumes(true);

        assert.deepEqual(volumes, [{ vol: '999', date: '', views: 0 }]);
        assert.ok(requestedUrls.includes('/contents/draft/archive.json'));
        assert.ok(!requestedUrls.includes('/contents/published/archive.json'));
    });

    test('archive load-more controls do not use inline JavaScript handlers', () => {
        assert.doesNotMatch(INDEX_HTML, /onclick="loadMoreVolumes/);
    });

    test('article batch rendering isolates individual markdown failures', async () => {
        const context = loadFrontendContext({
            fetchImpl: async (url) => {
                if (url === '/api/contributions/001') {
                    return createResponse(['bad-yaml', 'good-article']);
                }
                if (url.endsWith('/bad-yaml/index.md')) {
                    return createResponse('---\nbad: yaml\n---\nBroken');
                }
                if (url.endsWith('/good-article/index.md')) {
                    return createResponse('---\ntitle: Good Article\ndescription: Kept\n---\nReadable body');
                }
                return createResponse({});
            }
        });
        context.jsyaml.load = (source) => {
            if (source.includes('bad:')) {
                throw new Error('Invalid YAML');
            }
            return { title: 'Good Article', description: 'Kept' };
        };

        await context.loadContributions('001');

        const grid = context.__elements.get('contributions-grid');
        assert.equal(grid.children.length, 1);
        assert.match(grid.children[0].html, /Good Article/);
    });
});
