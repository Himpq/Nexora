/**
 * NexoraLog - 日志基础设施
 *
 * 提供按命名空间过滤、按级别控制的日志系统。
 * 接管 console 方法，通过 localStorage 持久化配置。
 *
 * 用法:
 *   import { NexoraLog } from './chat_logger.js';
 *   const log = NexoraLog.logger('MyModule');
 *   log.info('something happened');
 */

const STORAGE_LEVEL_KEY = 'nexora.log.level';
const STORAGE_NAMESPACES_KEY = 'nexora.log.namespaces';

const LEVELS = {
    debug: 10,
    info: 20,
    log: 20,
    warn: 30,
    error: 40,
    silent: 100
};

const originalConsole = {};
const consoleMethods = ['debug', 'info', 'log', 'warn', 'error', 'table', 'trace'];

consoleMethods.forEach((method) => {
    const value = console[method];

    if (typeof value !== 'function') {
        throw new Error(`NexoraLog requires console.${method}`);
    }

    originalConsole[method] = value.bind(console);
});

function readStorage(key) {
    try {
        return String(window.localStorage.getItem(key) || '').trim();
    } catch (_) {
        return '';
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, String(value || ''));
    } catch (_) {}
}

function normalizeLevel(level) {
    const key = String(level || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, key) ? key : 'warn';
}

function normalizeNamespace(namespace) {
    return String(namespace || '').trim();
}

function readNamespaceSet() {
    const raw = readStorage(STORAGE_NAMESPACES_KEY);
    const set = new Set();

    raw.split(',').forEach((item) => {
        const key = normalizeNamespace(item);

        if (key) {
            set.add(key);
        }
    });

    return set;
}

function persistNamespaceSet(namespaces) {
    writeStorage(STORAGE_NAMESPACES_KEY, Array.from(namespaces).sort().join(','));
}

function getMinLevel() {
    return normalizeLevel(readStorage(STORAGE_LEVEL_KEY) || 'warn');
}

function readMessageNamespace(args) {
    const first = args && args.length ? args[0] : '';
    const text = typeof first === 'string' ? first : '';
    const match = text.match(/^\[([^\]]+)\]/);
    return match ? match[1] : '';
}

function isNamespaceEnabled(namespace) {
    const key = normalizeNamespace(namespace);
    const namespaces = readNamespaceSet();

    if (namespaces.has('*')) {
        return true;
    }

    return !!key && namespaces.has(key);
}

function shouldPrint(method, namespace, args) {
    const levelKey = method === 'table' ? 'debug' : method;
    const minLevel = getMinLevel();
    const messageNamespace = namespace || readMessageNamespace(args);

    if (isNamespaceEnabled(messageNamespace)) {
        return true;
    }

    return LEVELS[levelKey] >= LEVELS[minLevel];
}

function emit(method, namespace, args) {
    if (!shouldPrint(method, namespace, args)) {
        return;
    }

    const target = originalConsole[method] || originalConsole.log;
    target(...args);
}

function createLogger(namespace) {
    const key = normalizeNamespace(namespace);

    return {
        debug: (...args) => emit('debug', key, args),
        info: (...args) => emit('info', key, args),
        log: (...args) => emit('log', key, args),
        warn: (...args) => emit('warn', key, args),
        error: (...args) => emit('error', key, args),
        table: (...args) => emit('table', key, args)
    };
}

function enable(namespace) {
    const key = normalizeNamespace(namespace || '*');
    const namespaces = readNamespaceSet();
    namespaces.add(key);
    persistNamespaceSet(namespaces);
    return Array.from(namespaces).sort();
}

function disable(namespace) {
    const key = normalizeNamespace(namespace || '*');
    const namespaces = readNamespaceSet();
    namespaces.delete(key);
    persistNamespaceSet(namespaces);
    return Array.from(namespaces).sort();
}

function setLevel(level) {
    const key = normalizeLevel(level);
    writeStorage(STORAGE_LEVEL_KEY, key);
    return key;
}

function getConfig() {
    return {
        level: getMinLevel(),
        namespaces: Array.from(readNamespaceSet()).sort()
    };
}

// 接管 console 方法
console.debug = (...args) => emit('debug', '', args);
console.info = (...args) => emit('info', '', args);
console.log = (...args) => emit('log', '', args);
console.table = (...args) => emit('table', '', args);
console.warn = (...args) => emit('warn', '', args);
console.error = (...args) => emit('error', '', args);

export const NexoraLog = {
    logger: createLogger,
    enable,
    disable,
    setLevel,
    getConfig,
    originalConsole
};

// 兼容期：保留 window 挂载，供尚未 ESM 化的模块继续使用
window.NexoraLog = NexoraLog;
