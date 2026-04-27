import { login, logout, me } from './api.js';

export async function restoreSession() {
    try {
        return await me();
    } catch (error) {
        if (error.status === 401) return null;
        throw error;
    }
}

export function bindAuth({ onSignedIn, onSignedOut }) {
    const form = document.getElementById('login-form');
    const username = document.getElementById('login-username');
    const password = document.getElementById('login-password');
    const status = document.getElementById('login-status');
    const logoutButton = document.getElementById('logout-button');

    form.addEventListener('submit', async event => {
        event.preventDefault();
        status.textContent = '';
        status.classList.remove('is-error', 'is-ok');

        try {
            const session = await login(username.value.trim(), password.value);
            password.value = '';
            status.textContent = '';
            onSignedIn(session);
        } catch (error) {
            status.textContent = `登录失败：${error.message}`;
            status.classList.add('is-error');
        }
    });

    logoutButton.addEventListener('click', async () => {
        try {
            await logout();
        } finally {
            onSignedOut();
        }
    });
}
