// MainChat.ets - 主对话页（豆包式单一主页）
// 登录后的唯一主页 = 对话界面本身，取代旧「HomePage 首页 + ChatPage 详情」的两页跳转：
//  - 顶栏左侧头像点击滑出侧栏抽屉（账号卡 / 新对话 / 最近对话 / 设置 / 退出）
//  - 中间列展示会话标题 + 当前模型（可点切换），右侧 + 新建对话
//  - 空态显示问候 + 快捷能力宫格，发送后原地进入消息流（不压栈）
//  - 历史会话从侧栏点选后「原地替换状态」，会话删除后若删的是当前会话则复位空态
// 键盘 RESIZE 避让与系统栏同色已在 EntryAbility 全局配置，本页不重复处理
// 页面级统一 @State 持有进程单例（见工程约定），弹层收敛到单个 bindSheet

import { hilog } from '@kit.PerformanceAnalysisKit';
import { ApiService } from '../common/ApiService';
import { AppState } from '../common/AppState';
import { ConversationItem, greetingOfHour, QuickAction, QUICK_ACTIONS, sanitizeDisplayName } from '../common/AppConfig';
import { ChatMessage } from '../common/ChatTypes';
import { chatStream, StreamListener } from '../common/ChatStreamClient';
import { FontSize, Glow, Motion, Radius, Shadow, Size, Space, StaggerDelay } from '../common/DesignToken';
import { ChatInputBar } from '../components/ChatInputBar';
import { QuickActionGrid } from '../components/QuickActionGrid';
import { MessageBubble } from '../components/chat/MessageBubble';
import { IconButton } from '../components/common/IconButton';
import { UserAvatar } from '../components/common/UserAvatar';
import { ModelPickerSheet } from '../components/sheets/ModelPickerSheet';
import { SettingsSheet } from '../components/sheets/SettingsSheet';
import { SidebarPanel } from '../components/sidebar/SidebarPanel';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMain';
const TITLE_MAX_LENGTH: number = 18;
// 侧栏抽屉宽度：固定 vp，translate 用 -100% 相对自身宽，隐藏时刚好滑出屏幕
const DRAWER_WIDTH: number = 304;

@Component
export struct MainChat {
    // 页面级统一用 @State 本地持有进程单例（@Observed 加持，字段级变化驱动本页刷新）
    @State app: AppState = AppState.shared;
    // 登出由宿主（Index）执行：清空会话并切回登录页
    onSignOut: () => void = () => {};

    // ---------- 会话状态 ----------
    // conversationId 需要驱动侧栏激活态高亮，故用 @State（history 载入由方法显式触发）
    @State private conversationId: string = '';
    @State private messages: ChatMessage[] = [];
    @State private draft: string = '';
    @State private streaming: boolean = false;
    @State private title: string = '新对话';
    @State private loadingHistory: boolean = false;
    @State private loadError: string = '';

    // ---------- 快捷能力 ----------
    @State private greeting: string = '';
    @State private activatedActionId: string = '';
    @State private greetingVisible: boolean = false;
    @State private actionsVisible: boolean = false;

    // ---------- 弹层（单 bindSheet：kind 决定内容与高度） ----------
    @State private showSheet: boolean = false;
    @State private sheetIsModel: boolean = true;

    // 顶栏模型展示名镜像：选中模型/刷新清单后由 syncModelLabel() 同步（实测正常）。
    @State private modelLabel: string = '选择模型';

    // ---------- 侧栏抽屉 ----------
    @State private sidebarOpen: boolean = false;
    @State private avatarPressed: boolean = false;
    // 会话列表代次：每次刷新/置顶/删除后 +1，随 @Prop 下发侧栏并进 ForEach key，
    // 强制列表行整体重建——规避 @ObjectLink 对数组整体替换通知不稳导致的"重开侧栏才更新"
    @State private convEpoch: number = 0;

    // 流式进度日志水位：每跨 200 字符打一条 hilog，用于真机核验 content/reasoning 是否逐帧到达
    private lastContentLog: number = -1;
    private lastReasoningLog: number = -1;

    private scroller: ListScroller = new ListScroller();

