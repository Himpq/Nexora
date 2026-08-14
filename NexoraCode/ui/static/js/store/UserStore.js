/**
 * UserStore - 用户/认证状态
 *
 * 管理当前登录用户信息、角色、偏好设置。
 */
import { ReactiveStore } from './ReactiveStore.js';

export class UserStore extends ReactiveStore {

    constructor() {
        super({
            // 用户名
            username: null,

            // 角色: 'member' | 'admin'
            role: 'member',

            // 头像 URL
            avatarUrl: '',

            // 用户偏好设置对象
            preferences: null,

            // 身份请求 Promise（防重复请求）
            identityRequest: null,

            // 待上传的头像 DataURL
            pendingAvatarDataUrl: ''
        });
    }

    get username() {
        return this.get('username');
    }

    set username(value) {
        this.set('username', value);
    }

    get role() {
        return this.get('role');
    }

    get isAdmin() {
        return this.get('role') === 'admin';
    }

    /**
     * 一次性写入完整用户身份信息
     */
    setIdentity(identity) {
        this.patch({
            username: identity.username,
            role: identity.role || 'member',
            avatarUrl: identity.avatarUrl || '',
            preferences: identity.preferences || null
        });
    }
}
