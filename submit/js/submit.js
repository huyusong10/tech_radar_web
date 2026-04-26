import {
    buildDraftAssetResolver,
    buildLocalAssetResolver,
    parseFrontmatter,
    renderPreview
} from '/admin/js/preview.js';

const state = {
    selectedFiles: [],
    revisionFiles: [],
    currentSubmission: null,
    currentToken: ''
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
        const error = new Error(typeof body === 'object' && body.error ? body.error : `Request failed: ${response.status}`);
        error.body = body;
        throw error;
    }
    return body;
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

async function toPayloadFile(item) {
    if (isTextFile(item.relativePath)) {
        return { path: item.relativePath, type: 'text', content: await item.file.text() };
    }
    return { path: item.relativePath, type: 'base64', content: arrayBufferToBase64(await item.file.arrayBuffer()) };
}

function renderFileList(container, files) {
    container.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<strong>${escapeHtml(file.path || file.relativePath)}</strong><small>${Number(file.size || 0).toLocaleString()} bytes</small>`;
        container.appendChild(item);
    });
    if (files.length === 0) {
        container.innerHTML = '<div class="file-item"><small>No files</small></div>';
    }
}

async function readIndex(files) {
    const index = files.find(file => file.relativePath === 'index.md');
    return index ? index.file.text() : '';
}

function authorMode() {
    return document.querySelector('input[name="author-mode"]:checked')?.value || 'temporary';
}

function syncAuthorMode() {
    $('known-author-row').classList.toggle('hidden', authorMode() !== 'known');
    $('author-search-results').classList.toggle('hidden', authorMode() !== 'known');
}

function buildSubmitter() {
    return {
        name: $('submitter-name').value.trim(),
        team: $('submitter-team').value.trim(),
        role: $('submitter-role').value.trim(),
        contact: $('submitter-contact').value.trim(),
        authorId: authorMode() === 'known' ? $('submitter-author-id').value.trim() : ''
    };
}

async function previewSelection(files, statusId) {
    const indexContent = await readIndex(files);
    if (!indexContent) {
        setStatus(statusId, 'index.md is required', 'error');
        return;
    }
    $('submit-editor').value = indexContent;
    renderPreview($('submit-preview'), indexContent, buildLocalAssetResolver(files));
    setStatus(statusId, 'Preview refreshed', 'ok');
}

async function submitDraft() {
    try {
        const files = await Promise.all(state.selectedFiles.map(toPayloadFile));
        const result = await api('/api/submissions', {
            method: 'POST',
            body: {
                targetVol: $('submit-vol').value.trim(),
                folderName: $('submit-folder').value.trim(),
                submitter: buildSubmitter(),
                files
            }
        });
        const statusUrl = new URL(result.statusUrl, window.location.origin).toString();
        $('status-url').textContent = statusUrl;
        $('submit-result-view').classList.remove('hidden');
        setStatus('submit-status', 'Submitted', 'ok');
    } catch (error) {
        setStatus('submit-status', error.message, 'error');
    }
}

function renderSubmission(detail) {
    state.currentSubmission = detail;
    $('submit-form-view').classList.add('hidden');
    $('submit-result-view').classList.add('hidden');
    $('submission-status-view').classList.remove('hidden');
    $('submission-heading').textContent = detail.submissionId;
    $('submission-meta').textContent = `${detail.status} · revision ${detail.revision}${detail.publishedArticleId ? ` · ${detail.publishedArticleId}` : ''}`;
    $('submit-editor').value = detail.indexContent || '';
    $('submit-editor').disabled = detail.status !== 'changes_requested';
    renderPreview($('submit-preview'), detail.indexContent || '', buildDraftAssetResolver(detail.files || []));
    renderFileList($('submission-file-list'), detail.files || []);

    const history = detail.review?.history || [];
    $('submission-review-history').innerHTML = history.slice().reverse().map(entry => `
        <div class="compact-item">
            <strong>${escapeHtml(entry.action)}</strong>
            <small>${escapeHtml(entry.role || '')}${entry.at ? ` · ${escapeHtml(entry.at)}` : ''}</small>
            ${entry.comment ? `<small>${escapeHtml(entry.comment)}</small>` : ''}
        </div>
    `).join('') || '<div class="compact-item"><small>No review history</small></div>';

    const canRevise = detail.status === 'changes_requested';
    $('revision-files').disabled = !canRevise;
    $('revision-delete-files').disabled = !canRevise;
    $('revision-preview-button').disabled = !canRevise;
    $('revision-submit-button').disabled = !canRevise;
}

async function loadSubmission() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) return;
    state.currentToken = token;
    try {
        const detail = await api(`/api/submissions/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
        renderSubmission(detail);
    } catch (error) {
        setStatus('submit-status', error.message, 'error');
    }
}

