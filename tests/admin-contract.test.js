const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createContentsSandbox, createServerHarness, readJson } = require('./helpers/server-harness');

const ADMIN_PASSWORD = 'admin-contract-secret';

function adminEnv(username, role) {
    return {
        ADMIN_BOOTSTRAP_USERNAME: username,
        ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
        ADMIN_BOOTSTRAP_DISPLAY_NAME: username,
        ADMIN_BOOTSTRAP_ROLE: role
    };
}

function jsonRequest(body, cookie) {
    return {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {})
        },
        body: JSON.stringify(body)
    };
}

function putJsonRequest(body, cookie) {
    return {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {})
        },
        body: JSON.stringify(body)
    };
}

async function login(harness, username, password = ADMIN_PASSWORD) {
    const response = await harness.request('/api/admin/login', jsonRequest({
        username,
        password
    }));
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'expected admin session cookie');
    return { cookie, body: await readJson(response) };
}

function draftMarkdown(authorFrontmatter = `author:
  name: "Temporary Author"
  team: "Platform Team"
  role: "Engineer"
  avatar: ""`) {
    return `---
title: "Admin Contract Draft"
description: "Draft imported through admin"
${authorFrontmatter}
---

# Imported Draft

This draft keeps the reader contract intact.
`;
}

function importPayload(folderName = 'admin-contract-draft') {
    return {
        targetVol: '003',
        folderName,
        files: [
            {
                path: 'index.md',
                type: 'text',
                content: draftMarkdown()
            }
        ]
    };
}

function submissionPayload(folderName = 'first-submission') {
    return {
        targetVol: '003',
        folderName,
        submitter: {
            name: 'First Submitter',
            team: 'Platform Team',
            role: 'Engineer',
            contact: 'first.submitter@example.test'
        },
        files: [
            {
                path: 'index.md',
                type: 'text',
                content: `---
title: "First Submission"
description: "Submission through token flow"
---

# First Submission

Initial version.
`
            }
        ]
    };
}

