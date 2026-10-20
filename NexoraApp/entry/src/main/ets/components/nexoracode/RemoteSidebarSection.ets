import { Json } from '../../common/JsonUtil';
import { NexoraCodeApi, RemoteConversation, RemoteDevice, RemoteTaskSession } from '../../common/NexoraCodeApi';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { TimeUtil } from '../../common/TimeUtil';

class RemoteComputerGroup {
    device: RemoteDevice;
    conversations: RemoteConversation[];
    runningIds: string[];

    constructor(device: RemoteDevice, conversations: RemoteConversation[], runningIds: string[]) {
        this.device = device;
        this.conversations = conversations;
        this.runningIds = runningIds;
    }
}

class RemoteProjectEntry {
    path: string;
    name: string;
    project: Object;
    conversations: RemoteConversation[] = [];

    constructor(path: string, name: string, project: Object) {
        this.path = path;
        this.name = name;
        this.project = project;
    }
}

@Component
export struct RemoteSidebarSection {
    @Prop activeConversationId: string = '';
    // 刷新信号：宿主切到「电脑」视图时自增。组件实例会被 ArkUI 复用，
    // aboutToAppear 只在首次创建时触发，靠该信号驱动后续每次切入的重新拉取。
    @Prop @Watch('onRefreshSignal') refreshSeq: number = 0;
    onOpenChat: (deviceId: string, conversationId: string, title: string, project: Object | null) => void =
        (_deviceId: string, _conversationId: string, _title: string, _project: Object | null): void => {};
    @State private groups: RemoteComputerGroup[] = [];
    @State private loading: boolean = false;
    @State private error: string = '';
    @State private expandedProjects: string[] = [];
    @State private pressedConversationKey: string = '';

    aboutToAppear(): void {
        void this.refresh();
    }

    onRefreshSignal(): void {
        void this.refresh();
    }

