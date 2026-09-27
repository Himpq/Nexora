import { Json } from '../../common/JsonUtil';
import { NexoraCodeApi, RemoteConversation, RemoteDevice } from '../../common/NexoraCodeApi';
import { FontSize, Radius, Space } from '../../common/DesignToken';

class RemoteComputerGroup {
    device: RemoteDevice;
    conversations: RemoteConversation[];

    constructor(device: RemoteDevice, conversations: RemoteConversation[]) {
        this.device = device;
        this.conversations = conversations;
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
    onOpenChat: (deviceId: string, conversationId: string, title: string, project: Object | null) => void =
        (_deviceId: string, _conversationId: string, _title: string, _project: Object | null): void => {};
    @State private groups: RemoteComputerGroup[] = [];
    @State private loading: boolean = false;
    @State private error: string = '';
    @State private expandedProjects: string[] = [];

    aboutToAppear(): void {
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
                    groups.push(new RemoteComputerGroup(device, []));
                    continue;
                }

                groups.push(new RemoteComputerGroup(device, await NexoraCodeApi.conversations(device.id)));
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

    build() {
        Column({ space: Space.sm }) {
            Row() {
                Text('电脑项目')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .layoutWeight(1);
                Text(this.loading ? '同步中' : '刷新')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_brand'))
                    .onClick(() => { void this.refresh(); });
            }
            .width('100%')
            .padding({ left: Space.lg, right: Space.lg, bottom: Space.xs });

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
                            Row({ space: Space.sm }) {
                                Image($r('app.media.ic_computer'))
                                    .width(16)
                                    .height(16)
                                    .fillColor($r('app.color.icon_secondary'));
                                Text(group.device.name)
                                    .fontSize(FontSize.body)
                                    .fontColor($r('app.color.text_primary'))
                                    .layoutWeight(1)
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis });
                                Text(group.device.online ? '在线' : '离线')
                                    .fontSize(FontSize.caption)
                                    .fontColor(group.device.online ? $r('app.color.text_brand') : $r('app.color.text_tertiary'));
                            }
                            .width('100%')
                            .height(42)
                            .padding({ left: Space.md, right: Space.md });

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
                                                Text(conversation.title)
                                                    .fontSize(FontSize.caption)
                                                    .fontColor(this.activeConversationId === conversation.id
                                                        ? $r('app.color.text_brand') : $r('app.color.text_secondary'))
                                                    .maxLines(1)
                                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                                    .width('100%')
                                                    .textAlign(TextAlign.Start)
                                                    .height(34)
                                                    .padding({ left: Space.xxl, right: Space.md })
                                                    .borderRadius(Radius.md)
                                                    .onClick(() => this.onOpenChat(group.device.id,
                                                        conversation.id, conversation.title, conversation.project));
                                            }, (conversation: RemoteConversation) => conversation.id);
                                        }
                                    }
                                    .width('100%')
                                    .alignItems(HorizontalAlign.Start)
                                }, (project: RemoteProjectEntry) => group.device.id + ':' + project.path);

                                ForEach(group.conversations.filter((conversation: RemoteConversation): boolean =>
                                    conversation.project === null), (conversation: RemoteConversation) => {
                                    Text(conversation.title)
                                        .fontSize(FontSize.small)
                                        .fontColor(this.activeConversationId === conversation.id
                                            ? $r('app.color.text_brand') : $r('app.color.text_secondary'))
                                        .maxLines(1)
                                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                                        .width('100%')
                                        .textAlign(TextAlign.Start)
                                        .height(38)
                                        .padding({ left: Space.xl, right: Space.md })
                                        .borderRadius(Radius.md)
                                        .onClick(() => this.onOpenChat(group.device.id, conversation.id, conversation.title, null));
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
}