describe('Admin contract', () => {
    test('keeps private admin data protected behind session-gated APIs', async () => {
        const harness = await createServerHarness({
            env: adminEnv('chief', 'chief_editor')
        });

        try {
            const adminPage = await harness.request('/admin');
            assert.equal(adminPage.status, 200);
            assert.match(await adminPage.text(), /Tech Radar Admin/);

            const submitPage = await harness.request('/submit');
            assert.equal(submitPage.status, 200);
            assert.match(await submitPage.text(), /Tech Radar Submit/);

            const apiResponse = await harness.request('/api/admin/drafts');
            assert.equal(apiResponse.status, 401);

            const staticResponse = await harness.request('/contents/admin/users.json');
            assert.equal(staticResponse.status, 403);
            assert.equal((await readJson(staticResponse)).error, 'Forbidden');
        } finally {
            await harness.cleanup();
        }
    });

    test('allows editors to import and preview drafts without publishing permission', async () => {
        const harness = await createServerHarness({
            env: adminEnv('editor', 'editor')
        });

        try {
            const { cookie, body } = await login(harness, 'editor');
            assert.equal(body.permissions.canImportDraft, true);
            assert.equal(body.permissions.canPublish, false);

            const importResponse = await harness.request('/api/admin/drafts/import', jsonRequest(importPayload('editor-flow'), cookie));
            assert.equal(importResponse.status, 201);
            const imported = await readJson(importResponse);
            assert.equal(imported.meta.status, 'editing');
            assert.ok(imported.files.some(file => file.path === 'index.md'));
            assert.match(imported.indexContent, /Temporary Author/);

            const lintResponse = await harness.request('/api/admin/lint', jsonRequest({}, cookie));
            assert.equal(lintResponse.status, 200);
            assert.equal((await readJson(lintResponse)).ok, true);

            const publishResponse = await harness.request(
                `/api/admin/drafts/${imported.meta.draftId}/publish`,
                jsonRequest({}, cookie)
            );
            assert.equal(publishResponse.status, 403);

            const usersResponse = await harness.request('/api/admin/users', {
                headers: { Cookie: cookie }
            });
            assert.equal(usersResponse.status, 403);
        } finally {
            await harness.cleanup();
        }
    });

    test('lets technical reviewers decide review state without author or draft mutation rights', async () => {
        const sandbox = await createContentsSandbox();
        const draftId = '20260427010101-review-seeded';
        const draftDir = path.join(sandbox.contentsDir, 'admin', 'drafts', draftId);
        const reviewsDir = path.join(sandbox.contentsDir, 'admin', 'reviews');
        await fs.mkdir(draftDir, { recursive: true });
        await fs.mkdir(reviewsDir, { recursive: true });
        await fs.writeFile(
            path.join(draftDir, 'index.md'),
            draftMarkdown('author_id: "huyusong"'),
            'utf8'
        );
        await fs.writeFile(
            path.join(draftDir, 'meta.json'),
            JSON.stringify({
                draftId,
                status: 'review_requested',
                targetVol: '003',
                folderName: 'review-seeded',
                createdBy: 'editor',
                updatedBy: 'editor',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, null, 2),
            'utf8'
        );
        await fs.writeFile(path.join(reviewsDir, `${draftId}.json`), JSON.stringify({ draftId, history: [] }), 'utf8');

        const harness = await createServerHarness({
            contentsDir: sandbox.contentsDir,
            sandboxRoot: sandbox.sandboxRoot,
            env: adminEnv('reviewer', 'tech_reviewer')
        });

        try {
            const { cookie, body } = await login(harness, 'reviewer');
            assert.equal(body.permissions.canReview, true);
            assert.equal(body.permissions.canManageAuthors, false);

            const approveResponse = await harness.request(
                `/api/admin/drafts/${draftId}/review`,
                jsonRequest({ action: 'approve', comment: 'Looks good' }, cookie)
            );
            assert.equal(approveResponse.status, 200);
            assert.equal((await readJson(approveResponse)).meta.status, 'approved');

            const authorResponse = await harness.request('/api/admin/authors', jsonRequest({
                author: { id: 'reviewer-author', name: 'Reviewer Author' }
            }, cookie));
            assert.equal(authorResponse.status, 403);

            const editResponse = await harness.request(
                `/api/admin/drafts/${draftId}`,
                putJsonRequest({ folderName: 'reviewer-edit' }, cookie)
            );
            assert.equal(editResponse.status, 403);
        } finally {
            await harness.cleanup();
        }
    });

    test('lets chief editors normalize temporary authors and publish approved drafts', async () => {
        const harness = await createServerHarness({
            env: adminEnv('chief', 'chief_editor')
        });

        try {
            const { cookie, body } = await login(harness, 'chief');
            assert.equal(body.permissions.canPublish, true);

            const userResponse = await harness.request('/api/admin/users', jsonRequest({
                user: {
                    username: 'desk_editor',
                    displayName: 'Desk Editor',
                    role: 'editor',
                    password: 'desk-editor-secret'
                }
            }, cookie));
            assert.equal(userResponse.status, 201);
            assert.equal((await readJson(userResponse)).user.role, 'editor');

            const volumeResponse = await harness.request('/api/admin/volumes', jsonRequest({
                vol: '004',
                radarContent: '---\nvol: "004"\ndate: "2026.04.27"\neditors: []\n---\n\n## Trending\n'
            }, cookie));
            assert.equal(volumeResponse.status, 201);
            assert.equal((await readJson(volumeResponse)).vol, '004');

            const importResponse = await harness.request('/api/admin/drafts/import', jsonRequest(importPayload('chief-flow'), cookie));
            assert.equal(importResponse.status, 201);
            const imported = await readJson(importResponse);
            const draftId = imported.meta.draftId;

            const reviewRequestResponse = await harness.request(
                `/api/admin/drafts/${draftId}/review-request`,
                jsonRequest({}, cookie)
            );
            assert.equal(reviewRequestResponse.status, 200);
            assert.equal((await readJson(reviewRequestResponse)).meta.status, 'review_requested');

            const approveResponse = await harness.request(
                `/api/admin/drafts/${draftId}/review`,
                jsonRequest({ action: 'approve' }, cookie)
            );
            assert.equal(approveResponse.status, 200);
            assert.equal((await readJson(approveResponse)).meta.status, 'approved');

            const publishResponse = await harness.request(
                `/api/admin/drafts/${draftId}/publish`,
                jsonRequest({
                    authorResolution: {
                        mode: 'create',
                        author: {
                            id: 'admin_contract_author',
                            name: 'Admin Contract Author',
                            team: 'Platform Team',
                            role: 'Engineer'
                        }
                    }
                }, cookie)
            );
            assert.equal(publishResponse.status, 200);
            const published = await readJson(publishResponse);
            assert.equal(published.articleId, '003-chief-flow');

            const publishedIndexPath = path.join(
                harness.contentsDir,
                'published',
                'vol-003',
                'contributions',
                'chief-flow',
                'index.md'
            );
            const publishedIndex = await fs.readFile(publishedIndexPath, 'utf8');
            assert.match(publishedIndex, /author_id: admin_contract_author/);
            assert.doesNotMatch(publishedIndex, /\nauthor:\n/);

            const contributions = await readJson(await harness.request('/api/contributions/003'));
            assert.ok(contributions.includes('chief-flow'));

            const detail = await readJson(await harness.request(`/api/admin/drafts/${draftId}`, {
                headers: { Cookie: cookie }
            }));
            assert.equal(detail.meta.status, 'published');

            const lintResponse = await harness.request('/api/admin/lint', jsonRequest({}, cookie));
            assert.equal(lintResponse.status, 200);
            assert.equal((await readJson(lintResponse)).ok, true);
        } finally {
            await harness.cleanup();
        }
    });

    test('closes the submitter to publish to governance lifecycle', async () => {
        const harness = await createServerHarness({
            env: adminEnv('chief', 'chief_editor')
        });

        try {
            const submissionResponse = await harness.request('/api/submissions', jsonRequest(submissionPayload('submitter-flow')));
            assert.equal(submissionResponse.status, 201);
            const submission = await readJson(submissionResponse);
            assert.ok(submission.accessToken);
            assert.match(submission.statusUrl, /\/submit\?/);

            const wrongTokenResponse = await harness.request(`/api/submissions/${submission.submissionId}?token=wrong`);
            assert.equal(wrongTokenResponse.status, 403);

            const initialStatus = await readJson(await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`
            ));
            assert.equal(initialStatus.status, 'submitted');
            assert.equal(initialStatus.revision, 1);
            assert.match(initialStatus.indexContent, /author:/);

            const { cookie: chiefCookie } = await login(harness, 'chief');
            await harness.request('/api/admin/users', jsonRequest({
                user: {
                    username: 'flow_editor',
                    displayName: 'Flow Editor',
                    role: 'editor',
                    password: 'flow-editor-secret'
                }
            }, chiefCookie));
            await harness.request('/api/admin/users', jsonRequest({
                user: {
                    username: 'flow_reviewer',
                    displayName: 'Flow Reviewer',
                    role: 'tech_reviewer',
                    password: 'flow-reviewer-secret'
                }
            }, chiefCookie));

            const { cookie: editorCookie } = await login(harness, 'flow_editor', 'flow-editor-secret');
            const editorAuthorResponse = await harness.request('/api/admin/authors', jsonRequest({
                author: {
                    id: 'editor_direct_author',
                    name: 'Editor Direct Author',
                    team: 'Editorial',
                    role: 'Author'
                }
            }, editorCookie));
            assert.equal(editorAuthorResponse.status, 201);

            const acceptResponse = await harness.request(
                `/api/admin/drafts/${submission.submissionId}/accept`,
                jsonRequest({ comment: 'Accepted by editor' }, editorCookie)
            );
            assert.equal(acceptResponse.status, 200);
            assert.equal((await readJson(acceptResponse)).meta.submissionStatus, 'in_editing');

            const reviewRequestResponse = await harness.request(
                `/api/admin/drafts/${submission.submissionId}/review-request`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(reviewRequestResponse.status, 200);
            assert.equal((await readJson(reviewRequestResponse)).meta.submissionStatus, 'in_technical_review');

            const { cookie: reviewerCookie } = await login(harness, 'flow_reviewer', 'flow-reviewer-secret');
            const reviewerLintResponse = await harness.request('/api/admin/lint', jsonRequest({}, reviewerCookie));
            assert.equal(reviewerLintResponse.status, 200);
            assert.equal((await readJson(reviewerLintResponse)).ok, true);

            const changesResponse = await harness.request(
                `/api/admin/drafts/${submission.submissionId}/review`,
                jsonRequest({ action: 'request_changes', comment: 'Please expand the example' }, reviewerCookie)
            );
            assert.equal(changesResponse.status, 200);
            assert.equal((await readJson(changesResponse)).meta.submissionStatus, 'changes_requested');

            const returnedStatus = await readJson(await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`
            ));
            assert.equal(returnedStatus.status, 'changes_requested');
            assert.ok(returnedStatus.review.history.some(entry => entry.comment === 'Please expand the example'));

            const revisedMarkdown = returnedStatus.indexContent.replace('Initial version.', 'Initial version.\n\nExpanded example.');
            const revisionResponse = await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`,
                putJsonRequest({
                    files: [{ path: 'index.md', type: 'text', content: revisedMarkdown }]
                })
            );
            assert.equal(revisionResponse.status, 200);
            const revised = await readJson(revisionResponse);
            assert.equal(revised.status, 'submitted');
            assert.equal(revised.revision, 2);

            await harness.request(
                `/api/admin/drafts/${submission.submissionId}/accept`,
                jsonRequest({}, editorCookie)
            );
            await harness.request(
                `/api/admin/drafts/${submission.submissionId}/review-request`,
                jsonRequest({}, editorCookie)
            );
            const approveResponse = await harness.request(
                `/api/admin/drafts/${submission.submissionId}/review`,
                jsonRequest({ action: 'approve', comment: 'Approved' }, reviewerCookie)
            );
            assert.equal(approveResponse.status, 200);
            assert.equal((await readJson(approveResponse)).meta.submissionStatus, 'approved');

            const publishResponse = await harness.request(
                `/api/admin/drafts/${submission.submissionId}/publish`,
                jsonRequest({
                    authorResolution: {
                        mode: 'create',
                        author: {
                            id: 'first_submitter_author',
                            name: 'First Submitter',
                            team: 'Platform Team',
                            role: 'Engineer'
                        }
                    }
                }, chiefCookie)
            );
            assert.equal(publishResponse.status, 200);
            assert.equal((await readJson(publishResponse)).articleId, '003-submitter-flow');

            const publishedStatus = await readJson(await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`
            ));
            assert.equal(publishedStatus.status, 'published');
            assert.equal(publishedStatus.publishedArticleId, '003-submitter-flow');

            let contributions = await readJson(await harness.request('/api/contributions/003'));
            assert.ok(contributions.includes('submitter-flow'));

            const publishedDetail = await readJson(await harness.request('/api/admin/published/003-submitter-flow', {
                headers: { Cookie: editorCookie }
            }));
            const editedMarkdown = publishedDetail.indexContent.replace('Expanded example.', 'Expanded example.\n\nEdited after publication.');
            const editResponse = await harness.request(
                '/api/admin/published/003-submitter-flow',
                putJsonRequest({ indexContent: editedMarkdown }, editorCookie)
            );
            assert.equal(editResponse.status, 200);
            const staticMarkdown = await (await harness.request('/contents/published/vol-003/contributions/submitter-flow/index.md')).text();
            assert.match(staticMarkdown, /Edited after publication/);

            const forbiddenUnpublish = await harness.request(
                '/api/admin/published/003-submitter-flow/unpublish',
                jsonRequest({}, editorCookie)
            );
            assert.equal(forbiddenUnpublish.status, 403);

            const unpublishResponse = await harness.request(
                '/api/admin/published/003-submitter-flow/unpublish',
                jsonRequest({}, chiefCookie)
            );
            assert.equal(unpublishResponse.status, 200);
            contributions = await readJson(await harness.request('/api/contributions/003'));
            assert.ok(!contributions.includes('submitter-flow'));

            const restoreResponse = await harness.request(
                '/api/admin/unpublished/003-submitter-flow/restore',
                jsonRequest({}, chiefCookie)
            );
            assert.equal(restoreResponse.status, 200);
            contributions = await readJson(await harness.request('/api/contributions/003'));
            assert.ok(contributions.includes('submitter-flow'));

            const disableResponse = await harness.request(
                '/api/admin/users/flow_reviewer/disable',
                jsonRequest({}, chiefCookie)
            );
            assert.equal(disableResponse.status, 200);
            const disabledLoginResponse = await harness.request('/api/admin/login', jsonRequest({
                username: 'flow_reviewer',
                password: 'flow-reviewer-secret'
            }));
            assert.equal(disabledLoginResponse.status, 401);

            const auditResponse = await harness.request('/api/admin/audit-log', {
                headers: { Cookie: chiefCookie }
            });
            assert.equal(auditResponse.status, 200);
            const audit = await readJson(auditResponse);
            assert.ok(audit.entries.some(entry => entry.action === 'create_submission'));
            assert.ok(audit.entries.some(entry => entry.action === 'unpublish_article'));
            assert.ok(audit.entries.some(entry => entry.action === 'restore_article'));
        } finally {
            await harness.cleanup();
        }
    });
});
