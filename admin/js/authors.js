import { createAuthor, listAuthors, updateAuthor } from './api.js';

function $(id) {
    return document.getElementById(id);
}

function setStatus(message, type = '') {
    const status = $('author-status');
    status.textContent = message;
    status.classList.toggle('is-error', type === 'error');
    status.classList.toggle('is-ok', type === 'ok');
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

export async function fileToBase64Payload(file) {
    if (!file) return null;
    return {
        filename: file.name,
        content: arrayBufferToBase64(await file.arrayBuffer())
    };
}

function readAuthorForm() {
    return {
        id: $('author-id').value.trim(),
        name: $('author-name').value.trim(),
        team: $('author-team').value.trim(),
        role: $('author-role').value.trim()
    };
}

function fillAuthorForm(author) {
    $('author-id').value = author.id || '';
    $('author-name').value = author.name || '';
    $('author-team').value = author.team || '';
    $('author-role').value = author.role || '';
}

function renderAuthors(authors, onSelect) {
    const list = $('author-list');
    list.innerHTML = '';

    authors.forEach(author => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'compact-item';
        item.innerHTML = `
            <strong>${author.name || author.id}</strong>
            <small>${author.id}${author.team ? ` · ${author.team}` : ''}</small>
        `;
        item.addEventListener('click', () => onSelect(author));
        list.appendChild(item);
    });

    if (authors.length === 0) {
        list.innerHTML = '<div class="compact-item"><small>No authors</small></div>';
    }
}

export function bindAuthorPanel({ getPermissions }) {
    let authors = [];

    async function refreshAuthors() {
        if (!getPermissions()?.canListAuthors) return [];
        const data = await listAuthors();
        authors = data.authors || [];
        renderAuthors(authors, author => {
            fillAuthorForm(author);
            setStatus(`Selected ${author.id}`);
        });
        return authors;
    }

    $('create-author-button').addEventListener('click', async () => {
        try {
            const avatarFile = await fileToBase64Payload($('author-avatar').files[0]);
            const result = await createAuthor(readAuthorForm(), avatarFile);
            setStatus(`Created ${result.author.id}`, 'ok');
            await refreshAuthors();
        } catch (error) {
            setStatus(error.message, 'error');
        }
    });

    $('update-author-button').addEventListener('click', async () => {
        try {
            const author = readAuthorForm();
            const avatarFile = await fileToBase64Payload($('author-avatar').files[0]);
            const result = await updateAuthor(author.id, author, avatarFile);
            setStatus(`Updated ${result.author.id}`, 'ok');
            await refreshAuthors();
        } catch (error) {
            setStatus(error.message, 'error');
        }
    });

    return {
        refreshAuthors,
        getAuthors: () => authors
    };
}
