import {
    acceptDraft,
    createAdminUser,
    createVolume,
    deleteDraft,
    disableAdminUser,
    getDraft,
    getPublished,
    importDraft,
    listAdminUsers,
    listAuditLog,
    listDrafts,
    listPublished,
    listVolumes,
    publishDraft,
    requestReview,
    rejectDraft,
    reviewDraft,
    runLint,
    updateAdminUser,
    updateDraft,
    updatePublished,
    unpublishArticle,
    restoreArticle,
    updateVolumeRadar
} from './api.js';
import { bindAuth, restoreSession } from './auth.js';
import { bindAuthorPanel, fileToBase64Payload } from './authors.js';
import { applyPermissionState, ROLE_LABELS } from './permissions.js';
import {
    buildDraftAssetResolver,
    buildLocalAssetResolver,
    parseFrontmatter,
    renderPreview
} from './preview.js';

const state = {
    user: null,
    permissions: {},
    drafts: [],
    selectedDraft: null,
    published: [],
    selectedPublished: null,
    selectedImportFiles: [],
    authorPanel: null,
    previewTimer: null
};

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setStatus(id, message, type = '') {
    const element = $(id);
    element.textContent = message;
    element.classList.toggle('is-error', type === 'error');
    element.classList.toggle('is-ok', type === 'ok');
}

function selectedDraftId() {
    return state.selectedDraft?.meta?.draftId;
}

