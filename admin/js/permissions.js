export const ROLE_LABELS = {
    chief_editor: '主编',
    editor: '编辑',
    tech_reviewer: '技术审核'
};

export function hasPermission(permissions, permission) {
    return Boolean(permissions && permissions[permission]);
}

export function applyPermissionState(root, permissions) {
    root.querySelectorAll('[data-permission]').forEach(element => {
        const permission = element.dataset.permission;
        const allowed = hasPermission(permissions, permission);

        if (element.matches('.admin-nav button, .governance-tabs button')) {
            element.hidden = !allowed;
            element.disabled = !allowed;
            return;
        }

        element.disabled = !allowed;
        element.setAttribute('aria-disabled', String(!allowed));
    });
}