    async refresh(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            const devices: RemoteDevice[] = await NexoraCodeApi.devices();
            const groups: RemoteComputerGroup[] = [];

            for (const device of devices) {
                if (!device.online) {
                    groups.push(new RemoteComputerGroup(device, [], []));
                    continue;
                }

                // 会话列表与任务状态各取一次：任务状态用于行内「生成中」标记
                const conversations: RemoteConversation[] = await NexoraCodeApi.conversations(device.id);
                const tasks: RemoteTaskSession[] = await NexoraCodeApi.tasks(device.id);
                const runningIds: string[] = [];

                for (const task of tasks) {
                    if ((task.status === 'running' || task.status === 'cancelling')
                        && task.conversationId.length > 0
                        && runningIds.indexOf(task.conversationId) < 0) {
                        runningIds.push(task.conversationId);
                    }
                }

                groups.push(new RemoteComputerGroup(device, conversations, runningIds));
            }

            this.groups = groups;
        } catch (cause) {
            this.error = String(cause);
        } finally {
            this.loading = false;
        }
    }

    private projectsFor(group: RemoteComputerGroup): RemoteProjectEntry[] {
        const projects: RemoteProjectEntry[] = [];

        for (const conversation of group.conversations) {
            if (conversation.project === null || conversation.projectPath.length === 0) {
                continue;
            }

            let entry: RemoteProjectEntry | undefined = projects.find((item: RemoteProjectEntry): boolean =>
                item.path === conversation.projectPath);

            if (entry === undefined) {
                const project: Record<string, Object> = conversation.project as Record<string, Object>;
                const name: string = Json.string(project, 'name') || conversation.projectPath;
                entry = new RemoteProjectEntry(conversation.projectPath, name, conversation.project);
                projects.push(entry);
            }

            entry.conversations.push(conversation);
        }

        return projects;
    }

    private isProjectExpanded(deviceId: string, path: string): boolean {
        return this.expandedProjects.indexOf(deviceId + ':' + path) >= 0;
    }

    private toggleProject(deviceId: string, path: string): void {
        const key: string = deviceId + ':' + path;
        this.expandedProjects = this.isProjectExpanded(deviceId, path)
            ? this.expandedProjects.filter((item: string): boolean => item !== key)
            : [...this.expandedProjects, key];
    }

    private isRunning(group: RemoteComputerGroup, conversationId: string): boolean {
        return group.runningIds.indexOf(conversationId) >= 0;
    }

    private conversationKey(deviceId: string, conversationId: string): string {
        return deviceId + ':' + conversationId;
    }

    private timeLabel(updatedAt: number): string {
        return TimeUtil.short(updatedAt);
    }

    build() {
        Column({ space: Space.sm }) {
            // 头部对齐本地会话列表的 SectionHeader：标题 + 刷新/加载指示
            Row() {
                Text('电脑项目')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .layoutWeight(1);

                if (this.loading) {
                    LoadingProgress()
                        .width(32)
                        .height(32)
                        .color($r('app.color.brand_primary'));
                } else {
                    Text('刷新')
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_brand'))
                        .height(32)
                        .textAlign(TextAlign.Center)
                        .onClick(() => { void this.refresh(); });
                }
            }
            .width('100%')
            .height(32)
            .padding({ left: Space.lg, right: Space.md, bottom: Space.xs });

            if (this.error.length > 0) {
                Text(this.error)
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_danger'))
                    .padding({ left: Space.lg, right: Space.lg });
            } else if (!this.loading && this.groups.length === 0) {
                Text('没有已配对的电脑')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_tertiary'))
                    .padding({ left: Space.lg, right: Space.lg, top: Space.md });
            }

            List({ space: 1 }) {
                ForEach(this.groups, (group: RemoteComputerGroup) => {
                    ListItem() {
                        Column({ space: Space.xxs }) {
                            // 设备行：字号与图标对齐本地功能入口行
                            Row({ space: Space.sm }) {
                                Image($r('app.media.ic_computer'))
                                    .width(Size.icon)
                                    .height(Size.icon)
                                    .fillColor($r('app.color.icon_secondary'));
                                Text(group.device.name)
                                    .fontSize(FontSize.body)
                                    .fontColor($r('app.color.text_primary'))
                                    .layoutWeight(1)
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                                Text(group.device.online ? '在线' : '离线')
                                    .fontSize(FontSize.caption)
                                    .lineHeight(LineHeight.caption)
                                    .fontColor(group.device.online ? $r('app.color.text_brand') : $r('app.color.text_tertiary'));
                            }
                            .width('100%')
                            .height(44)
                            .padding({ left: Space.lg, right: Space.md });

                            if (group.device.online) {
                                ForEach(this.projectsFor(group), (project: RemoteProjectEntry) => {
                                    Column() {
                                        Row({ space: Space.xs }) {
                                            Row({ space: Space.sm }) {
                                                Image(this.isProjectExpanded(group.device.id, project.path)
                                                    ? $r('app.media.ic_chevron_down') : $r('app.media.ic_chevron_right'))
                                                    .width(12)
                                                    .height(12)
                                                    .fillColor($r('app.color.icon_secondary'));
                                                Text(project.name)
                                                    .fontSize(FontSize.small)
                                                    .fontColor($r('app.color.text_primary'))
                                                    .layoutWeight(1)
                                                    .maxLines(1)
                                                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                                                Text(project.conversations.length + ' 个对话')
                                                    .fontSize(FontSize.caption)
                                                    .fontColor($r('app.color.text_tertiary'));
                                            }
                                            .layoutWeight(1)
                                            .height(40)
                                            .borderRadius(Radius.md)
                                            .onClick(() => this.toggleProject(group.device.id, project.path));

                                            Text('新建')
                                                .fontSize(FontSize.caption)
                                                .fontColor($r('app.color.text_brand'))
                                                .padding({ left: Space.sm, right: Space.sm, top: Space.xs, bottom: Space.xs })
                                                .onClick(() => this.onOpenChat(group.device.id, '', project.name, project.project));
                                        }
                                        .height(40)
                                        .padding({ left: Space.xl, right: Space.md });

                                        if (this.isProjectExpanded(group.device.id, project.path)) {
                                            ForEach(project.conversations, (conversation: RemoteConversation) => {
                                                this.RemoteConversationRow(group, conversation);
                                            }, (conversation: RemoteConversation) => conversation.id);
                                        }
                                    }
                                    .width('100%')
                                    .alignItems(HorizontalAlign.Start)
                                }, (project: RemoteProjectEntry) => group.device.id + ':' + project.path);

                                ForEach(group.conversations.filter((conversation: RemoteConversation): boolean =>
                                    conversation.project === null), (conversation: RemoteConversation) => {
                                    this.RemoteConversationRow(group, conversation);
                                }, (conversation: RemoteConversation) => conversation.id);
                            }
                        }
                        .width('100%')
                        .alignItems(HorizontalAlign.Start)
                        .padding({ left: Space.sm, right: Space.sm, bottom: Space.sm });
                    }
                }, (group: RemoteComputerGroup) => group.device.id);
            }
            .layoutWeight(1)
            .width('100%')
            .scrollBar(BarState.Auto)
            .scrollBarWidth(3)
            .scrollBarColor('#3A000000')
            .padding({ left: Space.md, right: Space.md });
        }
        .width('100%')
        .layoutWeight(1);
    }

    // 会话行：样式对齐本地会话列表（行高50、正文字号、激活/按压态、时间或生成中标记）
    @Builder
    RemoteConversationRow(group: RemoteComputerGroup, conversation: RemoteConversation) {
        Row({ space: Space.sm }) {
            Text(conversation.title)
                .fontSize(FontSize.body)
                .fontColor(this.activeConversationId === conversation.id
                    ? $r('app.color.text_brand') : $r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);

            if (this.isRunning(group, conversation.id)) {
                Text('生成中')
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_brand'));
            } else if (this.timeLabel(conversation.updatedAt).length > 0) {
                Text(this.timeLabel(conversation.updatedAt))
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'));
            }
        }
        .width('100%')
        .height(50)
        .padding({ left: Space.xl, right: Space.md })
        .borderRadius(Radius.md)
        .backgroundColor(this.activeConversationId === conversation.id
            ? $r('app.color.brand_soft')
            : this.pressedConversationKey === this.conversationKey(group.device.id, conversation.id)
                ? $r('app.color.bg_pressed')
                : Color.Transparent)
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            const key: string = this.conversationKey(group.device.id, conversation.id);

            if (event.type === TouchType.Down) {
                this.pressedConversationKey = key;
            }

            if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.pressedConversationKey = '';
            }
        })
        .onClick(() => this.onOpenChat(group.device.id,
            conversation.id, conversation.title, conversation.project));
    }
}