    aboutToAppear(): void {
        this.greeting = greetingOfHour(new Date().getHours());
        this.labelForModel(this.app.selectedModelId);
        this.app.refreshModels().then(() => {
            this.syncModelLabel();
        });
        this.app.refreshConversations();
        this.app.refreshUserProfile();

        // 空态区域交错入场（仅问候 / 快捷能力两个区块，输入栏常驻底部不做位移）
        setTimeout(() => { this.greetingVisible = true; }, StaggerDelay.greeting);
        setTimeout(() => { this.actionsVisible = true; }, StaggerDelay.actions);
    }

    build() {
        Stack() {
            // 主对话界面
            Column() {
                this.TopBar();

                this.ContentArea();

                if (this.loadError.length > 0) {
                    this.ErrorBar();
                }

                ChatInputBar({
                    draft: $draft,
                    streaming: this.streaming,
                    placeholder: this.inputPlaceholder(),
                    onSend: () => {
                        this.sendDraft();
                    },
                    onStop: () => {
                        chatStream.cancel();
                    },
                    onPickModel: () => {
                        this.openSheetModel();
                    }
                });
            }
            .width('100%')
            .height('100%')
            .backgroundColor($r('app.color.bg_page'));

            // 侧栏抽屉层：仅在展开时挂载，遮罩点击关闭
            if (this.sidebarOpen) {
                this.SidebarLayer();
            }
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'))
        .bindSheet(this.showSheet, this.SheetBuilder(), {
            height: this.sheetIsModel ? SheetSize.MEDIUM : SheetSize.LARGE,
            showClose: false,
            dragBar: false,
            onDisappear: () => {
                this.showSheet = false;
            }
        });
    }

    // ---------- 顶栏 ----------
    // 左：头像（点开侧栏）/ 中：会话标题 + 模型（点开模型选择）/ 右：新对话
    @Builder
    TopBar() {
        Row({ space: Space.xs }) {
            // 头像按钮：按压反馈 + 点击展开侧栏抽屉
            Column() {
                UserAvatar({
                    name: this.displayLabel(),
                    avatarUrl: this.app.avatarUrl,
                    diameter: 34
                });
            }
            .width(Size.touchTarget)
            .height(Size.touchTarget)
            .justifyContent(FlexAlign.Center)
            .borderRadius(Size.touchTarget / 2)
            .backgroundColor(this.avatarPressed ? $r('app.color.bg_sunken') : Color.Transparent)
            .scale({ x: this.avatarPressed ? 0.94 : 1, y: this.avatarPressed ? 0.94 : 1 })
            .animation({ duration: Motion.durationFast, curve: Motion.spring })
            .onTouch((event: TouchEvent) => {
                this.avatarPressed = event.type === TouchType.Down;
            })
            .onClick(() => {
                this.openSidebar();
            });

            // 标题 + 模型：整列可点，点按弹出模型选择
            Column({ space: Space.xxs }) {
                Text(this.title)
                    .fontSize(FontSize.bodyLarge)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });

                Row({ space: Space.xxs }) {
                    Text(this.modelLabel)
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1);

                    Image($r('app.media.ic_chevron_down'))
                        .width(10)
                        .height(10)
                        .fillColor($r('app.color.icon_secondary'));
                }
                .constraintSize({ maxWidth: '100%' })
                .alignItems(VerticalAlign.Center);
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            .onClick(() => {
                this.openSheetModel();
            });

            IconButton({
                icon: $r('app.media.ic_plus'),
                onTap: () => {
                    this.startNewRound();
                }
            });
        }
        .width('100%')
        .padding({ left: Space.sm, right: Space.sm, top: Space.sm, bottom: Space.sm });
    }

    // ---------- 中部内容区 ----------
    // 空态（问候 + 快捷能力，可滚）与消息流（List）互斥切换
    @Builder
    ContentArea() {
        Stack() {
            // 仅在「新对话」形态下展示问候首页；已打开某段历史会话时即使消息为空也留在会话上下文
            if (this.conversationId.length === 0 && this.messages.length === 0 && !this.loadingHistory) {
                // 空态：装饰光球垫底，内容可滚动，输入法弹出压缩高度后仍能浏览
                Stack() {
                    this.DecorBackground();

                    Scroll() {
                        Column({ space: Space.xl }) {
                            this.GreetingBlock();

                            QuickActionGrid({
                                actions: QUICK_ACTIONS,
                                activatedId: this.activatedActionId,
                                onPick: (action: QuickAction) => {
                                    this.pickQuickAction(action);
                                }
                            });
                        }
                        .width('100%')
                        .padding({ left: Space.lg, right: Space.lg, bottom: Space.xxl });
                    }
                    .width('100%')
                    .height('100%')
                    .scrollBar(BarState.Off);
                }
                .width('100%')
                .height('100%');
            } else {
                List({ scroller: this.scroller, space: 0 }) {
                    ForEach(this.messages, (message: ChatMessage, index: number) => {
                        ListItem() {
                            MessageBubble({
                                message: message,
                                onRegenerate: (target: ChatMessage) => {
                                    this.regenerate(target);
                                }
                            });
                        }
                        // 新消息入场过渡：配合 sendMessage 里的 animateTo 播放淡入上移，
                        // 让"发送/收到首段回复"不再是硬切闪烁
                        .transition(
                            TransitionEffect.OPACITY
                                .combine(TransitionEffect.translate({ y: 10 }))
                                .animation({ duration: Motion.durationBase, curve: Motion.easeOut })
                        );
                    }, (message: ChatMessage, index: number) => index + '_' + message.role);
                }
                .width('100%')
                .height('100%')
                .listDirection(Axis.Vertical)
                .edgeEffect(EdgeEffect.Spring)
                .maintainVisibleContentPosition(true)
                .padding({ top: Space.xs, bottom: Space.sm });

                // 已打开会话但无消息（如空历史 / 加载失败后）：居中轻提示
                if (this.messages.length === 0 && !this.loadingHistory) {
                    Column({ space: Space.sm }) {
                        Image($r('app.media.ic_chat'))
                            .width(Size.iconLarge)
                            .height(Size.iconLarge)
                            .fillColor($r('app.color.icon_secondary'));

                        Text(this.loadError.length > 0 ? '历史加载失败，点上方重试' : '这段对话还没有消息')
                            .fontSize(FontSize.small)
                            .fontColor($r('app.color.text_tertiary'));
                    }
                    .width('100%')
                    .height('100%')
                    .justifyContent(FlexAlign.Center);
                }
            }

            if (this.loadingHistory) {
                LoadingProgress()
                    .width(Size.iconLarge)
                    .height(Size.iconLarge)
                    .color($r('app.color.brand_primary'));
            }
        }
        .layoutWeight(1)
        .width('100%');
    }

    // 装饰背景：品牌色渐变光球，垫在问候区背后，仅空态出现
    @Builder
    DecorBackground() {
        Stack() {
            Circle()
                .width(Glow.brandRadius * 2)
                .height(Glow.brandRadius * 2)
                .fill($r('app.color.brand_primary'))
                .opacity(Glow.brandOpacity)
                .position({ x: -40, y: 40 })
                .blur(40);

            Circle()
                .width(Glow.secondaryRadius * 2)
                .height(Glow.secondaryRadius * 2)
                .fill($r('app.color.brand_secondary'))
                .opacity(Glow.secondaryOpacity)
                .position({ x: 220, y: 0 })
                .blur(30);
        }
        .width('100%')
        .height(260)
        .position({ x: 0, y: 0 });
    }

    // 问候区：大字问候 + 引导副标题，淡入上浮
    @Builder
    GreetingBlock() {
        Column({ space: Space.xs }) {
            // 展示名走普通方法并全链兜底清洗：组件 getter 在 UI 更新路径曾取到 undefined，
            // 欢迎语绝不允许再拼出 "晚上好undefined"
            Text(this.greetingText())
                .fontSize(FontSize.display)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .textAlign(TextAlign.Start);

            Text('今天想让我帮你做点什么？')
                .fontSize(FontSize.body)
                .fontColor($r('app.color.text_secondary'))
                .width('100%')
                .textAlign(TextAlign.Start);
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ top: Space.md, bottom: Space.xs })
        .opacity(this.greetingVisible ? 1 : 0)
        .translate({ y: this.greetingVisible ? 0 : 24 })
        .animation({ duration: Motion.durationSlow, curve: Motion.easeOut });
    }

    // 历史加载失败提示条：可点刷新重试
    @Builder
    ErrorBar() {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.text_danger'));

            Text(this.loadError)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .layoutWeight(1);

            IconButton({
                icon: $r('app.media.ic_refresh'),
                iconSize: Size.iconSmall,
                buttonSize: 32,
                onTap: () => {
                    this.loadHistory();
                }
            });
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.md, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.bg_sunken'));
    }

    // ---------- 侧栏抽屉 ----------
    // 遮罩 + 左侧滑出面板；根节点保留 opacity transition，配合 animateTo 触发退出动画
    //（仅靠 if 卸载子树时 SDK 不播放内层 transition 的消失动画，必须显式 animateTo + 根过渡）
    @Builder
    SidebarLayer() {
        Stack({ alignContent: Alignment.TopStart }) {
            // 半透明遮罩：点击空白关闭抽屉
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor('#59000000')
                .onClick(() => {
                    this.closeSidebar();
                })
                .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));

            // 抽屉本体：内容由 SidebarPanel 提供，右侧投影与页面分离
            Column() {
                SidebarPanel({
                    app: this.app,
                    activeConversationId: this.conversationId,
                    convList: this.app.conversations,
                    convEpoch: this.convEpoch,
                    onNewChat: () => {
                        this.startNewRound();
                    },
                    onOpenConversation: (conversationId: string, convTitle: string) => {
                        this.openConversation(conversationId, convTitle);
                    },
                    onTogglePin: (item: ConversationItem) => {
                        this.togglePin(item);
                    },
                    onDeleteRequest: (item: ConversationItem) => {
                        this.requestDelete(item);
                    },
                    onOpenSettings: () => {
                        this.closeSidebar();
                        this.openSheetSettings();
                    },
                    onSignOut: () => {
                        this.closeSidebar();
                        this.onSignOut();
                    },
                    onRequestRefresh: () => {
                        this.app.refreshConversations().then(() => {
                            this.bumpList();
                        });
                    }
                });
            }
            .width(DRAWER_WIDTH)
            .height('100%')
            .shadow(Shadow.float)
            .transition(
                TransitionEffect.translate({ x: '-100%' })
                    .combine(TransitionEffect.OPACITY)
                    .animation({ duration: Motion.durationBase, curve: Motion.easeOut })
            );
        }
        .width('100%')
        .height('100%')
        .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
    }

    // ---------- 弹层 ----------
    private openSheetModel(): void {
        this.sheetIsModel = true;
        this.showSheet = true;
    }

    private openSheetSettings(): void {
        this.sheetIsModel = false;
        this.showSheet = true;
    }

    private closeSheet(): void {
        this.showSheet = false;
    }

    @Builder
    SheetBuilder() {
        if (this.sheetIsModel) {
            ModelPickerSheet({
                app: this.app,
                onPicked: (modelId: string) => {
                    this.app.selectModel(modelId);
                    this.syncModelLabel();
                    this.closeSheet();
                }
            });
        } else {
            SettingsSheet({
                app: this.app,
                onSaved: () => {
                    this.closeSheet();
                    this.app.refreshModels().then(() => {
                        this.syncModelLabel();
                    });
                    // 设置页可能改了模型/能力等与会话展示相关的配置：刷新列表并推高代次，
                    // 保证侧栏数据（@Prop convList 由代次驱动推送）同步更新
                    this.app.refreshConversations().then(() => {
                        this.bumpList();
                    });
                },
                onOpenModelPicker: () => {
                    // 从设置直切模型选择：只换内容与高度，sheet 不关闭避免闪断
                    this.openSheetModel();
                },
                onSignOut: () => {
                    this.closeSheet();
                    this.onSignOut();
                }
            });
        }
    }

    // ---------- 侧栏开关 ----------
    // 打开/关闭都包在显式 animateTo 里：if 条件挂载/卸载的子树带 transition 时，
    // 仅当状态翻转发生在 animateTo 动画上下文中才会播放消失动画（进动画可用、退动画曾缺失）
    private openSidebar(): void {
        // 每次展开顺手刷新一次会话列表，保证最近对话不过期；完成后推高列表代次驱动重建
        this.app.refreshConversations().then(() => {
            this.bumpList();
        });
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.sidebarOpen = true;
        });
    }

    // 列表代次 +1：让侧栏 ForEach 以全新 key 重建行，置顶/标题/选中态当场可见
    private bumpList(): void {
        this.convEpoch = this.convEpoch + 1;
    }

    private closeSidebar(): void {
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.sidebarOpen = false;
        });
    }

    // ---------- 会话行为 ----------
    private loadHistory(): void {
        this.loadingHistory = true;
        this.loadError = '';

        ApiService.fetchMessages(this.conversationId).then((result) => {
            this.loadingHistory = false;

            if (!result.success) {
                this.loadError = result.message;
                return;
            }

            this.messages = result.messages;
            this.scrollToEnd();
        });
    }

    private sendDraft(): void {
        const text: string = this.draft.trim();

        if (text.length === 0) {
            return;
        }

        this.draft = '';
        this.activatedActionId = '';
        this.sendMessage(text);
    }

    // 发送消息入口：新对话（无 conversation_id）先预建会话拿 id 再发流（prepareNewRoundThenSend），
    // 追问/重答走 dispatchSend 直发。预创建让 conversation_id 在流开始前已知：
    //   ① 侧栏在回复途中即可出现新会话并可高亮（不再等 SSE 首帧——整包聚合时首帧要流末才到）；
    //   ② ChatStreamClient 轮询兜底可凭 conversation_id 解 stream 做增量渲染（整包也逐段显示）
    private sendMessage(text: string): void {
        if (this.streaming) {
            return;
        }

        if (this.conversationId.length === 0) {
            this.prepareNewRoundThenSend(text);
            return;
        }

        this.dispatchSend(text);
    }

    // 新对话首问：先 POST /api/conversations 建空会话拿 id，再发流。
    // 失败自动退回老路径（conversation_id 保持空，由 SSE 首帧 stream_session 带回并绑定，侧栏延后出现）
    private prepareNewRoundThenSend(text: string): void {
        ApiService.createConversation(text).then((created) => {
            // 预创建是异步的：期间用户若已切到别的会话（conversationId 被 openConversation 改走），
            // 放弃本次发送，避免问句落错会话
            if (this.conversationId.length > 0 && this.conversationId !== created.conversationId) {
                hilog.warn(DOMAIN, TAG, 'pre-create raced with conversation switch, send dropped');
                return;
            }

            if (created.success && created.conversationId.length > 0) {
                this.conversationId = created.conversationId;
                hilog.info(DOMAIN, TAG, 'conversation pre-created: %{public}s', created.conversationId);
            } else {
                hilog.warn(DOMAIN, TAG, 'pre-create failed (%{public}s), fallback to sse-head binding', created.message);
            }

            this.dispatchSend(text);
        });
    }

    // 实际发流：消息入列 + 侧栏即时占位（若列表还没有该会话）+ 挂流
    private dispatchSend(text: string): void {
        if (this.streaming) {
            return;
        }

        const userMessage: ChatMessage = ChatMessage.createUser(text);
        const assistantMessage: ChatMessage = ChatMessage.createAssistant();
        // 追加包在显式 animateTo 中：配合 ListItem 的 transition 播放"淡入 + 轻微上移"，
        // 消除新消息硬插入的闪烁感（空态问候页首次切入消息流时尤其明显）
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.messages = [...this.messages, userMessage, assistantMessage];
        });
        this.streaming = true;
        this.lastContentLog = -1;
        this.lastReasoningLog = -1;

        // 预创建/既有会话：消息入列后即可让侧栏出现本会话（ensureConversationVisible 内部幂等：
        // 列表或占位里已有则直接返回）。整包聚合传输下不再依赖迟到的 SSE 首帧才显示新会话
        if (this.conversationId.length > 0) {
            const alreadyVisible: boolean = this.app.conversations
                .some((item: ConversationItem): boolean => item.id === this.conversationId);

            if (!alreadyVisible) {
                this.app.ensureConversationVisible(this.conversationId, this.firstQuestionHint());
                this.app.refreshConversations().then(() => {
                    this.bumpList();
                });
            }
        }

        this.scrollToEnd(true);

        chatStream.start({
            message: text,
            conversationId: this.conversationId.length > 0 ? this.conversationId : undefined,
            modelName: this.app.selectedModelName.length > 0 ? this.app.selectedModelName : undefined,
            enableThinking: this.app.enableThinking,
            enableWebSearch: this.app.enableWebSearch,
            enableTools: true
        }, this.listenerFor(assistantMessage));
    }

    // 重新生成：截断到最后一条用户消息之后，用同一条提问再跑一次
    private regenerate(target: ChatMessage): void {
        const targetIndex: number = this.messages.indexOf(target);
        let userIndex: number = -1;

        for (let i: number = targetIndex - 1; i >= 0; i--) {
            if (this.messages[i].isUser) {
                userIndex = i;
                break;
            }
        }

        if (userIndex < 0) {
            return;
        }

        const question: string = this.messages[userIndex].content;
        this.messages = this.messages.slice(0, userIndex + 1);
        this.sendMessage(question);
    }

    // 打开历史会话：原地替换会话状态并载入历史，不做导航压栈
    private openConversation(conversationId: string, convTitle: string): void {
        if (this.streaming) {
            this.stopStreaming();
        }

        this.conversationId = conversationId;
        this.title = convTitle.length > 0 ? convTitle : '新对话';
        this.messages = [];
        this.loadError = '';
        this.activatedActionId = '';
        this.loadHistory();
        this.closeSidebar();
    }

    // 新开一轮：清空会话上下文回到空白态（顶栏 + 侧栏共用）
    private startNewRound(): void {
        if (this.streaming) {
            this.notify('正在生成中，请先停止', 1200);
            return;
        }

        this.stopStreaming();
        this.conversationId = '';
        this.title = '新对话';
        this.messages = [];
        this.loadError = '';
        this.activatedActionId = '';
        this.closeSidebar();
    }

    private stopStreaming(): void {
        if (chatStream.isStreaming) {
            chatStream.cancel();
        }
    }

    // 滚动到底：smooth=true 时用带动画的滚动（首条消息/历史载入），
    // 流式增量期间传 false 快速贴底，避免逐帧动画叠加造成卡顿/闪烁
    private scrollToEnd(smooth: boolean = false): void {
        if (this.messages.length === 0) {
            return;
        }

        this.scroller.scrollToIndex(this.messages.length - 1, smooth, ScrollAlign.END);
    }

    // 首轮生成结束后用首条提问作为会话标题
    private deriveTitle(): void {
        if (this.title !== '新对话' || this.messages.length === 0) {
            return;
        }

        const first: ChatMessage = this.messages[0];

        if (!first.isUser) {
            return;
        }

        this.title = first.content.length > TITLE_MAX_LENGTH
            ? first.content.substring(0, TITLE_MAX_LENGTH) + '…'
            : first.content;
    }

    // 回复完成 / 中止后轮询刷新会话列表：服务端对"新会话入库 / 标题落盘"存在可见延迟，
    // 单次延时刷新可能拉到的还是旧列表（表现为"重开侧栏才出现新会话"）。
    // 改为按 0.6s/2s/4.5s/9s 递增重试，直到当前会话出现在列表里为止。
    private scheduleListRefresh(): void {
        const targetId: string = this.conversationId;

        if (targetId.length === 0) {
            return;
        }

        const delays: number[] = [600, 2000, 4500, 9000];
        let attempt: number = 0;

        const pollOnce = (): void => {
            this.app.refreshConversations().then(() => {
                this.bumpList();

                // 轮询期间用户已切到别的会话：不再打扰
                if (this.conversationId !== targetId) {
                    return;
                }

                const found: boolean = this.app.conversations.some((item: ConversationItem): boolean => item.id === targetId);

                if (!found && attempt < delays.length - 1) {
                    attempt++;
                    setTimeout(pollOnce, delays[attempt]);
                }
            });
        };

        setTimeout(pollOnce, delays[0]);
    }

    // 选中快捷能力时同时开启对应生成开关，让选择直接作用于本次提问
    private pickQuickAction(action: QuickAction): void {
        if (this.activatedActionId === action.id) {
            this.activatedActionId = '';
            this.draft = '';
            return;
        }

        this.activatedActionId = action.id;
        this.draft = action.prompt;

        if (action.id === 'deep_think') {
            this.app.setThinking(true);
        }

        if (action.id === 'web_search') {
            this.app.setWebSearch(true);
        }
    }

    // 置顶 / 取消置顶：先本地应用，失败时回滚并提示
    private togglePin(item: ConversationItem): void {
        const targetPin: boolean = !item.pin;
        this.app.setConversationPin(item.id, targetPin).then((error: string) => {
            if (error.length > 0) {
                this.notify(error, 1600);
                return;
            }

            // 后端置顶会话会重排，刷新校正顺序；完成后推高列表代次，icon 当场出现/消失
            this.app.refreshConversations().then(() => {
                this.bumpList();
            });
        });
    }

    // Toast 统一出口：getPromptAction 版 showToast（非 deprecated），声明可能抛异常，在此集中 try/catch 消化
    private notify(message: string, duration?: number): void {
        try {
            this.getUIContext().getPromptAction().showToast({ message: message, duration: duration ?? 1500 });
        } catch (e) {
            hilog.warn(DOMAIN, TAG, 'toast failed: %{public}s', JSON.stringify(e));
        }
    }

    // 删除会话：危险操作先弹确认框，确认后调后端归档
    private requestDelete(item: ConversationItem): void {
        this.getUIContext().showAlertDialog({
            title: '删除会话',
            message: '「' + item.title + '」将移入回收站，删除后可在 PC 端恢复。',
            autoCancel: true,
            alignment: DialogAlignment.Center,
            primaryButton: {
                value: '取消',
                action: () => {
                }
            },
            secondaryButton: {
                value: '删除',
                fontColor: $r('app.color.danger'),
                action: () => {
                    this.performDelete(item);
                }
            }
        });
    }

    private async performDelete(item: ConversationItem): Promise<void> {
        const error: string = await this.app.deleteConversation(item.id);

        if (error.length > 0) {
            this.notify(error, 1600);
            return;
        }

        this.notify('会话已删除');
        this.bumpList();

        // 删的是当前正在看的会话：复位到新对话空态，避免停留在已删除会话的消息上
        if (item.id === this.conversationId) {
            this.startNewRound();
        }
    }

    // 流式事件到消息模型的映射：所有增量最终都落到同一条 assistant 消息上。
    // 统一经 UI 线程跳板（setTimeout 0）再改 @Observed 消息：
    // http 流回调线程不保证是 UI 线程，直接在此改 @Observed 字段可能不触发界面通知，
    // 表现为"服务端在推、界面一字不流"（曾实测复现），必须回到 UI 线程再落地。
    private listenerFor(assistant: ChatMessage): StreamListener {
        const onUi = (action: () => void): void => {
            setTimeout(() => {
                action();
            }, 0);
        };

        return {
            onConversationId: (conversationId: string) => {
                onUi(() => {
                    this.conversationId = conversationId;
                    hilog.info(DOMAIN, TAG, 'conversation bound: %{public}s', conversationId);
                    // 会话已建立：立即本地占位 + 刷新一次列表，让新会话在回复途中就出现在侧栏并可高亮
                    this.app.ensureConversationVisible(conversationId, this.firstQuestionHint());
                    this.app.refreshConversations().then(() => {
                        this.bumpList();
                    });
                });
            },
            onReasoningDelta: (delta: string) => {
                onUi(() => {
                    assistant.appendDelta('reasoning', delta);
                    this.logStreamProgress(assistant, true);
                });
            },
            onContentDelta: (delta: string) => {
                onUi(() => {
                    assistant.appendDelta('content', delta);
                    this.logStreamProgress(assistant, false);
                    this.scrollToEnd();
                });
            },
            onToolCall: (name: string, callId: string, args: string, round: number) => {
                onUi(() => {
                    assistant.beginToolCall(callId, name, args, round);
                    this.scrollToEnd();
                });
            },
            onToolResult: (name: string, callId: string, result: string, round: number) => {
                onUi(() => {
                    assistant.completeToolCall(callId, result);
                });
            },
            onError: (message: string) => {
                onUi(() => {
                    assistant.setError(message);
                    this.streaming = false;
                });
            },
            onComplete: (finalContent: string) => {
                onUi(() => {
                    // 思考型回复常见「全程 reasoning 帧、正文在结尾一次性到达」：
                    // 只要正文仍为空就必须落进 content，不能因消息已有思考内容而吞掉结尾正文
                    if (assistant.content.length === 0 && finalContent.length > 0) {
                        assistant.appendDelta('content', finalContent);
                    }

                    assistant.finish();
                    this.streaming = false;
                    this.deriveTitle();
                    this.app.updatePendingConversation(this.conversationId, this.title);
                    this.scheduleListRefresh();
                });
            },
            onAborted: () => {
                onUi(() => {
                    assistant.finish();
                    this.streaming = false;
                    this.deriveTitle();
                    this.app.updatePendingConversation(this.conversationId, this.title);
                    this.scheduleListRefresh();
                });
            }
        };
    }

    // ---------- 展示文案 ----------
    // 工程约定：UI 描述一律走普通方法而非组件 getter（getter 在 UI 更新路径曾取到 undefined 触发崩溃 / 脏值）
    private inputPlaceholder(): string {
        return this.conversationId.length > 0 ? '继续追问…' : '给 Nexora 发送消息，或试试下面的能力…';
    }

    // 当前会话的首问文本（截断），用于回复途中侧栏占位项的标题
    private firstQuestionHint(): string {
        for (let i: number = 0; i < this.messages.length; i++) {
            const message: ChatMessage = this.messages[i];

            if (message.isUser && message.content.length > 0) {
                return message.content.length > TITLE_MAX_LENGTH
                    ? message.content.substring(0, TITLE_MAX_LENGTH) + '…'
                    : message.content;
            }
        }

        return '新对话';
    }

    // 流式进度日志：每累计 200 字符打一条 hilog，真机核验 delta 是否逐帧到达
    // （若 v0.8.0 下日志显示 content 逐帧推进而 UI 不逐字，则问题收敛到 UI 刷新层，据此定位）
    private logStreamProgress(assistant: ChatMessage, reasoning: boolean): void {
        const len: number = reasoning ? assistant.reasoning.length : assistant.content.length;

        if (reasoning) {
            if (this.lastReasoningLog < 0) {
                hilog.info(DOMAIN, TAG, 'stream reasoning: first delta received');
                this.lastReasoningLog = 0;
            }

            if (len - this.lastReasoningLog >= 200) {
                hilog.info(DOMAIN, TAG, 'stream reasoning: +%{public}d chars (total=%{public}d)', len - this.lastReasoningLog, len);
                this.lastReasoningLog = len;
            }
            return;
        }

        if (this.lastContentLog < 0) {
            hilog.info(DOMAIN, TAG, 'stream content: first delta received');
            this.lastContentLog = 0;
        }

        if (len - this.lastContentLog >= 200) {
            hilog.info(DOMAIN, TAG, 'stream content: +%{public}d chars (total=%{public}d)', len - this.lastContentLog, len);
            this.lastContentLog = len;
        }
    }

    // 展示用名称：优先服务端展示名，未拉取到或为空时回退清洗后的登录用户名；任何脏值（undefined/null/字面量 "undefined"）都归空
    private displayLabel(): string {
        const display: string = sanitizeDisplayName(this.app.displayName);

        if (display.length > 0) {
            return display;
        }

        return sanitizeDisplayName(this.app.username);
    }

    // 欢迎语整句：问候语 + 可选昵称后缀，昵称脏值/缺省时绝不拼出 "晚上好undefined"
    private greetingText(): string {
        const name: string = this.displayLabel();
        const suffix: string = name.length > 0 ? '，' + name : '';
        return this.greeting + suffix;
    }

    // 顶栏模型展示名同步：直接从模型清单按 id 查 label（不经 @Observed getter 链，
    // 排除"getter 依赖收集读不到变更"的边界），查不到时回退原始 id / 引导文案。
    // 输入栏 chip 已直接绑定 app.selectedModelLabel，无需信号驱动
    private syncModelLabel(): void {
        this.modelLabel = this.labelForModel(this.app.selectedModelId);
        AppStorage.SetOrCreate('inputModelLabel', this.modelLabel);
        hilog.info(DOMAIN, TAG, '[modelLabel] synced id=%{public}s label=%{public}s models=%{public}d',
            this.app.selectedModelId, this.modelLabel, this.app.models.length);
    }

    private labelForModel(modelId: string): string {
        if (modelId.length === 0) {
            this.modelLabel = '选择模型';
            return '选择模型';
        }

        for (let i: number = 0; i < this.app.models.length; i++) {
            const model = this.app.models[i];

            if (model.id === modelId) {
                const label: string = model.provider.length > 0 ? model.provider + ' · ' + model.name : model.name;
                this.modelLabel = label;
                return label;
            }
        }

        hilog.warn(DOMAIN, TAG, '[modelLabel] id not found in models, fallback to raw id=%{public}s', modelId);
        this.modelLabel = modelId;
        return modelId;
    }
}
