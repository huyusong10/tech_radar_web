export const ROLE_LABELS = {
    chief_editor: 'Chief Editor',
    editor: 'Editor',
    tech_reviewer: 'Tech Reviewer'
};

export function hasPermission(permissions, permission) {
    return Boolean(permissions && permissions[permission]);
}

export function applyPermissionState(root, permissions) {
    root.querySelectorAll('[data-permission]').forEach(element => {
        const permission = element.dataset.permission;
        const allowed = hasPermission(permissions, permission);

        if (element.matches('.admin-nav button')) {
            element.hidden = !allowed;
            return;
        }

        element.disabled = !allowed;
        element.setAttribute('aria-disabled', String(!allowed));
    });
}
