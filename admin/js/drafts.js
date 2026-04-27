import {
    acceptSubmission,
    addIssueDraftManuscript,
    createAdminUser,
    createIssueDraft,
    createVolume,
    disableAdminUser,
    enableAdminUser,
    getIssueDraft,
    getManuscript,
    getPublished,
    getSubmission,
    issueSubmissionStatusLink,
    listAdminUsers,
    listAuditLog,
    listIssues,
    listIssueDrafts,
    listManuscripts,
    listPublished,
    listPublishedHistory,
    listSubmissions,
    listUnpublished,
    listVolumes,
    publishIssueDraft,
    rejectSubmission,
    removeIssueDraftManuscript,
    requestSubmissionChanges,
    restoreArticle,
    reviewIssueDraft,
    reviewManuscript,
    rollbackPublished,
    runLint,
    unpublishArticle,
    updateAdminUser,
    updateIssueDraft,
    updateManuscript,
    updatePublished,
    updateVolumeRadar
} from './api.js';
import { bindAuth, restoreSession } from './auth.js';
import { bindAuthorPanel } from './authors.js';
import { applyPermissionState, ROLE_LABELS } from './permissions.js';
import { buildDraftAssetResolver, renderPreview } from './preview.js';

const state = {
    user: null,
    permissions: {},
    submissions: [],
    manuscripts: [],
    issueDrafts: [],
    issues: [],
    selectedSubmission: null,
    selectedManuscript: null,
    selectedIssueDraft: null,
    selectedIssueVol: '',
    selectedIssueManuscriptId: '',
    selectedIssueAvailableManuscriptId: '',
    selectedManuscriptFiles: [],
    published: [],
    selectedPublished: null,
    unpublished: [],
    selectedUnpublished: null,
    selectedPublishedFiles: [],
    selectedPublishedSnapshotId: '',
    authorPanel: null,
    previewTimer: null
};

const MANUSCRIPT_STATUS_LABELS = {
    drafting: '编辑中',
    manuscript_review_requested: '待稿件审核',
    changes_requested: '已退回',
    available: '可入选',
    scheduled: '已编入草稿',
    published: '已发布',
    archived: '已归档'
};

const ISSUE_STATUS_LABELS = {
    editing: '编辑中',
    issue_review_requested: '待整期审核',
    changes_requested: '已退回',
    approved: '已审核',
    published: '已发布',
    archived: '已归档'
};

const ISSUE_MANAGEMENT_STATUS_LABELS = {
    editing: '草稿中',
    issue_review_requested: '待整期审核',
    approved: '已审核待发布',
    published: '已发布',
    archived: '已归档',
    empty: '未编排'
};

const SUBMISSION_STATUS_LABELS = {
    submitted: '待编辑初审',
    in_editor_review: '编辑处理中',
    changes_requested: '待返修',
    accepted: '已接收入池',
    rejected: '已拒稿',
    published: '已发布'
};

const VIEW_TITLES = {
    submissions: ['投稿初审', '处理新投稿、返修与接收入池'],
    manuscripts: ['稿件池', '编辑单篇稿件并完成单篇审核'],
    reviews: ['审核任务', '集中查看待审核稿件与期刊'],
    issues: ['期刊管理', '按卷期编排、预览、发布和维护文章'],
    authors: ['作者管理', '作者入库、修改、头像与合并'],
    users: ['人员权限', '维护后台用户和角色'],
    audit: ['操作日志', '查看关键后台操作记录']
};

