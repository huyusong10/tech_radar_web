import {
    acceptSubmission,
    addIssueDraftManuscript,
    archiveManuscript,
    createAdminUser,
    createIssueDraft,
    createVolume,
    deleteManuscript,
    discardManuscriptEdit,
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
    removeIssueDraftManuscript,
    removeSubmissionFromQueue,
    restoreArticle,
    restoreManuscript,
    acceptManuscriptEdit,
    issueManuscriptEditLink,
    reviewIssueDraft,
    rollbackPublished,
    runLint,
    unpublishArticle,
    updateAdminUser,
    updateIssueDraft,
    updatePublished,
    updateVolumeRadar
} from './api.js';
import { bindAuth, restoreSession } from './auth.js';
import { bindAuthorPanel } from './authors.js';
import { applyPermissionState, ROLE_LABELS } from './permissions.js';
import { buildDraftAssetResolver, buildLocalAssetResolver, renderPreview } from './preview.js';

const state = {
    user: null,
    permissions: {},
    submissions: [],
    manuscripts: [],
    manuscriptCounts: {},
    manuscriptPagination: { scope: 'candidate', page: 1, pageSize: 50, total: 0, totalPages: 1 },
    manuscriptScope: 'candidate',
    manuscriptQuery: '',
    manuscriptPage: 1,
    manuscriptPageSize: 50,
    issueAvailableManuscripts: [],
    issueDrafts: [],
    issues: [],
    selectedSubmission: null,
    selectedManuscript: null,
    selectedIssueDraft: null,
    selectedReviewIssueDraft: null,
    selectedIssueVol: '',
    selectedIssueManuscriptId: '',
    selectedIssueAvailableManuscriptId: '',
    published: [],
    selectedPublished: null,
    unpublished: [],
    selectedUnpublished: null,
    selectedPublishedFiles: [],
    selectedPublishedSnapshotId: '',
    authorPanel: null,
    previewReturnFocus: null,
    workbenchRefreshPromise: null,
    selectionTokens: {
        submission: 0,
        manuscript: 0,
        issueDraft: 0,
        reviewIssueDraft: 0
    }
};

let manuscriptSearchTimer = null;

const MANUSCRIPT_STATUS_LABELS = {
    drafting: '已入池',
    manuscript_review_requested: '已入池',
    changes_requested: '已入池',
    available: '已入池',
    scheduled: '已入池',
    published: '已入池',
    archived: '已归档'
};

const MANUSCRIPT_EDIT_STATUS_LABELS = {
    idle: '无修改',
    editing: '修改中',
    pending_review: '修改待确认'
};

const MANUSCRIPT_SCOPE_LABELS = {
    candidate: '候选稿件',
    editing: '修改待处理',
    scheduled: '已组刊',
    published: '已发布',
    archived: '归档',
    all: '全部'
};

const ISSUE_STATUS_LABELS = {
    editing: '草稿编排',
    issue_review_requested: '待整期审核',
    changes_requested: '需调整',
    approved: '审核通过',
    published: '审核通过',
    archived: '已归档'
};

const ISSUE_FLOW_STEPS = [
    { key: 'compose', label: '草稿编排', statuses: ['editing', 'changes_requested'] },
    { key: 'review', label: '整期审核', statuses: ['issue_review_requested'] },
    { key: 'approved', label: '审核通过', statuses: ['approved', 'published'] }
];

const ISSUE_MANAGEMENT_STATUS_LABELS = {
    editing: '草稿中',
    issue_review_requested: '待整期审核',
    approved: '已审核待发布',
    published: '已发布',
    archived: '已归档',
    empty: '未编排'
};

const SUBMISSION_STATUS_LABELS = {
    submitted: '未接收，可修改',
    in_editor_review: '未接收，可修改',
    changes_requested: '未接收，可修改',
    accepted: '已接收入池',
    rejected: '未接收，可修改',
    published: '已发布'
};

const VIEW_TITLES = {
    submissions: ['投稿初审', '预览投稿、接收入池或复制投稿链接'],
    manuscripts: ['稿件池', '管理候选稿件资产、修改链接与组刊去向'],
    reviews: ['审核任务', '处理待审核整期期刊草稿'],
    issues: ['期刊管理', '按卷期管理组稿草稿、发布上线与内容维护'],
    authors: ['作者管理', '作者入库、修改、头像与合并'],
    users: ['人员权限', '维护后台用户和角色'],
    audit: ['操作日志', '查看关键后台操作记录']
};

