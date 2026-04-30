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

function deleteRequest(cookie) {
    return {
        method: 'DELETE',
        headers: {
            ...(cookie ? { Cookie: cookie } : {})
        }
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

function submissionPayload(uniqueText = 'initial version') {
    return {
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
title: "Contract Submission"
description: "Submission through the new manuscript workflow"
---

# Contract Submission

${uniqueText}
`
            },
            {
                path: 'diagram.png',
                type: 'base64',
                content: Buffer.from('fake-image-bytes').toString('base64')
            }
        ]
    };
}

async function createUser(harness, cookie, username, role, password = `${username}-secret`) {
    const response = await harness.request('/api/admin/users', jsonRequest({
        user: {
            username,
            displayName: username,
            role,
            password
        }
    }, cookie));
    assert.equal(response.status, 201);
    return { username, password };
}

describe('Admin contract', () => {
    test('keeps private admin data protected and retires direct draft publishing', async () => {
        const harness = await createServerHarness({
            env: adminEnv('chief', 'chief_editor')
        });

        try {
            const adminPage = await harness.request('/admin');
            assert.equal(adminPage.status, 200);

            const submitPage = await harness.request('/submit');
            assert.equal(submitPage.status, 200);

            const apiResponse = await harness.request('/api/admin/submissions');
            assert.equal(apiResponse.status, 401);

            const staticResponse = await harness.request('/contents/admin/users.json');
            assert.equal(staticResponse.status, 403);
            assert.equal((await readJson(staticResponse)).error, 'Forbidden');

            const { cookie } = await login(harness, 'chief');
            const retiredPublish = await harness.request(
                '/api/admin/drafts/20260427010101-old-flow/publish',
                jsonRequest({}, cookie)
            );
            assert.equal(retiredPublish.status, 410);

            const retiredDraftWrites = [
                ['/api/admin/drafts/import', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow', putJsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow', deleteRequest(cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/accept', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/assign', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/status-link', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/reject', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/review-request', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/review', jsonRequest({}, cookie)],
                ['/api/admin/drafts/20260427010101-old-flow/publish-check', jsonRequest({}, cookie)]
            ];

            for (const [url, init] of retiredDraftWrites) {
                const response = await harness.request(url, init);
                assert.equal(response.status, 410, `${url} should be retired`);
            }
        } finally {
            await harness.cleanup();
        }
    });

    test('migrates legacy admin drafts into the manuscript pool without writing the old model', async () => {
        const sandbox = await createContentsSandbox();
        const draftId = '20260427010101-review-seeded';
        const draftDir = path.join(sandbox.contentsDir, 'admin', 'drafts', draftId);
        const reviewsDir = path.join(sandbox.contentsDir, 'admin', 'reviews');
        await fs.mkdir(draftDir, { recursive: true });
        await fs.mkdir(reviewsDir, { recursive: true });
        await fs.writeFile(
            path.join(draftDir, 'index.md'),
            `---
title: "Legacy Draft"
description: "Seeded legacy draft"
author_id: "huyusong"
---

# Legacy Draft
`,
            'utf8'
        );
        await fs.writeFile(
            path.join(draftDir, 'meta.json'),
            JSON.stringify({
                draftId,
                status: 'approved',
                targetVol: '003',
                folderName: 'legacy-draft',
                createdBy: 'editor',
                updatedBy: 'editor',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, null, 2),
            'utf8'
        );
        await fs.writeFile(path.join(reviewsDir, `${draftId}.json`), JSON.stringify({
            draftId,
            history: [{ action: 'approve', actor: 'reviewer' }]
        }), 'utf8');

        const harness = await createServerHarness({
            contentsDir: sandbox.contentsDir,
            sandboxRoot: sandbox.sandboxRoot,
            env: adminEnv('chief', 'chief_editor')
        });

        try {
            const { cookie } = await login(harness, 'chief');
            const manuscripts = await readJson(await harness.request('/api/admin/manuscripts', {
                headers: { Cookie: cookie }
            }));
            const migrated = manuscripts.manuscripts.find(item => item.manuscriptId === draftId);
            assert.ok(migrated);
            assert.equal(migrated.status, 'available');

            const review = await readJson(await harness.request(`/api/admin/manuscripts/${draftId}`, {
                headers: { Cookie: cookie }
            }));
            assert.equal(review.review.history[0].action, 'approve');
        } finally {
            await harness.cleanup();
        }
    });

    test('closes the submission to manuscript to issue draft to publication lifecycle', async () => {
        const harness = await createServerHarness({
            env: adminEnv('chief', 'chief_editor')
        });

        try {
            const submissionResponse = await harness.request('/api/submissions', jsonRequest(submissionPayload('initial version')));
            assert.equal(submissionResponse.status, 201);
            const submission = await readJson(submissionResponse);
            assert.ok(submission.accessToken);

            const submissionDir = path.join(harness.contentsDir, 'admin', 'submissions', submission.submissionId);
            assert.ok(await fs.stat(submissionDir));
            await assert.rejects(
                fs.stat(path.join(harness.contentsDir, 'admin', 'drafts', submission.submissionId)),
                /ENOENT/
            );

            const { cookie: chiefCookie } = await login(harness, 'chief');
            await createUser(harness, chiefCookie, 'flow_editor', 'editor', 'flow-editor-secret');
            await createUser(harness, chiefCookie, 'flow_reviewer', 'tech_reviewer', 'flow-reviewer-secret');

            const { cookie: editorCookie } = await login(harness, 'flow_editor', 'flow-editor-secret');
            const returnResponse = await harness.request(
                `/api/admin/submissions/${submission.submissionId}/request-changes`,
                jsonRequest({ comment: 'Please expand the example', visibility: 'public' }, editorCookie)
            );
            assert.equal(returnResponse.status, 410);
            const rejectResponse = await harness.request(
                `/api/admin/submissions/${submission.submissionId}/reject`,
                jsonRequest({ comment: 'No longer used' }, editorCookie)
            );
            assert.equal(rejectResponse.status, 410);

            const returnedStatus = await readJson(await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`
            ));
            assert.equal(returnedStatus.status, 'submitted');
            assert.deepEqual(returnedStatus.review.history, []);

            const revisedMarkdown = returnedStatus.indexContent.replace('initial version', 'expanded version');
            const revisionResponse = await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`,
                putJsonRequest({
                    files: [{ path: 'index.md', type: 'text', content: revisedMarkdown }],
                    replaceFiles: true
                })
            );
            assert.equal(revisionResponse.status, 200);
            const revised = await readJson(revisionResponse);
            assert.equal(revised.status, 'submitted');
            assert.equal(revised.revision, 2);

            const removableResponse = await harness.request('/api/submissions', jsonRequest(submissionPayload('remove me from queue')));
            assert.equal(removableResponse.status, 201);
            const removableSubmission = await readJson(removableResponse);
            const removeResponse = await harness.request(
                `/api/admin/submissions/${removableSubmission.submissionId}/remove`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(removeResponse.status, 200);
            let submissionQueue = await readJson(await harness.request('/api/admin/submissions', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(!submissionQueue.submissions.some(item => item.submissionId === removableSubmission.submissionId));
            const removedStatus = await readJson(await harness.request(
                `/api/submissions/${removableSubmission.submissionId}?token=${removableSubmission.accessToken}`
            ));
            const resubmitRemovedResponse = await harness.request(
                `/api/submissions/${removableSubmission.submissionId}?token=${removableSubmission.accessToken}`,
                putJsonRequest({
                    files: [{ path: 'index.md', type: 'text', content: removedStatus.indexContent.replace('remove me from queue', 'returned to queue') }],
                    replaceFiles: true
                })
            );
            assert.equal(resubmitRemovedResponse.status, 200);
            submissionQueue = await readJson(await harness.request('/api/admin/submissions', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(submissionQueue.submissions.some(item => item.submissionId === removableSubmission.submissionId));

            const acceptResponse = await harness.request(
                `/api/admin/submissions/${submission.submissionId}/accept`,
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
                }, editorCookie)
            );
            assert.equal(acceptResponse.status, 201);
            const manuscript = await readJson(acceptResponse);
            const manuscriptId = manuscript.meta.manuscriptId;
            assert.equal(manuscript.meta.status, 'available');
            assert.equal(manuscript.meta.sourceSubmissionId, submission.submissionId);
            assert.doesNotMatch(manuscript.indexContent, /\nauthor:\n/);
            assert.match(manuscript.indexContent, /author_id: first_submitter_author/);
            submissionQueue = await readJson(await harness.request('/api/admin/submissions', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(!submissionQueue.submissions.some(item => item.submissionId === submission.submissionId));

            const acceptedStatus = await readJson(await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`
            ));
            assert.equal(acceptedStatus.status, 'accepted');
            assert.equal(acceptedStatus.manuscriptId, manuscriptId);
            const acceptedRevisionAttempt = await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`,
                putJsonRequest({
                    files: [{ path: 'index.md', type: 'text', content: revisedMarkdown }],
                    replaceFiles: true
                })
            );
            assert.equal(acceptedRevisionAttempt.status, 400);

            const { cookie: reviewerCookie } = await login(harness, 'flow_reviewer', 'flow-reviewer-secret');
            const editorPublish = await harness.request(
                `/api/admin/issue-drafts/${manuscriptId}/publish`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(editorPublish.status, 403);

            const reviewerMutation = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}`,
                putJsonRequest({ assignee: 'reviewer' }, reviewerCookie)
            );
            assert.equal(reviewerMutation.status, 403);
            const retiredDirectEdit = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}`,
                putJsonRequest({ assignee: 'editor' }, editorCookie)
            );
            assert.equal(retiredDirectEdit.status, 410);

            const reviewResponse = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/review`,
                jsonRequest({ action: 'approve', comment: 'Looks good', visibility: 'internal' }, reviewerCookie)
            );
            assert.equal(reviewResponse.status, 410);

            const manuscriptListResponse = await harness.request('/api/admin/manuscripts', {
                headers: { Cookie: editorCookie }
            });
            assert.equal(manuscriptListResponse.status, 200);
            const manuscriptList = await readJson(manuscriptListResponse);
            assert.equal(manuscriptList.pagination.scope, 'all');
            assert.equal(manuscriptList.pagination.pageSize, 50);
            assert.ok(manuscriptList.counts.candidate >= 1);
            const listedManuscript = manuscriptList.manuscripts.find(item => item.manuscriptId === manuscriptId);
            assert.equal(listedManuscript.title, 'Contract Submission');
            assert.deepEqual(listedManuscript.authorIds, ['first_submitter_author']);
            assert.equal(listedManuscript.lifecycle.usageStatus, 'unassigned');
            assert.equal(listedManuscript.lifecycle.canJoinIssue, true);
            const candidateManuscripts = await readJson(await harness.request('/api/admin/manuscripts?scope=candidate&pageSize=1', {
                headers: { Cookie: editorCookie }
            }));
            assert.equal(candidateManuscripts.pagination.scope, 'candidate');
            assert.equal(candidateManuscripts.pagination.pageSize, 1);
            assert.ok(candidateManuscripts.pagination.total >= 1);
            assert.ok(candidateManuscripts.manuscripts.every(item => item.lifecycle.usageStatus === 'unassigned'));

            const editLinkResponse = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/edit-link`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(editLinkResponse.status, 200);
            const editLink = await readJson(editLinkResponse);
            assert.ok(editLink.accessToken);
            assert.equal(editLink.manuscript.meta.editStatus, 'editing');
            const editingManuscripts = await readJson(await harness.request('/api/admin/manuscripts?scope=editing', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(editingManuscripts.manuscripts.some(item => item.manuscriptId === manuscriptId));
            const editPage = await readJson(await harness.request(
                `/api/manuscript-edits/${manuscriptId}?token=${editLink.accessToken}`
            ));
            assert.equal(editPage.editStatus, 'editing');
            assert.match(editPage.indexContent, /expanded version/);
            const sourceArchiveResponse = await harness.request(
                `/api/manuscript-edits/${manuscriptId}/source.zip?token=${editLink.accessToken}`
            );
            assert.equal(sourceArchiveResponse.status, 200);
            assert.match(sourceArchiveResponse.headers.get('content-type') || '', /application\/zip/);
            const sourceArchive = Buffer.from(await sourceArchiveResponse.arrayBuffer());
            assert.match(sourceArchive.toString('utf8'), /index\.md/);
            assert.match(sourceArchive.toString('utf8'), /expanded version/);

            const firstManuscriptEdit = editPage.indexContent.replace('expanded version', 'edited in manuscript pool');
            const submitEditResponse = await harness.request(
                `/api/manuscript-edits/${manuscriptId}?token=${editLink.accessToken}`,
                putJsonRequest({ indexContent: firstManuscriptEdit })
            );
            assert.equal(submitEditResponse.status, 200);
            assert.equal((await readJson(submitEditResponse)).editStatus, 'pending_review');
            const acceptEditResponse = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/pending-edit/accept`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(acceptEditResponse.status, 200);
            const acceptedEdit = await readJson(acceptEditResponse);
            assert.equal(acceptedEdit.meta.editStatus, 'idle');
            assert.match(acceptedEdit.indexContent, /edited in manuscript pool/);

            const deletableSubmissionResponse = await harness.request('/api/submissions', jsonRequest(submissionPayload('delete me from pool')));
            assert.equal(deletableSubmissionResponse.status, 201);
            const deletableSubmission = await readJson(deletableSubmissionResponse);
            const deletableAccept = await harness.request(
                `/api/admin/submissions/${deletableSubmission.submissionId}/accept`,
                jsonRequest({
                    authorResolution: {
                        mode: 'existing',
                        authorId: 'first_submitter_author'
                    }
                }, editorCookie)
            );
            assert.equal(deletableAccept.status, 201);
            const deletableManuscript = await readJson(deletableAccept);
            const deletableManuscriptId = deletableManuscript.meta.manuscriptId;
            const editingDeletableLink = await harness.request(
                `/api/admin/manuscripts/${deletableManuscriptId}/edit-link`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(editingDeletableLink.status, 200);
            const archiveEditing = await harness.request(
                `/api/admin/manuscripts/${deletableManuscriptId}/archive`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(archiveEditing.status, 409);
            const discardDeletableEdit = await harness.request(
                `/api/admin/manuscripts/${deletableManuscriptId}/pending-edit/discard`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(discardDeletableEdit.status, 200);
            const archiveAvailable = await harness.request(
                `/api/admin/manuscripts/${deletableManuscriptId}/archive`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(archiveAvailable.status, 200);
            const archivedList = await readJson(await harness.request('/api/admin/manuscripts?scope=archived', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(archivedList.manuscripts.some(item => item.manuscriptId === deletableManuscriptId));
            const candidateAfterArchive = await readJson(await harness.request('/api/admin/manuscripts?scope=candidate', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(!candidateAfterArchive.manuscripts.some(item => item.manuscriptId === deletableManuscriptId));
            const restoreArchived = await harness.request(
                `/api/admin/manuscripts/${deletableManuscriptId}/restore`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(restoreArchived.status, 200);
            const candidateAfterRestore = await readJson(await harness.request('/api/admin/manuscripts?scope=candidate', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(candidateAfterRestore.manuscripts.some(item => item.manuscriptId === deletableManuscriptId));
            const deleteAvailable = await harness.request(
                `/api/admin/manuscripts/${deletableManuscriptId}`,
                deleteRequest(editorCookie)
            );
            assert.equal(deleteAvailable.status, 200);
            const deletedDetail = await harness.request(`/api/admin/manuscripts/${deletableManuscriptId}`, {
                headers: { Cookie: editorCookie }
            });
            assert.equal(deletedDetail.status, 404);

            const issueResponse = await harness.request('/api/admin/issue-drafts', jsonRequest({
                vol: '777',
                title: 'Contract Issue',
                radarContent: '---\nvol: "777"\ndate: "2026.04.28"\neditors: []\n---\n\n## Radar\n'
            }, editorCookie));
            assert.equal(issueResponse.status, 201);
            const issueDraft = await readJson(issueResponse);
            const issueDraftId = issueDraft.meta.issueDraftId;

            const addResponse = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/manuscripts`,
                jsonRequest({ manuscriptId, folderName: 'contract-submission' }, editorCookie)
            );
            assert.equal(addResponse.status, 200);
            assert.equal((await readJson(addResponse)).meta.manuscripts[0].manuscriptId, manuscriptId);
            const candidateAfterSchedule = await readJson(await harness.request('/api/admin/manuscripts?scope=candidate', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(!candidateAfterSchedule.manuscripts.some(item => item.manuscriptId === manuscriptId));
            const scheduledManuscripts = await readJson(await harness.request('/api/admin/manuscripts?scope=scheduled', {
                headers: { Cookie: editorCookie }
            }));
            assert.ok(scheduledManuscripts.manuscripts.some(item => item.manuscriptId === manuscriptId));
            const archiveScheduled = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/archive`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(archiveScheduled.status, 409);

            const deleteScheduled = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}`,
                deleteRequest(editorCookie)
            );
            assert.equal(deleteScheduled.status, 409);

            let issuesResponse = await harness.request('/api/admin/issues', {
                headers: { Cookie: editorCookie }
            });
            assert.equal(issuesResponse.status, 200);
            let issues = await readJson(issuesResponse);
            let contractIssue = issues.issues.find(issue => issue.vol === '777');
            assert.ok(contractIssue);
            assert.equal(contractIssue.counts.drafts, 1);

            const secondIssueResponse = await harness.request('/api/admin/issue-drafts', jsonRequest({
                vol: '778',
                title: 'Second Contract Issue',
                radarContent: '---\nvol: "778"\ndate: "2026.04.28"\neditors: []\n---\n\n## Radar\n'
            }, editorCookie));
            assert.equal(secondIssueResponse.status, 201);
            const secondIssue = await readJson(secondIssueResponse);
            const duplicateAdd = await harness.request(
                `/api/admin/issue-drafts/${secondIssue.meta.issueDraftId}/manuscripts`,
                jsonRequest({ manuscriptId, folderName: 'contract-submission' }, editorCookie)
            );
            assert.equal(duplicateAdd.status, 400);

            const previewResponse = await harness.request(`/api/admin/issue-drafts/${issueDraftId}/preview`, {
                headers: { Cookie: editorCookie }
            });
            assert.equal(previewResponse.status, 200);
            const preview = await readJson(previewResponse);
            assert.equal(preview.manuscripts.length, 1);
            assert.match(preview.manuscripts[0].indexContent, /edited in manuscript pool/);

            const previewPageResponse = await harness.request(`/admin/issue-drafts/${issueDraftId}/preview-page`, {
                headers: { Cookie: editorCookie }
            });
            assert.equal(previewPageResponse.status, 200);
            assert.match(await previewPageResponse.text(), /id="contributions-grid"/);

            const previewVolumeResponse = await harness.request(`/api/admin/issue-drafts/${issueDraftId}/preview-volume`, {
                headers: { Cookie: editorCookie }
            });
            assert.equal(previewVolumeResponse.status, 200);
            assert.deepEqual((await readJson(previewVolumeResponse)).map(item => item.vol), ['777']);

            const previewContributionsResponse = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/preview-contributions/777`,
                { headers: { Cookie: editorCookie } }
            );
            assert.equal(previewContributionsResponse.status, 200);
            assert.deepEqual(await readJson(previewContributionsResponse), ['contract-submission']);

            const previewRadarResponse = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/preview-content/vol-777/radar.md`,
                { headers: { Cookie: editorCookie } }
            );
            assert.equal(previewRadarResponse.status, 200);
            assert.match(await previewRadarResponse.text(), /vol: "777"/);

            const previewArticleResponse = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/preview-content/vol-777/contributions/contract-submission/index.md`,
                { headers: { Cookie: editorCookie } }
            );
            assert.equal(previewArticleResponse.status, 200);
            assert.match(await previewArticleResponse.text(), /edited in manuscript pool/);

            const requestIssueReview = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/review`,
                jsonRequest({ action: 'request_review' }, editorCookie)
            );
            assert.equal(requestIssueReview.status, 200);
            assert.equal((await readJson(requestIssueReview)).meta.status, 'issue_review_requested');

            const approveIssue = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/review`,
                jsonRequest({ action: 'approve', comment: 'Issue approved' }, reviewerCookie)
            );
            assert.equal(approveIssue.status, 200);
            assert.equal((await readJson(approveIssue)).meta.status, 'approved');

            const scheduledEditLinkResponse = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/edit-link`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(scheduledEditLinkResponse.status, 200);
            const scheduledEditLink = await readJson(scheduledEditLinkResponse);
            const scheduledEditPage = await readJson(await harness.request(
                `/api/manuscript-edits/${manuscriptId}?token=${scheduledEditLink.accessToken}`
            ));
            const scheduledEditMarkdown = scheduledEditPage.indexContent.replace('edited in manuscript pool', 'edited while scheduled');
            const scheduledSubmitEdit = await harness.request(
                `/api/manuscript-edits/${manuscriptId}?token=${scheduledEditLink.accessToken}`,
                putJsonRequest({
                    files: [{ path: 'index.md', type: 'text', content: scheduledEditMarkdown }],
                    replaceFiles: true
                })
            );
            assert.equal(scheduledSubmitEdit.status, 200);
            const scheduledAcceptEdit = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/pending-edit/accept`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(scheduledAcceptEdit.status, 200);
            assert.match((await readJson(scheduledAcceptEdit)).indexContent, /edited while scheduled/);
            const issueAfterScheduledEdit = await readJson(await harness.request(`/api/admin/issue-drafts/${issueDraftId}`, {
                headers: { Cookie: editorCookie }
            }));
            assert.equal(issueAfterScheduledEdit.meta.status, 'editing');
            assert.ok(issueAfterScheduledEdit.review.history.some(entry => entry.action === 'manuscript_edit_accepted'));

            const requestIssueReviewAgain = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/review`,
                jsonRequest({ action: 'request_review' }, editorCookie)
            );
            assert.equal(requestIssueReviewAgain.status, 200);
            const approveIssueAgain = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/review`,
                jsonRequest({ action: 'approve', comment: 'Issue re-approved' }, reviewerCookie)
            );
            assert.equal(approveIssueAgain.status, 200);
            assert.equal((await readJson(approveIssueAgain)).meta.status, 'approved');

            const publishResponse = await harness.request(
                `/api/admin/issue-drafts/${issueDraftId}/publish`,
                jsonRequest({}, chiefCookie)
            );
            assert.equal(publishResponse.status, 200);
            const published = await readJson(publishResponse);
            assert.deepEqual(published.articleIds, ['777-contract-submission']);
            const publishedManuscripts = await readJson(await harness.request('/api/admin/manuscripts?scope=published', {
                headers: { Cookie: editorCookie }
            }));
            const publishedManuscript = publishedManuscripts.manuscripts.find(item => item.manuscriptId === manuscriptId);
            assert.equal(publishedManuscript.lifecycle.usageStatus, 'published');
            assert.equal(publishedManuscript.lifecycle.publishedArticleId, '777-contract-submission');
            const archivePublished = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/archive`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(archivePublished.status, 409);

            const contributions = await readJson(await harness.request('/api/contributions/777'));
            assert.ok(contributions.includes('contract-submission'));

            issuesResponse = await harness.request('/api/admin/issues', {
                headers: { Cookie: editorCookie }
            });
            issues = await readJson(issuesResponse);
            contractIssue = issues.issues.find(issue => issue.vol === '777');
            assert.ok(contractIssue.publishedArticles.some(article => article.articleId === '777-contract-submission'));

            const publishedStatus = await readJson(await harness.request(
                `/api/submissions/${submission.submissionId}?token=${submission.accessToken}`
            ));
            assert.equal(publishedStatus.status, 'published');
            assert.equal(publishedStatus.publishedArticleId, '777-contract-submission');

            const publishedDetail = await readJson(await harness.request('/api/admin/published/777-contract-submission', {
                headers: { Cookie: editorCookie }
            }));
            assert.match(publishedDetail.indexContent, /edited while scheduled/);

            const publishedEditLinkResponse = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/edit-link`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(publishedEditLinkResponse.status, 200);
            const publishedEditLink = await readJson(publishedEditLinkResponse);
            const publishedEditPage = await readJson(await harness.request(
                `/api/manuscript-edits/${manuscriptId}?token=${publishedEditLink.accessToken}`
            ));
            const publishedEditMarkdown = publishedEditPage.indexContent.replace('edited while scheduled', 'edited after publication through manuscript link');
            const publishedSubmitEdit = await harness.request(
                `/api/manuscript-edits/${manuscriptId}?token=${publishedEditLink.accessToken}`,
                putJsonRequest({
                    files: [{ path: 'index.md', type: 'text', content: publishedEditMarkdown }],
                    replaceFiles: true
                })
            );
            assert.equal(publishedSubmitEdit.status, 200);
            const publishedAcceptEdit = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}/pending-edit/accept`,
                jsonRequest({}, editorCookie)
            );
            assert.equal(publishedAcceptEdit.status, 200);
            assert.match((await readJson(publishedAcceptEdit)).indexContent, /edited after publication through manuscript link/);
            const publishedAfterManuscriptEdit = await readJson(await harness.request('/api/admin/published/777-contract-submission', {
                headers: { Cookie: editorCookie }
            }));
            assert.match(publishedAfterManuscriptEdit.indexContent, /edited after publication through manuscript link/);

            const editedMarkdown = publishedAfterManuscriptEdit.indexContent.replace('edited after publication through manuscript link', 'expanded version after publication');
            const editResponse = await harness.request(
                '/api/admin/published/777-contract-submission',
                putJsonRequest({ indexContent: editedMarkdown }, editorCookie)
            );
            assert.equal(editResponse.status, 200);

            const deletePublished = await harness.request(
                `/api/admin/manuscripts/${manuscriptId}`,
                deleteRequest(editorCookie)
            );
            assert.equal(deletePublished.status, 409);

            const unpublishResponse = await harness.request(
                '/api/admin/published/777-contract-submission/unpublish',
                jsonRequest({}, editorCookie)
            );
            assert.equal(unpublishResponse.status, 200);
            const afterUnpublish = await readJson(await harness.request('/api/contributions/777'));
            assert.ok(!afterUnpublish.includes('contract-submission'));
            issuesResponse = await harness.request('/api/admin/issues', {
                headers: { Cookie: editorCookie }
            });
            issues = await readJson(issuesResponse);
            contractIssue = issues.issues.find(issue => issue.vol === '777');
            assert.ok(contractIssue.unpublishedArticles.some(article => article.articleId === '777-contract-submission'));

            const restoreResponse = await harness.request(
                '/api/admin/unpublished/777-contract-submission/restore',
                jsonRequest({}, editorCookie)
            );
            assert.equal(restoreResponse.status, 200);
            const afterRestore = await readJson(await harness.request('/api/contributions/777'));
            assert.ok(afterRestore.includes('contract-submission'));

            const disableResponse = await harness.request(
                '/api/admin/users/flow_reviewer/disable',
                jsonRequest({}, chiefCookie)
            );
            assert.equal(disableResponse.status, 200);
            const disabledLogin = await harness.request('/api/admin/login', jsonRequest({
                username: 'flow_reviewer',
                password: 'flow-reviewer-secret'
            }));
            assert.equal(disabledLogin.status, 401);

            const auditResponse = await harness.request('/api/admin/audit-log', {
                headers: { Cookie: chiefCookie }
            });
            assert.equal(auditResponse.status, 200);
            const audit = await readJson(auditResponse);
            assert.ok(audit.entries.some(entry => entry.action === 'create_submission'));
            assert.ok(audit.entries.some(entry => entry.action === 'remove_submission_from_queue'));
            assert.ok(audit.entries.some(entry => entry.action === 'accept_submission'));
            assert.ok(audit.entries.some(entry => entry.action === 'schedule_manuscript'));
            assert.ok(audit.entries.some(entry => entry.action === 'issue_draft_approve'));
            assert.ok(audit.entries.some(entry => entry.action === 'publish_issue_draft'));
            assert.ok(audit.entries.some(entry => entry.action === 'update_published'));
            assert.ok(audit.entries.some(entry => entry.action === 'unpublish_article'));
            assert.ok(audit.entries.some(entry => entry.action === 'restore_article'));
            assert.ok(audit.entries.some(entry => entry.action === 'disable_admin_user'));
        } finally {
            await harness.cleanup();
        }
    });
});
