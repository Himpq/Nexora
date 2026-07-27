/**
 * NexoraChatShared - 模块注册表
 *
 * 提供跨模块的注册/获取机制。
 * ESM 化后推荐直接 import 目标模块，此注册表作为兼容期桥接保留。
 *
 * 用法（新）:
 *   import { getModule, registerModule } from './chat_shared.js';
 *
 * 用法（旧，兼容期）:
 *   window.NexoraChatShared.getModule('messages')
 */

const modules = {};
const state = {};

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

export { modules, state, registerModule, getModule };

// 兼容期：保留 window 挂载
window.NexoraChatShared = {
    modules,
    state,
    registerModule,
    getModule
};
