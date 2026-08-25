(function() {
    const USER_AVATAR_SLOT_CLASS = 'message-user-avatar-slot';

    function ensureUserAvatarSlot(messageEl) {
        if (!messageEl || !messageEl.classList || !messageEl.classList.contains('user')) return;
        if (messageEl.querySelector(`.${USER_AVATAR_SLOT_CLASS}`)) return;

        const slot = document.createElement('div');
        slot.className = USER_AVATAR_SLOT_CLASS;
        slot.setAttribute('aria-hidden', 'true');
        messageEl.appendChild(slot);
    }

    function syncUserAvatarSlots(root) {
        const scope = root || document;

        if (scope.matches && scope.matches('.message.user')) {
            ensureUserAvatarSlot(scope);
        }

        if (!scope.querySelectorAll) return;

        scope.querySelectorAll('.message.user').forEach((messageEl) => {
            ensureUserAvatarSlot(messageEl);
        });
    }

    function observeMessagesContainer(container) {
        syncUserAvatarSlots(container);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

                    syncUserAvatarSlots(node);
                });
            });
        });

        observer.observe(container, {
            childList: true,
            subtree: true
        });
    }

    function initMessageAvatarSlots() {
        const container = document.getElementById('messagesContainer');

        if (!container) return;

        observeMessagesContainer(container);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMessageAvatarSlots, { once: true });
    } else {
        initMessageAvatarSlots();
    }
})();
