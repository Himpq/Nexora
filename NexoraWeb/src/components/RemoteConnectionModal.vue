<!--
    RemoteConnectionModal.vue — 远程连接

    只做「电脑连上这台服务器」这一件事，不承载任务下发：
      - 顶部状态条：一眼回答「现在有没有电脑连着」，不必逐行扫列表；
      - 服务器地址：填进电脑端 NexoraCode 设置的「服务器地址」完成配对；
      - 配对码：一次性、五分钟有效，电脑端输入后即换设备凭据；
      - 已绑定电脑：每台一行带状态点，解除绑定是次要操作。

    电脑主动向云端发起 WebSocket，云端拿不到电脑的 IP，因此这里不展示电脑地址。
-->

<template>
    <Modal
        :open="open"
        title="远程连接"
        modal-class="remote-connection-modal"
        width="720px"
        @close="emit('close')"
    >
        <div class="remote-connection">
            <!-- 状态条：最主要的信息，视觉权重高于下面所有操作 -->
            <div class="remote-connection-status" :class="statusTone">
                <span class="remote-connection-status-dot" aria-hidden="true"></span>
                <span class="remote-connection-status-main">
                    <strong>{{ statusHeadline }}</strong>
                    <span class="remote-connection-status-detail">{{ statusDetail }}</span>
                </span>
                <Button size="compact" icon="fa-solid fa-rotate" :disabled="busy" @click="run(() => loadDevices({ manual: true }))">刷新</Button>
            </div>

            <p class="remote-connection-lead">
                电脑端 NexoraCode 主动连接本服务器，任务与历史留在电脑本地，服务器只做转发。
            </p>

            <div class="remote-connection-grid">
                <section class="remote-connection-card">
                    <h3 class="remote-connection-card-title">服务器地址</h3>
                    <p class="remote-connection-card-hint">填入电脑端 NexoraCode 设置 → 远程连接</p>
                    <div class="remote-connection-value">
                        <code class="remote-connection-code">{{ serverUrl }}</code>
                        <Button size="compact" icon="fa-regular fa-copy" :disabled="busy" @click="copyServerUrl">复制</Button>
                    </div>
                </section>

                <section class="remote-connection-card">
                    <h3 class="remote-connection-card-title">配对码</h3>
                    <p class="remote-connection-card-hint">
                        {{ pairCode ? pairCountdown : '一次性，五分钟内有效' }}
                    </p>
                    <div v-if="pairCode" class="remote-connection-value">
                        <code class="remote-connection-code is-emphasis">{{ pairCode }}</code>
                    </div>
                    <div v-else class="remote-connection-value">
                        <Button variant="primary" :disabled="busy" @click="run(createPair)">生成配对码</Button>
                    </div>
                </section>
            </div>

            <section class="remote-connection-devices">
                <h3 class="remote-connection-card-title">已绑定电脑</h3>

                <p v-if="loading" class="remote-connection-hint">正在读取设备状态…</p>
                <p v-else-if="!devices.length" class="remote-connection-hint">
                    还没有电脑绑定。生成配对码后，在电脑端 NexoraCode 设置 → 远程连接中填入地址与配对码。
                </p>
                <ul v-else class="remote-connection-list">
                    <li v-for="device in devices" :key="device.device_id" class="remote-connection-device">
                        <span
                            class="remote-connection-device-dot"
                            :class="device.online ? 'is-online' : 'is-offline'"
                            aria-hidden="true"
                        ></span>
                        <span class="remote-connection-device-main">
                            <span class="remote-connection-device-name">{{ device.name || '未命名电脑' }}</span>
                            <span class="remote-connection-device-meta">
                                {{ device.online ? '已连接，可下发任务' : '未连接，任务与历史不可用' }}
                                <code class="remote-connection-device-id">{{ shortId(device.device_id) }}</code>
                            </span>
                        </span>
                        <Button size="compact" variant="quiet" :disabled="busy" @click="run(() => revoke(device.device_id))">
                            解除绑定
                        </Button>
                    </li>
                </ul>
            </section>

            <p v-if="error" role="alert" class="remote-connection-error">{{ error }}</p>
        </div>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import { createPairCode, fetchDevices, revokeDevice, type RemoteDevice } from '@/api/nexoracode'
    import { showError, showToast } from '@/stores/notify'
    import { Button } from '@/ui'
    import Modal from '@/ui/Modal.vue'

    import '@/styles/remote-connection-modal.css'

    const props = defineProps<{ open: boolean }>()

    const emit = defineEmits<{ close: [] }>()

