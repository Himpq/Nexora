<!--
    LoginView.vue — 登录页(复刻原版 login.html 视觉)

    布局:左侧黑色品牌区(大 Logo) + 右侧白色表单区
-->

<template>
    <div class="login-wrapper">
        <div class="login-left">
            <div class="brand-block">
                <div class="big-logo">Nexora<span class="dot"></span></div>
            </div>
        </div>

        <div class="login-right">
            <div class="login-box">
                <div class="login-header">
                    <h2>欢迎回来</h2>
                    <p>Connect / Remember / Know</p>
                </div>

                <div class="error-message" :class="{ show: errorMessage }">
                    {{ errorMessage }}
                </div>

                <form id="loginForm" @submit.prevent="handleSubmit">
                    <div class="form-group">
                        <label for="username">用户名</label>
                        <input
                            id="username"
                            v-model="form.username"
                            type="text"
                            placeholder="输入您的用户名"
                            autocomplete="username"
                        />
                    </div>

                    <div class="form-group">
                        <label for="password">密码</label>
                        <input
                            id="password"
                            v-model="form.password"
                            type="password"
                            placeholder="输入您的密码"
                            autocomplete="current-password"
                        />
                    </div>

                    <button type="submit" class="btn-login" id="loginBtn" :disabled="submitting">
                        <span id="btnText" :style="{ display: submitting ? 'none' : 'inline' }">登 录</span>
                        <div class="loading" id="loading" :style="{ display: submitting ? 'inline-block' : 'none' }"></div>
                    </button>
                </form>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { reactive, ref } from 'vue'
    import { useRoute, useRouter } from 'vue-router'

    import { useUserStore } from '@/stores/user'

    const route = useRoute()
    const router = useRouter()
    const userStore = useUserStore()

    const form = reactive({
        username: '',
        password: '',
    })

    const errorMessage = ref('')
    const submitting = ref(false)

    /** 回跳地址解析(与原版 resolveNextPath 一致:仅允许站内相对路径) */
    function resolveNextPath(): string {
        const raw = typeof route.query.next === 'string' ? route.query.next : ''

        if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
            return '/'
        }

        return raw
    }

    async function handleSubmit(): Promise<void> {
        if (submitting.value) {
            return
        }

        const username = form.username.trim()
        const password = form.password

        if (!username || !password) {
            errorMessage.value = '请输入用户名和密码'

            return
        }

        submitting.value = true
        errorMessage.value = ''

        try {
            const ok = await userStore.login(username, password)

            if (ok) {
                await router.replace(resolveNextPath())

                return
            }

            errorMessage.value = '用户名或密码错误'
        } catch (error) {
            errorMessage.value = error instanceof Error ? error.message : '网络错误,请稍后重试'
        } finally {
            submitting.value = false
        }
    }
</script>

<style scoped>
    :root {
        --bg-left: #000000;
        --bg-right: #ffffff;
        --text-main: #1a1a1a;
        --border: #eeeeee;
    }

    .login-wrapper {
        display: flex;
        height: 100vh;
        width: 100%;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: #fff;
    }

    .login-left {
        flex: 1.3;
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
    }

    .login-left::before {
        content: '';
        position: absolute;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle at center, #111 0%, #000 70%);
        opacity: 0.5;
    }

    .brand-block {
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
    }

    .big-logo {
        font-size: 84px;
        font-weight: 700;
        color: #fff;
        letter-spacing: -4px;
        display: flex;
        align-items: baseline;
        z-index: 10;
        text-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .big-logo .dot {
        color: #444;
        margin-left: 4px;
    }

    .login-right {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
        background: #fff;
    }

    .login-box {
        width: 100%;
        max-width: 380px;
    }

    .login-header {
        margin-bottom: 40px;
    }

    .login-header h2 {
        font-size: 28px;
        font-weight: 600;
        color: #1a1a1a;
        margin: 0 0 8px;
    }

    .login-header p {
        color: #0f0f0f;
        font-size: 12px;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0;
    }

    .login-header p::before,
    .login-header p::after {
        content: '';
        display: inline-block;
        width: 18px;
        height: 1px;
        background: #111;
        opacity: 0.4;
    }

    .error-message {
        background: #fff2f2;
        color: #d00;
        padding: 14px;
        border-radius: 4px;
        border-left: 4px solid #d00;
        margin-bottom: 24px;
        font-size: 14px;
        display: none;
    }

    .error-message.show {
        display: block;
        animation: fade-in 0.3s;
    }

    .form-group {
        margin-bottom: 24px;
    }

    .form-group label {
        display: block;
        margin-bottom: 10px;
        color: #1a1a1a;
        font-weight: 500;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .form-group input {
        width: 100%;
        padding: 14px 16px;
        border: 1px solid #eee;
        border-radius: 4px;
        font-size: 15px;
        background: #fafafa;
        transition: all 0.2s ease;
    }

    .form-group input:focus {
        outline: none;
        border-color: #000;
        background: #fff;
        box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.03);
    }

    .btn-login {
        width: 100%;
        padding: 16px;
        background: #000;
        color: #fff;
        border: none;
        border-radius: 4px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
    }

    .btn-login:hover:not(:disabled) {
        background: #222;
        transform: translateY(-1px);
    }

    .btn-login:disabled {
        background: #999;
        cursor: not-allowed;
    }

    .loading {
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    @keyframes fade-in {
        from {
            opacity: 0;
        }

        to {
            opacity: 1;
        }
    }

    @media (max-width: 768px) {
        .login-left {
            display: none;
        }

        .login-right {
            flex: 1;
        }
    }
</style>
