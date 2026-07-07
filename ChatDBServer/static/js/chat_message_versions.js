(function () {
    'use strict';

    const MODULE_NAME = 'messageVersions';

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Message Versions 模块');
        }

        return shared;
    }

    function normalizeVariantTimestamp(variant) {
        const raw = String((variant && variant.timestamp) || '').trim();

        if (!raw) {
            return 0;
        }

        const parsed = Date.parse(raw);

        return Number.isFinite(parsed) ? parsed : 0;
    }

    function variantSignature(variant) {
        const timestamp = String((variant && variant.timestamp) || '');
        const content = String((variant && variant.content) || '');

        return `${timestamp}::${content.slice(0, 120)}`;
    }

    function isMeaningfulVersionVariant(variant) {
        const item = (variant && typeof variant === 'object') ? variant : {};
        const content = String(item.content || '').trim();

        if (content) {
            return true;
        }

        const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};

        if (Array.isArray(metadata.process_steps) && metadata.process_steps.length > 0) {
            return true;
        }

        const reasoning = String(metadata.reasoning_content || '').trim();

        return !!reasoning;
    }

    function buildVersionNavigation(message) {
        const rawVersions = (message && message.metadata && Array.isArray(message.metadata.versions))
            ? message.metadata.versions
            : [];
        const versions = rawVersions
            .map((variant, index) => {
                const source = (variant && typeof variant === 'object') ? variant : {};

                return {
                    ...source,
                    __serverIndex: index
                };
            })
            .filter((variant) => isMeaningfulVersionVariant(variant));
        const currentVariant = {
            content: message ? message.content : '',
            timestamp: message ? message.timestamp : '',
            __serverIndex: rawVersions.length,
            __isCurrent: true
        };
        const pool = versions.map((variant) => ({
            content: variant.content || '',
            timestamp: variant.timestamp || '',
            __serverIndex: Number(variant.__serverIndex),
            __isCurrent: false
        }));
        pool.push(currentVariant);

        if (pool.length <= 1) {
            return {
                total: 1,
                current: 1,
                prevIndex: null,
                nextIndex: null
            };
        }

        const sorted = pool
            .map((variant, index) => ({
                ...variant,
                __originOrder: index
            }))
            .sort((left, right) => {
                const leftTimestamp = normalizeVariantTimestamp(left);
                const rightTimestamp = normalizeVariantTimestamp(right);

                if (leftTimestamp !== rightTimestamp) {
                    return leftTimestamp - rightTimestamp;
                }

                return left.__originOrder - right.__originOrder;
            });

        const currentSignature = variantSignature(currentVariant);
        let currentPosition = sorted.findIndex((variant) => {
            return variantSignature(variant) === currentSignature && variant.__isCurrent;
        });

        if (currentPosition < 0) {
            currentPosition = sorted.length - 1;
        }

        const previous = currentPosition > 0 ? sorted[currentPosition - 1] : null;
        const next = currentPosition < sorted.length - 1 ? sorted[currentPosition + 1] : null;

        return {
            total: sorted.length,
            current: currentPosition + 1,
            prevIndex: previous ? Number(previous.__serverIndex) : null,
            nextIndex: next ? Number(next.__serverIndex) : null
        };
    }

    getShared().registerModule(MODULE_NAME, {
        normalizeVariantTimestamp,
        variantSignature,
        isMeaningfulVersionVariant,
        buildVersionNavigation
    });
})();