const ACTION_LABELS = {
    create_submission: '创建投稿',
    submitter_revision: '投稿者返修',
    accepted: '已接收',
    rejected: '已拒稿',
    request_changes: '退回修改',
    approve: '审核通过',
    request_review: '提交审核',
    published: '已发布'
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

function labelFrom(labels, value) {
    return labels[value] || value || '-';
}

function setStatus(id, message, type = '') {
    const element = $(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', type === 'error');
    element.classList.toggle('is-ok', type === 'ok');
}

function renderFileList(container, files = []) {
    container.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <strong>${escapeHtml(file.path || file.relativePath)}</strong>
            <small>${Number(file.size || 0).toLocaleString()} 字节</small>
        `;
        container.appendChild(item);
    });
    if (!files.length) {
        container.innerHTML = '<div class="file-item"><small>暂无文件</small></div>';
    }
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

function normalizeFileSelection(fileList) {
    const files = Array.from(fileList || []);
    const rawPaths = files.map(file => file.webkitRelativePath || file.name);
    const indexPath = rawPaths.find(item => item === 'index.md' || item.endsWith('/index.md'));
    const rootPrefix = indexPath && indexPath !== 'index.md'
        ? indexPath.slice(0, -'index.md'.length)
        : '';
    return files.map((file, index) => {
        const rawPath = rawPaths[index];
        return {
            file,
            relativePath: rootPrefix && rawPath.startsWith(rootPrefix)
                ? rawPath.slice(rootPrefix.length)
                : rawPath.split('/').pop(),
            size: file.size
        };
    });
}

async function toAdminFilePayload(item) {
    if (isTextFile(item.relativePath)) {
        return { path: item.relativePath, type: 'text', content: await item.file.text() };
    }
    return { path: item.relativePath, type: 'base64', content: arrayBufferToBase64(await item.file.arrayBuffer()) };
}

function parsePathList(value) {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function compactItem({ active, pill, title, subtitle, onClick }) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `compact-item${active ? ' active' : ''}`;
    item.innerHTML = `
        ${pill ? `<span class="status-pill">${escapeHtml(pill)}</span>` : ''}
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(subtitle || '')}</small>
    `;
    if (typeof onClick === 'function') {
        item.addEventListener('click', onClick);
    }
    return item;
}

function selectedSubmissionId() {
    return state.selectedSubmission?.meta?.submissionId;
}

function selectedManuscriptId() {
    return state.selectedManuscript?.meta?.manuscriptId;
}

function selectedIssueDraftId() {
    return state.selectedIssueDraft?.meta?.issueDraftId;
}

function selectedAdminIssue() {
    return state.issues.find(issue => issue.vol === state.selectedIssueVol) || null;
}

function renderMetrics() {
    $('metric-submissions').textContent = state.submissions.filter(item => item.status === 'submitted').length;
    $('metric-manuscript-review').textContent = state.manuscripts.filter(item => item.status === 'manuscript_review_requested').length;
    $('metric-available').textContent = state.manuscripts.filter(item => item.status === 'available').length;
    $('metric-issue-drafts').textContent = state.issueDrafts.filter(item => item.status !== 'published').length;
}

function renderSubmissionList() {
    const list = $('submission-list');
    list.innerHTML = '';
    state.submissions.forEach(submission => {
        list.appendChild(compactItem({
            active: selectedSubmissionId() === submission.submissionId,
            pill: labelFrom(SUBMISSION_STATUS_LABELS, submission.status),
            title: submission.submitter?.name || submission.submissionId,
            subtitle: `${submission.submissionId}${submission.submitter?.contact ? ` · ${submission.submitter.contact}` : ''}`,
            onClick: () => selectSubmission(submission.submissionId)
        }));
    });
    if (!state.submissions.length) list.innerHTML = '<div class="compact-item"><small>暂无投稿</small></div>';
}

function renderManuscriptList() {
    const list = $('manuscript-list');
    list.innerHTML = '';
    state.manuscripts.forEach(manuscript => {
        list.appendChild(compactItem({
            active: selectedManuscriptId() === manuscript.manuscriptId,
            pill: labelFrom(MANUSCRIPT_STATUS_LABELS, manuscript.status),
            title: manuscript.title || manuscript.manuscriptId,
            subtitle: `${manuscript.reviewers?.length ? `审稿人 ${manuscript.reviewers.join(', ')}` : '未审稿'}${manuscript.scheduledIssueDraftId ? ` · ${manuscript.scheduledIssueDraftId}` : ''}`,
            onClick: () => selectManuscript(manuscript.manuscriptId)
        }));
    });
    if (!state.manuscripts.length) list.innerHTML = '<div class="compact-item"><small>暂无稿件</small></div>';
}

function renderReviewTaskLists() {
    const manuscriptList = $('review-manuscript-list');
    const issueList = $('review-issue-list');
    if (!manuscriptList || !issueList) return;

    manuscriptList.innerHTML = '';
    const reviewManuscripts = state.manuscripts.filter(manuscript => manuscript.status === 'manuscript_review_requested');
    reviewManuscripts.forEach(manuscript => {
        manuscriptList.appendChild(compactItem({
            active: selectedManuscriptId() === manuscript.manuscriptId,
            pill: labelFrom(MANUSCRIPT_STATUS_LABELS, manuscript.status),
            title: manuscript.title || manuscript.manuscriptId,
            subtitle: manuscript.assignee || '未分配',
            onClick: async () => {
                await selectManuscript(manuscript.manuscriptId);
                selectView('manuscripts');
            }
        }));
    });
    if (!reviewManuscripts.length) manuscriptList.innerHTML = '<div class="compact-item"><small>暂无待审稿件</small></div>';

    issueList.innerHTML = '';
    const reviewIssues = state.issueDrafts.filter(issue => issue.status === 'issue_review_requested');
    reviewIssues.forEach(issue => {
        issueList.appendChild(compactItem({
            active: selectedIssueDraftId() === issue.issueDraftId,
            pill: labelFrom(ISSUE_STATUS_LABELS, issue.status),
            title: issue.title || `vol-${issue.vol}`,
            subtitle: `vol-${issue.vol} · ${(issue.manuscripts || []).length} 篇稿件`,
            onClick: async () => {
                state.selectedIssueVol = issue.vol;
                await selectIssueDraft(issue.issueDraftId);
                selectView('issues');
            }
        }));
    });
    if (!reviewIssues.length) issueList.innerHTML = '<div class="compact-item"><small>暂无待审期刊</small></div>';
}

function renderAdminIssueList() {
    const list = $('admin-issue-list');
    if (!list) return;
    list.innerHTML = '';
    state.issues.forEach(issue => {
        list.appendChild(compactItem({
            active: state.selectedIssueVol === issue.vol,
            pill: labelFrom(ISSUE_MANAGEMENT_STATUS_LABELS, issue.status),
            title: `vol-${issue.vol}`,
            subtitle: `${issue.counts.drafts} 个草稿 · ${issue.counts.published} 篇已发布 · ${issue.counts.unpublished} 篇已下线`,
            onClick: () => selectAdminIssue(issue.vol)
        }));
    });
    if (!state.issues.length) list.innerHTML = '<div class="compact-item"><small>暂无期刊</small></div>';
}

function renderIssueDraftList() {
    const list = $('issue-draft-list');
    list.innerHTML = '';
    const issueDrafts = state.selectedIssueVol
        ? state.issueDrafts.filter(issue => issue.vol === state.selectedIssueVol)
        : state.issueDrafts;
    issueDrafts.forEach(issue => {
        list.appendChild(compactItem({
            active: selectedIssueDraftId() === issue.issueDraftId,
            pill: labelFrom(ISSUE_STATUS_LABELS, issue.status),
            title: issue.title || issue.issueDraftId,
            subtitle: `vol-${issue.vol} · ${(issue.manuscripts || []).length} 篇稿件`,
            onClick: () => selectIssueDraft(issue.issueDraftId)
        }));
    });
    if (!issueDrafts.length) list.innerHTML = '<div class="compact-item"><small>暂无期刊草稿</small></div>';
}

function manuscriptDefaultFolder(manuscript) {
    const idSlug = String(manuscript?.manuscriptId || '')
        .replace(/^\d{14}-/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return idSlug || 'manuscript';
}

function selectAvailableManuscriptForIssue(manuscript) {
    state.selectedIssueAvailableManuscriptId = manuscript.manuscriptId || '';
    $('issue-add-manuscript-id').value = manuscript.manuscriptId || '';
    $('issue-add-folder').value = manuscriptDefaultFolder(manuscript);
    renderAllLists();
    syncActionState();
    setStatus('issue-status', '已选择可加入稿件');
}

function renderIssueAvailableManuscriptList() {
    const list = $('issue-available-manuscript-list');
    if (!list) return;
    list.innerHTML = '';
    if (!selectedIssueDraftId() || state.selectedIssueDraft?.meta?.status === 'published') {
        list.innerHTML = '<div class="compact-item"><small>先选择可编辑期刊草稿</small></div>';
        return;
    }
    const scheduledIds = new Set((state.selectedIssueDraft?.meta?.manuscripts || []).map(item => item.manuscriptId));
    const available = state.manuscripts.filter(manuscript => manuscript.status === 'available' && !scheduledIds.has(manuscript.manuscriptId));
    available.forEach(manuscript => {
        list.appendChild(compactItem({
            active: $('issue-add-manuscript-id')?.value === manuscript.manuscriptId,
            pill: '可加入',
            title: manuscript.title || manuscript.manuscriptId,
            subtitle: `${manuscriptDefaultFolder(manuscript)} · ${manuscript.authorIds?.join(', ') || '未标作者'}`,
            onClick: () => selectAvailableManuscriptForIssue(manuscript)
        }));
    });
    if (!available.length) {
        list.innerHTML = '<div class="compact-item"><small>暂无可加入稿件</small></div>';
    }
}

function renderReviewHistory(container, entries = []) {
    container.innerHTML = '';
    entries.slice().reverse().forEach(entry => {
        const item = document.createElement('div');
        item.className = 'compact-item';
        item.innerHTML = `
            <strong>${escapeHtml(labelFrom(ACTION_LABELS, entry.action))}</strong>
            <small>${escapeHtml(entry.actor || '-')}${entry.at ? ` · ${escapeHtml(entry.at)}` : ''}</small>
            ${entry.comment ? `<small>${escapeHtml(entry.comment)}</small>` : ''}
        `;
        container.appendChild(item);
    });
    if (!entries.length) container.innerHTML = '<div class="compact-item"><small>暂无记录</small></div>';
}

function acceptAuthorMode() {
    return document.querySelector('input[name="accept-author-mode"]:checked')?.value || 'existing';
}

function setAcceptAuthorMode(mode) {
    const input = document.querySelector(`input[name="accept-author-mode"][value="${mode}"]`);
    if (input) input.checked = true;
    syncAcceptAuthorMode();
}

function syncAcceptAuthorMode({ clearHidden = false } = {}) {
    const mode = acceptAuthorMode();
    $('accept-existing-panel').classList.toggle('hidden', mode !== 'existing');
    $('accept-new-panel').classList.toggle('hidden', mode !== 'create');
    if (!clearHidden) return;
    if (mode === 'existing') {
        $('accept-new-id').value = '';
        $('accept-new-name').value = '';
        $('accept-new-team').value = '';
        $('accept-new-role').value = '';
    } else {
        $('accept-existing-author').value = '';
    }
}

function renderAcceptAuthorOptions() {
    const options = $('accept-author-options');
    if (!options) return;
    const authors = state.authorPanel?.getAuthors?.() || [];
    options.innerHTML = authors.map(author => `
        <option value="${escapeHtml(author.id)}">${escapeHtml(author.name || author.id)}</option>
    `).join('');
}

function clearAcceptAuthorFields() {
    $('accept-existing-author').value = '';
    $('accept-new-id').value = '';
    $('accept-new-name').value = '';
    $('accept-new-team').value = '';
    $('accept-new-role').value = '';
}

function renderSubmissionSummary(detail) {
    const submitter = detail?.meta?.submitter || {};
    const chips = detail ? [
        ['状态', labelFrom(SUBMISSION_STATUS_LABELS, detail.meta?.status)],
        ['投稿者', submitter.name || '-'],
        ['团队', submitter.team || '-'],
        ['版本', `第 ${detail.meta?.revision || 1} 版`]
    ] : [];
    $('submission-summary').innerHTML = chips.map(([label, value]) => `
        <div class="summary-chip">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `).join('');
}

function prefillAcceptAuthorFields(detail) {
    clearAcceptAuthorFields();
    if (!detail) {
        setAcceptAuthorMode('existing');
        return;
    }
    const submitter = detail.meta?.submitter || {};
    if (submitter.authorId) {
        $('accept-existing-author').value = submitter.authorId;
        setAcceptAuthorMode('existing');
        return;
    }
    $('accept-new-name').value = submitter.name || '';
    $('accept-new-team').value = submitter.team || '';
    $('accept-new-role').value = submitter.role || '';
    setAcceptAuthorMode('create');
}

function renderSubmissionDetail() {
    const detail = state.selectedSubmission;
    $('submission-preview').innerHTML = '';
    $('submission-files').innerHTML = '';
    $('issued-status-link').textContent = '';
    renderSubmissionSummary(detail);
    if (!detail) {
        clearAcceptAuthorFields();
        syncActionState();
        return;
    }
    prefillAcceptAuthorFields(detail);
    renderAcceptAuthorOptions();
    renderPreview($('submission-preview'), detail.indexContent || '', buildDraftAssetResolver(detail.files || []));
    renderFileList($('submission-files'), detail.files || []);
    syncActionState();
}

function renderManuscriptDetail() {
    const detail = state.selectedManuscript;
    $('manuscript-editor').value = detail?.indexContent || '';
    $('manuscript-assignee').value = detail?.meta?.assignee || '';
    $('manuscript-preview').innerHTML = '';
    if (detail) {
        renderPreview($('manuscript-preview'), detail.indexContent || '', buildDraftAssetResolver(detail.files || []));
    }
    renderFileList($('manuscript-files'), detail?.files || []);
    renderReviewHistory($('manuscript-review-history'), detail?.review?.history || []);
    syncActionState();
}

function renderIssueDraftDetail() {
    const issue = state.selectedIssueDraft;
    $('issue-vol').value = issue?.meta?.vol || '';
    $('issue-title').value = issue?.meta?.title || '';
    $('issue-radar').value = issue?.meta?.radarContent || '';
    renderReviewHistory($('issue-review-history'), issue?.review?.history || []);
    renderIssueManuscriptList(issue?.meta?.manuscripts || []);
    syncActionState();
}

function renderIssueManuscriptList(items = []) {
    const list = $('issue-manuscript-list');
    list.innerHTML = '';
    items.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(item => {
        const manuscript = state.manuscripts.find(candidate => candidate.manuscriptId === item.manuscriptId);
        list.appendChild(compactItem({
            active: state.selectedIssueManuscriptId === item.manuscriptId,
            pill: item.folderName,
            title: manuscript?.title || item.manuscriptId,
            subtitle: `${item.manuscriptId} · order ${item.order || 0}`,
            onClick: () => {
                state.selectedIssueManuscriptId = item.manuscriptId;
                renderIssueManuscriptList(items);
            }
        }));
    });
    if (!items.length) list.innerHTML = '<div class="compact-item"><small>暂无入选稿件</small></div>';
}

function renderAllLists() {
    renderMetrics();
    renderSubmissionList();
    renderManuscriptList();
    renderReviewTaskLists();
    renderAdminIssueList();
    renderIssueDraftList();
    renderIssueAvailableManuscriptList();
    renderPublishedList();
    renderUnpublishedList();
}

function syncActionState() {
    const submissionStatus = state.selectedSubmission?.meta?.status;
    const manuscriptStatus = state.selectedManuscript?.meta?.status;
    const issueStatus = state.selectedIssueDraft?.meta?.status;
    $('accept-submission-button').disabled = !selectedSubmissionId() || !state.permissions.canEditDraft || !['submitted', 'in_editor_review', 'changes_requested'].includes(submissionStatus);
    $('return-submission-button').disabled = !selectedSubmissionId() || !state.permissions.canEditDraft || !['submitted', 'in_editor_review'].includes(submissionStatus);
    $('reject-submission-button').disabled = !selectedSubmissionId() || !state.permissions.canRejectDraft || ['accepted', 'published'].includes(submissionStatus);
    $('issue-status-link-button').disabled = !selectedSubmissionId() || !state.permissions.canIssueStatusLink;
    $('save-manuscript-button').disabled = !selectedManuscriptId() || !state.permissions.canEditDraft || ['scheduled', 'published'].includes(manuscriptStatus);
    $('approve-manuscript-button').disabled = !selectedManuscriptId() || !state.permissions.canReviewManuscript || !['drafting', 'manuscript_review_requested', 'changes_requested'].includes(manuscriptStatus);
    $('changes-manuscript-button').disabled = !selectedManuscriptId() || !state.permissions.canReviewManuscript || !['drafting', 'manuscript_review_requested'].includes(manuscriptStatus);
    $('create-issue-draft-button').disabled = !state.permissions.canManageIssueDrafts;
    $('save-issue-draft-button').disabled = !selectedIssueDraftId() || !state.permissions.canManageIssueDrafts || issueStatus === 'published';
    $('add-manuscript-to-issue-button').disabled = !selectedIssueDraftId() || !state.permissions.canManageIssueDrafts || issueStatus === 'published';
    $('remove-manuscript-from-issue-button').disabled = !selectedIssueDraftId() || !state.selectedIssueManuscriptId || !state.permissions.canManageIssueDrafts || issueStatus === 'published';
    $('request-issue-review-button').disabled = !selectedIssueDraftId() || !state.permissions.canManageIssueDrafts || !['editing', 'changes_requested'].includes(issueStatus);
    $('approve-issue-button').disabled = !selectedIssueDraftId() || !state.permissions.canReviewIssueDraft || issueStatus !== 'issue_review_requested';
    $('changes-issue-button').disabled = !selectedIssueDraftId() || !state.permissions.canReviewIssueDraft || issueStatus !== 'issue_review_requested';
    $('publish-issue-button').disabled = !selectedIssueDraftId() || !state.permissions.canPublish || issueStatus !== 'approved';
    $('rollback-button').disabled = !state.selectedPublished || !state.selectedPublishedSnapshotId || !state.permissions.canRollbackPublished;
    $('restore-button').disabled = !state.selectedUnpublished || !state.permissions.canUnpublish;
    $('unpublish-button').disabled = !state.selectedPublished || !state.permissions.canUnpublish;
    $('save-published-button').disabled = !state.selectedPublished || !state.permissions.canEditPublished;
}

async function refreshWorkbench() {
    const [submissions, manuscripts, issueDrafts, issues] = await Promise.all([
        listSubmissions(),
        listManuscripts(),
        listIssueDrafts(),
        listIssues()
    ]);
    state.submissions = submissions.submissions || [];
    state.manuscripts = manuscripts.manuscripts || [];
    state.issueDrafts = issueDrafts.issueDrafts || [];
    state.issues = issues.issues || [];
    state.published = state.issues.flatMap(issue => issue.publishedArticles || []);
    state.unpublished = state.issues.flatMap(issue => issue.unpublishedArticles || []);
    if (state.selectedIssueVol && !state.issues.some(issue => issue.vol === state.selectedIssueVol)) {
        state.selectedIssueVol = '';
    }
    renderAllLists();
    syncActionState();
}

async function selectSubmission(submissionId) {
    state.selectedSubmission = await getSubmission(submissionId);
    renderAllLists();
    renderSubmissionDetail();
}

async function selectManuscript(manuscriptId) {
    state.selectedManuscript = await getManuscript(manuscriptId);
    renderAllLists();
    renderManuscriptDetail();
}

async function selectIssueDraft(issueDraftId) {
    state.selectedIssueDraft = await getIssueDraft(issueDraftId);
    state.selectedIssueVol = state.selectedIssueDraft?.meta?.vol || state.selectedIssueVol;
    state.selectedIssueManuscriptId = '';
    state.selectedIssueAvailableManuscriptId = '';
    $('issue-add-manuscript-id').value = '';
    $('issue-add-folder').value = '';
    renderAllLists();
    renderIssueDraftDetail();
}

function selectAdminIssue(vol) {
    state.selectedIssueVol = vol;
    const issue = selectedAdminIssue();
    $('volume-id').value = issue?.vol || '';
    $('volume-radar').value = issue?.radarContent || '';
    if (!state.selectedIssueDraft || state.selectedIssueDraft.meta?.vol !== vol) {
        state.selectedIssueDraft = null;
        state.selectedIssueManuscriptId = '';
        state.selectedIssueAvailableManuscriptId = '';
        renderIssueDraftDetail();
    }
    $('issue-vol').value = issue?.vol || '';
    $('issue-title').value = issue?.title || '';
    $('issue-radar').value = issue?.radarContent || '';
    state.selectedPublished = null;
    state.selectedUnpublished = null;
    state.selectedPublishedSnapshotId = '';
    $('published-editor').value = '';
    $('published-files').innerHTML = '';
    $('published-history-list').innerHTML = '';
    renderAllLists();
    syncActionState();
}

function buildAcceptAuthorResolution() {
    if (acceptAuthorMode() === 'existing') {
        const existing = $('accept-existing-author').value.trim();
        if (!existing) throw new Error('请选择或输入已有作者 ID');
        return { mode: 'existing', authorId: existing };
    }

    const newId = $('accept-new-id').value.trim();
    const newName = $('accept-new-name').value.trim();
    if (!newId || !newName) {
        throw new Error('请填写新作者 ID 和姓名');
    }
    return {
        mode: 'create',
        author: {
            id: newId,
            name: newName,
            team: $('accept-new-team').value.trim(),
            role: $('accept-new-role').value.trim(),
            avatar: ''
        }
    };
}

function bindSubmissionFlow() {
    document.querySelectorAll('input[name="accept-author-mode"]').forEach(input => {
        input.addEventListener('change', () => syncAcceptAuthorMode({ clearHidden: true }));
    });
    $('accept-existing-author').addEventListener('input', () => {
        const author = (state.authorPanel?.getAuthors?.() || []).find(item => item.id === $('accept-existing-author').value.trim());
        if (author) {
            setStatus('submission-action-status', `${author.name || author.id} · ${author.team || author.id}`);
        }
    });
    $('accept-new-name').addEventListener('input', () => {
        if (!$('accept-new-id').value.trim()) {
            $('accept-new-id').value = 'new_author';
        }
    });
    $('accept-submission-button').addEventListener('click', async () => {
        try {
            if (!selectedSubmissionId()) return;
            const result = await acceptSubmission(selectedSubmissionId(), buildAcceptAuthorResolution());
            state.selectedManuscript = result;
            setStatus('submission-action-status', '已接收入稿件池', 'ok');
            await refreshWorkbench();
            await state.authorPanel?.refreshAuthors();
            renderAcceptAuthorOptions();
            await selectSubmission(selectedSubmissionId());
            renderManuscriptDetail();
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
    $('return-submission-button').addEventListener('click', async () => {
        try {
            if (!selectedSubmissionId()) return;
            state.selectedSubmission = await requestSubmissionChanges(
                selectedSubmissionId(),
                $('submission-action-comment').value.trim(),
                'internal'
            );
            setStatus('submission-action-status', '已退回投稿者返修', 'ok');
            await refreshWorkbench();
            renderSubmissionDetail();
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
    $('reject-submission-button').addEventListener('click', async () => {
        try {
            if (!selectedSubmissionId()) return;
            state.selectedSubmission = await rejectSubmission(
                selectedSubmissionId(),
                $('submission-action-comment').value.trim(),
                'internal'
            );
            setStatus('submission-action-status', '投稿已拒绝', 'ok');
            await refreshWorkbench();
            renderSubmissionDetail();
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
    $('issue-status-link-button').addEventListener('click', async () => {
        try {
            if (!selectedSubmissionId()) return;
            const result = await issueSubmissionStatusLink(selectedSubmissionId());
            $('issued-status-link').textContent = new URL(result.statusUrl, window.location.origin).toString();
            setStatus('submission-action-status', '状态链接已补发', 'ok');
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
}

function bindManuscriptFlow() {
    $('manuscript-files-input').addEventListener('change', () => {
        state.selectedManuscriptFiles = normalizeFileSelection($('manuscript-files-input').files);
        setStatus('manuscript-status', `已选择 ${state.selectedManuscriptFiles.length} 个资源文件`);
    });
    $('manuscript-editor').addEventListener('input', () => {
        clearTimeout(state.previewTimer);
        state.previewTimer = setTimeout(() => {
            renderPreview($('manuscript-preview'), $('manuscript-editor').value, buildDraftAssetResolver(state.selectedManuscript?.files || []));
        }, 160);
    });
    $('save-manuscript-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            const files = await Promise.all(state.selectedManuscriptFiles.map(toAdminFilePayload));
            state.selectedManuscript = await updateManuscript(selectedManuscriptId(), {
                indexContent: $('manuscript-editor').value,
                assignee: $('manuscript-assignee').value.trim(),
                files,
                deleteFiles: parsePathList($('manuscript-delete-files').value)
            });
            state.selectedManuscriptFiles = [];
            $('manuscript-files-input').value = '';
            $('manuscript-delete-files').value = '';
            setStatus('manuscript-status', '稿件已保存', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
    async function submitReview(action) {
        try {
            if (!selectedManuscriptId()) return;
            state.selectedManuscript = await reviewManuscript(
                selectedManuscriptId(),
                action,
                $('manuscript-review-comment').value.trim(),
                'internal'
            );
            $('manuscript-review-comment').value = '';
            setStatus('manuscript-status', action === 'approve' ? '稿件已通过' : '稿件已退回', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    }
    $('approve-manuscript-button').addEventListener('click', () => submitReview('approve'));
    $('changes-manuscript-button').addEventListener('click', () => submitReview('request_changes'));
}

function bindIssueDraftFlow() {
    $('create-issue-draft-button').addEventListener('click', async () => {
        try {
            const result = await createIssueDraft({
                vol: $('issue-vol').value.trim(),
                title: $('issue-title').value.trim(),
                radarContent: $('issue-radar').value
            });
            state.selectedIssueDraft = result;
            setStatus('issue-status', '期刊草稿已创建', 'ok');
            await refreshWorkbench();
            renderIssueDraftDetail();
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    });
    $('save-issue-draft-button').addEventListener('click', async () => {
        try {
            if (!selectedIssueDraftId()) return;
            state.selectedIssueDraft = await updateIssueDraft(selectedIssueDraftId(), {
                vol: $('issue-vol').value.trim(),
                title: $('issue-title').value.trim(),
                radarContent: $('issue-radar').value,
                manuscripts: state.selectedIssueDraft.meta.manuscripts || []
            });
            setStatus('issue-status', '期刊草稿已保存', 'ok');
            await refreshWorkbench();
            renderIssueDraftDetail();
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    });
    $('add-manuscript-to-issue-button').addEventListener('click', async () => {
        try {
            if (!selectedIssueDraftId()) return;
            const manuscriptId = $('issue-add-manuscript-id').value.trim();
            if (!manuscriptId) {
                setStatus('issue-status', '请选择可加入稿件', 'error');
                return;
            }
            state.selectedIssueDraft = await addIssueDraftManuscript(selectedIssueDraftId(), manuscriptId, $('issue-add-folder').value.trim());
            setStatus('issue-status', '稿件已加入期刊草稿', 'ok');
            await refreshWorkbench();
            state.selectedIssueAvailableManuscriptId = '';
            $('issue-add-manuscript-id').value = '';
            $('issue-add-folder').value = '';
            renderIssueDraftDetail();
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    });
    $('remove-manuscript-from-issue-button').addEventListener('click', async () => {
        try {
            if (!selectedIssueDraftId() || !state.selectedIssueManuscriptId) return;
            state.selectedIssueDraft = await removeIssueDraftManuscript(selectedIssueDraftId(), state.selectedIssueManuscriptId);
            state.selectedIssueManuscriptId = '';
            setStatus('issue-status', '稿件已移出期刊草稿', 'ok');
            await refreshWorkbench();
            renderIssueDraftDetail();
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    });
    async function submitIssueReview(action) {
        try {
            if (!selectedIssueDraftId()) return;
            state.selectedIssueDraft = await reviewIssueDraft(
                selectedIssueDraftId(),
                action,
                $('issue-review-comment').value.trim(),
                'internal'
            );
            $('issue-review-comment').value = '';
            setStatus('issue-status', '期刊草稿状态已更新', 'ok');
            await refreshWorkbench();
            renderIssueDraftDetail();
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    }
    $('request-issue-review-button').addEventListener('click', () => submitIssueReview('request_review'));
    $('approve-issue-button').addEventListener('click', () => submitIssueReview('approve'));
    $('changes-issue-button').addEventListener('click', () => submitIssueReview('request_changes'));
    $('preview-issue-button').addEventListener('click', async () => {
        try {
            if (!selectedIssueDraftId()) return;
            const url = `/admin/issue-drafts/${encodeURIComponent(selectedIssueDraftId())}/preview-page`;
            window.open(url, '_blank', 'noopener');
            $('issue-preview').innerHTML = '<p>已打开整期读者页预览</p>';
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    });
    $('publish-issue-button').addEventListener('click', async () => {
        try {
            if (!selectedIssueDraftId()) return;
            const result = await publishIssueDraft(selectedIssueDraftId());
            setStatus('issue-status', `已发布 ${result.articleIds.join(', ')}`, 'ok');
            await refreshWorkbench();
            await selectIssueDraft(selectedIssueDraftId());
        } catch (error) {
            setStatus('issue-status', error.message, 'error');
        }
    });
}

function selectView(viewName) {
    const requested = document.querySelector(`.admin-nav button[data-view="${viewName}"]`);
    const fallback = Array.from(document.querySelectorAll('.admin-nav button')).find(button => !button.disabled && !button.hidden);
    const activeView = requested && !requested.disabled && !requested.hidden
        ? viewName
        : (fallback?.dataset.view || 'manuscripts');
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${activeView}`));
    document.querySelectorAll('.admin-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === activeView));
    const [title, subtitle] = VIEW_TITLES[activeView] || VIEW_TITLES.submissions;
    $('view-title').textContent = title;
    $('view-subtitle').textContent = subtitle;
}

