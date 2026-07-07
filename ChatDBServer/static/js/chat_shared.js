(function () {
    'use strict';

    const root = window.NexoraChatShared && typeof window.NexoraChatShared === 'object'
        ? window.NexoraChatShared
        : {};
    const modules = root.modules && typeof root.modules === 'object'
        ? root.modules
        : {};
    const state = root.state && typeof root.state === 'object'
        ? root.state
        : {};

    function normalizeModuleName(name) {
        const key = String(name || '').trim();

        if (!key) {
            throw new Error('NexoraChatShared requires a module name');
        }

        return key;
    }

    function registerModule(name, api) {
        const key = normalizeModuleName(name);

        if (!api || typeof api !== 'object') {
            throw new Error(`NexoraChatShared module "${key}" must be an object`);
        }

        modules[key] = api;
        return api;
    }

    function getModule(name) {
        const key = normalizeModuleName(name);
        const api = modules[key];

        if (!api || typeof api !== 'object') {
            throw new Error(`NexoraChatShared module "${key}" is not registered`);
        }

        return api;
    }

    root.modules = modules;
    root.state = state;
    root.registerModule = registerModule;
    root.getModule = getModule;

    window.NexoraChatShared = root;
})();
