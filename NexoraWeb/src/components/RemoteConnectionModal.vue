<!--
    RemoteConnectionModal.vue — 远程连接

    只做「电脑连上这台服务器」这一件事，不承载任务下发：
      - 服务器地址：填进电脑端 NexoraCode 设置的「服务器地址」完成配对；
      - 配对码：一次性、五分钟有效，电脑端输入后即换设备凭据；
      - 已绑定电脑：在线状态与解除绑定。

    电脑主动向云端发起 WebSocket，云端拿不到电脑的 IP，因此这里不展示电脑地址。
-->

<template>
    <Modal
        :open="open"
        title="远程连接"
        modal-class="remote-connection-modal"
        width="520px"
        @close="emit('close')"
    >
        <div class="remote-connection">
            <p class="remote-connection-lead">
                电脑端 NexoraCode 主动连接本服务器，任务与历史留在电脑本地，服务器只做转发。
            </p>

            <div class="gddp-form-field">
                <label>服务器地址</label>
                <div class="remote-connection-value">
                    <code class="remote-connection-code">{{ serverUrl }}</code>
                    <Button size="compact" icon="fa-regular fa-copy" :disabled="busy" @click="copyServerUrl">复制</Button>
                </div>
            </div>

            <div class="gddp-form-field">
                <label>配对码</label>
                <div v-if="pairCode" class="remote-connection-value">
                    <code class="remote-connection-code is-emphasis">{{ pairCode }}</code>
                    <span class="remote-connection-countdown">{{ pairCountdown }}</span>
                </div>
                <div v-else class="remote-connection-hint">
                    在电脑端 NexoraCode 设置 → 远程连接中填入上方地址与配对码。
                </div>
                <div class="remote-connection-actions">
                    <Button size="compact" :disabled="busy" @click="run(createPair)">生成配对码</Button>
                </div>
            </div>

            <div class="remote-connection-devices">
                <div class="remote-connection-devices-head">
                    <span>已绑定电脑</span>
                    <Button size="compact" icon="fa-solid fa-rotate" :disabled="busy" @click="run(loadDevices)">刷新</Button>
                </div>

                <p v-if="loading" class="remote-connection-hint">正在读取设备状态…</p>
                <p v-else-if="!devices.length" class="remote-connection-hint">尚未绑定电脑。生成配对码后在电脑端完成配对。</p>
                <ul v-else class="remote-connection-list">
                    <li v-for="device in devices" :key="device.device_id" class="remote-connection-device">
                        <span class="remote-connection-device-icon">
                            <i class="fa-solid fa-laptop-code" aria-hidden="true"></i>
                        </span>
                        <span class="remote-connection-device-main">
                            <span class="remote-connection-device-name">{{ device.name || '未命名电脑' }}</span>
                            <span class="remote-connection-device-meta mono">{{ device.device_id }}</span>
                        </span>
                        <span class="remote-connection-device-state" :class="device.online ? 'is-online' : 'is-offline'">
                            {{ device.online ? '在线' : '离线' }}
                        </span>
                        <Button
                            size="compact"
                            variant="danger"
                            :disabled="busy"
                            @click="run(() => revoke(device.device_id))"
                        >解除绑定</Button>
                    </li>
                </ul>
            </div>

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

    const devices = ref<RemoteDevice[]>([])
    const pairCode = ref('')
    const pairExpiresAt = ref(0)
    const now = ref(Date.now())
    const loading = ref(false)
    const busy = ref(false)
    const error = ref('')
    let ticker: number | null = null

    const serverUrl = window.location.origin
    const pairCountdown = computed(() => {
        const seconds = Math.max(0, Math.floor((pairExpiresAt.value - now.value) / 1000))

        if (seconds <= 0) {
            return '已过期'
        }

        return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒后失效`
    })

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

    async function loadDevices(): Promise<void> {
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
            void run(loadDevices)
        },
        { immediate: true }
    )

    onBeforeUnmount(stopTicker)
</script>