function bindNavigation() {
    document.querySelectorAll('.admin-nav button').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
    $('refresh-button').addEventListener('click', async () => {
        await refreshWorkbench();
        await state.authorPanel?.refreshAuthors();
        await refreshVolumes();
        await refreshAdminUsers();
        await refreshAuditLog();
    });
}

function bindLintFlow() {
    $('run-lint-button').addEventListener('click', async () => {
        $('lint-output').textContent = '检查中...\n';
        try {
            const result = await runLint();
            $('lint-output').textContent = [
                `${result.ok ? '通过' : '失败'} · ${result.summary?.errorCount || 0} 个错误 · ${result.summary?.warningCount || 0} 个警告`,
                ...(result.issues || []).map(issue => `${issue.severity}: ${issue.message}`),
                result.stdout || '',
                result.stderr || ''
            ].filter(Boolean).join('\n\n');
        } catch (error) {
            $('lint-output').textContent = error.message;
        }
    });
}

function renderPublishedList() {
    const list = $('published-list');
    list.innerHTML = '';
    const issue = selectedAdminIssue();
    const articles = issue ? (issue.publishedArticles || []) : state.published;
    articles.forEach(article => {
        list.appendChild(compactItem({
            active: state.selectedPublished?.articleId === article.articleId,
            title: article.title || article.articleId,
            subtitle: `${article.articleId}${article.description ? ` · ${article.description}` : ''}`,
            onClick: async () => {
                state.selectedPublished = await getPublished(article.articleId);
                $('published-editor').value = state.selectedPublished.indexContent || '';
                renderFileList($('published-files'), state.selectedPublished.files || []);
                await refreshPublishedHistory();
                renderPublishedList();
                syncActionState();
            }
        }));
    });
    if (!articles.length) list.innerHTML = '<div class="compact-item"><small>暂无已发布文章</small></div>';
}

