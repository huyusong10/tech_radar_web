const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
const SUBMIT_HTML = fs.readFileSync(path.join(PROJECT_ROOT, 'submit', 'index.html'), 'utf8');
const ADMIN_HTML = fs.readFileSync(path.join(PROJECT_ROOT, 'admin', 'index.html'), 'utf8');
const ADMIN_CSS = fs.readFileSync(path.join(PROJECT_ROOT, 'admin', 'admin.css'), 'utf8');
const ADMIN_API_JS = fs.readFileSync(path.join(PROJECT_ROOT, 'admin', 'js', 'api.js'), 'utf8');
const ADMIN_DRAFTS_JS = fs.readFileSync(path.join(PROJECT_ROOT, 'admin', 'js', 'drafts.js'), 'utf8');
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

    test('markdown loading coalesces duplicate in-flight requests', async () => {
        let fetchCount = 0;
        const context = loadFrontendContext({
            fetchImpl: async (url) => {
                fetchCount += 1;
                assert.equal(url, '/contents/published/vol-001/contributions/demo/index.md');
                return createResponse('---\ntitle: Demo\n---\nBody');
            }
        });

        const [first, second] = await Promise.all([
            context.loadMarkdown('/contents/published/vol-001/contributions/demo/index.md'),
            context.loadMarkdown('/contents/published/vol-001/contributions/demo/index.md')
        ]);

        assert.equal(fetchCount, 1);
        assert.equal(first, second);
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

    test('admin issue preview mode reads issue draft preview APIs', async () => {
        const requestedUrls = [];
        const issueDraftId = '20260428103000-demo-vol-004';
        const context = loadFrontendContext({
            pathname: `/admin/issue-drafts/${issueDraftId}/preview-page`,
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
                if (url === `/api/admin/issue-drafts/${issueDraftId}/preview-volume`) {
                    return createResponse([{ vol: '004', date: '', views: 0, preview: true }]);
                }
                if (url === `/api/admin/issue-drafts/${issueDraftId}/preview-contributions/004`) {
                    return createResponse(['release-automation']);
                }
                throw new Error(`Unexpected request: ${url}`);
            }
        });

        await context.loadSitePaths();
        const volumes = await context.fetchVolumes(true);
        const folders = await context.getContributionFolders('004');

        assert.deepEqual(volumes.map(item => item.vol), ['004']);
        assert.deepEqual(folders, ['release-automation']);
        assert.ok(requestedUrls.includes(`/api/admin/issue-drafts/${issueDraftId}/preview-volume`));
        assert.ok(!requestedUrls.includes('/api/volumes'));
    });

    test('reader shell exposes accessible controls for core interactions', () => {
        assert.match(INDEX_HTML, /id="stats-button"[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*aria-controls="stats-modal"/);
        assert.match(INDEX_HTML, /id="stats-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
        assert.match(INDEX_HTML, /id="stats-modal-close"[^>]*aria-label="[^"]+"/);
        assert.match(INDEX_HTML, /id="search-clear"[^>]*aria-label="[^"]+"/);
        assert.match(INDEX_HTML, /id="header-search-clear"[^>]*aria-label="[^"]+"/);
        assert.match(INDEX_HTML, /data-like-button="true"[^>]*aria-pressed="\$\{userLiked \? 'true' : 'false'\}"[^>]*aria-label="[^"]+"/);
        assert.doesNotMatch(INDEX_HTML, /closeSubmitModal/);
    });

    test('volume load contexts invalidate stale async work', () => {
        const context = loadFrontendContext();

        const first = context.startVolumeLoad('001');
        assert.equal(context.isActiveVolumeLoad(first), true);

        const second = context.startVolumeLoad('002');
        assert.equal(context.isActiveVolumeLoad(first), false);
        assert.equal(context.isActiveVolumeLoad(second), true);
    });

    test('stale search responses cannot overwrite newer query state', async () => {
        let resolveFetch;
        const context = loadFrontendContext({
            fetchImpl: async () => new Promise(resolve => {
                resolveFetch = resolve;
            })
        });
        const dropdown = createElementMock();
        dropdown.id = 'search-dropdown';
        const state = context.getSearchState(dropdown);
        state.requestId = 1;

        const searchPromise = context.performSearch('old', dropdown, state, 1);
        state.requestId = 2;
        resolveFetch(createResponse({
            results: [{ type: 'contribution', title: 'Old', vol: '001', authorIds: [] }]
        }));
        await searchPromise;

        assert.equal(dropdown.innerHTML, '');
        assert.equal(state.results.length, 0);
    });

    test('reader page exposes submission as a direct route entry', () => {
        assert.match(INDEX_HTML, /href="\/submit"/);
        assert.equal((INDEX_HTML.match(/href="\/submit"/g) || []).length, 1);
        assert.doesNotMatch(INDEX_HTML, /onclick="openSubmitModal\(\)"/);
        assert.doesNotMatch(INDEX_HTML, /id="submit-modal"/);
    });

    test('submitter page keeps publication targeting in the editor workflow', () => {
        assert.doesNotMatch(SUBMIT_HTML, /id="submit-vol"/);
        assert.doesNotMatch(SUBMIT_HTML, /id="submit-folder"/);
        assert.doesNotMatch(SUBMIT_HTML, /id="submit-editor"/);
        assert.doesNotMatch(SUBMIT_HTML, /提交初稿/);
        assert.match(SUBMIT_HTML, /id="submit-dropzone"/);
        assert.match(SUBMIT_HTML, /id="revision-dropzone"/);
        assert.match(SUBMIT_HTML, /id="source-download-link"/);
        assert.match(SUBMIT_HTML, /id="revision-editor"/);
    });

    test('admin page exposes direct workflow modules and issue-centered management', () => {
        [
            'submissions',
            'manuscripts',
            'reviews',
            'issues',
            'authors',
            'users',
            'audit'
        ].forEach(view => assert.match(ADMIN_HTML, new RegExp(`data-view="${view}"`)));

        assert.doesNotMatch(ADMIN_HTML, /data-view="governance"/);
        assert.doesNotMatch(ADMIN_HTML, /data-governance-panel=/);

        [
            'admin-issue-list',
            'issue-workspace-drafts',
            'issue-workspace-maintenance',
            'issue-workspace-settings',
            'issue-draft-list',
            'issue-available-manuscript-list',
            'published-list',
            'unpublished-list',
            'published-history-list'
        ].forEach(id => assert.match(ADMIN_HTML, new RegExp(`id="${id}"`)));

        assert.match(ADMIN_HTML, /id="view-issues"/);
    });

    test('admin page keeps stable controls for submission, manuscript and review flows', () => {
        assert.match(ADMIN_HTML, /data-view="manuscripts"/);
        assert.match(ADMIN_HTML, /data-view="reviews" data-permission="canReviewIssueDraft"/);
        assert.doesNotMatch(ADMIN_HTML, /data-view="drafts"/);
        assert.doesNotMatch(ADMIN_HTML, /data-view="publish"/);
        assert.match(ADMIN_HTML, /name="accept-author-mode"/);
        assert.doesNotMatch(ADMIN_HTML, /id="submission-comment-visibility"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-review-visibility"/);
        assert.doesNotMatch(ADMIN_HTML, /id="issue-review-visibility"/);

        [
            'submission-list',
            'submission-summary',
            'preview-submission-button',
            'accept-submission-button',
            'issue-status-link-button',
            'remove-submission-button',
            'manuscript-scope-tabs',
            'manuscript-search',
            'manuscript-list',
            'manuscript-prev-page-button',
            'manuscript-page-info',
            'manuscript-next-page-button',
            'review-issue-list',
            'review-task-detail',
            'review-task-title',
            'review-task-facts',
            'review-preview-issue-button',
            'run-lint-button',
            'manuscript-asset-title',
            'manuscript-asset-description',
            'manuscript-asset-markers',
            'manuscript-asset-actions',
            'preview-manuscript-button',
            'issue-manuscript-edit-link-button',
            'preview-manuscript-edit-button',
            'accept-manuscript-edit-button',
            'discard-manuscript-edit-button',
            'archive-manuscript-button',
            'restore-manuscript-button',
            'delete-manuscript-button',
            'manuscript-go-issues-button',
            'manuscript-open-issue-button',
            'manuscript-edit-link',
            'manuscript-info-facts',
            'manuscript-route-facts',
            'manuscript-file-list',
            'manuscript-review-history',
            'issue-flow-title',
            'issue-flow-description',
            'issue-flow-markers',
            'issue-flow-steps',
            'issue-flow-actions',
            'issue-radar',
            'issue-manual-add-panel',
            'preview-issue-button',
            'approve-issue-button',
            'changes-issue-button',
            'issue-review-history',
            'author-list',
            'published-list',
            'preview-published-button',
            'check-published-content-button',
            'volume-list',
            'user-list',
            'audit-list',
            'admin-preview-dialog',
            'admin-preview-surface'
        ].forEach(id => assert.match(ADMIN_HTML, new RegExp(`id="${id}"`)));
        assert.doesNotMatch(ADMIN_HTML, /id="return-submission-button"/);
        assert.doesNotMatch(ADMIN_HTML, /id="reject-submission-button"/);
        assert.doesNotMatch(ADMIN_HTML, /id="submission-action-comment"/);
        assert.doesNotMatch(ADMIN_HTML, /id="save-manuscript-button"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-editor"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-files-input"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-review-comment"/);
        assert.doesNotMatch(ADMIN_HTML, /id="review-manuscript-list"/);
        assert.doesNotMatch(ADMIN_HTML, /id="approve-manuscript-button"/);
        assert.doesNotMatch(ADMIN_HTML, /id="changes-manuscript-button"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-flow-steps"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-edit-link" class="[^"]*hidden/);
        assert.match(ADMIN_CSS, /\.token-box:empty::before/);
        assert.match(ADMIN_CSS, /\.manuscript-asset-actions #discard-manuscript-edit-button/);
        assert.match(ADMIN_CSS, /\.scope-tabs/);
        assert.match(ADMIN_CSS, /\.status-pill\.is-warning/);
        assert.match(ADMIN_CSS, /\.workflow-marker\.is-danger/);
        assert.match(ADMIN_DRAFTS_JS, /scope:\s*state\.manuscriptScope/);
        assert.match(ADMIN_DRAFTS_JS, /scope:\s*'candidate'/);
        assert.match(ADMIN_API_JS, /archiveManuscript/);
        assert.match(ADMIN_API_JS, /restoreManuscript/);
    });

    test('admin issue management separates draft, maintenance and review task workspaces', () => {
        const reviewView = ADMIN_HTML.match(/<section class="view" id="view-reviews"[\s\S]*?<section class="view" id="view-issues"/)[0];
        const draftWorkspace = ADMIN_HTML.match(/<section class="issue-workspace" id="issue-workspace-drafts"[\s\S]*?<section class="issue-workspace" id="issue-workspace-maintenance"/)[0];
        const maintenanceWorkspace = ADMIN_HTML.match(/<section class="issue-workspace" id="issue-workspace-maintenance"[\s\S]*?<section class="issue-workspace" id="issue-workspace-settings"/)[0];
        const settingsWorkspace = ADMIN_HTML.match(/<section class="issue-workspace" id="issue-workspace-settings"[\s\S]*?<\/section>\s*<\/section>/)[0];

        assert.match(reviewView, /id="review-issue-list"/);
        assert.match(reviewView, /id="review-preview-issue-button"/);
        assert.match(reviewView, /id="run-lint-button"/);
        assert.match(reviewView, /id="approve-issue-button"/);
        assert.match(reviewView, /id="changes-issue-button"/);
        assert.doesNotMatch(reviewView, /id="publish-issue-button"/);

        assert.match(draftWorkspace, /id="admin-issue-list"/);
        assert.match(draftWorkspace, /id="issue-draft-list"/);
        assert.match(draftWorkspace, /id="issue-available-manuscript-list"/);
        assert.match(draftWorkspace, /id="issue-manual-add-panel"/);
        assert.match(draftWorkspace, /id="request-issue-review-button"/);
        assert.match(draftWorkspace, /id="publish-issue-button"/);
        assert.doesNotMatch(draftWorkspace, /id="approve-issue-button"/);
        assert.doesNotMatch(draftWorkspace, /id="changes-issue-button"/);

        assert.match(maintenanceWorkspace, /id="published-list"/);
        assert.match(maintenanceWorkspace, /id="unpublished-list"/);
        assert.match(maintenanceWorkspace, /id="published-editor"/);
        assert.match(maintenanceWorkspace, /id="check-published-content-button"/);
        assert.match(maintenanceWorkspace, /id="check-published-content-button" data-check-scope="site"/);
        assert.doesNotMatch(maintenanceWorkspace, /id="request-issue-review-button"/);
        assert.doesNotMatch(maintenanceWorkspace, /id="approve-issue-button"/);
        assert.doesNotMatch(maintenanceWorkspace, /id="changes-issue-button"/);

        assert.match(settingsWorkspace, /id="volume-id"/);
        assert.match(settingsWorkspace, /id="volume-list"/);
        assert.match(ADMIN_DRAFTS_JS, /selectedReviewIssueDraft/);
        assert.match(ADMIN_DRAFTS_JS, /selectedReviewIssueDraftId/);
        assert.match(ADMIN_DRAFTS_JS, /issue-workspace-drafts/);
    });

    test('admin editing pages use an on-demand preview surface', () => {
        assert.match(ADMIN_CSS, /\.workflow-steps/);
        assert.doesNotMatch(ADMIN_CSS, /#draft-editor/);
        assert.doesNotMatch(ADMIN_CSS, /#manuscript-editor/);
        assert.doesNotMatch(ADMIN_HTML, /id="submission-preview"/);
        assert.doesNotMatch(ADMIN_HTML, /id="manuscript-preview"/);
        assert.doesNotMatch(ADMIN_HTML, /id="issue-preview"/);
    });

    test('admin client follows the manuscript and issue workflow instead of retired draft mutations', () => {
        assert.match(ADMIN_API_JS, /\/api\/admin\/submissions/);
        assert.match(ADMIN_API_JS, /\/api\/admin\/manuscripts/);
        assert.match(ADMIN_API_JS, /\/api\/admin\/issue-drafts/);
        assert.doesNotMatch(ADMIN_API_JS, /export function reviewManuscript\b/);
        assert.doesNotMatch(
            ADMIN_API_JS,
            /export function (listDrafts|getDraft|importDraft|updateDraft|assignDraft|issueStatusLink|deleteDraft|acceptDraft|rejectDraft|requestReview|reviewDraft|publishDraft|checkPublish)\b/
        );
        assert.doesNotMatch(ADMIN_DRAFTS_JS, /\/api\/admin\/drafts/);
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

    test('shared preview renderer does not duplicate frontmatter title by default', async () => {
        const previewSource = fs
            .readFileSync(path.join(PROJECT_ROOT, 'admin', 'js', 'preview.js'), 'utf8')
            .replace(/export function /g, 'function ');
        const context = {
            document: {
                createElement() {
                    let html = '';
                    return {
                        set innerHTML(value) {
                            html = String(value);
                        },
                        get innerHTML() {
                            return html;
                        },
                        content: {
                            querySelectorAll() {
                                return [];
                            }
                        }
                    };
                }
            },
            marked: { parse: markdown => markdown },
            jsyaml: {
                load() {
                    return { title: 'Frontmatter Title', description: 'Frontmatter Description' };
                }
            },
            globalThis: null
        };
        context.globalThis = context;
        vm.createContext(context);
        vm.runInContext(previewSource, context);

        const container = {
            innerHTML: '',
            querySelectorAll() {
                return [];
            }
        };
        context.renderPreview(container, '---\ntitle: Frontmatter Title\ndescription: Frontmatter Description\n---\n# Body Title\n\nBody');

        assert.doesNotMatch(container.innerHTML, /^# Frontmatter Title/);
        assert.match(container.innerHTML, /# Body Title/);
    });
});
