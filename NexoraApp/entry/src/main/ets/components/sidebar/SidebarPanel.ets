// SidebarPanel.ets - 左侧抽屉内容（豆包式侧栏）
// 账号卡 + 新对话 + 最近对话列表（点击切换、⋯菜单置顶/删除）+ 设置 / 退出登录
// 数据直接消费 AppState 单例（@Observed），会话增删改后列表自动刷新，宿主只负责显隐与业务回调
// 注意：本组件是组件级，@ObjectLink 由宿主页面的 @State 单例注入，符合工程约定

import { ConversationItem, KnowledgeItem, sanitizeDisplayName } from '../../common/AppConfig';
import { AppState } from '../../common/AppState';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { UserAvatar } from '../common/UserAvatar';
import { IconButton } from '../common/IconButton';

@Component
export struct SidebarPanel {
    @ObjectLink app: AppState;
    @Prop activeConversationId: string = '';
    // 会话列表数据源：由宿主页面在每次刷新/置顶/删除后（epoch 触发重渲染时）以最新快照推送。
    // 列表展示不直接依赖 @ObjectLink 对 app.conversations 数组整体替换的通知（真机曾实测不稳），
    // 改由宿主 @State 代次 -> @Prop 快照的确定性链路驱动；ForEach key 用稳定 id，
    // 同 key 行就地更新数据而非销毁重建，杜绝"刷新即整表重建 -> 高度抖动闪烁"
    @Prop convList: ConversationItem[] = [];
    // 会话列表代次：宿主每次刷新/置顶/删除后 +1（见 convList 注释）
    @Prop @Watch('onEpochChanged') convEpoch: number = 0;
    onNewChat: () => void = () => {};
    onOpenConversation: (conversationId: string, title: string) => void = () => {};
    onTogglePin: (item: ConversationItem) => void = () => {};
    onDeleteRequest: (item: ConversationItem) => void = () => {};
    onOpenSettings: () => void = () => {};
    onSignOut: () => void = () => {};
    // 手动刷新：由宿主执行（刷新 + bump 代次），因为列表数据源是宿主 @Prop 推送，
    // 组件内部直接刷 AppState 不会驱动 @Prop 更新
    onRequestRefresh: () => void = () => {};
    // 知识库相关：列表数据直接消费 app.knowledgeList（@ObjectLink 驱动），刷新由组件直接调 app
    onOpenKnowledge: (title: string) => void = () => {};
    onToggleKnowledgePin: (item: KnowledgeItem) => void = () => {};
    onDeleteKnowledge: (item: KnowledgeItem) => void = () => {};
    onCreateKnowledge: () => void = () => {};

    private listScroller: Scroller = new Scroller();
    // 侧栏实例创建时刻：仅挂载后短暂窗口内随代次滚动（打开侧栏定位当前会话），
    // 之后刷新/置顶/删除等代次变化不再强制滚动，避免列表被反复拉回中部造成视觉跳动
    private bornAt: number = 0;

    aboutToAppear(): void {
        this.bornAt = Date.now();

        // 侧栏由宿主按需挂载，展开动画结束（240ms）后再把选中会话滚到可视区中部
        setTimeout(() => {
            this.scrollToActive();
        }, 280);
    }