async function submitRevision() {
    try {
        if (!state.currentSubmission) return;
        const files = await Promise.all(state.revisionFiles.map(toPayloadFile));
        const deleteFiles = $('revision-delete-files').value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
        const detail = await api(
            `/api/submissions/${encodeURIComponent(state.currentSubmission.submissionId)}?token=${encodeURIComponent(state.currentToken)}`,
            {
                method: 'PUT',
                body: {
                    indexContent: $('submit-editor').value,
                    files,
                    deleteFiles
                }
            }
        );
        state.revisionFiles = [];
        $('revision-files').value = '';
        $('revision-delete-files').value = '';
        setStatus('revision-status', 'Revision submitted', 'ok');
        renderSubmission(detail);
    } catch (error) {
        setStatus('revision-status', error.message, 'error');
    }
}

async function searchAuthors() {
    const query = $('author-search').value.trim();
    const result = await api(`/api/submission-authors?q=${encodeURIComponent(query)}`);
    $('author-search-results').innerHTML = (result.authors || []).map(author => `
        <button type="button" class="compact-item" data-author-id="${escapeHtml(author.id)}">
            <strong>${escapeHtml(author.name || author.id)}</strong>
            <small>${escapeHtml(author.id)}${author.team ? ` · ${escapeHtml(author.team)}` : ''}</small>
        </button>
    `).join('') || '<div class="compact-item"><small>No authors</small></div>';
    $('author-search-results').querySelectorAll('[data-author-id]').forEach(button => {
        button.addEventListener('click', () => {
            $('submitter-author-id').value = button.dataset.authorId;
        });
    });
}

function bindEvents() {
    document.querySelectorAll('input[name="author-mode"]').forEach(input => {
        input.addEventListener('change', syncAuthorMode);
    });
    $('author-search').addEventListener('input', () => {
        searchAuthors().catch(error => setStatus('submit-status', error.message, 'error'));
    });
    $('submit-files').addEventListener('change', () => {
        state.selectedFiles = normalizeFileSelection($('submit-files').files);
        renderFileList($('submit-file-list'), state.selectedFiles);
    });
    $('submit-preview-button').addEventListener('click', () => previewSelection(state.selectedFiles, 'submit-status'));
    $('submit-button').addEventListener('click', submitDraft);
    $('copy-status-button').addEventListener('click', async () => {
        await navigator.clipboard.writeText($('status-url').textContent);
    });
    $('open-status-button').addEventListener('click', () => {
        window.location.href = $('status-url').textContent;
    });
    $('reload-submission-button').addEventListener('click', loadSubmission);
    $('revision-files').addEventListener('change', () => {
        state.revisionFiles = normalizeFileSelection($('revision-files').files);
    });
    $('revision-preview-button').addEventListener('click', () => previewSelection(state.revisionFiles, 'revision-status'));
    $('revision-submit-button').addEventListener('click', submitRevision);
    $('submit-editor').addEventListener('input', () => {
        const files = state.currentSubmission?.files || [];
        renderPreview($('submit-preview'), $('submit-editor').value, buildDraftAssetResolver(files));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    syncAuthorMode();
    bindEvents();
    loadSubmission();
});
