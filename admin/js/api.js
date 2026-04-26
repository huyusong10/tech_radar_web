async function request(path, options = {}) {
    const init = {
        method: options.method || 'GET',
        credentials: 'same-origin',
        headers: {
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    };

    if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, init);
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        const error = new Error(typeof body === 'object' && body.error ? body.error : `Request failed: ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
    }

    return body;
}

export function login(username, password) {
    return request('/api/admin/login', {
        method: 'POST',
        body: { username, password }
    });
}

export function logout() {
    return request('/api/admin/logout', { method: 'POST' });
}

export function me() {
    return request('/api/admin/me');
}

export function listDrafts() {
    return request('/api/admin/drafts');
}

export function getDraft(draftId) {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}`);
}

export function importDraft(payload) {
    return request('/api/admin/drafts/import', {
        method: 'POST',
        body: payload
    });
}

export function updateDraft(draftId, payload) {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PUT',
        body: payload
    });
}

export function deleteDraft(draftId) {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}`, {
        method: 'DELETE'
    });
}

export function acceptDraft(draftId, comment = '') {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}/accept`, {
        method: 'POST',
        body: { comment }
    });
}

export function rejectDraft(draftId, comment = '') {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}/reject`, {
        method: 'POST',
        body: { comment }
    });
}

export function requestReview(draftId, comment = '') {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}/review-request`, {
        method: 'POST',
        body: { comment }
    });
}

export function reviewDraft(draftId, action, comment = '') {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}/review`, {
        method: 'POST',
        body: { action, comment }
    });
}

export function publishDraft(draftId, authorResolution) {
    return request(`/api/admin/drafts/${encodeURIComponent(draftId)}/publish`, {
        method: 'POST',
        body: { authorResolution }
    });
}

export function listAuthors() {
    return request('/api/admin/authors');
}

export function createAuthor(author, avatarFile) {
    return request('/api/admin/authors', {
        method: 'POST',
        body: { author, avatarFile }
    });
}

export function updateAuthor(authorId, author, avatarFile) {
    return request(`/api/admin/authors/${encodeURIComponent(authorId)}`, {
        method: 'PUT',
        body: { author, avatarFile }
    });
}

export function runLint() {
    return request('/api/admin/lint', { method: 'POST' });
}

export function listAuditLog() {
    return request('/api/admin/audit-log');
}

export function listPublished() {
    return request('/api/admin/published');
}

export function getPublished(articleId) {
    return request(`/api/admin/published/${encodeURIComponent(articleId)}`);
}

export function updatePublished(articleId, payload) {
    return request(`/api/admin/published/${encodeURIComponent(articleId)}`, {
        method: 'PUT',
        body: payload
    });
}

export function unpublishArticle(articleId) {
    return request(`/api/admin/published/${encodeURIComponent(articleId)}/unpublish`, {
        method: 'POST'
    });
}

export function restoreArticle(articleId) {
    return request(`/api/admin/unpublished/${encodeURIComponent(articleId)}/restore`, {
        method: 'POST'
    });
}

export function listAdminUsers() {
    return request('/api/admin/users');
}

export function createAdminUser(user) {
    return request('/api/admin/users', {
        method: 'POST',
        body: { user }
    });
}

export function updateAdminUser(username, user) {
    return request(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: { user }
    });
}

export function disableAdminUser(username) {
    return request(`/api/admin/users/${encodeURIComponent(username)}/disable`, {
        method: 'POST'
    });
}

export function listVolumes() {
    return request('/api/admin/volumes');
}

export function createVolume(vol, radarContent) {
    return request('/api/admin/volumes', {
        method: 'POST',
        body: { vol, radarContent }
    });
}

export function updateVolumeRadar(vol, radarContent) {
    return request(`/api/admin/volumes/${encodeURIComponent(vol)}/radar`, {
        method: 'PUT',
        body: { radarContent }
    });
}
