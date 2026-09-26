import { NexoraCodeApi, RemoteDevice, RemoteConversation, RemoteTaskBody } from '../../common/NexoraCodeApi';
import { Json } from '../../common/JsonUtil';
import { IconButton } from '../common/IconButton';
import { Space, FontSize } from '../../common/DesignToken';

@Component
export struct RemoteProjectsPage {
    onBack: () => void = () => {};
    @State private devices: RemoteDevice[] = [];
    @State private conversations: RemoteConversation[] = [];
    @State private deviceId: string = '';
    @State private conversationId: string = '';
    @State private draft: string = '';
    @State private output: string = '';
    @State private error: string = '';
    @State private busy: boolean = false;
    @State private taskStatus: string = '';
    @State private permissionText: string = '';
    private permission: Object | null = null;
    private streamId: string = '';
    private cursor: number = 0;
    private generation: number = 0;
    private pollBusy: boolean = false;
    private timer: number = -1;
    private pending: RemoteTaskBody | null = null;

    aboutToAppear(): void {
        void this.refresh();
        this.timer = setInterval(() => { void this.poll(); }, 1500);
    }

    aboutToDisappear(): void {
        this.generation++;
        clearInterval(this.timer);
    }

    private isOnline(): boolean {
        return this.devices.some((device: RemoteDevice): boolean => device.id === this.deviceId && device.online);
    }

    private isRunning(): boolean {
        return this.taskStatus === 'running' || this.taskStatus === 'cancelling';
    }

    private statusLabel(): string {
        if (this.taskStatus === 'running') return '执行中';
        if (this.taskStatus === 'cancelling') return '正在停止';
        if (this.taskStatus === 'done') return '已完成';
        if (this.taskStatus === 'cancelled') return '已停止';
        if (this.taskStatus === 'error') return '执行失败';
        if (this.taskStatus === 'interrupted') return '电脑重启，任务已中断';
        return '未开始';
    }

    private async refresh(): Promise<void> {
        try {
            this.devices = await NexoraCodeApi.devices();
        } catch (cause) {
            this.error = String(cause);
        }
    }

    private async selectDevice(id: string): Promise<void> {
        this.busy = true;
        this.generation++;
        this.deviceId = id;
        this.conversationId = '';
        this.streamId = '';
        this.output = '';
        this.taskStatus = '';
        this.pending = null;
        this.permission = null;
        this.permissionText = '';

        try {
            this.conversations = await NexoraCodeApi.conversations(id);
            this.error = '';
        } catch (cause) {
            this.error = String(cause);
        } finally {
            this.busy = false;
        }
    }

    private async selectConversation(id: string): Promise<void> {
        this.busy = true;
        this.generation++;
        this.conversationId = id;
        this.cursor = 0;
        this.streamId = '';
        this.taskStatus = '';
        this.pending = null;
        this.permission = null;
        this.permissionText = '';

        try {
            const data: Record<string, Object> = await NexoraCodeApi.rpc(this.deviceId, '/api/conversations/' + id + '/messages');
            const tasks: Record<string, Object> = await NexoraCodeApi.rpc(this.deviceId, '/api/local/tasks');
            let historyUserCount: number = -1;

            for (const raw of Json.array(tasks, 'sessions')) {
                const task: Record<string, Object> = raw as Record<string, Object>;
                const status: string = Json.string(task, 'status');

                if (Json.string(task, 'conversation_id') === id && Json.fieldOrNull(task, 'history_user_count') !== null) {
                    this.streamId = Json.string(task, 'stream_id');
                    this.taskStatus = status;
                    historyUserCount = Json.number(task, 'history_user_count');
                    break;
                }
            }
            let userCount: number = 0;
            this.output = Json.array(data, 'messages').filter((raw: Object): boolean => {
                const row: Record<string, Object> = raw as Record<string, Object>;
                const isUser: boolean = Json.string(row, 'role') === 'user';
                if (isUser) userCount++;
                return historyUserCount < 0 || userCount <= historyUserCount || (userCount === historyUserCount + 1 && isUser);
            }).map((raw: Object): string => {
                const row: Record<string, Object> = raw as Record<string, Object>;
                return (Json.string(row, 'role') === 'user' ? '你' : 'NexoraCode') + '：\n' + Json.string(row, 'content');
            }).join('\n\n');
            this.error = '';
        } catch (cause) {
            this.error = String(cause);
        } finally {
            this.busy = false;
        }
    }

