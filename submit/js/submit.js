import {
    buildDraftAssetResolver,
    buildLocalAssetResolver,
    renderPreview
} from '/admin/js/preview.js';

const state = {
    selectedFiles: [],
    revisionFiles: [],
    currentSubmission: null,
    currentManuscriptEdit: null,
    currentToken: '',
    selectedAuthor: null,
    previewSignature: '',
    revisionPreviewSignature: '',
    revisionEditorPreviewSignature: '',
    authorSearchTimer: null
};

const STATUS_LABELS = {
    submitted: '未接收，可继续修改',
    in_editor_review: '未接收，可继续修改',
    changes_requested: '未接收，可继续修改',
    accepted: '已进入稿件池',
    published: '已发布',
    rejected: '未接收，可继续修改'
};

const REVIEW_ACTION_LABELS = {
    accepted: '编辑已接收',
    rejected: '历史处理',
    request_changes: '历史处理',
    approve: '技术审核通过',
    published: '已发布',
    submitter_revision: '已提交修改'
};

const MANUSCRIPT_EDIT_STATUS_LABELS = {
    idle: '无修改',
    editing: '修改中',
    pending_review: '修改待确认'
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

async function api(path, options = {}) {
    const response = await fetch(path, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : {},
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = (response.headers.get('content-type') || '').includes('application/json')
        ? await response.json()
        : await response.text();
    if (!response.ok) {
        const error = new Error(typeof body === 'object' && body.error ? body.error : `请求失败：${response.status}`);
        error.body = body;
        throw error;
    }
    return body;
}

function normalizeFileSelection(fileList) {
    const entries = Array.from(fileList || []);
    const rawPaths = entries.map(entry => {
        const file = entry.file || entry;
        return entry.relativePath || file.webkitRelativePath || file.name;
    });
    const indexPath = rawPaths.find(item => item === 'index.md' || item.endsWith('/index.md'));
    const rootPrefix = indexPath && indexPath !== 'index.md'
        ? indexPath.slice(0, -'index.md'.length)
        : '';

    return entries.map((entry, index) => {
        const file = entry.file || entry;
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

function isImageFile(path) {
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
}

function fileKind(path) {
    if (path === 'index.md') return '正文';
    if (isImageFile(path)) return '图片';
    if (isTextFile(path)) return '文本';
    return '资源';
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

async function toPayloadFile(item) {
    if (isTextFile(item.relativePath)) {
        return { path: item.relativePath, type: 'text', content: await item.file.text() };
    }
    return { path: item.relativePath, type: 'base64', content: arrayBufferToBase64(await item.file.arrayBuffer()) };
}

function filesSignature(files) {
    return files.map(file => `${file.relativePath}:${file.size}:${file.file.lastModified || 0}`).join('|');
}

function editorSignature(value) {
    return String(value || '');
}

function hasIndex(files) {
    return files.some(file => file.relativePath === 'index.md');
}

function renderFileList(container, files) {
    container.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <strong>${escapeHtml(file.path || file.relativePath)}</strong>
            <small><span class="file-kind">${escapeHtml(fileKind(file.path || file.relativePath))}</span> · ${Number(file.size || 0).toLocaleString()} 字节</small>
        `;
        container.appendChild(item);
    });
    if (files.length === 0) {
        container.innerHTML = '<div class="file-item"><small>暂无文件</small></div>';
    }
}

async function readIndex(files) {
    const index = files.find(file => file.relativePath === 'index.md');
    return index ? index.file.text() : '';
}

function updateUploadHealth(files) {
    const count = files.length;
    const label = hasIndex(files)
        ? `已就绪 · ${count}`
        : count > 0
            ? `缺 index.md · ${count}`
            : '未上传';
    $('upload-health').textContent = label;
    $('upload-health').classList.toggle('is-ok', hasIndex(files));
}

function setPrimaryFiles(files) {
    state.selectedFiles = normalizeFileSelection(files);
    state.previewSignature = '';
    renderFileList($('submit-file-list'), state.selectedFiles);
    updateUploadHealth(state.selectedFiles);
    if (state.selectedFiles.length > 0) {
        setStatus('submit-status', hasIndex(state.selectedFiles) ? '文件已载入，请先预览效果' : '缺少 index.md', hasIndex(state.selectedFiles) ? '' : 'error');
    }
}

function setRevisionFiles(files) {
    state.revisionFiles = normalizeFileSelection(files);
    state.revisionPreviewSignature = '';
    renderFileList($('revision-file-list'), state.revisionFiles);
    if (state.revisionFiles.length > 0) {
        setStatus('revision-status', hasIndex(state.revisionFiles) ? '修改文件已载入，请先预览效果' : '缺少 index.md', hasIndex(state.revisionFiles) ? '' : 'error');
    }
}

async function readAllDirectoryEntries(reader) {
    const entries = [];
    while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        entries.push(...batch);
    }
    return entries;
}

async function traverseEntry(entry, prefix = '') {
    if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        return [{ file, relativePath: `${prefix}${file.name}` }];
    }

    if (entry.isDirectory) {
        const children = await readAllDirectoryEntries(entry.createReader());
        const nested = await Promise.all(children.map(child => traverseEntry(child, `${prefix}${entry.name}/`)));
        return nested.flat();
    }

    return [];
}

async function filesFromDrop(event) {
    const entries = Array.from(event.dataTransfer?.items || [])
        .map(item => item.webkitGetAsEntry?.())
        .filter(Boolean);

    if (entries.length > 0) {
        const nested = await Promise.all(entries.map(entry => traverseEntry(entry)));
        return nested.flat();
    }

    return Array.from(event.dataTransfer?.files || []);
}

function bindUploadZone({ zoneId, folderInputId, filesInputId, folderButtonId, filesButtonId, onFiles }) {
    const zone = $(zoneId);
    const folderInput = $(folderInputId);
    const filesInput = $(filesInputId);

    $(folderButtonId).addEventListener('click', event => {
        event.stopPropagation();
        folderInput.click();
    });
    $(filesButtonId).addEventListener('click', event => {
        event.stopPropagation();
        filesInput.click();
    });
    folderInput.addEventListener('change', () => onFiles(folderInput.files));
    filesInput.addEventListener('change', () => onFiles(filesInput.files));

    zone.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        folderInput.click();
    });
    zone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            folderInput.click();
        }
    });
    ['dragenter', 'dragover'].forEach(type => {
        zone.addEventListener(type, event => {
            event.preventDefault();
            zone.classList.add('drag-active');
        });
    });
    ['dragleave', 'drop'].forEach(type => {
        zone.addEventListener(type, event => {
            event.preventDefault();
            zone.classList.remove('drag-active');
        });
    });
    zone.addEventListener('drop', async event => {
        onFiles(await filesFromDrop(event));
    });
}

function authorMode() {
    return document.querySelector('input[name="author-mode"]:checked')?.value || 'temporary';
}

function syncAuthorMode() {
    const known = authorMode() === 'known';
    $('known-author-row').classList.toggle('hidden', !known);
    $('temporary-author-row').classList.toggle('hidden', known);
    if (!known) {
        state.selectedAuthor = null;
        $('submitter-author-id').value = '';
        $('selected-author').classList.add('hidden');
    }
}

function buildSubmitter() {
    if (authorMode() === 'known') {
        return {
            name: state.selectedAuthor?.name || '',
            team: state.selectedAuthor?.team || '',
            role: state.selectedAuthor?.role || '',
            contact: '',
            authorId: $('submitter-author-id').value.trim()
        };
    }

    return {
        name: $('submitter-name').value.trim(),
        team: $('submitter-team').value.trim(),
        role: $('submitter-role').value.trim(),
        contact: $('submitter-contact').value.trim(),
        authorId: ''
    };
}

function validateAuthorInput() {
    if (authorMode() === 'known') {
        if (!$('submitter-author-id').value.trim()) {
            setStatus('submit-status', '请先搜索并选择已有作者', 'error');
            return false;
        }
        return true;
    }

    if (!$('submitter-name').value.trim()) {
        setStatus('submit-status', '请填写中文姓名', 'error');
        return false;
    }
    return true;
}

async function previewSelection(files, previewId, statusId, signatureKey) {
    const indexContent = await readIndex(files);
    if (!indexContent) {
        setStatus(statusId, '必须包含 index.md', 'error');
        return;
    }
    renderPreview($(previewId), indexContent, buildLocalAssetResolver(files));
    state[signatureKey] = filesSignature(files);
    setStatus(statusId, '预览已刷新', 'ok');
}

function setSubmitPageMode(mode) {
    const manuscriptEdit = mode === 'manuscript-edit';
    $('submit-brand').textContent = manuscriptEdit ? '>_ Tech Radar 修改台' : '>_ Tech Radar 投稿台';
    $('submit-page-title').textContent = manuscriptEdit ? '稿件修改' : '提交投稿';
    document.title = manuscriptEdit ? 'Tech Radar Manuscript Edit' : 'Tech Radar Submit';
    $('source-download-link').classList.add('hidden');
    $('revision-editor-panel').classList.toggle('hidden', !manuscriptEdit);
    $('revision-title').textContent = manuscriptEdit ? '提交稿件修改' : '提交修改版本';
    $('revision-dropzone-title').textContent = manuscriptEdit ? '上传完整替换包' : '拖拽修改稿件';
}

async function submitDraft() {
    try {
        if (state.selectedFiles.length === 0 || !hasIndex(state.selectedFiles)) {
            setStatus('submit-status', '请先上传包含 index.md 的稿件文件', 'error');
            return;
        }
        if (state.previewSignature !== filesSignature(state.selectedFiles)) {
            setStatus('submit-status', '请先预览当前文件再提交', 'error');
            return;
        }
        if (!validateAuthorInput()) return;

        const files = await Promise.all(state.selectedFiles.map(toPayloadFile));
        const result = await api('/api/submissions', {
            method: 'POST',
            body: {
                submitter: buildSubmitter(),
                files
            }
        });
        const statusUrl = new URL(result.statusUrl, window.location.origin).toString();
        $('status-url').textContent = statusUrl;
        $('submit-result-view').classList.remove('hidden');
        setStatus('submit-status', '已提交给编辑部', 'ok');
    } catch (error) {
        setStatus('submit-status', error.message, 'error');
    }
}

function renderSubmission(detail) {
    state.currentSubmission = detail;
    state.currentManuscriptEdit = null;
    setSubmitPageMode('submission');
    $('submit-form-view').classList.add('hidden');
    $('submit-result-view').classList.add('hidden');
    $('submission-status-view').classList.remove('hidden');
    $('submission-heading').textContent = detail.submissionId;
    $('submission-meta').textContent = `${STATUS_LABELS[detail.status] || detail.status} · 第 ${detail.revision} 版${detail.publishedArticleId ? ` · ${detail.publishedArticleId}` : ''}`;
    renderPreview($('status-preview'), detail.indexContent || '', buildDraftAssetResolver(detail.files || []));
    renderFileList($('submission-file-list'), detail.files || []);

    const history = detail.review?.history || [];
    $('submission-review-history').innerHTML = history.slice().reverse().map(entry => `
        <div class="compact-item">
            <strong>${escapeHtml(REVIEW_ACTION_LABELS[entry.action] || entry.action)}</strong>
            <small>${escapeHtml(entry.role || '')}${entry.at ? ` · ${escapeHtml(entry.at)}` : ''}</small>
            ${entry.comment ? `<small>${escapeHtml(entry.comment)}</small>` : ''}
        </div>
    `).join('') || '<div class="compact-item"><small>暂无公开反馈</small></div>';

    const canRevise = !['accepted', 'published'].includes(detail.status);
    $('revision-panel').classList.toggle('hidden', !canRevise);
    $('revision-folder-button').disabled = !canRevise;
    $('revision-files-button').disabled = !canRevise;
    $('revision-preview-button').disabled = !canRevise;
    $('revision-submit-button').disabled = !canRevise;
}

function renderManuscriptEdit(detail) {
    state.currentSubmission = null;
    state.currentManuscriptEdit = detail;
    setSubmitPageMode('manuscript-edit');
    $('submit-form-view').classList.add('hidden');
    $('submit-result-view').classList.add('hidden');
    $('submission-status-view').classList.remove('hidden');
    $('submission-heading').textContent = detail.title || detail.manuscriptId;
    $('submission-meta').textContent = `稿件修改 · ${MANUSCRIPT_EDIT_STATUS_LABELS[detail.editStatus] || detail.editStatus}`;
    $('source-download-link').href = `/api/manuscript-edits/${encodeURIComponent(detail.manuscriptId)}/source.zip?token=${encodeURIComponent(state.currentToken)}`;
    $('source-download-link').setAttribute('download', `${detail.manuscriptId}-source.zip`);
    $('source-download-link').classList.remove('hidden');
    $('revision-editor').value = detail.indexContent || '';
    state.revisionEditorPreviewSignature = '';
    renderPreview($('status-preview'), detail.indexContent || '', buildDraftAssetResolver(detail.files || []));
    renderFileList($('submission-file-list'), detail.files || []);
    $('submission-review-history').innerHTML = detail.editStatus === 'pending_review'
        ? '<div class="compact-item"><small>修改已提交，等待编辑确认。</small></div>'
        : '<div class="compact-item"><small>请上传完整修改包，编辑确认后生效。</small></div>';

    const canRevise = detail.editStatus !== 'idle';
    $('revision-panel').classList.toggle('hidden', !canRevise);
    $('revision-folder-button').disabled = !canRevise;
    $('revision-files-button').disabled = !canRevise;
    $('revision-preview-button').disabled = !canRevise;
    $('revision-submit-button').disabled = !canRevise;
}

async function loadSubmission() {
    const params = new URLSearchParams(window.location.search);
    const manuscriptId = params.get('manuscript');
    const id = params.get('id');
    const token = params.get('token');
    if (manuscriptId) {
        setSubmitPageMode('manuscript-edit');
        $('submit-form-view').classList.add('hidden');
        $('submit-result-view').classList.add('hidden');
        $('submission-status-view').classList.remove('hidden');
        $('submission-heading').textContent = '稿件修改';
        $('submission-meta').textContent = '正在读取修改链接';
        $('submission-review-history').innerHTML = '<div class="compact-item"><small>正在读取</small></div>';
        renderFileList($('submission-file-list'), []);
        $('revision-panel').classList.add('hidden');
        $('status-preview').innerHTML = '';
    }
    if (!token || (!id && !manuscriptId)) {
        if (manuscriptId) {
            $('submission-meta').textContent = '修改链接不可用';
            $('submission-review-history').innerHTML = '<div class="compact-item"><small>缺少访问凭证</small></div>';
        }
        return;
    }
    state.currentToken = token;
    try {
        if (manuscriptId) {
            const detail = await api(`/api/manuscript-edits/${encodeURIComponent(manuscriptId)}?token=${encodeURIComponent(token)}`);
            renderManuscriptEdit(detail);
            return;
        }
        const detail = await api(`/api/submissions/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
        renderSubmission(detail);
    } catch (error) {
        if (manuscriptId) {
            $('submission-meta').textContent = '修改链接不可用';
            $('submission-review-history').innerHTML = `<div class="compact-item"><small>${escapeHtml(error.message)}</small></div>`;
            return;
        }
        setStatus('submit-status', error.message, 'error');
    }
}

async function submitRevision() {
    try {
        if (!state.currentSubmission && !state.currentManuscriptEdit) return;
        const usingEditor = state.currentManuscriptEdit && state.revisionFiles.length === 0;
        if (!usingEditor && (state.revisionFiles.length === 0 || !hasIndex(state.revisionFiles))) {
            setStatus('revision-status', '请上传包含 index.md 的完整修改文件', 'error');
            return;
        }
        if (usingEditor && state.revisionEditorPreviewSignature !== editorSignature($('revision-editor').value)) {
            setStatus('revision-status', '请先预览当前正文再提交', 'error');
            return;
        }
        if (!usingEditor && state.revisionPreviewSignature !== filesSignature(state.revisionFiles)) {
            setStatus('revision-status', '请先预览当前修改文件再提交', 'error');
            return;
        }

        const files = await Promise.all(state.revisionFiles.map(toPayloadFile));
        const detail = state.currentManuscriptEdit
            ? await api(
                `/api/manuscript-edits/${encodeURIComponent(state.currentManuscriptEdit.manuscriptId)}?token=${encodeURIComponent(state.currentToken)}`,
                {
                    method: 'PUT',
                    body: usingEditor
                        ? { indexContent: $('revision-editor').value }
                        : { files, replaceFiles: true }
                }
            )
            : await api(
                `/api/submissions/${encodeURIComponent(state.currentSubmission.submissionId)}?token=${encodeURIComponent(state.currentToken)}`,
                {
                    method: 'PUT',
                    body: {
                        files,
                        replaceFiles: true
                    }
                }
            );
        state.revisionFiles = [];
        state.revisionPreviewSignature = '';
        state.revisionEditorPreviewSignature = '';
        $('revision-folder-input').value = '';
        $('revision-files-input').value = '';
        renderFileList($('revision-file-list'), []);
        setStatus('revision-status', '修改版本已提交', 'ok');
        if (state.currentManuscriptEdit) {
            renderManuscriptEdit(detail);
        } else {
            renderSubmission(detail);
        }
    } catch (error) {
        setStatus('revision-status', error.message, 'error');
    }
}

function renderAuthorResults(authors) {
    $('author-search-results').innerHTML = authors.map(author => `
        <button type="button" class="compact-item" data-author-id="${escapeHtml(author.id)}">
            <strong>${escapeHtml(author.name || author.id)}</strong>
            <small>${escapeHtml(author.id)}${author.pinyin ? ` · ${escapeHtml(author.pinyin)}` : ''}${author.initials ? ` · ${escapeHtml(author.initials)}` : ''}${author.team ? ` · ${escapeHtml(author.team)}` : ''}</small>
            ${author.match ? `<small>${escapeHtml(author.match)}</small>` : ''}
        </button>
    `).join('') || '<div class="compact-item"><small>无匹配</small></div>';

    $('author-search-results').querySelectorAll('[data-author-id]').forEach(button => {
        button.addEventListener('click', () => {
            const author = authors.find(item => item.id === button.dataset.authorId);
            state.selectedAuthor = author || null;
            $('submitter-author-id').value = button.dataset.authorId;
            $('selected-author').textContent = author
                ? `已选择：${author.name || author.id}（${author.id}）`
                : `已选择：${button.dataset.authorId}`;
            $('selected-author').classList.remove('hidden');
        });
    });
}

async function searchAuthors() {
    const query = $('author-search').value.trim();
    if (!query) {
        renderAuthorResults([]);
        return;
    }
    const result = await api(`/api/submission-authors?q=${encodeURIComponent(query)}`);
    renderAuthorResults(result.authors || []);
}

function bindEvents() {
    document.querySelectorAll('input[name="author-mode"]').forEach(input => {
        input.addEventListener('change', syncAuthorMode);
    });
    $('author-search').addEventListener('input', () => {
        clearTimeout(state.authorSearchTimer);
        state.authorSearchTimer = setTimeout(() => {
            state.selectedAuthor = null;
            $('submitter-author-id').value = '';
            $('selected-author').classList.add('hidden');
            searchAuthors().catch(error => setStatus('submit-status', error.message, 'error'));
        }, 180);
    });

    bindUploadZone({
        zoneId: 'submit-dropzone',
        folderInputId: 'submit-folder-input',
        filesInputId: 'submit-files-input',
        folderButtonId: 'choose-folder-button',
        filesButtonId: 'choose-files-button',
        onFiles: setPrimaryFiles
    });
    bindUploadZone({
        zoneId: 'revision-dropzone',
        folderInputId: 'revision-folder-input',
        filesInputId: 'revision-files-input',
        folderButtonId: 'revision-folder-button',
        filesButtonId: 'revision-files-button',
        onFiles: setRevisionFiles
    });

    $('submit-preview-button').addEventListener('click', () => previewSelection(state.selectedFiles, 'submit-preview', 'submit-status', 'previewSignature'));
    $('submit-button').addEventListener('click', submitDraft);
    $('copy-status-button').addEventListener('click', async () => {
        await navigator.clipboard.writeText($('status-url').textContent);
    });
    $('open-status-button').addEventListener('click', () => {
        window.location.href = $('status-url').textContent;
    });
    $('reload-submission-button').addEventListener('click', loadSubmission);
    $('revision-preview-button').addEventListener('click', () => {
        if (state.currentManuscriptEdit && state.revisionFiles.length === 0) {
            renderPreview(
                $('status-preview'),
                $('revision-editor').value,
                buildDraftAssetResolver(state.currentManuscriptEdit.files || [])
            );
            state.revisionEditorPreviewSignature = editorSignature($('revision-editor').value);
            setStatus('revision-status', '预览已刷新', 'ok');
            return;
        }
        previewSelection(state.revisionFiles, 'status-preview', 'revision-status', 'revisionPreviewSignature');
    });
    $('revision-submit-button').addEventListener('click', submitRevision);
}

document.addEventListener('DOMContentLoaded', () => {
    setSubmitPageMode('submission');
    syncAuthorMode();
    renderFileList($('submit-file-list'), []);
    renderFileList($('revision-file-list'), []);
    bindEvents();
    loadSubmission();
});