function normalizeFileSelection(fileList) {
    const files = Array.from(fileList || []);
    const rawPaths = files.map(file => file.webkitRelativePath || file.name);
    const indexPath = rawPaths.find(item => item === 'index.md' || item.endsWith('/index.md'));
    const rootPrefix = indexPath && indexPath !== 'index.md'
        ? indexPath.slice(0, -'index.md'.length)
        : '';

    return files.map((file, index) => {
        const rawPath = rawPaths[index];
        const relativePath = rootPrefix && rawPath.startsWith(rootPrefix)
            ? rawPath.slice(rootPrefix.length)
            : rawPath.split('/').pop();
        return {
            file,
            name: file.name,
            relativePath,
            size: file.size,
            objectUrl: URL.createObjectURL(file)
        };
    }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function isTextFile(path) {
    return /\.(md|txt|json|ya?ml|svg|css|js|html?)$/i.test(path);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

async function toAdminFilePayload(item) {
    if (isTextFile(item.relativePath)) {
        return {
            path: item.relativePath,
            type: 'text',
            content: await item.file.text()
        };
    }

    return {
        path: item.relativePath,
        type: 'base64',
        content: arrayBufferToBase64(await item.file.arrayBuffer())
    };
}

async function readSelectedIndexContent() {
    const index = state.selectedImportFiles.find(file => file.relativePath === 'index.md');
    return index ? index.file.text() : '';
}

function renderFileList(container, files) {
    container.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <strong>${escapeHtml(file.path || file.relativePath)}</strong>
            <small>${Number(file.size || 0).toLocaleString()} bytes</small>
        `;
        container.appendChild(item);
    });

    if (files.length === 0) {
        container.innerHTML = '<div class="file-item"><small>No files</small></div>';
    }
}

function renderDashboard() {
    const counts = state.drafts.reduce((acc, draft) => {
        acc[draft.status] = (acc[draft.status] || 0) + 1;
        return acc;
    }, {});

    $('metric-editing').textContent = counts.editing || 0;
    $('metric-review').textContent = counts.review_requested || 0;
    $('metric-approved').textContent = counts.approved || 0;
    $('metric-published').textContent = counts.published || 0;

    const recent = state.drafts.slice(0, 6);
    const recentContainer = $('dashboard-drafts');
    recentContainer.innerHTML = '';
    recent.forEach(draft => recentContainer.appendChild(createDraftItem(draft)));
    if (recent.length === 0) {
        recentContainer.innerHTML = '<div class="compact-item"><small>No drafts</small></div>';
    }

    $('dashboard-snapshot').innerHTML = [
        ['New submissions', state.drafts.filter(draft => draft.source === 'submission' && draft.submissionStatus === 'submitted').length],
        ['Ready for review', counts.review_requested || 0],
        ['Ready to publish', counts.approved || 0],
        ['Returned', counts.changes_requested || 0]
    ].map(([label, value]) => `
        <div class="compact-item">
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(label)}</small>
        </div>
    `).join('');
}

function createDraftItem(draft) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `compact-item${selectedDraftId() === draft.draftId ? ' active' : ''}`;
    item.innerHTML = `
        <span class="status-pill">${escapeHtml(draft.status)}</span>
        <strong>${escapeHtml(draft.folderName || draft.draftId)}</strong>
        <small>${escapeHtml(draft.targetVol || '-')}${draft.source ? ` · ${escapeHtml(draft.source)}` : ''}${draft.submissionStatus ? ` · ${escapeHtml(draft.submissionStatus)}` : ''}${draft.updatedAt ? ` · ${escapeHtml(draft.updatedAt)}` : ''}</small>
    `;
    item.addEventListener('click', () => selectDraft(draft.draftId));
    return item;
}

function renderDraftList() {
    const list = $('draft-list');
    list.innerHTML = '';
    state.drafts.forEach(draft => list.appendChild(createDraftItem(draft)));

    if (state.drafts.length === 0) {
        list.innerHTML = '<div class="compact-item"><small>No drafts</small></div>';
    }

    renderDashboard();
    renderSubmissionList();
}

function renderSubmissionList() {
    const list = $('submission-list');
    if (!list) return;
    list.innerHTML = '';
    const submissions = state.drafts.filter(draft => draft.source === 'submission');
    submissions.forEach(draft => list.appendChild(createDraftItem(draft)));
    if (submissions.length === 0) {
        list.innerHTML = '<div class="compact-item"><small>No submissions</small></div>';
    }
}

function renderSelectedDraft() {
    const detail = state.selectedDraft;
    const canEdit = state.permissions.canEditDraft && detail?.meta?.status !== 'published';
    $('draft-target-vol').value = detail?.meta?.targetVol || '';
    $('draft-folder-name').value = detail?.meta?.folderName || '';
    $('draft-editor').value = detail?.indexContent || '';
    $('draft-editor').disabled = !canEdit;
    $('draft-target-vol').disabled = !canEdit;
    $('draft-folder-name').disabled = !canEdit;
    renderFileList($('draft-files'), detail?.files || []);

    if (detail) {
        renderPreview($('draft-preview'), detail.indexContent, buildDraftAssetResolver(detail.files));
    } else {
        $('draft-preview').innerHTML = '';
    }

    renderReviewHistory();
    syncActionState();
}

function renderReviewHistory() {
    const history = state.selectedDraft?.review?.history || [];
    const container = $('review-history');
    container.innerHTML = '';
    history.slice().reverse().forEach(entry => {
        const item = document.createElement('div');
        item.className = 'compact-item';
        item.innerHTML = `
            <strong>${escapeHtml(entry.action)}</strong>
            <small>${escapeHtml(entry.actor || '-')}${entry.at ? ` · ${escapeHtml(entry.at)}` : ''}</small>
            ${entry.comment ? `<small>${escapeHtml(entry.comment)}</small>` : ''}
        `;
        container.appendChild(item);
    });

    if (history.length === 0) {
        container.innerHTML = '<div class="compact-item"><small>No review history</small></div>';
    }
}

function syncActionState() {
    const status = state.selectedDraft?.meta?.status;
    const hasDraft = Boolean(state.selectedDraft);
    $('save-draft-button').disabled = !hasDraft || !state.permissions.canEditDraft || status === 'published';
    $('request-review-button').disabled = !hasDraft || !state.permissions.canRequestReview || !['editing', 'changes_requested'].includes(status);
    $('approve-button').disabled = !hasDraft || !state.permissions.canReview || status !== 'review_requested';
    $('changes-button').disabled = !hasDraft || !state.permissions.canReview || status !== 'review_requested';
    $('publish-button').disabled = !hasDraft || !state.permissions.canPublish || status !== 'approved';
    $('delete-draft-button').disabled = !hasDraft || !state.permissions.canDeleteDraft || status === 'published';
    $('accept-submission-button').disabled = !hasDraft || !state.permissions.canEditDraft || state.selectedDraft?.meta?.source !== 'submission' || !['editing', 'rejected'].includes(status);
    $('reject-submission-button').disabled = !hasDraft || !state.permissions.canRejectDraft || status === 'published';
}

async function refreshDrafts() {
    const data = await listDrafts();
    state.drafts = data.drafts || [];
    renderDraftList();
    syncActionState();
}

async function selectDraft(draftId) {
    state.selectedDraft = await getDraft(draftId);
    renderDraftList();
    renderSelectedDraft();
}

function selectView(viewName) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('active', view.id === `view-${viewName}`);
    });
    document.querySelectorAll('.admin-nav button').forEach(button => {
        button.classList.toggle('active', button.dataset.view === viewName);
    });

    const titles = {
        dashboard: ['Dashboard', 'Content operations workspace'],
        submissions: ['Submissions', 'Submitter queue and status'],
        drafts: ['Drafts', 'Import, edit and preview submissions'],
        review: ['Review', 'Technical review queue'],
        publish: ['Publish', 'Approved draft promotion'],
        authors: ['Authors', 'Official author library'],
        published: ['Published', 'Live content governance'],
        volumes: ['Volumes', 'Published volume metadata'],
        users: ['Users', 'Admin operator access'],
        audit: ['Audit', 'Operational event log'],
        lint: ['Checks', 'Content contract validation']
    };
    const [title, subtitle] = titles[viewName] || titles.dashboard;
    $('view-title').textContent = title;
    $('view-subtitle').textContent = subtitle;

    if (viewName === 'authors') {
        state.authorPanel?.refreshAuthors().catch(error => setStatus('author-status', error.message, 'error'));
    }
    if (viewName === 'volumes') {
        refreshVolumes().catch(error => setStatus('volume-status', error.message, 'error'));
    }
    if (viewName === 'users') {
        refreshAdminUsers().catch(error => setStatus('user-status', error.message, 'error'));
    }
    if (viewName === 'published') {
        refreshPublished().catch(error => setStatus('published-status', error.message, 'error'));
    }
    if (viewName === 'audit') {
        refreshAuditLog().catch(error => {});
    }
}

function bindNavigation() {
    document.querySelectorAll('.admin-nav button').forEach(button => {
        button.addEventListener('click', () => selectView(button.dataset.view));
    });
    $('refresh-button').addEventListener('click', async () => {
        await refreshDrafts();
        if (selectedDraftId()) await selectDraft(selectedDraftId());
        await state.authorPanel?.refreshAuthors();
        await refreshVolumes();
        await refreshAdminUsers();
        await refreshPublished();
        await refreshAuditLog();
    });
}

function bindImportFlow() {
    $('import-files').addEventListener('change', () => {
        state.selectedImportFiles = normalizeFileSelection($('import-files').files);
        renderFileList($('import-file-list'), state.selectedImportFiles);
        setStatus('import-status', `${state.selectedImportFiles.length} files selected`);
    });

    $('import-preview-button').addEventListener('click', async () => {
        const indexContent = await readSelectedIndexContent();
        if (!indexContent) {
            setStatus('import-status', 'index.md is required', 'error');
            return;
        }
        renderPreview($('draft-preview'), indexContent, buildLocalAssetResolver(state.selectedImportFiles));
        $('draft-editor').value = indexContent;
        setStatus('import-status', 'Preview refreshed', 'ok');
    });

    $('import-submit-button').addEventListener('click', async () => {
        try {
            const files = await Promise.all(state.selectedImportFiles.map(toAdminFilePayload));
            const detail = await importDraft({
                targetVol: $('import-vol').value.trim(),
                folderName: $('import-folder').value.trim(),
                files
            });
            setStatus('import-status', `Saved ${detail.meta.draftId}`, 'ok');
            await refreshDrafts();
            state.selectedDraft = detail;
            renderSelectedDraft();
            renderDraftList();
        } catch (error) {
            setStatus('import-status', error.message, 'error');
        }
    });
}

function bindDraftEditor() {
    $('draft-editor').addEventListener('input', () => {
        clearTimeout(state.previewTimer);
        state.previewTimer = setTimeout(() => {
            renderPreview(
                $('draft-preview'),
                $('draft-editor').value,
                buildDraftAssetResolver(state.selectedDraft?.files || [])
            );
        }, 160);
    });

    $('save-draft-button').addEventListener('click', async () => {
        try {
            if (!selectedDraftId()) return;
            state.selectedDraft = await updateDraft(selectedDraftId(), {
                indexContent: $('draft-editor').value,
                targetVol: $('draft-target-vol').value.trim(),
                folderName: $('draft-folder-name').value.trim()
            });
            setStatus('import-status', `Saved ${selectedDraftId()}`, 'ok');
            await refreshDrafts();
            renderSelectedDraft();
        } catch (error) {
            setStatus('import-status', error.message, 'error');
        }
    });

    $('request-review-button').addEventListener('click', async () => {
        try {
            if (!selectedDraftId()) return;
            state.selectedDraft = await requestReview(selectedDraftId());
            await refreshDrafts();
            renderSelectedDraft();
        } catch (error) {
            setStatus('import-status', error.message, 'error');
        }
    });

    $('delete-draft-button').addEventListener('click', async () => {
        try {
            if (!selectedDraftId()) return;
            await deleteDraft(selectedDraftId());
            state.selectedDraft = null;
            await refreshDrafts();
            renderSelectedDraft();
            setStatus('import-status', 'Draft deleted', 'ok');
        } catch (error) {
            setStatus('import-status', error.message, 'error');
        }
    });
}

function bindSubmissionFlow() {
    $('accept-submission-button').addEventListener('click', async () => {
        try {
            if (!selectedDraftId()) return;
            state.selectedDraft = await acceptDraft(selectedDraftId(), $('submission-action-comment').value.trim());
            $('submission-action-comment').value = '';
            await refreshDrafts();
            renderSelectedDraft();
            setStatus('submission-action-status', 'Submission accepted', 'ok');
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });

    $('reject-submission-button').addEventListener('click', async () => {
        try {
            if (!selectedDraftId()) return;
            state.selectedDraft = await rejectDraft(selectedDraftId(), $('submission-action-comment').value.trim());
            $('submission-action-comment').value = '';
            await refreshDrafts();
            renderSelectedDraft();
            setStatus('submission-action-status', 'Submission rejected', 'ok');
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
}

function bindReviewFlow() {
    async function submit(action) {
        try {
            if (!selectedDraftId()) return;
            state.selectedDraft = await reviewDraft(selectedDraftId(), action, $('review-comment').value.trim());
            $('review-comment').value = '';
            await refreshDrafts();
            renderSelectedDraft();
        } catch (error) {
            setStatus('publish-status', error.message, 'error');
        }
    }

    $('approve-button').addEventListener('click', () => submit('approve'));
    $('changes-button').addEventListener('click', () => submit('request_changes'));
}

function buildAuthorResolution() {
    const metadata = parseFrontmatter($('draft-editor').value || state.selectedDraft?.indexContent || '').metadata;
    if (!metadata.author) return null;

    const existing = $('publish-existing-author').value.trim();
    const newId = $('publish-new-id').value.trim();
    const newName = $('publish-new-name').value.trim();

    if (existing && (newId || newName)) {
        throw new Error('Choose one author resolution mode');
    }

    if (existing) {
        return { mode: 'existing', authorId: existing };
    }

    return {
        mode: 'create',
        author: {
            id: newId,
            name: newName || metadata.author.name,
            team: $('publish-new-team').value.trim() || metadata.author.team || '',
            role: $('publish-new-role').value.trim() || metadata.author.role || '',
            avatar: metadata.author.avatar || ''
        }
    };
}

function bindPublishFlow() {
    $('publish-button').addEventListener('click', async () => {
        try {
            if (!selectedDraftId()) return;
            const avatarFile = await fileToBase64Payload($('author-avatar').files[0]);
            const authorResolution = buildAuthorResolution();
            if (authorResolution?.mode === 'create' && avatarFile) {
                authorResolution.avatarFile = avatarFile;
            }
            const result = await publishDraft(selectedDraftId(), authorResolution);
            setStatus('publish-status', `Published ${result.articleId}`, 'ok');
            await refreshDrafts();
            await selectDraft(selectedDraftId());
        } catch (error) {
            setStatus('publish-status', error.message, 'error');
        }
    });
}

function bindLintFlow() {
    $('run-lint-button').addEventListener('click', async () => {
        $('lint-output').textContent = 'Running...\n';
        try {
            const result = await runLint();
            $('lint-output').textContent = `${result.ok ? 'OK' : 'FAILED'}\n\n${result.stdout || ''}${result.stderr || ''}`;
        } catch (error) {
            $('lint-output').textContent = error.message;
        }
    });
}

function renderPublishedList() {
    const list = $('published-list');
    list.innerHTML = '';
    state.published.forEach(article => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `compact-item${state.selectedPublished?.articleId === article.articleId ? ' active' : ''}`;
        item.innerHTML = `
            <strong>${escapeHtml(article.title || article.articleId)}</strong>
            <small>${escapeHtml(article.articleId)}${article.description ? ` · ${escapeHtml(article.description)}` : ''}</small>
        `;
        item.addEventListener('click', async () => {
            state.selectedPublished = await getPublished(article.articleId);
            $('published-editor').value = state.selectedPublished.indexContent || '';
            renderPublishedList();
        });
        list.appendChild(item);
    });

    if (state.published.length === 0) {
        list.innerHTML = '<div class="compact-item"><small>No published articles</small></div>';
    }
}

async function refreshPublished() {
    if (!state.permissions.canEditPublished) return;
    const data = await listPublished();
    state.published = data.articles || [];
    renderPublishedList();
}

function bindPublishedFlow() {
    $('refresh-published-button').addEventListener('click', refreshPublished);
    $('save-published-button').addEventListener('click', async () => {
        try {
            if (!state.selectedPublished) return;
            state.selectedPublished = await updatePublished(state.selectedPublished.articleId, {
                indexContent: $('published-editor').value
            });
            setStatus('published-status', `Saved ${state.selectedPublished.articleId}`, 'ok');
            await refreshPublished();
        } catch (error) {
            setStatus('published-status', error.message, 'error');
        }
    });
    $('unpublish-button').addEventListener('click', async () => {
        try {
            if (!state.selectedPublished) return;
            await unpublishArticle(state.selectedPublished.articleId);
            setStatus('published-status', `Unpublished ${state.selectedPublished.articleId}`, 'ok');
            state.selectedPublished = null;
            $('published-editor').value = '';
            await refreshPublished();
        } catch (error) {
            setStatus('published-status', error.message, 'error');
        }
    });
    $('restore-button').addEventListener('click', async () => {
        try {
            const articleId = window.prompt('Article ID to restore');
            if (!articleId) return;
            await restoreArticle(articleId.trim());
            setStatus('published-status', `Restored ${articleId.trim()}`, 'ok');
            await refreshPublished();
        } catch (error) {
            setStatus('published-status', error.message, 'error');
        }
    });
}

async function refreshAuditLog() {
    if (!state.permissions.canViewAuditLog) return;
    const data = await listAuditLog();
    $('audit-list').innerHTML = (data.entries || []).map(entry => `
        <div class="compact-item">
            <strong>${escapeHtml(entry.action || '')}</strong>
            <small>${escapeHtml(entry.actor || '-')}${entry.at ? ` · ${escapeHtml(entry.at)}` : ''}</small>
            <small>${escapeHtml(entry.draftId || entry.articleId || entry.authorId || entry.username || entry.vol || '')}</small>
        </div>
    `).join('') || '<div class="compact-item"><small>No audit entries</small></div>';
}

function bindAuditFlow() {
    $('refresh-audit-button').addEventListener('click', () => {
        refreshAuditLog().catch(error => console.error(error));
    });
}

async function refreshVolumes() {
    if (!state.permissions.canManageVolumes) return;
    const data = await listVolumes();
    const list = $('volume-list');
    list.innerHTML = '';

    (data.volumes || []).forEach(volume => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'compact-item';
        item.innerHTML = `
            <strong>vol-${escapeHtml(volume.vol)}</strong>
            <small>${Number(volume.contributions || 0).toLocaleString()} contributions</small>
        `;
        item.addEventListener('click', () => {
            $('volume-id').value = volume.vol;
            $('volume-radar').value = volume.radarContent || '';
            setStatus('volume-status', `Selected vol-${volume.vol}`);
        });
        list.appendChild(item);
    });

    if (!data.volumes?.length) {
        list.innerHTML = '<div class="compact-item"><small>No volumes</small></div>';
    }
}

function bindVolumeFlow() {
    $('create-volume-button').addEventListener('click', async () => {
        try {
            const result = await createVolume($('volume-id').value.trim(), $('volume-radar').value);
            setStatus('volume-status', `Created vol-${result.vol}`, 'ok');
            await refreshVolumes();
        } catch (error) {
            setStatus('volume-status', error.message, 'error');
        }
    });

    $('update-volume-button').addEventListener('click', async () => {
        try {
            const result = await updateVolumeRadar($('volume-id').value.trim(), $('volume-radar').value);
            setStatus('volume-status', `Updated vol-${result.vol}`, 'ok');
            await refreshVolumes();
        } catch (error) {
            setStatus('volume-status', error.message, 'error');
        }
    });
}

function readAdminUserForm() {
    return {
        username: $('user-username').value.trim(),
        displayName: $('user-display-name').value.trim(),
        role: $('user-role').value.trim(),
        password: $('user-password').value
    };
}

async function refreshAdminUsers() {
    if (!state.permissions.canManageUsers) return;
    const data = await listAdminUsers();
    const list = $('user-list');
    list.innerHTML = '';

    (data.users || []).forEach(user => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'compact-item';
        item.innerHTML = `
            <strong>${escapeHtml(user.displayName || user.username)}</strong>
            <small>${escapeHtml(user.username)} · ${escapeHtml(user.role)}${user.disabled ? ' · disabled' : ''}</small>
        `;
        item.addEventListener('click', () => {
            $('user-username').value = user.username;
            $('user-display-name').value = user.displayName || '';
            $('user-role').value = user.role || '';
            $('user-password').value = '';
            setStatus('user-status', `Selected ${user.username}`);
        });
        list.appendChild(item);
    });

    if (!data.users?.length) {
        list.innerHTML = '<div class="compact-item"><small>No users</small></div>';
    }
}

function bindUserFlow() {
    $('create-user-button').addEventListener('click', async () => {
        try {
            const result = await createAdminUser(readAdminUserForm());
            $('user-password').value = '';
            setStatus('user-status', `Created ${result.user.username}`, 'ok');
            await refreshAdminUsers();
        } catch (error) {
            setStatus('user-status', error.message, 'error');
        }
    });

    $('update-user-button').addEventListener('click', async () => {
        try {
            const user = readAdminUserForm();
            const result = await updateAdminUser(user.username, user);
            $('user-password').value = '';
            setStatus('user-status', `Updated ${result.user.username}`, 'ok');
            await refreshAdminUsers();
        } catch (error) {
            setStatus('user-status', error.message, 'error');
        }
    });

    $('disable-user-button').addEventListener('click', async () => {
        try {
            const username = $('user-username').value.trim();
            const result = await disableAdminUser(username);
            setStatus('user-status', `Disabled ${result.user.username}`, 'ok');
            await refreshAdminUsers();
        } catch (error) {
            setStatus('user-status', error.message, 'error');
        }
    });
}

function showSession(session) {
    state.user = session.user;
    state.permissions = session.permissions || {};
    $('login-view').classList.add('hidden');
    $('admin-shell').classList.remove('hidden');
    $('operator-name').textContent = session.user.displayName || session.user.username;
    $('operator-role').textContent = ROLE_LABELS[session.user.role] || session.user.role;
    applyPermissionState(document, state.permissions);
    syncActionState();
}

function showLogin() {
    state.user = null;
    state.permissions = {};
    $('login-view').classList.remove('hidden');
    $('admin-shell').classList.add('hidden');
}

async function init() {
    bindAuth({
        onSignedIn: async session => {
            showSession(session);
            await refreshDrafts();
            await state.authorPanel?.refreshAuthors();
            await refreshVolumes();
            await refreshAdminUsers();
            await refreshPublished();
            await refreshAuditLog();
        },
        onSignedOut: showLogin
    });
    bindNavigation();
    bindImportFlow();
    bindDraftEditor();
    bindSubmissionFlow();
    bindReviewFlow();
    bindPublishFlow();
    bindLintFlow();
    bindPublishedFlow();
    bindAuditFlow();
    bindVolumeFlow();
    bindUserFlow();

    state.authorPanel = bindAuthorPanel({
        getPermissions: () => state.permissions
    });

    const session = await restoreSession();
    if (!session) {
        showLogin();
        return;
    }

    showSession(session);
    await refreshDrafts();
    await state.authorPanel.refreshAuthors();
    await refreshVolumes();
    await refreshAdminUsers();
    await refreshPublished();
    await refreshAuditLog();
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
        showLogin();
        setStatus('login-status', error.message, 'error');
    });
});