async function refreshPublished() {
    if (!state.permissions.canEditPublished && !state.permissions.canUnpublish) return;
    await refreshWorkbench();
}

function renderUnpublishedList() {
    const list = $('unpublished-list');
    list.innerHTML = '';
    const issue = selectedAdminIssue();
    const articles = issue ? (issue.unpublishedArticles || []) : state.unpublished;
    articles.forEach(article => {
        list.appendChild(compactItem({
            active: state.selectedUnpublished?.articleId === article.articleId,
            title: article.title || article.articleId,
            subtitle: article.articleId,
            onClick: () => {
                state.selectedUnpublished = article;
                renderUnpublishedList();
                syncActionState();
            }
        }));
    });
    if (!articles.length) list.innerHTML = '<div class="compact-item"><small>暂无已下线文章</small></div>';
}

async function refreshUnpublished() {
    if (!state.permissions.canUnpublish) return;
    const data = await listUnpublished();
    state.unpublished = data.articles || [];
    renderUnpublishedList();
}

async function refreshPublishedHistory() {
    const list = $('published-history-list');
    list.innerHTML = '';
    if (!state.selectedPublished || !state.permissions.canViewPublishedHistory) {
        state.selectedPublishedSnapshotId = '';
        list.innerHTML = '<div class="compact-item"><small>未选择历史快照</small></div>';
        return;
    }
    const data = await listPublishedHistory(state.selectedPublished.articleId);
    const snapshots = data.snapshots || [];
    if (!snapshots.some(snapshot => snapshot.snapshotId === state.selectedPublishedSnapshotId)) {
        state.selectedPublishedSnapshotId = '';
    }
    snapshots.forEach(snapshot => {
        list.appendChild(compactItem({
            active: state.selectedPublishedSnapshotId === snapshot.snapshotId,
            title: snapshot.reason || snapshot.snapshotId,
            subtitle: snapshot.at || snapshot.snapshotId,
            onClick: () => {
                state.selectedPublishedSnapshotId = snapshot.snapshotId;
                refreshPublishedHistory();
                syncActionState();
            }
        }));
    });
    if (!snapshots.length) list.innerHTML = '<div class="compact-item"><small>暂无历史快照</small></div>';
    syncActionState();
}