    build() {
        Column() {
            this.AccountHeader();

            this.NewChatButton();

            // 分隔线：区分顶部功能区与列表区
            Divider()
                .strokeWidth(0.5)
                .color($r('app.color.divider'))
                .margin({ left: Space.lg, right: Space.lg });

            this.SectionHeader();

            // 列表区：根据侧栏视图切换，淡入淡出过渡
            if (this.app.sidebarView === 'chat') {
                Column() {
                    if (this.app.conversationsError.length > 0) {
                        this.ErrorHint();
                    } else if (this.convList.length === 0 && !this.app.conversationsLoading) {
                        this.EmptyHint();
                    } else {
                        // space=1 固定行距，行高固定 50：每项布局高恒为 51，消除任何"估算高/实测高"两阶段跳变
                        List({ scroller: this.listScroller, space: 1 }) {
                            ForEach(this.convList, (item: ConversationItem) => {
                                ListItem() {
                                    this.ConversationRow(item);
                                }
                            }, (item: ConversationItem) => item.id);
                        }
                        .layoutWeight(1)
                        .width('100%')
                        .scrollBar(BarState.Auto)
                        .scrollBarWidth(3)
                        .scrollBarColor('#3A000000')
                        .padding({ left: Space.md, right: Space.md });
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
            } else {
                Column() {
                    if (this.app.knowledgeError.length > 0) {
                        this.KnowledgeErrorHint();
                    } else if (this.app.knowledgeList.length === 0 && !this.app.knowledgeLoading) {
                        this.KnowledgeEmptyHint();
                    } else {
                        List({ space: 1 }) {
                            ForEach(this.app.knowledgeList, (item: KnowledgeItem) => {
                                ListItem() {
                                    this.KnowledgeRow(item);
                                }
                            }, (item: KnowledgeItem) => item.title);
                        }
                        .layoutWeight(1)
                        .width('100%')
                        .scrollBar(BarState.Auto)
                        .scrollBarWidth(3)
                        .scrollBarColor('#3A000000')
                        .padding({ left: Space.md, right: Space.md });
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
            }

            Blank();

            // 分隔线：区分列表区与底部功能区
            Divider()
                .strokeWidth(0.5)
                .color($r('app.color.divider'))
                .margin({ left: Space.lg, right: Space.lg });

            this.ViewSwitcher();

            this.Footer();
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    // ---------- 区域 ----------

    // 账号卡：头像 + 展示名 + 后端地址（脏值已在展示层清洗）
    @Builder
    AccountHeader() {
        Row({ space: Space.md }) {
            UserAvatar({
                name: this.accountDisplayName(),
                avatarUrl: this.app.avatarUrl,
                diameter: 44
            });

            Column({ space: Space.xxs }) {
                Text(this.accountDisplayName())
                    .fontSize(FontSize.bodyLarge)
                    .fontWeight(FontWeight.Bold)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });

                Text(this.app.backendUrl)
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.xl, bottom: Space.md });
    }

    // 新对话主按钮：内容自适应宽度的居中胶囊（不贴满侧栏宽度，避免视觉过大）
    @Builder
    NewChatButton() {
        Row({ space: Space.sm }) {
            Image($r('app.media.ic_plus'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.text_inverse'));

            Text(this.app.sidebarView === 'chat' ? '新对话' : '新建知识库')
                .fontSize(FontSize.body)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_inverse'));
        }
        .height(44)
        .padding({ left: Space.xxl, right: Space.xxl })
        .justifyContent(FlexAlign.Center)
        .borderRadius(Radius.full)
        .linearGradient({
            angle: 135,
            colors: [
                [$r('app.color.brand_primary'), 0],
                [$r('app.color.brand_secondary'), 1]
            ]
        })
        .margin({ bottom: Space.md })
        .shadow({
            radius: 12,
            color: '#334C6FFF',
            offsetX: 0,
            offsetY: 4
        })
        .onClick(() => {
            if (this.app.sidebarView === 'chat') {
                this.onNewChat();
            } else {
                this.onCreateKnowledge();
            }
        });
    }

    // 会话区块标题 + 刷新
    // LoadingProgress 与 IconButton 容器尺寸统一为 32x32，避免加载态切换时 Row 高度从 32 缩为 16
    // 触发 Column 重排（List layoutWeight 区域突变 → 全部 item 位置跳变）
    @Builder
    SectionHeader() {
        Row() {
            Text(this.app.sidebarView === 'chat' ? '最近对话' : '知识库')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .layoutWeight(1);

            if (this.app.sidebarView === 'chat' ? this.app.conversationsLoading : this.app.knowledgeLoading) {
                LoadingProgress()
                    .width(32)
                    .height(32)
                    .color($r('app.color.brand_primary'));
            } else {
                IconButton({
                    icon: $r('app.media.ic_refresh'),
                    iconSize: Size.iconSmall,
                    buttonSize: 32,
                    onTap: () => {
                        if (this.app.sidebarView === 'chat') {
                            this.onRequestRefresh();
                        } else {
                            this.app.refreshKnowledgeList();
                        }
                    }
                });
            }
        }
        .width('100%')
        .height(32)
        .padding({ left: Space.lg, right: Space.md, bottom: Space.xs });
    }

    // 会话行：点击切换会话；右侧 ⋯ 弹出置顶/删除菜单
    // 置顶 icon 与标题同行（icon + 标题第一行，时间第二行），行高固定 60 保证列表布局确定
    @Builder
    ConversationRow(item: ConversationItem) {
        Row({ space: Space.sm }) {
            Column({ space: Space.xxs }) {
                Row({ space: Space.xs }) {
                    if (item.pin) {
                        Image($r('app.media.ic_spark'))
                            .width(12)
                            .height(12)
                            .fillColor($r('app.color.brand_primary'))
                            .margin({ right: Space.xxs });
                    }

                    Text(item.title)
                        .fontSize(FontSize.body)
                        .fontColor(this.isActive(item.id) ? $r('app.color.text_brand') : $r('app.color.text_primary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .width('100%');

                Text(item.time)
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1);
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);

            Image($r('app.media.ic_more_horiz'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.icon_secondary'))
                .bindMenu(this.menuFor(item));
        }
        .width('100%')
        .height(50)
        .padding({ left: Space.lg, right: Space.md })
        .borderRadius(Radius.md)
        .backgroundColor(this.isActive(item.id) ? $r('app.color.brand_soft') : Color.Transparent)
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
        .onClick(() => {
            if (!this.isActive(item.id)) {
                this.onOpenConversation(item.id, item.title);
            }
        });
    }

    // 知识库行：点击打开编辑弹层；右侧 ⋯ 弹出置顶/删除菜单
    @Builder
    KnowledgeRow(item: KnowledgeItem) {
        Row({ space: Space.sm }) {
            Column({ space: Space.xxs }) {
                Row({ space: Space.xs }) {
                    if (item.pin) {
                        Image($r('app.media.ic_spark'))
                            .width(12)
                            .height(12)
                            .fillColor($r('app.color.brand_primary'))
                            .margin({ right: Space.xxs });
                    }

                    Text(item.title)
                        .fontSize(FontSize.body)
                        .fontColor($r('app.color.text_primary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis });
                }
                .width('100%');

                Text(item.time)
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1);
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);

            Image($r('app.media.ic_more_horiz'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.icon_secondary'))
                .bindMenu(this.knowledgeMenuFor(item));
        }
        .width('100%')
        .height(50)
        .padding({ left: Space.lg, right: Space.md })
        .borderRadius(Radius.md)
        .onClick(() => {
            this.onOpenKnowledge(item.title);
        });
    }

    @Builder
    EmptyHint() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_chat'))
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor($r('app.color.icon_secondary'));

            Text('还没有对话，点上方「新对话」开始')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .padding({ top: Space.xxl })
        .justifyContent(FlexAlign.Center);
    }

    @Builder
    ErrorHint() {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.text_danger'));

            Text(this.app.conversationsError)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.sm });
    }

    @Builder
    KnowledgeEmptyHint() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_book'))
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor($r('app.color.icon_secondary'));

            Text('还没有知识库，点上方「新建知识库」开始')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .padding({ top: Space.xxl })
        .justifyContent(FlexAlign.Center);
    }

    @Builder
    KnowledgeErrorHint() {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.text_danger'));

            Text(this.app.knowledgeError)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.sm });
    }

    // 底部：设置
    @Builder
    Footer() {
        Column({ space: Space.xs }) {
            Row({ space: Space.md }) {
                Image($r('app.media.ic_settings'))
                    .width(Size.icon)
                    .height(Size.icon)
                    .fillColor($r('app.color.icon_secondary'));

                Text('设置')
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_primary'))
                    .layoutWeight(1);

                Image($r('app.media.ic_chevron_right'))
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .fillColor($r('app.color.icon_secondary'));
            }
            .width('100%')
            .height(50)
            .padding({ left: Space.lg, right: Space.lg })
            .borderRadius(Radius.md)
            .onClick(() => {
                this.onOpenSettings();
            });

            Text('Nexora Harmony · v0.11.0')
                .fontSize(FontSize.caption)
                .fontColor($r('app.color.text_tertiary'))
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: Space.sm, bottom: Space.lg });
        }
        .width('100%')
        .padding({ left: Space.md, right: Space.md, top: Space.xs });
    }

    // 视图切换器：对话 / 知识库 segmented，下划线指示器随选中态滑动
    // animateTo 包裹状态翻转，驱动列表区 if 分支的 transition 进退动画同步播放
    @Builder
    ViewSwitcher() {
        Column() {
            Row() {
                Text('对话')
                    .fontSize(FontSize.body)
                    .fontWeight(this.app.sidebarView === 'chat' ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(this.app.sidebarView === 'chat' ? $r('app.color.text_primary') : $r('app.color.text_secondary'))
                    .layoutWeight(1)
                    .textAlign(TextAlign.Center)
                    .onClick(() => {
                        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                            this.app.setSidebarView('chat');
                        });
                    });

                Text('知识库')
                    .fontSize(FontSize.body)
                    .fontWeight(this.app.sidebarView === 'knowledge' ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(this.app.sidebarView === 'knowledge' ? $r('app.color.text_primary') : $r('app.color.text_secondary'))
                    .layoutWeight(1)
                    .textAlign(TextAlign.Center)
                    .onClick(() => {
                        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                            this.app.setSidebarView('knowledge');
                        });
                    });
            }
            .width('100%')
            .height(40);

            // 下划线指示器：宽度 50%，通过 translate x 滑动到选中 tab 下方
            Divider()
                .strokeWidth(2)
                .color($r('app.color.brand_primary'))
                .width('50%')
                .translate({ x: this.app.sidebarView === 'chat' ? '0%' : '100%' })
                .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.lg, top: Space.xs, bottom: Space.xs })
        .alignItems(HorizontalAlign.Start);
    }

    // ---------- 行为 ----------
    private isActive(conversationId: string): boolean {
        return this.activeConversationId === conversationId;
    }

    // 列表代次变化（宿主刷新/置顶/删除/新会话占位后都会 bump）：仅侧栏刚挂载的短暂窗口内
    // 滚动定位到当前会话（打开侧栏场景），此后代次变化不再滚动——列表数据就地更新即可，
    // 强制滚动会把用户正在浏览的位置反复拉走（旧实现每次刷新都滚，视觉上正是"列表跳变"的一部分）
    private onEpochChanged(): void {
        if (Date.now() - this.bornAt > 1500) {
            return;
        }

        setTimeout(() => {
            this.scrollToActive();
        }, 200);
    }

    private scrollToActive(): void {
        const list: ConversationItem[] = this.convList;
        let target: number = -1;

        for (let i: number = 0; i < list.length; i++) {
            if (list[i].id === this.activeConversationId) {
                target = i;
                break;
            }
        }

        if (target >= 0) {
            this.listScroller.scrollToIndex(target, true, ScrollAlign.CENTER);
        } else if (list.length > 0) {
            this.listScroller.scrollEdge(Edge.Top);
        }
    }

    // 账号展示名（含兜底）：UI 统一走普通方法而非原型 getter——
    // @ObjectLink 组件的 UI 更新路径下 getter 间接取值曾返回 undefined 触发崩溃，
    // 改为直接读取字段 + sanitize + 兜底，任何字段为空都收敛为 '未登录'
    private accountDisplayName(): string {
        const display: string = sanitizeDisplayName(this.app.displayName);

        if (display.length > 0) {
            return display;
        }

        const user: string = sanitizeDisplayName(this.app.username);
        return user.length > 0 ? user : '未登录';
    }

    // ⋯ 菜单：置顶 / 删除
    private menuFor(item: ConversationItem): MenuElement[] {
        const entries: MenuElement[] = [
            {
                value: item.pin ? '取消置顶' : '置顶',
                action: () => {
                    this.onTogglePin(item);
                }
            },
            {
                value: '删除',
                action: () => {
                    this.onDeleteRequest(item);
                }
            }
        ];
        return entries;
    }

    // 知识库 ⋯ 菜单：置顶 / 删除
    private knowledgeMenuFor(item: KnowledgeItem): MenuElement[] {
        const entries: MenuElement[] = [
            {
                value: item.pin ? '取消置顶' : '置顶',
                action: () => {
                    this.onToggleKnowledgePin(item);
                }
            },
            {
                value: '删除',
                action: () => {
                    this.onDeleteKnowledge(item);
                }
            }
        ];
        return entries;
    }
}