    private async newConversation(project: Object | null): Promise<void> {
        this.busy = true;
        try {
            const id: string = await NexoraCodeApi.createConversation(this.deviceId, project);
            this.conversations = await NexoraCodeApi.conversations(this.deviceId);
            await this.selectConversation(id);
        } catch (cause) {
            this.error = String(cause);
        } finally {
            this.busy = false;
        }
    }

    private async send(): Promise<void> {
        this.busy = true;
        try {
            if (this.conversationId.length === 0) {
                this.conversationId = await NexoraCodeApi.createConversation(this.deviceId, null);
            }

            if (this.pending === null) {
                this.pending = { request_id: 'android-' + Date.now() + '-' + Math.random().toString(36).slice(2), conversation_id: this.conversationId, message: this.draft.trim(), force_context_compression: false };
            }

            const result: Record<string, Object> = await NexoraCodeApi.rpc(this.deviceId, '/api/local/tasks', 'POST', this.pending);
            this.output += '\n\n你：\n' + this.pending.message + '\n\nNexoraCode：\n';
            this.pending = null;
            this.draft = '';
            this.streamId = Json.string(result, 'stream_id');
            this.cursor = 0;
            this.taskStatus = 'running';
            this.error = '';
        } catch (cause) {
            this.error = String(cause);
        } finally {
            this.busy = false;
        }
    }

    private async stop(): Promise<void> {
        try {
            await NexoraCodeApi.rpc(this.deviceId, '/api/local/tasks/' + this.streamId + '/cancel', 'POST');
            this.taskStatus = 'cancelling';
        } catch (cause) {
            this.error = String(cause);
        }
    }

    private async answerPermission(allow: boolean): Promise<void> {
        this.busy = true;
        try {
            if (allow && this.permission !== null) {
                await NexoraCodeApi.grant(this.deviceId, this.conversationId, this.permission);
            }
            this.permission = null;
            this.permissionText = '';
            this.draft = allow ? '已允许本次对话访问该路径，请继续未完成的任务。' : '拒绝该路径访问，请在已有授权范围内继续。';
            await this.send();
        } catch (cause) {
            this.error = String(cause);
        } finally {
            this.busy = false;
        }
    }

    private async poll(): Promise<void> {
        if (this.busy || this.pollBusy) return;
        this.pollBusy = true;
        const epoch: number = this.generation;
        const sid: string = this.streamId;

        try {
            await this.refresh();
            if (!this.isOnline() || sid.length === 0) return;
            const data: Record<string, Object> = await NexoraCodeApi.rpc(this.deviceId, '/api/local/tasks/' + sid + '/events', 'GET', undefined, this.cursor);
            if (epoch !== this.generation || sid !== this.streamId) return;

            for (const raw of Json.array(data, 'events')) {
                const event: Record<string, Object> = raw as Record<string, Object>;
                const type: string = Json.string(event, 'type');
                this.cursor = Json.number(event, '_stream_seq');

                if (type === 'content') {
                    this.output += Json.string(event, 'content');
                } else if (type === 'function_call' || type === 'function_result' || type === 'context_compression_status') {
                    this.output += '\n[' + (Json.string(event, 'name') || type) + '] ' + (Json.string(event, 'result') || Json.string(event, 'content')) + '\n';
                } else if (type === 'question') {
                    const question: Record<string, Object> | null = Json.object(event, 'question');

                    if (question !== null) {
                        this.permission = Json.object(question, 'permission_request');
                        this.permissionText = Json.string(question, 'question_content');
                    }
                } else if (type === 'error') {
                    this.error = Json.string(event, 'message') || Json.string(event, 'content');
                }
            }

            const session: Record<string, Object> | null = Json.object(data, 'session');
            if (session !== null) {
                this.taskStatus = Json.string(session, 'status');
                if (Json.string(session, 'error').length > 0) this.error = Json.string(session, 'error');
                if (!this.isRunning() && this.cursor >= Json.number(session, 'last_seq')) this.streamId = '';
            }
        } catch (cause) {
            if (epoch === this.generation) this.error = String(cause);
        } finally {
            this.pollBusy = false;
        }
    }

