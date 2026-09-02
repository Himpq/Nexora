// SidebarPanel.ets - 左侧抽屉内容（豆包式侧栏）
// 账号卡 + 新对话 + 最近对话列表（点击切换、⋯菜单置顶/删除）+ 设置 / 退出登录
// 数据直接消费 AppState 单例（@Observed），会话增删改后列表自动刷新，宿主只负责显隐与业务回调
// 注意：本组件是组件级，@ObjectLink 由宿主页面的 @State 单例注入，符合工程约定

import { ConversationItem, sanitizeDisplayName } from '../../common/AppConfig';
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

            this.SectionHeader();

            // 会话列表区：错误提示 / 空态 / 列表三态
            if (this.app.conversationsError.length > 0) {
                this.ErrorHint();
            } else if (this.convList.length === 0 && !this.app.conversationsLoading) {
                this.EmptyHint();
            } else {
                // space=2 固定行距，行高固定 60：每项布局高恒为 62，消除任何"估算高/实测高"两阶段跳变
                List({ scroller: this.listScroller, space: 2 }) {
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

            Blank();

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

            Text('新对话')
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
            this.onNewChat();
        });
    }

    // 会话区块标题 + 刷新
    @Builder
    SectionHeader() {
        Row() {
            Text('最近对话')
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_secondary'))
                .layoutWeight(1);

            if (this.app.conversationsLoading) {
                LoadingProgress()
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .color($r('app.color.brand_primary'));
            } else {
                IconButton({
                    icon: $r('app.media.ic_refresh'),
                    iconSize: Size.iconSmall,
                    buttonSize: 32,
                    onTap: () => {
                        this.onRequestRefresh();
                    }
                });
            }
        }
        .width('100%')
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
        .height(60)
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

    // 底部：设置 + 退出登录
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

            Row({ space: Space.md }) {
                Image($r('app.media.ic_logout'))
                    .width(Size.icon)
                    .height(Size.icon)
                    .fillColor($r('app.color.text_danger'));

                Text('退出登录')
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_danger'))
                    .layoutWeight(1);
            }
            .width('100%')
            .height(50)
            .padding({ left: Space.lg, right: Space.lg })
            .borderRadius(Radius.md)
            .onClick(() => {
                this.onSignOut();
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
}