const ACTION_LABELS = {
    create_submission: '创建投稿',
    submitter_revision: '投稿者修改',
    accepted: '已接收',
    rejected: '历史处理',
    request_changes: '历史处理',
    approve: '历史审核通过',
    request_review: '提交审核',
    published: '已发布',
    accept_edit: '采用修改',
    discard_edit: '放弃修改',
    manuscript_edit_accepted: '稿件修改已采用'
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

function getManuscriptStatus(record) {
    return record?.meta?.status || record?.status || '';
}

function getManuscriptEditStatus(record) {
    return record?.meta?.editStatus || record?.editStatus || 'idle';
}

function getManuscriptScheduledIssue(record) {
    return record?.meta?.scheduledIssueDraftId || record?.scheduledIssueDraftId || '';
}

function getManuscriptPublishedArticle(record) {
    return record?.meta?.publishedArticleId || record?.publishedArticleId || '';
}

function getManuscriptLifecycle(record) {
    if (record?.lifecycle) return record.lifecycle;
    const status = getManuscriptStatus(record);
    const scheduledIssueDraftId = getManuscriptScheduledIssue(record);
    const publishedArticleId = getManuscriptPublishedArticle(record);
    const assetStatus = status === 'archived' ? 'archived' : 'active';
    const usageStatus = publishedArticleId || status === 'published'
        ? 'published'
        : (scheduledIssueDraftId || status === 'scheduled' ? 'scheduled' : 'unassigned');
    const editStatus = getManuscriptEditStatus(record);
    const isFreeAsset = assetStatus === 'active' && usageStatus === 'unassigned';
    const isRestoreCandidate = assetStatus === 'archived' && usageStatus === 'unassigned' && editStatus === 'idle';
    return {
        assetStatus,
        usageStatus,
        scheduledIssueDraftId,
        publishedArticleId,
        editStatus,
        canJoinIssue: isFreeAsset,
        canDelete: isFreeAsset,
        canArchive: isFreeAsset && editStatus === 'idle',
        canRestore: isRestoreCandidate
    };
}

function manuscriptUsageLabel(record) {
    const lifecycle = getManuscriptLifecycle(record);
    if (lifecycle.assetStatus === 'archived') return '已归档';
    if (lifecycle.usageStatus === 'published') return '已发布';
    if (lifecycle.usageStatus === 'scheduled') {
        return lifecycle.scheduledIssueDraftId
            ? `已加入 ${lifecycle.scheduledIssueDraftId}`
            : '已加入期刊草稿';
    }
    return '未组刊';
}

function manuscriptCardUsageLabel(record) {
    const lifecycle = getManuscriptLifecycle(record);
    if (lifecycle.assetStatus === 'archived') return '已归档';
    if (lifecycle.usageStatus === 'published') return '已发布';
    if (lifecycle.usageStatus === 'scheduled') return '已加入期刊草稿';
    return '未组刊';
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function parseSimpleFrontmatter(indexContent = '') {
    const source = String(indexContent || '');
    const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    const metadata = {};
    if (!match) return { metadata, body: source };

    match[1].split('\n').forEach(line => {
        const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!pair) return;
        const raw = pair[2].trim();
        const value = raw.replace(/^['"]|['"]$/g, '');
        if (raw.startsWith('[') && raw.endsWith(']')) {
            metadata[pair[1]] = raw.slice(1, -1)
                .split(',')
                .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean);
        } else {
            metadata[pair[1]] = value;
        }
    });

    return { metadata, body: source.slice(match[0].length) };
}

function extractFirstHeading(body = '') {
    const match = String(body || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '';
}

function manuscriptDocumentSummary(detail) {
    const parsed = parseSimpleFrontmatter(detail?.indexContent || '');
    const metadata = parsed.metadata;
    const authorIds = Array.isArray(metadata.author_ids)
        ? metadata.author_ids
        : (metadata.author_id ? [metadata.author_id] : []);
    const nonWhitespaceLength = parsed.body.replace(/\s+/g, '').length;
    return {
        title: metadata.title || extractFirstHeading(parsed.body) || detail?.meta?.manuscriptId || '-',
        description: metadata.description || '-',
        authorIds,
        bodyLength: nonWhitespaceLength
    };
}

function renderFactGrid(container, facts = []) {
    container.innerHTML = facts.map(item => `
        <div class="detail-fact" title="${escapeHtml(item.value)}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value || '-')}</strong>
        </div>
    `).join('');
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
            name: file.name,
            relativePath: rootPrefix && rawPath.startsWith(rootPrefix)
                ? rawPath.slice(rootPrefix.length)
                : rawPath.split('/').pop(),
            size: file.size,
            objectUrl: URL.createObjectURL(file)
        };
    }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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

function composeAssetResolvers(...resolvers) {
    return rawPath => {
        for (const resolver of resolvers) {
            if (!resolver) continue;
            const resolved = resolver(rawPath);
            if (resolved !== rawPath) return resolved;
        }
        return rawPath;
    };
}

function previewTitle(fallback, detail) {
    return detail?.meta?.title || detail?.title || fallback;
}

function showPreviewDialog(title, indexContent, assetResolver) {
    const dialog = $('admin-preview-dialog');
    const surface = $('admin-preview-surface');
    const activeElement = document.activeElement;
    state.previewReturnFocus = typeof activeElement?.focus === 'function' ? activeElement : null;
    $('admin-preview-title').textContent = title || '预览';
    surface.innerHTML = '';
    renderPreview(surface, indexContent || '', assetResolver);
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    $('admin-preview-close-button').focus();
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    return false;
}

function closePreviewDialog() {
    const dialog = $('admin-preview-dialog');
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
    $('admin-preview-surface').innerHTML = '';
    document.body.classList.remove('modal-open');
    state.previewReturnFocus?.focus?.();
    state.previewReturnFocus = null;
}

function renderStatusPills(pill, pillTone = 'neutral', badges = null) {
    const items = Array.isArray(badges)
        ? badges
        : (pill ? [{ label: pill, tone: pillTone }] : []);
    const rendered = items
        .filter(item => item?.label)
        .map(item => `<span class="status-pill is-${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.label)}</span>`)
        .join('');
    return rendered ? `<span class="status-pill-row">${rendered}</span>` : '';
}

function compactItem({ active, pill, pillTone = 'neutral', badges, title, subtitle, onClick, className = '' }) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `compact-item${className ? ` ${className}` : ''}${active ? ' active' : ''}`;
    item.innerHTML = `
        ${renderStatusPills(pill, pillTone, badges)}
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

function selectedReviewIssueDraftId() {
    return state.selectedReviewIssueDraft?.meta?.issueDraftId;
}

function selectedAdminIssue() {
    return state.issues.find(issue => issue.vol === state.selectedIssueVol) || null;
}

function workflowStepIndex(steps, status) {
    return steps.findIndex(step => step.statuses.includes(status));
}

function renderWorkflowMarkers(container, markers = []) {
    container.innerHTML = markers.map(marker => `
        <span class="workflow-marker is-${escapeHtml(marker.tone || 'neutral')}">
            <small>${escapeHtml(marker.label)}</small>
            <strong>${escapeHtml(marker.value)}</strong>
        </span>
    `).join('');
    container.hidden = markers.length === 0;
}

function manuscriptUsageTone(record) {
    const lifecycle = getManuscriptLifecycle(record);
    if (lifecycle.assetStatus === 'archived') return 'muted';
    if (lifecycle.usageStatus === 'published') return 'success';
    if (lifecycle.usageStatus === 'scheduled') return 'info';
    return 'neutral';
}

function manuscriptEditTone(editStatus) {
    if (editStatus === 'pending_review') return 'danger';
    if (editStatus === 'editing') return 'warning';
    return 'muted';
}

function renderWorkflowSteps(container, { steps, status, labels, currentIndex }) {
    container.innerHTML = steps.map((step, index) => {
        const stateName = index < currentIndex ? 'complete' : (index === currentIndex ? 'current' : 'pending');
        const currentStatus = step.statuses.includes(status) ? labelFrom(labels, status) : '';
        return `
            <li class="workflow-step is-${stateName}"${index === currentIndex ? ' aria-current="step"' : ''}>
                <span class="flow-node">${index + 1}</span>
                <strong>${escapeHtml(step.label)}</strong>
                ${currentStatus ? `<small>${escapeHtml(currentStatus)}</small>` : ''}
            </li>
        `;
    }).join('');
}

function manuscriptAssetCopy(detail) {
    if (!detail) return ['未选择稿件', '从左侧选择一篇稿件后查看去向、修改状态和可执行动作。'];
    const lifecycle = getManuscriptLifecycle(detail);
    if (lifecycle.assetStatus === 'archived') {
        return ['已归档稿件', '这篇稿件已归档，不再参与组刊、修改或发布流程。'];
    }
    if (lifecycle.usageStatus === 'published') {
        return ['已发布稿件', '这篇稿件已经发布。后续修改仍通过独立修改链接提交和确认。'];
    }
    if (lifecycle.usageStatus === 'scheduled') {
        return ['已加入期刊草稿', '这篇稿件已被某期草稿引用。采用修改后，相关整期草稿需要重新确认。'];
    }
    return ['候选稿件资产', '这篇稿件已在稿件池中，可直接加入期刊草稿或通过修改链接维护。'];
}

function manuscriptAssetMarkers(detail) {
    if (!detail) return [];
    const lifecycle = getManuscriptLifecycle(detail);
    const editStatus = lifecycle.editStatus || getManuscriptEditStatus(detail);
    return [
        {
            label: '资产',
            value: lifecycle.assetStatus === 'archived' ? '已归档' : '有效',
            tone: lifecycle.assetStatus === 'archived' ? 'muted' : 'success'
        },
        {
            label: '去向',
            value: manuscriptUsageLabel(detail),
            tone: manuscriptUsageTone(detail)
        },
        {
            label: '修改',
            value: labelFrom(MANUSCRIPT_EDIT_STATUS_LABELS, editStatus),
            tone: manuscriptEditTone(editStatus)
        },
        {
            label: '删除',
            value: lifecycle.canDelete ? '可删除' : '被引用',
            tone: lifecycle.canDelete ? 'muted' : 'warning'
        }
    ];
}

function manuscriptListMarker(manuscript) {
    const editStatus = getManuscriptEditStatus(manuscript);
    if (editStatus === 'pending_review') return '修改待确认';
    if (editStatus === 'editing') return '修改中';
    return manuscriptUsageLabel(manuscript);
}

function renderManuscriptAssetPanel(detail) {
    const [title, description] = manuscriptAssetCopy(detail);
    $('manuscript-asset-title').textContent = title;
    $('manuscript-asset-description').textContent = description;
    renderWorkflowMarkers($('manuscript-asset-markers'), manuscriptAssetMarkers(detail));
}

function issueFlowCopy(detail) {
    const status = detail?.meta?.status;
    const copy = {
        editing: [
            '草稿编排',
            '正在组织本期稿件和 radar 内容，准备好后可以提交整期审核。'
        ],
        issue_review_requested: [
            '等待整期审核',
            '这份期刊草稿正在等待审核。审核通过后，整期流程到达终点。'
        ],
        changes_requested: [
            '需要调整',
            '整期审核已退回。调整稿件编排或 radar 内容后，可以重新提交审核。'
        ],
        approved: [
            '审核通过',
            '整期审核已完成。是否发布是后续发布标记，不再作为审核流程步骤。'
        ],
        published: [
            '审核通过',
            '整期审核已完成，发布结果在标记中单独呈现。'
        ],
        archived: [
            '已归档',
            '这份期刊草稿已归档，通常不再参与审核或发布流程。'
        ]
    };
    return copy[status] || ['未选择草稿', '从左侧选择一个期刊草稿后查看流程位置和可执行动作。'];
}

function issueLifecycleMarkers(detail) {
    if (!detail) return [];
    const status = detail.meta?.status;
    if (status === 'approved') {
        return [{ label: '发布标记', value: '待发布', tone: 'muted' }];
    }
    if (status === 'published') {
        return [{ label: '发布标记', value: '已发布', tone: 'active' }];
    }
    if (status === 'archived') {
        return [{ label: '归档标记', value: '已归档', tone: 'muted' }];
    }
    return [];
}

function issueDraftListMarker(issue) {
    if (issue.status === 'approved') return '待发布';
    if (issue.status === 'published') return '已发布';
    if (issue.status === 'archived') return '已归档';
    return '';
}

function renderIssueFlow(detail) {
    const title = $('issue-flow-title');
    const description = $('issue-flow-description');
    const steps = $('issue-flow-steps');
    const markers = $('issue-flow-markers');
    const status = detail?.meta?.status;
    const currentIndex = detail ? workflowStepIndex(ISSUE_FLOW_STEPS, status) : -1;
    const [flowTitle, flowDescription] = issueFlowCopy(detail);

    title.textContent = flowTitle;
    description.textContent = flowDescription;
    renderWorkflowMarkers(markers, issueLifecycleMarkers(detail));
    renderWorkflowSteps(steps, {
        steps: ISSUE_FLOW_STEPS,
        status,
        labels: ISSUE_STATUS_LABELS,
        currentIndex
    });
}

function renderManuscriptDetailCards(detail) {
    const emptyFacts = [
        { label: '标题', value: '-' },
        { label: '稿件 ID', value: '-' },
        { label: '作者', value: '-' },
        { label: '正文长度', value: '-' }
    ];
    if (!detail) {
        renderFactGrid($('manuscript-info-facts'), emptyFacts);
        renderFactGrid($('manuscript-route-facts'), [
            { label: '来源投稿', value: '-' },
            { label: '期刊草稿', value: '-' },
            { label: '发布文章', value: '-' },
            { label: '更新时间', value: '-' }
        ]);
        renderFileList($('manuscript-file-list'), []);
        renderReviewHistory($('manuscript-review-history'), []);
        return;
    }

    const summary = manuscriptDocumentSummary(detail);
    const files = detail.files || [];
    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const pendingEdit = detail.pendingEdit;
    const lifecycle = getManuscriptLifecycle(detail);
    renderFactGrid($('manuscript-info-facts'), [
        { label: '标题', value: summary.title },
        { label: '摘要', value: summary.description },
        { label: '作者', value: summary.authorIds.join(', ') || '-' },
        { label: '正文长度', value: `${summary.bodyLength.toLocaleString()} 字符` },
        { label: '责任人', value: detail.meta?.assignee || '-' },
        { label: '资源规模', value: `${files.length} 个文件 · ${totalSize.toLocaleString()} 字节` }
    ]);
    renderFactGrid($('manuscript-route-facts'), [
        { label: '稿件 ID', value: detail.meta?.manuscriptId || '-' },
        { label: '来源投稿', value: detail.meta?.sourceSubmissionId || '-' },
        { label: '稿件去向', value: manuscriptUsageLabel(detail) },
        { label: '期刊草稿', value: lifecycle.scheduledIssueDraftId || '未加入' },
        { label: '发布文章', value: lifecycle.publishedArticleId || '未发布' },
        { label: '修改状态', value: labelFrom(MANUSCRIPT_EDIT_STATUS_LABELS, lifecycle.editStatus || 'idle') },
        { label: '待确认包', value: pendingEdit ? `${pendingEdit.files?.length || 0} 个文件` : '-' },
        { label: '创建时间', value: formatDateTime(detail.meta?.createdAt) },
        { label: '更新时间', value: formatDateTime(detail.meta?.updatedAt) }
    ]);
    renderFileList($('manuscript-file-list'), files);
    renderReviewHistory($('manuscript-review-history'), detail.review?.history || []);
}

function renderMetrics() {
    const counts = state.manuscriptCounts || {};
    const reviewDraftCount = state.issueDrafts.filter(issue => issue.status === 'issue_review_requested').length;
    const publishedMaintenanceCount = state.issues.reduce((sum, issue) => (
        sum + Number(issue.counts?.published || 0) + Number(issue.counts?.unpublished || 0)
    ), 0);
    $('metric-submissions').textContent = counts.candidate ?? 0;
    $('metric-pending-edits').textContent = counts.pendingReview ?? 0;
    $('metric-unassigned-manuscripts').textContent = reviewDraftCount;
    $('metric-issue-drafts').textContent = publishedMaintenanceCount;
}

function renderManuscriptScopeTabs() {
    const counts = state.manuscriptCounts || {};
    document.querySelectorAll('[data-manuscript-scope]').forEach(button => {
        const scope = button.dataset.manuscriptScope;
        button.classList.toggle('active', scope === state.manuscriptScope);
        const counter = button.querySelector('span');
        if (counter) counter.textContent = counts[scope] ?? 0;
    });
}

function renderManuscriptPager() {
    const pagination = state.manuscriptPagination || { page: 1, totalPages: 1, total: 0 };
    $('manuscript-page-info').textContent = `${pagination.page || 1} / ${pagination.totalPages || 1} · ${pagination.total || 0}`;
    $('manuscript-prev-page-button').disabled = (pagination.page || 1) <= 1;
    $('manuscript-next-page-button').disabled = (pagination.page || 1) >= (pagination.totalPages || 1);
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
    renderManuscriptScopeTabs();
    renderManuscriptPager();
    state.manuscripts.forEach(manuscript => {
        const editStatus = getManuscriptEditStatus(manuscript);
        const badges = [
            { label: manuscriptCardUsageLabel(manuscript), tone: manuscriptUsageTone(manuscript) }
        ];
        if (editStatus !== 'idle') {
            badges.push({
                label: labelFrom(MANUSCRIPT_EDIT_STATUS_LABELS, editStatus),
                tone: manuscriptEditTone(editStatus)
            });
        }
        const cardClass = editStatus === 'pending_review'
            ? 'is-edit-pending'
            : (editStatus === 'editing' ? 'is-editing' : '');
        const subtitleParts = [
            manuscript.authorIds?.join(', ') || '作者 -',
            manuscript.manuscriptId
        ].filter(Boolean);
        list.appendChild(compactItem({
            active: selectedManuscriptId() === manuscript.manuscriptId,
            badges,
            title: manuscript.title || manuscript.manuscriptId,
            subtitle: subtitleParts.join(' · '),
            className: cardClass,
            onClick: () => selectManuscript(manuscript.manuscriptId)
        }));
    });
    if (!state.manuscripts.length) {
        const scopeLabel = MANUSCRIPT_SCOPE_LABELS[state.manuscriptScope] || '稿件';
        list.innerHTML = `<div class="compact-item"><small>暂无${escapeHtml(scopeLabel)}</small></div>`;
    }
}

function renderReviewTaskLists() {
    const issueList = $('review-issue-list');
    if (!issueList) return;

    issueList.innerHTML = '';
    const reviewIssues = state.issueDrafts.filter(issue => issue.status === 'issue_review_requested');
    reviewIssues.forEach(issue => {
        issueList.appendChild(compactItem({
            active: selectedReviewIssueDraftId() === issue.issueDraftId,
            pill: labelFrom(ISSUE_STATUS_LABELS, issue.status),
            title: issue.title || `vol-${issue.vol}`,
            subtitle: `vol-${issue.vol} · ${(issue.manuscripts || []).length} 篇稿件`,
            onClick: () => selectReviewIssueDraft(issue.issueDraftId)
        }));
    });
    if (!reviewIssues.length) issueList.innerHTML = '<div class="compact-item"><small>暂无待审期刊</small></div>';
}

function selectedReviewTask() {
    return state.selectedReviewIssueDraft?.meta?.status === 'issue_review_requested'
        ? state.selectedReviewIssueDraft
        : null;
}

function renderReviewTaskDetail() {
    const detail = selectedReviewTask();
    const title = $('review-task-title');
    const description = $('review-task-description');
    const markers = $('review-task-markers');
    const facts = $('review-task-facts');
    const history = $('review-issue-history');
    if (!title || !description || !markers || !facts || !history) return;

    if (!detail) {
        title.textContent = '未选择待审核期刊';
        description.textContent = '从左侧选择一份待审核草稿后，查看整期状态、运行内容检查并给出审核结论。';
        renderWorkflowMarkers(markers, []);
        renderFactGrid(facts, [
            { label: '卷期', value: '-' },
            { label: '稿件数', value: '-' },
            { label: '状态', value: '-' },
            { label: '更新时间', value: '-' }
        ]);
        renderReviewHistory(history, []);
        return;
    }

    const meta = detail.meta || {};
    const manuscriptCount = (meta.manuscripts || []).length;
    title.textContent = meta.title || `vol-${meta.vol}`;
    description.textContent = '这份草稿已进入整期技术审核。审核通过后，发布动作回到期刊管理的组稿草稿工作区。';
    renderWorkflowMarkers(markers, [
        { label: '审核', value: labelFrom(ISSUE_STATUS_LABELS, meta.status), tone: 'warning' },
        { label: '卷期', value: `vol-${meta.vol || '-'}`, tone: 'info' },
        { label: '稿件', value: `${manuscriptCount} 篇`, tone: manuscriptCount ? 'success' : 'muted' }
    ]);
    renderFactGrid(facts, [
        { label: '草稿 ID', value: meta.issueDraftId || '-' },
        { label: '卷期', value: meta.vol || '-' },
        { label: '稿件数', value: `${manuscriptCount} 篇` },
        { label: '状态', value: labelFrom(ISSUE_STATUS_LABELS, meta.status) },
        { label: '创建时间', value: formatDateTime(meta.createdAt) },
        { label: '更新时间', value: formatDateTime(meta.updatedAt) }
    ]);
    renderReviewHistory(history, detail.review?.history || []);
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
        const subtitleParts = [
            `vol-${issue.vol}`,
            `${(issue.manuscripts || []).length} 篇稿件`,
            issueDraftListMarker(issue)
        ].filter(Boolean);
        list.appendChild(compactItem({
            active: selectedIssueDraftId() === issue.issueDraftId,
            pill: labelFrom(ISSUE_STATUS_LABELS, issue.status),
            title: issue.title || issue.issueDraftId,
            subtitle: subtitleParts.join(' · '),
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
    if (!selectedIssueDraftId() || !['editing', 'changes_requested'].includes(state.selectedIssueDraft?.meta?.status)) {
        list.innerHTML = '<div class="compact-item"><small>先选择可编辑期刊草稿</small></div>';
        return;
    }
    const scheduledIds = new Set((state.selectedIssueDraft?.meta?.manuscripts || []).map(item => item.manuscriptId));
    const available = state.issueAvailableManuscripts.filter(manuscript => getManuscriptLifecycle(manuscript).canJoinIssue && !scheduledIds.has(manuscript.manuscriptId));
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
    renderFileList($('submission-files'), detail.files || []);
    syncActionState();
}

function renderManuscriptDetail() {
    const detail = state.selectedManuscript;
    renderManuscriptAssetPanel(detail);
    renderManuscriptDetailCards(detail);
    $('manuscript-edit-link').textContent = '';
    syncActionState();
}

function renderIssueDraftDetail() {
    const issue = state.selectedIssueDraft;
    renderIssueFlow(issue);
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
    renderReviewTaskDetail();
    renderAdminIssueList();
    renderIssueDraftList();
    renderIssueAvailableManuscriptList();
    renderPublishedList();
    renderUnpublishedList();
}

function syncActionState() {
    const submissionStatus = state.selectedSubmission?.meta?.status;
    const manuscriptStatus = state.selectedManuscript?.meta?.status;
    const manuscriptLifecycle = getManuscriptLifecycle(state.selectedManuscript);
    const manuscriptEditStatus = manuscriptLifecycle.editStatus || 'idle';
    const scheduledIssueDraftId = manuscriptLifecycle.scheduledIssueDraftId;
    const issueStatus = state.selectedIssueDraft?.meta?.status;
    const reviewIssueStatus = state.selectedReviewIssueDraft?.meta?.status;
    const issueDraftEditable = ['editing', 'changes_requested'].includes(issueStatus);
    $('preview-submission-button').disabled = !selectedSubmissionId();
    $('accept-submission-button').disabled = !selectedSubmissionId() || !state.permissions.canEditDraft || ['accepted', 'published'].includes(submissionStatus);
    $('issue-status-link-button').disabled = !selectedSubmissionId() || !state.permissions.canIssueStatusLink;
    $('remove-submission-button').disabled = !selectedSubmissionId() || !state.permissions.canEditDraft || ['accepted', 'published'].includes(submissionStatus);
    $('preview-manuscript-button').disabled = !selectedManuscriptId();
    $('issue-manuscript-edit-link-button').hidden = !selectedManuscriptId() || !state.permissions.canEditDraft || manuscriptStatus === 'archived';
    $('issue-manuscript-edit-link-button').disabled = $('issue-manuscript-edit-link-button').hidden;
    $('preview-manuscript-edit-button').hidden = !state.selectedManuscript?.pendingEdit;
    $('preview-manuscript-edit-button').disabled = $('preview-manuscript-edit-button').hidden;
    $('accept-manuscript-edit-button').hidden = !selectedManuscriptId() || !state.permissions.canEditDraft || manuscriptEditStatus !== 'pending_review';
    $('accept-manuscript-edit-button').disabled = $('accept-manuscript-edit-button').hidden;
    $('discard-manuscript-edit-button').hidden = !selectedManuscriptId() || !state.permissions.canEditDraft || !['editing', 'pending_review'].includes(manuscriptEditStatus);
    $('discard-manuscript-edit-button').disabled = $('discard-manuscript-edit-button').hidden;
    $('manuscript-go-issues-button').hidden = !selectedManuscriptId() || !manuscriptLifecycle.canJoinIssue || !state.permissions.canManageIssueDrafts;
    $('manuscript-go-issues-button').disabled = $('manuscript-go-issues-button').hidden;
    $('manuscript-open-issue-button').hidden = manuscriptLifecycle.usageStatus !== 'scheduled';
    $('manuscript-open-issue-button').disabled = !scheduledIssueDraftId;
    $('archive-manuscript-button').hidden = !selectedManuscriptId() || !state.permissions.canEditDraft || !manuscriptLifecycle.canArchive;
    $('archive-manuscript-button').disabled = $('archive-manuscript-button').hidden;
    $('restore-manuscript-button').hidden = !selectedManuscriptId() || !state.permissions.canEditDraft || !manuscriptLifecycle.canRestore;
    $('restore-manuscript-button').disabled = $('restore-manuscript-button').hidden;
    $('delete-manuscript-button').hidden = !selectedManuscriptId() || !state.permissions.canEditDraft || !manuscriptLifecycle.canDelete;
    $('delete-manuscript-button').disabled = $('delete-manuscript-button').hidden;
    $('create-issue-draft-button').hidden = !state.permissions.canManageIssueDrafts;
    $('create-issue-draft-button').disabled = !state.permissions.canManageIssueDrafts;
    $('save-issue-draft-button').hidden = !selectedIssueDraftId() || !state.permissions.canManageIssueDrafts || !issueDraftEditable;
    $('save-issue-draft-button').disabled = $('save-issue-draft-button').hidden;
    $('add-manuscript-to-issue-button').disabled = !selectedIssueDraftId() || !state.permissions.canManageIssueDrafts || !issueDraftEditable;
    $('remove-manuscript-from-issue-button').disabled = !selectedIssueDraftId() || !state.selectedIssueManuscriptId || !state.permissions.canManageIssueDrafts || !issueDraftEditable;
    $('request-issue-review-button').hidden = !selectedIssueDraftId() || !state.permissions.canManageIssueDrafts || !issueDraftEditable;
    $('request-issue-review-button').disabled = $('request-issue-review-button').hidden;
    $('approve-issue-button').hidden = !selectedReviewIssueDraftId() || !state.permissions.canReviewIssueDraft || reviewIssueStatus !== 'issue_review_requested';
    $('approve-issue-button').disabled = $('approve-issue-button').hidden;
    $('changes-issue-button').hidden = !selectedReviewIssueDraftId() || !state.permissions.canReviewIssueDraft || reviewIssueStatus !== 'issue_review_requested';
    $('changes-issue-button').disabled = $('changes-issue-button').hidden;
    $('preview-issue-button').hidden = !selectedIssueDraftId();
    $('preview-issue-button').disabled = !selectedIssueDraftId();
    $('review-preview-issue-button').disabled = !selectedReviewTask();
    $('publish-issue-button').hidden = !selectedIssueDraftId() || !state.permissions.canPublish || issueStatus !== 'approved';
    $('publish-issue-button').disabled = $('publish-issue-button').hidden;
    $('rollback-button').disabled = !state.selectedPublished || !state.selectedPublishedSnapshotId || !state.permissions.canRollbackPublished;
    $('restore-button').disabled = !state.selectedUnpublished || !state.permissions.canUnpublish;
    $('unpublish-button').disabled = !state.selectedPublished || !state.permissions.canUnpublish;
    $('preview-published-button').disabled = !state.selectedPublished;
    $('check-published-content-button').disabled = !state.selectedPublished || !state.permissions.canRunLint;
    $('save-published-button').disabled = !state.selectedPublished || !state.permissions.canEditPublished;
}

async function refreshWorkbench() {
    if (state.workbenchRefreshPromise) {
        return state.workbenchRefreshPromise;
    }

    const refreshButton = $('refresh-button');
    const wasDisabled = refreshButton?.disabled;
    if (refreshButton) refreshButton.disabled = true;

    state.workbenchRefreshPromise = (async () => {
        const manuscriptRequest = {
            scope: state.manuscriptScope,
            q: state.manuscriptQuery,
            page: state.manuscriptPage,
            pageSize: state.manuscriptPageSize
        };
        const [submissions, manuscripts, issueCandidates, issueDrafts, issues] = await Promise.all([
            listSubmissions(),
            listManuscripts(manuscriptRequest),
            listManuscripts({ scope: 'candidate', page: 1, pageSize: 200 }),
            listIssueDrafts(),
            listIssues()
        ]);
        state.submissions = submissions.submissions || [];
        state.manuscripts = manuscripts.manuscripts || [];
        state.manuscriptCounts = manuscripts.counts || {};
        state.manuscriptPagination = manuscripts.pagination || {
            scope: state.manuscriptScope,
            page: state.manuscriptPage,
            pageSize: state.manuscriptPageSize,
            total: state.manuscripts.length,
            totalPages: 1
        };
        state.manuscriptPage = state.manuscriptPagination.page || state.manuscriptPage;
        state.issueAvailableManuscripts = issueCandidates.manuscripts || [];
        state.issueDrafts = issueDrafts.issueDrafts || [];
        state.issues = issues.issues || [];
        state.published = state.issues.flatMap(issue => issue.publishedArticles || []);
        state.unpublished = state.issues.flatMap(issue => issue.unpublishedArticles || []);
        if (
            selectedReviewIssueDraftId() &&
            !state.issueDrafts.some(issue => issue.issueDraftId === selectedReviewIssueDraftId() && issue.status === 'issue_review_requested')
        ) {
            state.selectedReviewIssueDraft = null;
        }
        if (state.selectedIssueVol && !state.issues.some(issue => issue.vol === state.selectedIssueVol)) {
            state.selectedIssueVol = '';
        }
        renderAllLists();
        syncActionState();
    })().finally(() => {
        state.workbenchRefreshPromise = null;
        if (refreshButton) refreshButton.disabled = Boolean(wasDisabled);
        syncActionState();
    });

    return state.workbenchRefreshPromise;
}

async function selectSubmission(submissionId) {
    const token = ++state.selectionTokens.submission;
    const detail = await getSubmission(submissionId);
    if (token !== state.selectionTokens.submission) return;
    state.selectedSubmission = detail;
    renderAllLists();
    renderSubmissionDetail();
}

async function selectManuscript(manuscriptId) {
    const token = ++state.selectionTokens.manuscript;
    const detail = await getManuscript(manuscriptId);
    if (token !== state.selectionTokens.manuscript) return;
    state.selectedManuscript = detail;
    renderAllLists();
    renderManuscriptDetail();
}

async function selectIssueDraft(issueDraftId) {
    const token = ++state.selectionTokens.issueDraft;
    const detail = await getIssueDraft(issueDraftId);
    if (token !== state.selectionTokens.issueDraft) return;
    state.selectedIssueDraft = detail;
    state.selectedIssueVol = state.selectedIssueDraft?.meta?.vol || state.selectedIssueVol;
    state.selectedIssueManuscriptId = '';
    state.selectedIssueAvailableManuscriptId = '';
    $('issue-add-manuscript-id').value = '';
    $('issue-add-folder').value = '';
    renderAllLists();
    renderIssueDraftDetail();
}

async function selectReviewIssueDraft(issueDraftId) {
    const token = ++state.selectionTokens.reviewIssueDraft;
    const detail = await getIssueDraft(issueDraftId);
    if (token !== state.selectionTokens.reviewIssueDraft) return;
    state.selectedReviewIssueDraft = detail;
    renderAllLists();
    renderReviewTaskDetail();
    syncActionState();
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

function goToIssuePlanningForSelectedManuscript() {
    const detail = state.selectedManuscript;
    const manuscriptId = detail?.meta?.manuscriptId;
    if (!manuscriptId) return;
    selectView('issues');
    $('issue-add-manuscript-id').value = manuscriptId;
    $('issue-add-folder').value = manuscriptDefaultFolder({
        manuscriptId,
        title: detail?.meta?.title
    });
    state.selectedIssueAvailableManuscriptId = manuscriptId;
    renderIssueAvailableManuscriptList();
    syncActionState();
    $('issue-workspace-drafts')?.scrollIntoView({ block: 'start' });
    setStatus(
        'issue-status',
        selectedIssueDraftId()
            ? '已带入这篇稿件，可加入当前期刊草稿'
            : '请选择一个期刊草稿，再加入这篇稿件'
    );
}

async function openScheduledIssueForSelectedManuscript() {
    const issueDraftId = state.selectedManuscript?.meta?.scheduledIssueDraftId;
    if (!issueDraftId) return;
    await selectIssueDraft(issueDraftId);
    selectView('issues');
    $('issue-workspace-drafts')?.scrollIntoView({ block: 'start' });
    setStatus('issue-status', '已定位到这篇稿件所在的期刊草稿');
}

function bindPreviewDialog() {
    $('admin-preview-close-button').addEventListener('click', closePreviewDialog);
    $('admin-preview-dialog').addEventListener('click', event => {
        if (event.target === event.currentTarget) closePreviewDialog();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('admin-preview-dialog').classList.contains('hidden')) {
            closePreviewDialog();
        }
    });
}

function bindSubmissionFlow() {
    $('preview-submission-button').addEventListener('click', () => {
        if (!state.selectedSubmission) return;
        showPreviewDialog(
            previewTitle('投稿预览', state.selectedSubmission),
            state.selectedSubmission.indexContent || '',
            buildDraftAssetResolver(state.selectedSubmission.files || [])
        );
    });
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
            state.selectedSubmission = null;
            setStatus('submission-action-status', '已接收入稿件池', 'ok');
            await refreshWorkbench();
            await state.authorPanel?.refreshAuthors();
            renderAcceptAuthorOptions();
            renderSubmissionDetail();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
    $('issue-status-link-button').addEventListener('click', async () => {
        try {
            if (!selectedSubmissionId()) return;
            const result = await issueSubmissionStatusLink(selectedSubmissionId());
            const url = new URL(result.statusUrl, window.location.origin).toString();
            $('issued-status-link').textContent = url;
            const copied = await copyTextToClipboard(url);
            setStatus('submission-action-status', copied ? '链接已复制' : '链接已生成，请手动复制', copied ? 'ok' : '');
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
    $('remove-submission-button').addEventListener('click', async () => {
        try {
            if (!selectedSubmissionId()) return;
            const submissionId = selectedSubmissionId();
            if (!window.confirm(`将投稿 ${submissionId} 移出初审队列？投稿链接仍可继续用于修改。`)) return;
            await removeSubmissionFromQueue(submissionId);
            state.selectedSubmission = null;
            await refreshWorkbench();
            renderSubmissionDetail();
            setStatus('submission-action-status', '已移出投稿队列', 'ok');
        } catch (error) {
            setStatus('submission-action-status', error.message, 'error');
        }
    });
}

function bindManuscriptFlow() {
    document.querySelectorAll('[data-manuscript-scope]').forEach(button => {
        button.addEventListener('click', async () => {
            state.manuscriptScope = button.dataset.manuscriptScope || 'candidate';
            state.manuscriptPage = 1;
            await refreshWorkbench();
        });
    });
    $('manuscript-search').addEventListener('input', () => {
        window.clearTimeout(manuscriptSearchTimer);
        manuscriptSearchTimer = window.setTimeout(async () => {
            state.manuscriptQuery = $('manuscript-search').value.trim();
            state.manuscriptPage = 1;
            await refreshWorkbench();
        }, 240);
    });
    $('manuscript-prev-page-button').addEventListener('click', async () => {
        if ((state.manuscriptPagination?.page || 1) <= 1) return;
        state.manuscriptPage = (state.manuscriptPagination.page || 1) - 1;
        await refreshWorkbench();
    });
    $('manuscript-next-page-button').addEventListener('click', async () => {
        if ((state.manuscriptPagination?.page || 1) >= (state.manuscriptPagination?.totalPages || 1)) return;
        state.manuscriptPage = (state.manuscriptPagination.page || 1) + 1;
        await refreshWorkbench();
    });
    $('preview-manuscript-button').addEventListener('click', () => {
        if (!state.selectedManuscript) return;
        showPreviewDialog(
            previewTitle('稿件预览', state.selectedManuscript),
            state.selectedManuscript.indexContent || '',
            buildDraftAssetResolver(state.selectedManuscript.files || [])
        );
    });
    $('manuscript-go-issues-button').addEventListener('click', goToIssuePlanningForSelectedManuscript);
    $('manuscript-open-issue-button').addEventListener('click', () => {
        openScheduledIssueForSelectedManuscript().catch(error => setStatus('manuscript-status', error.message, 'error'));
    });
    $('issue-manuscript-edit-link-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            const result = await issueManuscriptEditLink(selectedManuscriptId());
            const url = new URL(result.editUrl, window.location.origin).toString();
            $('manuscript-edit-link').textContent = url;
            state.selectedManuscript = result.manuscript || await getManuscript(selectedManuscriptId());
            const copied = await copyTextToClipboard(url);
            setStatus('manuscript-status', copied ? '修改链接已复制' : '修改链接已生成，请手动复制', copied ? 'ok' : '');
            await refreshWorkbench();
            renderManuscriptDetail();
            $('manuscript-edit-link').textContent = url;
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
    $('preview-manuscript-edit-button').addEventListener('click', () => {
        const pendingEdit = state.selectedManuscript?.pendingEdit;
        if (!pendingEdit) return;
        showPreviewDialog(
            previewTitle('待确认修改预览', { ...state.selectedManuscript, indexContent: pendingEdit.indexContent }),
            pendingEdit.indexContent || '',
            buildDraftAssetResolver(pendingEdit.files || [])
        );
    });
    $('accept-manuscript-edit-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            state.selectedManuscript = await acceptManuscriptEdit(selectedManuscriptId());
            setStatus('manuscript-status', '修改已采用', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
    $('discard-manuscript-edit-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            state.selectedManuscript = await discardManuscriptEdit(selectedManuscriptId());
            setStatus('manuscript-status', '修改已放弃', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
    $('archive-manuscript-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            const manuscriptId = selectedManuscriptId();
            if (!window.confirm(`归档稿件 ${manuscriptId}？归档后不会出现在候选稿件视图。`)) return;
            state.selectedManuscript = await archiveManuscript(manuscriptId);
            setStatus('manuscript-status', '稿件已归档', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
    $('restore-manuscript-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            state.selectedManuscript = await restoreManuscript(selectedManuscriptId());
            setStatus('manuscript-status', '稿件已恢复为候选资产', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
    $('delete-manuscript-button').addEventListener('click', async () => {
        try {
            if (!selectedManuscriptId()) return;
            const manuscriptId = selectedManuscriptId();
            if (!window.confirm(`永久删除稿件 ${manuscriptId}？此操作不能撤销。`)) return;
            await deleteManuscript(manuscriptId);
            state.selectedManuscript = null;
            setStatus('manuscript-status', '稿件已删除', 'ok');
            await refreshWorkbench();
            renderManuscriptDetail();
        } catch (error) {
            setStatus('manuscript-status', error.message, 'error');
        }
    });
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
    async function submitIssueReview(action, { statusId = 'issue-status', source = 'issue' } = {}) {
        try {
            const issueDraftId = source === 'review'
                ? selectedReviewIssueDraftId()
                : selectedIssueDraftId();
            if (!issueDraftId) return;
            const comment = action === 'request_review'
                ? ''
                : $('issue-review-comment').value.trim();
            const result = await reviewIssueDraft(
                issueDraftId,
                action,
                comment,
                'internal'
            );
            if (state.selectedIssueDraft?.meta?.issueDraftId === issueDraftId) {
                state.selectedIssueDraft = result;
            }
            if (source === 'review') {
                state.selectedReviewIssueDraft = result.meta?.status === 'issue_review_requested' ? result : null;
            } else {
                state.selectedIssueDraft = result;
            }
            if (action !== 'request_review') {
                $('issue-review-comment').value = '';
            }
            const statusMessage = {
                request_review: '已提交整期审核',
                approve: '整期审核已通过',
                request_changes: '整期审核已退回'
            }[action] || '期刊草稿状态已更新';
            setStatus(statusId, statusMessage, 'ok');
            await refreshWorkbench();
            if (source === 'review') {
                renderReviewTaskDetail();
            } else {
                renderIssueDraftDetail();
            }
        } catch (error) {
            setStatus(statusId, error.message, 'error');
        }
    }
    async function openIssueDraftPreview(statusId = 'issue-status', issueDraftId = selectedIssueDraftId()) {
        try {
            if (!issueDraftId) return;
            const url = `/admin/issue-drafts/${encodeURIComponent(issueDraftId)}/preview-page`;
            window.open(url, '_blank', 'noopener');
            setStatus(statusId, '已打开整期读者页预览', 'ok');
        } catch (error) {
            setStatus(statusId, error.message, 'error');
        }
    }
    $('request-issue-review-button').addEventListener('click', () => submitIssueReview('request_review', { statusId: 'issue-status' }));
    $('approve-issue-button').addEventListener('click', () => submitIssueReview('approve', { statusId: 'review-status', source: 'review' }));
    $('changes-issue-button').addEventListener('click', () => submitIssueReview('request_changes', { statusId: 'review-status', source: 'review' }));
    $('preview-issue-button').addEventListener('click', () => openIssueDraftPreview('issue-status'));
    $('review-preview-issue-button').addEventListener('click', () => openIssueDraftPreview('review-status', selectedReviewIssueDraftId()));
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
    $('check-published-content-button').addEventListener('click', async () => {
        try {
            if (!state.selectedPublished) return;
            setStatus('published-status', '全站巡检中...');
            const result = await runLint();
            setStatus(
                'published-status',
                `${result.ok ? '全站巡检通过' : '全站巡检失败'} · ${result.summary?.errorCount || 0} 个错误 · ${result.summary?.warningCount || 0} 个警告`,
                result.ok ? 'ok' : 'error'
            );
        } catch (error) {
            setStatus('published-status', error.message, 'error');
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
    $('preview-published-button').addEventListener('click', () => {
        if (!state.selectedPublished) return;
        showPreviewDialog(
            previewTitle(state.selectedPublished.articleId || '已发布文章预览', state.selectedPublished),
            $('published-editor').value,
            composeAssetResolvers(
                buildLocalAssetResolver(state.selectedPublishedFiles),
                buildDraftAssetResolver(state.selectedPublished.files || [])
            )
        );
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
    bindPreviewDialog();
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