/** 设备在线状态由电脑端主动上报，弹窗必须自己轮询才能看到变化。 */
const DEVICE_POLL_MS = 5000

const devices = ref<RemoteDevice[]>([])
const pairCode = ref('')
const pairExpiresAt = ref(0)
const now = ref(Date.now())
const loading = ref(false)
const busy = ref(false)
const error = ref('')
let ticker: number | null = null
let poller: number | null = null
/** 用户点过「刷新」后短暂抑制轮询，避免把手动动作的节奏打乱。 */
let manualRefreshUntil = 0

    const serverUrl = window.location.origin

    const onlineCount = computed(() => devices.value.filter(device => device.online).length)
    const totalCount = computed(() => devices.value.length)
    const statusTone = computed(() => {
        if (!totalCount.value) {
            return 'is-empty'
        }

        return onlineCount.value > 0 ? 'is-online' : 'is-offline'
    })
    const statusHeadline = computed(() => {
        if (!totalCount.value) {
            return '尚未绑定电脑'
        }

        if (!onlineCount.value) {
            return '电脑未连接'
        }

        return onlineCount.value === 1 ? '1 台电脑在线' : `${onlineCount.value} 台电脑在线`
    })
    const statusDetail = computed(() => {
        if (!totalCount.value) {
            return '生成配对码，在电脑端完成绑定'
        }

        if (onlineCount.value < totalCount.value) {
            return `共 ${totalCount.value} 台，${totalCount.value - onlineCount.value} 台离线`
        }

        return '可下发任务并读取该电脑的会话'
    })
    const pairCountdown = computed(() => {
        const seconds = Math.max(0, Math.floor((pairExpiresAt.value - now.value) / 1000))

        if (seconds <= 0) {
            return '已过期，请重新生成'
        }

        return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒后失效`
    })

    function shortId(value: string): string {
        const text = String(value || '')

        return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text
    }

    async function run(action: () => Promise<void>): Promise<void> {
        if (busy.value) {
            return
        }

        busy.value = true
        error.value = ''

        try {
            await action()
        } catch (cause) {
            error.value = cause instanceof Error ? cause.message : String(cause)
        } finally {
            busy.value = false
        }
    }

    async function loadDevices(options: { manual?: boolean } = {}): Promise<void> {
        if (options.manual) {
            manualRefreshUntil = Date.now() + DEVICE_POLL_MS
        }

        loading.value = true

        try {
            devices.value = (await fetchDevices()).devices
        } finally {
            loading.value = false
        }
    }

    async function createPair(): Promise<void> {
        const result = await createPairCode()
        pairCode.value = result.code
        pairExpiresAt.value = Date.now() + Math.max(0, Number(result.expires_in) || 0) * 1000
        showToast('配对码已生成，五分钟内在电脑端输入', 'success')
    }

    async function revoke(deviceId: string): Promise<void> {
        await revokeDevice(deviceId)
        devices.value = devices.value.filter(device => device.device_id !== deviceId)
        showToast('已解除该电脑的绑定', 'success')
    }

    async function copyServerUrl(): Promise<void> {
        try {
            await navigator.clipboard.writeText(serverUrl)
            showToast('服务器地址已复制', 'success')
        } catch (cause) {
            showError(cause instanceof Error ? cause.message : '复制失败')
        }
    }

    function stopTicker(): void {
        if (ticker !== null) {
            window.clearInterval(ticker)
            ticker = null
        }

        if (poller !== null) {
            window.clearInterval(poller)
            poller = null
        }
    }

    watch(
        () => props.open,
        (opened) => {
            stopTicker()

            if (!opened) {
                return
            }

            now.value = Date.now()
            // 倒计时只用于提示过期，过期后自动清空配对码避免误用。
            ticker = window.setInterval(() => {
                now.value = Date.now()

                if (pairExpiresAt.value > 0 && now.value >= pairExpiresAt.value) {
                    pairCode.value = ''
                    pairExpiresAt.value = 0
                }
            }, 1000)
            void run(() => loadDevices())
            // 电脑随时可能上线或掉线，弹窗开着就得持续反映最新状态。
            poller = window.setInterval(() => {
                if (busy.value || Date.now() < manualRefreshUntil) {
                    return
                }

                void loadDevices()
            }, DEVICE_POLL_MS)
        },
        { immediate: true }
    )

    onBeforeUnmount(stopTicker)
</script>