    build() {
        Column({ space: Space.md }) {
            Row() {
                IconButton({ icon: $r('app.media.ic_back'), onTap: (): void => { this.onBack(); } });
                Text('电脑项目').fontSize(FontSize.title).layoutWeight(1);
                Button('刷新').onClick(() => { void this.refresh(); });
            }.width('100%');
            Text('任务在电脑执行；电脑离线时无法读取历史。请先在网页 Projects 配对电脑。')
                .fontSize(FontSize.small).fontColor($r('app.color.text_secondary'));
            if (this.error.length > 0) Text(this.error).fontSize(FontSize.small);
            Scroll() {
                Column({ space: Space.sm }) {
                    ForEach(this.devices, (device: RemoteDevice) => {
                        Button(device.name + (device.online ? ' · 在线' : ' · 离线'))
                            .enabled(device.online && !this.busy)
                            .onClick(() => { void this.selectDevice(device.id); });
                    }, (device: RemoteDevice) => device.id);
                    if (this.deviceId.length > 0) {
                        Button('新会话').enabled(this.isOnline() && !this.busy && !this.isRunning()).onClick(() => { void this.newConversation(null); });
                        ForEach(this.conversations, (conversation: RemoteConversation) => {
                            Row() {
                                Button(conversation.title).layoutWeight(1).enabled(this.isOnline() && !this.busy)
                                    .onClick(() => { void this.selectConversation(conversation.id); });
                                if (conversation.project !== null) {
                                    Button('新任务').enabled(this.isOnline() && !this.busy && !this.isRunning())
                                        .onClick(() => { void this.newConversation(conversation.project); });
                                }
                            }.width('100%');
                            if (conversation.projectPath.length > 0) Text(conversation.projectPath).fontSize(FontSize.small);
                        }, (conversation: RemoteConversation) => conversation.id);
                        Text(this.isOnline() ? '执行状态：' + this.statusLabel() : '电脑离线，执行状态尚未确认').fontSize(FontSize.small);
                        Text(this.output).width('100%').fontSize(FontSize.body).copyOption(CopyOptions.LocalDevice);
                        if (this.permissionText.length > 0) {
                            Text(this.permissionText).fontSize(FontSize.body);
                            Row({ space: Space.md }) {
                                Button('允许本次对话').enabled(this.isOnline() && !this.busy && !this.isRunning()).onClick(() => { void this.answerPermission(true); });
                                Button('拒绝').enabled(this.isOnline() && !this.busy && !this.isRunning()).onClick(() => { void this.answerPermission(false); });
                            }
                        }
                    }
                }.width('100%');
            }.layoutWeight(1).width('100%');
            if (this.deviceId.length > 0) {
                TextArea({ text: this.draft, placeholder: '向电脑上的 NexoraCode 发任务' })
                    .height(90).enabled(this.isOnline()).onChange((value: string) => { this.draft = value; });
                Row({ space: Space.md }) {
                    Button('发送到电脑').enabled(this.isOnline() && !this.busy && !this.isRunning() && this.draft.trim().length > 0)
                        .onClick(() => { void this.send(); });
                    Button('停止任务').enabled(this.isOnline() && this.isRunning()).onClick(() => { void this.stop(); });
                }
            }
        }.width('100%').height('100%').padding(Space.lg).backgroundColor($r('app.color.bg_page'));
    }
}