function bindPublishedFlow() {
    $('refresh-published-button').addEventListener('click', refreshPublished);
    $('published-files-input').addEventListener('change', () => {
        state.selectedPublishedFiles = normalizeFileSelection($('published-files-input').files);
        setStatus('published-status', `已选择 ${state.selectedPublishedFiles.length} 个已发布资源文件`);
    });
    $('save-published-button').addEventListener('click', async () => {
        try {
            if (!state.selectedPublished) return;
            const files = await Promise.all(state.selectedPublishedFiles.map(toAdminFilePayload));
            state.selectedPublished = await updatePublished(state.selectedPublished.articleId, {
                indexContent: $('published-editor').value,
                files,
                deleteFiles: parsePathList($('published-delete-files').value)
            });
            state.selectedPublishedFiles = [];
            $('published-files-input').value = '';
            $('published-delete-files').value = '';
            renderFileList($('published-files'), state.selectedPublished.files || []);
            await refreshPublishedHistory();
            setStatus('published-status', `已保存 ${state.selectedPublished.articleId}`, 'ok');
            await refreshPublished();
        } catch (error) {
            setStatus('published-status', error.message, 'error');
        }
    });
    $('unpublish-button').addEventListener('click', async () => {
        try {
            if (!state.selectedPublished) return;
            await unpublishArticle(state.selectedPublished.articleId);
            setStatus('published-status', `已下线 ${state.selectedPublished.articleId}`, 'ok');
            state.selectedPublished = null;
            $('published-editor').value = '';
            $('published-files').innerHTML = '';
            await refreshPublished();
        } catch (error) {
            setStatus('published-status', error.message, 'error');
        }
    });
    $('restore-button').addEventListener('click', async () => {
        try {
            const articleId = state.selectedUnpublished?.articleId;
            if (!articleId) return;
            await restoreArticle(articleId);
            state.selectedUnpublished = null;
            setStatus('published-status', `已恢复 ${articleId}`, 'ok');
            await refreshPublished();
        } catch (error) {
            setStatus('published-status', error.message, 'error');
        }
    });
    $('rollback-button').addEventListener('click', async () => {
        try {
            if (!state.selectedPublished || !state.selectedPublishedSnapshotId) return;
            state.selectedPublished = await rollbackPublished(state.selectedPublished.articleId, state.selectedPublishedSnapshotId);
            $('published-editor').value = state.selectedPublished.indexContent || '';
            renderFileList($('published-files'), state.selectedPublished.files || []);
            await refreshPublishedHistory();
            setStatus('published-status', `已回滚 ${state.selectedPublished.articleId}`, 'ok');
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
            <strong>${escapeHtml(entry.action || '-')}</strong>
            <small>${escapeHtml(entry.actor || '-')}${entry.at ? ` · ${escapeHtml(entry.at)}` : ''}</small>
            <small>${escapeHtml(entry.submissionId || entry.manuscriptId || entry.issueDraftId || entry.articleId || entry.authorId || entry.username || entry.vol || '')}</small>
        </div>
    `).join('') || '<div class="compact-item"><small>暂无审计记录</small></div>';
}

function bindAuditFlow() {
    $('refresh-audit-button').addEventListener('click', () => refreshAuditLog().catch(error => console.error(error)));
}

async function refreshVolumes() {
    if (!state.permissions.canManageVolumes) return;
    const data = await listVolumes();
    const list = $('volume-list');
    list.innerHTML = '';
    (data.volumes || []).forEach(volume => {
        list.appendChild(compactItem({
            title: `vol-${volume.vol}`,
            subtitle: `${Number(volume.contributions || 0).toLocaleString()} 篇投稿`,
            onClick: () => {
                $('volume-id').value = volume.vol;
                $('volume-radar').value = volume.radarContent || '';
                setStatus('volume-status', `已选择 vol-${volume.vol}`);
            }
        }));
    });
    if (!data.volumes?.length) list.innerHTML = '<div class="compact-item"><small>暂无卷期</small></div>';
}

function bindVolumeFlow() {
    $('create-volume-button').addEventListener('click', async () => {
        try {
            const result = await createVolume($('volume-id').value.trim(), $('volume-radar').value);
            setStatus('volume-status', `已新建 vol-${result.vol}`, 'ok');
            await refreshVolumes();
            await refreshWorkbench();
            state.selectedIssueVol = result.vol;
            selectAdminIssue(result.vol);
        } catch (error) {
            setStatus('volume-status', error.message, 'error');
        }
    });
    $('update-volume-button').addEventListener('click', async () => {
        try {
            const result = await updateVolumeRadar($('volume-id').value.trim(), $('volume-radar').value);
            setStatus('volume-status', `已更新 vol-${result.vol}`, 'ok');
            await refreshVolumes();
            await refreshWorkbench();
            state.selectedIssueVol = result.vol;
            selectAdminIssue(result.vol);
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
        list.appendChild(compactItem({
            title: user.displayName || user.username,
            subtitle: `${user.username} · ${ROLE_LABELS[user.role] || user.role}${user.disabled ? ' · 已停用' : ''}`,
            onClick: () => {
                $('user-username').value = user.username;
                $('user-display-name').value = user.displayName || '';
                $('user-role').value = user.role || '';
                $('user-password').value = '';
                setStatus('user-status', `已选择 ${user.username}`);
            }
        }));
    });
    if (!data.users?.length) list.innerHTML = '<div class="compact-item"><small>暂无用户</small></div>';
}

function bindUserFlow() {
    $('create-user-button').addEventListener('click', async () => {
        try {
            const result = await createAdminUser(readAdminUserForm());
            $('user-password').value = '';
            setStatus('user-status', `已新建 ${result.user.username}`, 'ok');
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
            setStatus('user-status', `已更新 ${result.user.username}`, 'ok');
            await refreshAdminUsers();
        } catch (error) {
            setStatus('user-status', error.message, 'error');
        }
    });
    $('disable-user-button').addEventListener('click', async () => {
        try {
            const result = await disableAdminUser($('user-username').value.trim());
            setStatus('user-status', `已停用 ${result.user.username}`, 'ok');
            await refreshAdminUsers();
        } catch (error) {
            setStatus('user-status', error.message, 'error');
        }
    });
    $('enable-user-button').addEventListener('click', async () => {
        try {
            const result = await enableAdminUser($('user-username').value.trim());
            setStatus('user-status', `已启用 ${result.user.username}`, 'ok');
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
    selectView(document.querySelector('.admin-nav button.active:not([hidden])')?.dataset.view || 'submissions');
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
            await refreshWorkbench();
            await state.authorPanel?.refreshAuthors();
            renderAcceptAuthorOptions();
            await refreshVolumes();
            await refreshAdminUsers();
            await refreshAuditLog();
        },
        onSignedOut: showLogin
    });
    bindNavigation();
    bindSubmissionFlow();
    bindManuscriptFlow();
    bindIssueDraftFlow();
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
    await refreshWorkbench();
    await state.authorPanel.refreshAuthors();
    renderAcceptAuthorOptions();
    await refreshVolumes();
    await refreshAdminUsers();
    await refreshAuditLog();
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
        showLogin();
        setStatus('login-status', error.message, 'error');
    });
});
