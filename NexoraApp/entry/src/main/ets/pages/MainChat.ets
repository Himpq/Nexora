// MainChat.ets - 主对话页（豆包式单一主页）
// 登录后的唯一主页 = 对话界面本身，取代旧「HomePage 首页 + ChatPage 详情」的两页跳转：
//  - 顶栏左侧头像点击滑出侧栏抽屉（功能入口：新对话/邮件/随笔 / 最近对话 / 视图切换 / 账户行）
//  - 中间列展示会话标题 + 当前模型（可点切换），右侧 + 新建对话
//  - 空态显示问候 + 快捷能力宫格，发送后原地进入消息流（不压栈）
//  - 历史会话从侧栏点选后「原地替换状态」，会话删除后若删的是当前会话则复位空态
//  - 邮件为独立界面：侧栏入口触发，本页全屏覆盖层挂载，返回键先退详情再退页面
// 键盘 RESIZE 避让与系统栏同色已在 EntryAbility 全局配置，本页不重复处理
// 页面级统一 @State 持有进程单例（见工程约定），弹层收敛到单个 bindSheet

import { hilog } from '@kit.PerformanceAnalysisKit';
import { promptAction } from '@kit.ArkUI';
import { ApiService } from '../common/ApiService';
import { AppState } from '../common/AppState';
import { ConversationItem, greetingOfHour, KnowledgeItem, QuickAction, QUICK_ACTIONS, sanitizeDisplayName } from '../common/AppConfig';
import { ChatMessage, TokenUsage, ToolResultPayload } from '../common/ChatTypes';
import { chatStream, ConversationModePayload, StreamListener, StreamOptions } from '../common/ChatStreamClient';
import { ChatItemBuilder } from '../common/ChatItemBuilder';
import { ChatItemDataSource } from '../common/ChatItemDataSource';
import { ChatRenderItem } from '../common/ChatRenderItem';
import { ConversationBuffer } from '../common/ConversationBuffer';
import { LiveViewController } from '../common/LiveViewController';
import { MapRendererConfig } from '../common/MapRendererConfig';
import { NextFrameCallback } from '../common/NextFrame';
import { QuestionItem, readQuestionLock, writeQuestionLock } from '../common/QuestionLocks';
import { FontSize, Glow, Motion, PressScale, Radius, Shadow, Size, Space, StaggerDelay } from '../common/DesignToken';
import { ChatInputBar } from '../components/ChatInputBar';
import { QuickActionGrid } from '../components/QuickActionGrid';
import { ImageViewer } from '../components/chat/ImageViewer';
import { ChatItemRow } from '../components/chat/ChatItemRow';
import { TurnIndicatorPanel } from '../components/chat/TurnIndicatorPanel';
import { IconButton } from '../components/common/IconButton';
import { UserAvatar } from '../components/common/UserAvatar';
import { ModelPickerSheet } from '../components/sheets/ModelPickerSheet';
import { SettingsSheet } from '../components/sheets/SettingsSheet';
import { KnowledgeEditorSheet } from '../components/sheets/KnowledgeEditorSheet';
import { SidebarPanel } from '../components/sidebar/SidebarPanel';
import { MailPage } from '../components/mail/MailPage';
import { NotesEntryCard } from '../components/notes/NotesEntryCard';
import { NotesPage } from '../components/notes/NotesPage';
import { LearningPage } from '../components/learning/LearningPage';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMain';
const TITLE_MAX_LENGTH: number = 18;
// 侧栏抽屉宽度：固定 vp，translate 用 -100% 相对自身宽，隐藏时刚好滑出屏幕
const DRAWER_WIDTH: number = 304;
// 新会话预创建失败时，承载该流的本地临时键前缀（SSE 首帧绑定真实会话 ID 后迁移）
const PENDING_STREAM_PREFIX: string = 'pending:';
// 单步落地后的校验延时：等待该步布局完成与滚动索引上报（约 4 帧）；索引上报本身也会提前收尾
const JUMP_SETTLE_DELAY: number = 56;
// 定位期间屏蔽触顶分页的时长：定位过程经过索引 0 时不能启动历史分页
const JUMP_PAGINATION_HOLD: number = 240;
// 最大推进步数：仍无法命中说明行高估计被严重带偏，停止推进并保持当前位置
const JUMP_MAX_STEPS: number = 10;
// 等待动画推进的最大次数：动画卡死时不能无限等，超限即改发无动画步兜住结果
const JUMP_MAX_REARMS: number = 6;
// 触底校验延时（ms）：等该次 scrollEdge 的布局与索引上报完成
const BOTTOM_SETTLE_DELAY: number = 56;
// 触底最大重试次数：引擎对内容边界的认知来自未测量行的行高估算，需逐次逼近
const BOTTOM_MAX_ATTEMPTS: number = 12;
// 上滑历史的分页条数：前插补偿的误差与插入行数成正比，页越小跳变越小（见 loadMoreMessages）
const HISTORY_PAGE_SIZE: number = 6;
// 轮次跳转高亮的保持时长
const HIGHLIGHT_DURATION: number = 3000;
// 跳转末段滑入的行数：远距离先无动画落到目标前方这么多行，最后一段平滑滑入
// （对齐「跳转要有动画」的手感；长距离平滑会被框架丢弃，所以只让末段动）
const JUMP_GLIDE_ROWS: number = 14;
// 动画步的落地校验延时：等平滑滚动播完再校验（无动画步只需等布局完成）
const JUMP_ANIMATE_SETTLE_DELAY: number = 360;
// 帧间隔告警阈值（ms）：60fps 一帧 16.7ms，超过即掉帧；原来取 32ms 只能看到 30fps 以下的卡顿
const SCROLL_GAP_WARN_MS: number = 17;
// 帧间隔告警的最小间隔（ms）：限流，避免日志本身成为滚动开销
const SCROLL_GAP_LOG_INTERVAL: number = 120;

// 单条流的绑定上下文：本地临时键的流在服务端返回会话 ID 后迁移，
// context.key 始终指向当前缓冲/传输锁键，回调据此路由事件与视图更新
interface StreamContext {
    key: string;
    conversationId: string;
}

// 单次发送要带上的会话模式：learning 会话由后端挂载 NexoraLearning 运行时，
// payload 决定运行时内的子场景（如 interview=true 走六维画像快速评估链路）
interface SendMode {
    conversationMode: string;
    payload: ConversationModePayload;
}

// 学习会话固定标识：后端 conversation_mode 字段值
const LEARNING_MODE: string = 'learning';
// 画像快速评估会话标题
const PROFILE_INTERVIEW_TITLE: string = '学习画像评估';
// 画像评估开场消息：真正的评估指令由后端画像访谈链路注入系统提示，客户端只负责发起这一轮
const PROFILE_INTERVIEW_KICKOFF: string = '开始我的六维学习画像快速评估';

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

    // ---------- 多会话并行缓冲 ----------
    // 会话键 → 本地消息缓冲：切走的流持续写入自己的缓冲，切回时原样接上
    private buffers: Map<string, ConversationBuffer> = new Map<string, ConversationBuffer>();
    // 进行中流的键集合（会话 ID 或本地临时键）：判定会话级生成状态与侧栏指示
    private streamingKeys: Set<string> = new Set<string>();
    // 侧栏流式指示镜像：普通 Set 变更不驱动 UI，重算为新数组交给 @Prop 刷新
    @State private streamingConvIds: string[] = [];
    // 空白新会话在预创建失败时承载本次流的本地临时键（绑定真实 ID 后清空）
    private pendingSendKey: string = '';
    private pendingKeySeq: number = 0;

    // 消息分页：初始只取最近一页，滚到顶部再加载更早的一页，避免长对话一次性渲染卡死主线程
    @State private hasMoreMessages: boolean = false;
    @State private oldestLoadedIndex: number = 0;
    @State private loadingMoreMessages: boolean = false;
    // 加载更多前的视口中心索引，前插消息后用于保持同一条消息仍处于视口中心
    private scrollCenterBeforeLoad: number = -1;

    // ---------- 快捷能力 ----------
    @State private greeting: string = '';
    @State private activatedActionId: string = '';
    @State private greetingVisible: boolean = false;
    @State private actionsVisible: boolean = false;

    // ---------- 弹层（单 bindSheet：kind 决定内容与高度） ----------
    @State private showSheet: boolean = false;
    @State private sheetKind: string = 'model';
    // 知识库编辑目标标题：打开编辑弹层时设定
    @State private knowledgeEditTarget: string = '';

    // 顶栏模型展示名镜像：选中模型/刷新清单后由 syncModelLabel() 同步（实测正常）。
    @State private modelLabel: string = '选择模型';
    // ---------- 侧栏抽屉 ----------
    // 始终挂载，用 translate+opacity 控制显隐：避免 if 卸载时退场动画失效（关闭动画直接偏移）
    @State private sidebarOpen: boolean = false;
    @State private sidebarTranslate: number = -DRAWER_WIDTH;
    @State private sidebarOverlayOpacity: number = 0;
    @State private avatarPressed: boolean = false;
    @State private modelTitlePressed: boolean = false;
    // 拖拽起始时的 translate 值（跟手拖动用，非响应式）
    private dragStartTranslate: number = 0;

    // ---------- 邮件页（全屏覆盖层） ----------
    // 条件挂载 + 右滑转场；mailDetailOpen 以 @Link 下发 MailPage，返回键先退详情再退页面
    @State private mailOpen: boolean = false;
    @State private mailDetailOpen: boolean = false;

    // 随笔页（全屏覆盖层）：编辑态由宿主持有，系统返回键可先退出编辑再退出页面
    @State private notesOpen: boolean = false;
    @State private noteEditorOpen: boolean = false;
    @State private noteLaunchEditor: boolean = false;

    // Learning 工作区（全屏覆盖层）：原生 ArkUI 学习页；内层导航深度由子组件经 @Link 回报，
    // 系统返回键逐级回退（阅读器 → 课程目录 → 课程列表 → 退出学习）
    @State private learningOpen: boolean = false;
    @State private learningNavDepth: number = 0;

    // 回到底部按钮：滚动离开底部时显示，点击平滑回到底部
    @State private showScrollBottom: boolean = false;
    @State private scrollBottomPressed: boolean = false;

    // 全屏图片查看器当前图片地址（空串表示关闭）
    @State private viewerUrl: string = '';

    // 轮次指示器：当前激活的用户轮次索引（-1 表示无）
    @State private activeTurnIndex: number = -1;

    // 轮次跳转后临时高亮的消息索引（-1 表示无高亮）
    private highlightToken: number = 0;
    // 会话列表代次：每次刷新/置顶/删除后 +1，随 @Prop 下发侧栏并进 ForEach key，
    // 强制列表行整体重建——规避 @ObjectLink 对数组整体替换通知不稳导致的"重开侧栏才更新"
    @State private convEpoch: number = 0;
    // 会话列表快照：bumpList 时从 app.conversations 拷贝，作为 @Prop 下发侧栏。
    // 直接传 app.conversations 时，@Observed 属性无 @Trace 不会使 @State app 变 dirty，
    // convEpoch 变化不会触发 convList 参数重新求值，侧栏拿不到新数组
    @State private convListSnapshot: ConversationItem[] = [];

    // 流式进度日志水位：每跨 200 字符打一条 hilog，用于真机核验 content/reasoning 是否逐帧到达
    private lastContentLog: number = -1;
    private lastReasoningLog: number = -1;

    private scroller: ListScroller = new ListScroller();
    // 流式贴底只允许由当前帧合并执行；用户开始滚动后不再抢占手势
    private streamFollowPending: boolean = false;
    private streamUserScrolled: boolean = false;
    // 滚动索引回调可能在同一帧触发多次，只保留最后一次结果，避免反复驱动指示器重排。
    private scrollIndexFramePending: boolean = false;
    private pendingScrollStart: number = -1;
    private pendingScrollEnd: number = -1;
    private pendingScrollCenter: number = -1;
    // 帧间隔探针：记录超过一帧预算的间隔（60fps = 16.7ms），限流后打日志
    private lastScrollFrameAt: number = 0;
    private lastScrollGapLogAt: number = 0;
    // 定位状态：目标索引（-1 表示无在途定位）/ 对齐方式 / 已推进步数 / 落地回调
    private jumpTargetIndex: number = -1;
    private jumpAlign: ScrollAlign = ScrollAlign.CENTER;
    private jumpSteps: number = 0;
    private jumpSettled: () => void = () => {};
    private jumpLabel: string = '';
    // 定位代次：连续点击轮次时，旧定位链路的落地回调据此失效
    private jumpToken: number = 0;
    // 本次定位是否已用过动画步：动画步被框架丢弃时不重复尝试，避免来回摆动
    private jumpAnimated: boolean = false;
    // 上一次校验时的可视区间：区间还在变说明动画正在推进，应继续等而不是再发一步定位
    private jumpLastStart: number = -1;
    private jumpLastEnd: number = -1;
    // 动画推进的额外等待次数：限流，避免动画卡死时无限等待
    private jumpRearms: number = 0;
    // 滚动索引处理（JS 侧）单帧最大耗时：用于区分掉帧来自 JS 还是渲染引擎
    private maxScrollIndexCost: number = 0;
    // 触底收敛状态：在途标记 + 已尝试次数
    private bottomLoopActive: boolean = false;
    private bottomAttempts: number = 0;
    // 定位后的分页屏蔽截止时间戳：布尔开关在异常路径漏复位会永久锁死分页，时间戳可自愈
    private paginationBlockedUntil: number = 0;
    // 最近一次 List 上报的可视区间：定位落地后据此校验目标是否真的进入视口
    private visibleStartIndex: number = 0;
    private visibleEndIndex: number = 0;
    // 列表数据源装的是「块级渲染单元」：一条助手消息按 Markdown AST 拆成多行，
    // 行高跨度从 67~3394vp 压到几十~两三百 vp，列表对未测量行的估算误差随之塌下来
    private itemSource: ChatItemDataSource = new ChatItemDataSource();
    // 单元索引在单元集合变化时一次性建立，滚动回调只读 O(1) 结果，避免每帧扫描整段历史。
    @State private userTurnCount: number = 0;
    private turnIndexByItem: number[] = [];
    // 每条消息的首个单元下标：轮次跳转与重答定位都以「该消息的第一行」为目标
    private messageStartByMessage: number[] = [];

    aboutToAppear(): void {
        this.greeting = greetingOfHour(new Date().getHours());
        this.labelForModel(this.app.selectedModelId);
        this.app.refreshModels().then(() => {
            this.syncModelLabel();
        });
        this.app.refreshConversations().then(() => {
            this.bumpList();
        });
        this.app.refreshNotes();
        this.app.refreshUserProfile();
        // Learning 运行时配置轻量预取：侧栏入口生效前拿到开关与工作区地址
        void this.app.refreshLearningRuntime();

        // 地图渲染配置轻量预取：登录后只拉一次，地图结果到达时无需等待
        MapRendererConfig.ensure();

        // 空态区域交错入场（仅问候 / 快捷能力两个区块，输入栏常驻底部不做位移）
        setTimeout(() => { this.greetingVisible = true; }, StaggerDelay.greeting);
        setTimeout(() => { this.actionsVisible = true; }, StaggerDelay.actions);

        // 注入返回键处理：侧边栏展开→收起，弹层→关闭，有对话→新对话
        this.app.backHandler = (): boolean => {
            return this.handleBackPress();
        };
    }

    // 系统返回键处理：图片查看器 > 邮件/随笔页(详情→页面) > 侧边栏 > 弹层 > 对话→新对话
    private handleBackPress(): boolean {
        if (this.viewerUrl.length > 0) {
            this.viewerUrl = '';
            return true;
        }

        if (this.mailOpen) {
            if (this.mailDetailOpen) {
                this.mailDetailOpen = false;
                return true;
            }

            this.closeMail();
            return true;
        }

        if (this.notesOpen) {
            if (this.noteEditorOpen) {
                this.noteEditorOpen = false;
                return true;
            }

            this.closeNotes();
            return true;
        }

        if (this.learningOpen) {
            if (this.learningNavDepth > 0) {
                this.learningNavDepth = this.learningNavDepth - 1;
                return true;
            }

            this.learningOpen = false;
            return true;
        }

        if (this.sidebarOpen) {
            this.closeSidebar();
            return true;
        }

        if (this.showSheet) {
            this.showSheet = false;
            return true;
        }

        if (this.conversationId.length > 0) {
            this.startNewRound();
            return true;
        }

        return false;
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
                        this.stopStreaming();
                    },
                    onPickModel: () => {
                        this.openSheetModel();
                    }
                });
            }
            .width('100%')
            .height('100%')
            .backgroundColor($r('app.color.bg_page'));

            // 侧栏抽屉层：始终挂载，用 translate/opacity 控制显隐（避免 if 卸载退场动画失效）
            this.SidebarLayer();

            // 邮件页层：条件挂载，整页右滑进出（进入即拉取当前箱列表）
            if (this.mailOpen) {
                MailPage({
                    app: this.app,
                    mailDetailOpen: $mailDetailOpen,
                    onBack: () => {
                        this.closeMail();
                    }
                })
                    .width('100%')
                    .height('100%')
                    .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                        .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
            }

            // 随笔页层：与邮件同级的轻量全屏容器，避免把编辑态塞进知识库弹层
            if (this.notesOpen) {
                NotesPage({
                    app: this.app,
                    noteEditorOpen: $noteEditorOpen,
                    launchEditor: this.noteLaunchEditor,
                    onBack: () => {
                        this.closeNotes();
                    }
                })
                    .width('100%')
                    .height('100%')
                    .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                        .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
            }

            // Learning 工作区层：与邮件/随笔同级的全屏覆盖层（原生 ArkUI 学习页）
            if (this.learningOpen) {
                LearningPage({
                    app: this.app,
                    navDepth: $learningNavDepth,
                    onBack: () => {
                        this.learningOpen = false;
                    },
                    onOpenImage: (url: string) => {
                        this.viewerUrl = url;
                    },
                    onStartProfileInterview: () => {
                        this.startProfileInterview();
                    }
                })
                    .width('100%')
                    .height('100%')
                    .transition(TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY)
                        .animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
            }

            // 全屏图片查看器：最顶层，点击任意区域或系统返回键关闭
            if (this.viewerUrl.length > 0) {
                ImageViewer({
                    url: this.viewerUrl,
                    onClose: () => {
                        this.viewerUrl = '';
                    }
                })
                    .width('100%')
                    .height('100%');
            }
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'))
        .bindSheet(this.showSheet, this.SheetBuilder(), {
            height: this.sheetKind === 'model' ? SheetSize.MEDIUM : SheetSize.LARGE,
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
            .backgroundColor(this.avatarPressed ? $r('app.color.bg_pressed') : Color.Transparent)
            .scale({
                x: this.avatarPressed ? PressScale.pressed : PressScale.normal,
                y: this.avatarPressed ? PressScale.pressed : PressScale.normal
            })
            .animation({ duration: Motion.durationPress, curve: Motion.press })
            .onTouch((event: TouchEvent) => {
                if (event.type === TouchType.Down) {
                    this.avatarPressed = true;
                }

                if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                    this.avatarPressed = false;
                }
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
            .borderRadius(Radius.md)
            .backgroundColor(this.modelTitlePressed ? $r('app.color.bg_pressed') : Color.Transparent)
            .animation({ duration: Motion.durationPress, curve: Motion.press })
            .onTouch((event: TouchEvent) => {
                if (event.type === TouchType.Down) {
                    this.modelTitlePressed = true;
                }

                if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                    this.modelTitlePressed = false;
                }
            })
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

                            NotesEntryCard({
                                onTap: () => {
                                    this.openNotes(true);
                                }
                            });

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
                // space 为 0：行间间距全部由行自身 margin 给出。
                // 被切开过的块（表格 / 列表）需要精确控制接缝间距，
                // List 的统一间距会在接缝处叠出额外空隙，把整块切成几截
                List({ scroller: this.scroller, space: 0 }) {
                    LazyForEach(this.itemSource, (item: ChatRenderItem) => {
                        ListItem() {
                            ChatItemRow({
                                item: item,
                                conversationId: this.conversationId,
                                onRegenerate: (message: ChatMessage) => {
                                    this.regenerate(message);
                                },
                                onOpenImage: (url: string) => {
                                    this.viewerUrl = url;
                                },
                                onQuestionAnswer: (target: QuestionItem, answer: string) => {
                                    this.answerQuestion(target, answer);
                                }
                            });
                        }
                     // 键值取「消息身份 + 单元序号」：单元序号在消息内稳定，同一条消息的
                     // 第 N 个块流式期间始终复用同一个节点；不能用数组下标——前插历史会让
                     // 所有下标位移，列表会把单元错配到别的行上
                    }, (item: ChatRenderItem) => item.key());
                }
                .width('100%')
                .height('100%')
                .listDirection(Axis.Vertical)
                .edgeEffect(EdgeEffect.Spring)
                // 视口外各预加载 2 行：新行提前完成创建与测量，减少滚动时的反复销毁重建
                .cachedCount(2)
                // 关闭「同步加载全部子组件」：默认 true 时，无动画跳转/首屏会把沿途尚未布局的行
                // 在同一帧里全部布局完（实测一次跨 19 行的跳转 → 主线程卡死 68 帧 ≈ 1.1s）。
                // 置 false 后单帧布局超时会把这部分工作顺延到后续帧，视口不再整帧卡死
                .syncLoad(false)
                // 历史消息只在列表头部前插，交给 List 保持当前可见内容，避免重排后再次 scrollToIndex。
                .maintainVisibleContentPosition(true)
                // 纵向留白走 contentStart/EndOffset：写在 padding 上会变成裁切死带，
                // 表现为「最后一条消息与输入栏之间永远空一条」（底部空线）
                .contentStartOffset(Space.xs)
                .contentEndOffset(Space.sm)
                .onScrollIndex((start: number, end: number, center: number) => {
                    this.scheduleScrollIndexUpdate(start, end, center);
                })
                // 该回调只在用户/惯性滚动的每帧开始前触发，scrollToIndex 不会触发它。
                // 一旦用户开始阅读历史内容，流式更新不得再把手势拉回末条。
                .onScrollFrameBegin((offset: number, state: ScrollState): OnScrollFrameBeginHandlerResult => {
                    const now: number = Date.now();
                    const gap: number = this.lastScrollFrameAt > 0 ? now - this.lastScrollFrameAt : 0;

                    if (gap >= SCROLL_GAP_WARN_MS && now - this.lastScrollGapLogAt >= SCROLL_GAP_LOG_INTERVAL) {
                        const jsCost: number = this.maxScrollIndexCost;
                        const chars: number = this.visibleContentChars();
                        this.maxScrollIndexCost = 0;
                        this.lastScrollGapLogAt = now;
                        hilog.warn(DOMAIN, TAG,
                            '[scroll] frame gap=%{public}dms offset=%{public}d visible=%{public}d-%{public}d js=%{public}dms chars=%{public}d',
                            gap, offset, this.visibleStartIndex, this.visibleEndIndex, jsCost, chars);
                    }

                    this.lastScrollFrameAt = now;

                    if (!this.streamUserScrolled) {
                        this.streamUserScrolled = true;
                    }

                    return { offsetRemain: offset };
                })
                .onScrollStop(() => {
                    this.lastScrollFrameAt = 0;
                });

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

            // 回到底部按钮：滚动离开底部时浮现，定位在内容区右下角（输入框正上方）
            if (this.showScrollBottom && this.messages.length > 0) {
                Stack() {
                    this.ScrollBottomButton();
                }
                .alignContent(Alignment.BottomEnd)
                .width('100%')
                .height('100%')
                .padding({ right: Space.lg, bottom: Space.lg })
                .hitTestBehavior(HitTestMode.Transparent);
            }

            // 轮次指示器：右侧垂直居中，仅在有多轮对话时显示
            if (this.userTurnCount >= 2) {
                Stack() {
                    TurnIndicatorPanel({
                        turnCount: this.userTurnCount,
                        activeIndex: this.activeTurnIndex,
                        onJump: (turnIndex: number) => {
                            this.jumpToTurn(turnIndex);
                        },
                        onRequirePreviews: (): string[] => {
                            return this.buildTurnPreviews();
                        }
                    });
                }
                .alignContent(Alignment.End)
                .width('100%')
                .height('100%')
                .padding({ right: Space.sm })
                .hitTestBehavior(HitTestMode.Transparent);
            }
        }
        .layoutWeight(1)
        .width('100%');
    }

    // 回到底部浮动按钮：分阶段定位到末条，避免从远端平滑加载全部中间消息。
    @Builder
    ScrollBottomButton() {
        Column() {
            Image($r('app.media.ic_chevron_down'))
                .width(Size.icon)
                .height(Size.icon)
                .fillColor($r('app.color.icon_secondary'));
        }
        .width(Size.touchTarget)
        .height(Size.touchTarget)
        .justifyContent(FlexAlign.Center)
        .borderRadius(Size.touchTarget / 2)
        .backgroundColor(this.scrollBottomPressed ? $r('app.color.bg_pressed') : $r('app.color.bg_card'))
        .shadow(Shadow.raised)
        .scale({
            x: this.scrollBottomPressed ? PressScale.pressed : PressScale.normal,
            y: this.scrollBottomPressed ? PressScale.pressed : PressScale.normal
        })
        .animation({ duration: Motion.durationPress, curve: Motion.press })
        .onTouch((event: TouchEvent) => {
            if (event.type === TouchType.Down) {
                this.scrollBottomPressed = true;
            }

            if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
                this.scrollBottomPressed = false;
            }
        })
        .onClick(() => {
            this.scrollToEnd('button', true);
        });
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
        .translate({ y: this.greetingVisible ? 0 : 8 })
        .animation({ duration: Motion.durationBase, curve: Motion.easeOut });
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
                    this.loadHistory(this.conversationId);
                }
            });
        }
        .width('100%')
        .padding({ left: Space.lg, right: Space.md, top: Space.xs, bottom: Space.xs })
        .borderRadius(Radius.md)
        .backgroundColor($r('app.color.bg_sunken'));
    }

    // ---------- 侧栏抽屉 ----------
    // 始终挂载，用 translate+opacity 控制显隐：避免 if 卸载时退场动画失效（关闭动画直接偏移）
    @Builder
    SidebarLayer() {
        Stack({ alignContent: Alignment.TopStart }) {
            // 半透明遮罩：点击空白或向左滑动关闭抽屉
            Column()
                .width('100%')
                .height('100%')
                .backgroundColor('#59000000')
                .opacity(this.sidebarOverlayOpacity)
                .hitTestBehavior(this.sidebarOpen ? HitTestMode.Default : HitTestMode.None)
                .onClick(() => {
                    this.closeSidebar();
                })
                .gesture(
                    PanGesture({ direction: PanDirection.Horizontal, distance: 5 })
                        .onActionStart(() => {
                            this.dragStartTranslate = this.sidebarTranslate;
                        })
                        .onActionUpdate((event: GestureEvent) => {
                            this.updateDragTranslate(event.offsetX);
                        })
                        .onActionEnd((event: GestureEvent) => {
                            this.finishDrag();
                        })
                );

            // 抽屉本体：内容由 SidebarPanel 提供，右侧投影与页面分离
            Column() {
                SidebarPanel({
                    app: this.app,
                    activeConversationId: this.conversationId,
                    convList: this.convListSnapshot,
                    convEpoch: this.convEpoch,
                    streamingIds: this.streamingConvIds,
                    onNewChat: () => {
                        this.startNewRound();
                    },
                    onOpenMail: () => {
                        this.closeSidebar();
                        this.openMail();
                    },
                    onOpenNotes: () => {
                        this.closeSidebar();
                        this.openNotes(false);
                    },
                    onOpenLearning: () => {
                        void this.openLearning();
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
                    },
                    onOpenKnowledge: (title: string) => {
                        this.closeSidebar();
                        this.openSheetKnowledge(title);
                    },
                    onToggleKnowledgePin: (item: KnowledgeItem) => {
                        this.toggleKnowledgePin(item);
                    },
                    onDeleteKnowledge: (item: KnowledgeItem) => {
                        this.requestDeleteKnowledge(item);
                    },
                    onCreateKnowledge: () => {
                        this.createKnowledge();
                    }
                });
            }
            .width(DRAWER_WIDTH)
            .height('100%')
            .shadow(Shadow.float)
            .translate({ x: this.sidebarTranslate })
            .hitTestBehavior(this.sidebarOpen ? HitTestMode.Default : HitTestMode.None)
            // 使用独占手势：抽屉内横向拖动一旦识别为关闭手势，就取消子项的点击，
            // 避免拖动结束时把手指落点误判成某个会话的点击。
            .gesture(
                PanGesture({ direction: PanDirection.Horizontal, distance: 5 })
                    .onActionStart(() => {
                        this.dragStartTranslate = this.sidebarTranslate;
                    })
                    .onActionUpdate((event: GestureEvent) => {
                        this.updateDragTranslate(event.offsetX);
                    })
                    .onActionEnd((event: GestureEvent) => {
                        this.finishDrag();
                    })
            );
        }
        .width('100%')
        .height('100%')
        .hitTestBehavior(this.sidebarOpen ? HitTestMode.Default : HitTestMode.None);
    }

    // ---------- 弹层 ----------
    private openSheetModel(): void {
        this.sheetKind = 'model';
        this.showSheet = true;
    }

    private openSheetSettings(): void {
        this.sheetKind = 'settings';
        this.showSheet = true;
    }

    private openSheetKnowledge(title: string): void {
        this.knowledgeEditTarget = title;
        this.sheetKind = 'knowledge';
        this.showSheet = true;
    }

    private closeSheet(): void {
        this.showSheet = false;
    }

    @Builder
    SheetBuilder() {
        if (this.sheetKind === 'model') {
            ModelPickerSheet({
                app: this.app,
                onPicked: (modelId: string) => {
                    hilog.info(DOMAIN, TAG, '[onPicked] modelId=%{public}s', modelId);
                    this.app.selectModel(modelId);
                    hilog.info(DOMAIN, TAG, '[onPicked] after selectModel, app.selectedModelId=%{public}s app.selectedModelLabel=%{public}s',
                        this.app.selectedModelId, this.app.selectedModelLabel);
                    this.syncModelLabel();
                    hilog.info(DOMAIN, TAG, '[onPicked] after syncModelLabel, AppStorage inputModelLabel=%{public}s',
                        AppStorage.get<string>('inputModelLabel'));
                    this.closeSheet();
                }
            });
        } else if (this.sheetKind === 'settings') {
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
        } else {
            KnowledgeEditorSheet({
                app: this.app,
                targetTitle: this.knowledgeEditTarget,
                onSaved: () => {
                    this.closeSheet();
                    this.app.refreshKnowledgeList();
                },
                onDeleted: () => {
                    this.closeSheet();
                    this.app.refreshKnowledgeList();
                },
                onClose: () => {
                    this.closeSheet();
                }
            });
        }
    }

    // ---------- 邮件页 ----------
    // 打开邮件页：进入即拉取当前箱列表（与打开侧栏即刷新会话同一策略）
    private openMail(): void {
        this.app.refreshMailList();
        this.mailOpen = true;
    }

    private closeMail(): void {
        this.mailOpen = false;
    }

    // ---------- 随笔页 ----------
    // 首页入口直接进入编辑态，侧栏入口进入按日期分组的列表态
    private openNotes(launchEditor: boolean): void {
        this.noteLaunchEditor = launchEditor;
        this.noteEditorOpen = launchEditor;
        this.notesOpen = true;
    }

    private closeNotes(): void {
        this.noteEditorOpen = false;
        this.noteLaunchEditor = false;
        this.notesOpen = false;
    }

    // ---------- Learning 工作区 ----------
    // 打开 Learning：先刷新运行时配置（管理端开关/地址可能刚变更），校验后进入全屏工作区
    private async openLearning(): Promise<void> {
        await this.app.refreshLearningRuntime();

        if (!this.app.learningEnabled) {
            this.notify('Learning 未启用', 1600);
            return;
        }

        if (this.app.learningFrontendUrl.trim().length === 0) {
            this.notify('Learning 未配置前端地址', 1600);
            return;
        }

        this.closeSidebar();
        this.learningNavDepth = 0;
        this.learningOpen = true;
    }

    // 学习侧发起一轮学习会话（当前用于六维画像快速评估）：
    // 评估必须跑在 NexoraLearning 的画像链路上——只有 conversation_mode='learning' 的会话，
    // 后端才会挂载学习运行时（question 工具逐维出选择题、submit_profile_score 写回评分），
    // 并由 payload.interview=true 把画像访谈指令注入系统提示。
    // 因此这里新建一个学习会话并切过去，客户端只发一条开场消息，不搬运评估指令原文。
    private startProfileInterview(): void {
        this.learningOpen = false;
        this.learningNavDepth = 0;

        // 当前会话正在生成时不抢占：新会话照常预建，等这一轮结束再发
        if (this.isCurrentStreaming()) {
            this.notify('当前回复生成中，请稍后再开始评估', 2000);
            return;
        }

        ApiService.createConversation(PROFILE_INTERVIEW_TITLE, LEARNING_MODE).then((created) => {
            if (!created.success || created.conversationId.length === 0) {
                this.notify('评估会话创建失败：' + created.message, 2400);
                return;
            }

            this.openConversation(created.conversationId, PROFILE_INTERVIEW_TITLE);
            this.app.refreshConversations().then(() => {
                this.bumpList();
            });

            const payload: ConversationModePayload = { learning: true, interview: true };
            const mode: SendMode = { conversationMode: LEARNING_MODE, payload: payload };
            this.dispatchSend(PROFILE_INTERVIEW_KICKOFF, created.conversationId, true, mode);
        });
    }

    // ---------- 侧栏开关 ----------
    // 打开/关闭用 animateTo 驱动 translate+opacity 属性动画（始终挂载，无 if 卸载退场动画问题）
    private openSidebar(): void {
        // 每次展开顺手刷新一次会话列表，保证最近对话不过期；完成后推高列表代次驱动重建
        this.app.refreshConversations().then(() => {
            this.bumpList();
        });
        this.sidebarOpen = true;
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.sidebarTranslate = 0;
            this.sidebarOverlayOpacity = 1;
        });
    }

    // 列表代次 +1 并同步快照：让侧栏 ForEach 以全新 key 重建行，置顶/标题/选中态当场可见
    private bumpList(): void {
        this.convListSnapshot = [...this.app.conversations];
        this.convEpoch = this.convEpoch + 1;
    }

    private closeSidebar(): void {
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            this.sidebarTranslate = -DRAWER_WIDTH;
            this.sidebarOverlayOpacity = 0;
        });
        this.sidebarOpen = false;
    }

    // 跟手拖动：实时更新 translate 和遮罩透明度，抽屉跟随手指移动
    private updateDragTranslate(offsetX: number): void {
        let translate: number = this.dragStartTranslate + offsetX;

        // 限制范围：[-DRAWER_WIDTH, 0]，不允许向右拖出或向左拖穿
        if (translate > 0) {
            translate = 0;
        }

        if (translate < -DRAWER_WIDTH) {
            translate = -DRAWER_WIDTH;
        }

        this.sidebarTranslate = translate;
        // 遮罩透明度随抽屉位置线性变化：完全展开=1，完全关闭=0
        this.sidebarOverlayOpacity = 1 - Math.abs(translate) / DRAWER_WIDTH;
    }

    // 松手后判定：拖过半屏关闭，否则弹回展开
    private finishDrag(): void {
        if (this.sidebarTranslate < -DRAWER_WIDTH / 2) {
            this.closeSidebar();
        } else {
            animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                this.sidebarTranslate = 0;
                this.sidebarOverlayOpacity = 1;
            });
        }
    }

    // ---------- 知识库行为 ----------
    private toggleKnowledgePin(item: KnowledgeItem): void {
        this.app.setKnowledgePin(item.title, !item.pin).then((message: string) => {
            if (message.length > 0) {
                promptAction.showToast({ message: message, duration: 2000 });
            }
        });
    }

    private requestDeleteKnowledge(item: KnowledgeItem): void {
        promptAction.showDialog({
            title: '删除知识库',
            message: '确定删除「' + item.title + '」？此操作不可撤销。',
            buttons: [
                { text: '取消', color: $r('app.color.text_secondary') },
                { text: '删除', color: $r('app.color.text_danger') }
            ]
        }).then((dialogResult) => {
            if (dialogResult.index === 1) {
                this.app.deleteKnowledge(item.title).then((message: string) => {
                    if (message.length > 0) {
                        promptAction.showToast({ message: message, duration: 2000 });
                    }
                });
            }
        });
    }

    private createKnowledge(): void {
        ApiService.createBlankKnowledge('未命名知识库').then((result) => {
            if (!result.success) {
                promptAction.showToast({ message: result.message, duration: 2000 });
                return;
            }

            this.app.refreshKnowledgeList();
            this.closeSidebar();
            this.openSheetKnowledge(result.title);
        });
    }

    // ---------- 会话行为 ----------
    // 加载指定会话的最近一页历史：写入该会话缓冲；仅在仍查看该会话时镜像到视图。
    // 缓冲里比服务端本页更新的消息（未落库的提问 / 刚生成完的回复）一并保留，
    // 合并规则见 mergeHistoryWithLive
    private loadHistory(conversationId: string): void {
        this.loadingHistory = true;
        this.loadError = '';
        this.hasMoreMessages = false;
        this.oldestLoadedIndex = 0;

        ApiService.fetchMessages(conversationId, 20, 0).then((result) => {
            const isViewing: boolean = this.currentBufferKey() === conversationId;

            if (isViewing) {
                this.loadingHistory = false;
            }

            if (!result.success) {
                if (isViewing) {
                    this.loadError = result.message;
                }

                return;
            }

            const buffer: ConversationBuffer = this.bufferFor(conversationId);
            // 服务端本页窗口之后的本地消息（尚未落库的提问 / 刚生成完但落库有延迟的回复）
            // 由缓冲保留，窗口内以服务端为准：否则切走期间生成结束时切回，回复会凭空消失
            const windowEnd: number = result.startIndex + result.messages.length;
            const history: ChatMessage[] = this.mergeHistoryWithLive(result.messages, buffer.messages, windowEnd);

            buffer.messages = history;
            buffer.hasMore = result.hasMoreBefore;
            buffer.oldestIndex = result.startIndex;

            if (isViewing) {
                this.replaceMessages(history);
                this.hasMoreMessages = result.hasMoreBefore;
                this.oldestLoadedIndex = result.startIndex;
                this.applyQuestionLocks(conversationId, history);
                this.scrollToEnd('load-history');
                // scrollToEnd 的 scrollToIndex 不一定触发 onScrollIndex，这里主动以末条为基准算出当前轮次
                this.activeTurnIndex = this.computeActiveTurnOfLastMessage();
                hilog.info(DOMAIN, TAG, '[loadHistory] msgCount=%{public}d activeTurn=%{public}d', this.messages.length, this.activeTurnIndex);
            }
        });
    }

    // 加载更早的一页消息：只作用于当前查看会话的缓冲，插入列表头部。
    // List 的 maintainVisibleContentPosition 负责保持当前可见内容，不再手动二次定位。
    private loadMoreMessages(): void {
        const key: string = this.currentBufferKey();
        const buffer: ConversationBuffer | undefined = this.buffers.get(key);

        if (buffer === undefined || !buffer.hasMore || this.loadingMoreMessages || buffer.oldestIndex <= 0) {
            return;
        }

        this.loadingMoreMessages = true;
        const centerBeforeLoad: number = this.scrollCenterBeforeLoad;

        // 历史页大小刻意取小：前插的这些行都还没被测量过，列表只能用「已测行的平均高度」
        // 估算它们的总高并据此补偿滚动位置。估算是系统性的（实测偏低约 6.6%），
        // 误差与插入行数成正比 —— 20 条消息约 220 行时累积到 14 行（约 2 个屏幕）的可见跳变，
        // 6 条消息约 66 行时降到 4 行左右（约半屏）。再多翻几页只是多几次请求，代价远小于跳变。
        ApiService.fetchMessages(key, HISTORY_PAGE_SIZE, buffer.oldestIndex).then((result) => {
            // 期间切走：结果作废，缓冲一致性由该会话下次打开时的初始页加载保证。
            // 必须释放加载锁：该锁是视图级单例，漏释放会让切过去的会话再也拉不动历史
            if (this.currentBufferKey() !== key) {
                this.loadingMoreMessages = false;
                return;
            }

            if (!result.success) {
                this.loadingMoreMessages = false;
                return;
            }

            // 去重：跳过新加载消息中与已有消息 index 重叠的部分
            const existingMinIndex: number = buffer.messages.length > 0 ? buffer.messages[0].index : -1;
            const dedupedMessages: ChatMessage[] = [];

            for (let i: number = 0; i < result.messages.length; i++) {
                if (result.messages[i].index < existingMinIndex) {
                    dedupedMessages.push(result.messages[i]);
                }
            }

            if (dedupedMessages.length === 0) {
                buffer.hasMore = false;
                this.hasMoreMessages = false;
                this.loadingMoreMessages = false;
                return;
            }

            const insertedCount: number = dedupedMessages.length;
            buffer.messages = [...dedupedMessages, ...buffer.messages];
            buffer.hasMore = result.hasMoreBefore;
            buffer.oldestIndex = result.startIndex;

            const insertedItems: ChatRenderItem[] = this.buildItems(dedupedMessages);
            this.itemSource.prependItems(insertedItems);
            this.messages = buffer.messages;
            this.rebuildItemIndex();

            hilog.info(DOMAIN, TAG, '[history] source=prepend add=%{public}d size=%{public}d',
                insertedCount, this.messages.length);

            // 消息前插会改变所有旧消息的数组索引；先同步修正活动轮次，
            // 再恢复滚动位置，避免指示器在旧轮次与新轮次之间出现双高亮。
            const preservedCenter: number = centerBeforeLoad + insertedItems.length;

            if (centerBeforeLoad >= 0 && preservedCenter < this.turnIndexByItem.length) {
                const preservedActiveTurn: number = this.computeActiveTurn(preservedCenter);
                this.activeTurnIndex = preservedActiveTurn;
                hilog.info(DOMAIN, TAG,
                    '[history] prepend=%{public}d center=%{public}d->%{public}d active=%{public}d',
                    insertedCount, centerBeforeLoad, preservedCenter, preservedActiveTurn);
            }

            this.hasMoreMessages = buffer.hasMore;
            this.oldestLoadedIndex = buffer.oldestIndex;
            this.applyQuestionLocks(key, dedupedMessages);

            // 等待数据源刷新完成后释放加载锁；可见位置由 List 属性保持。
            setTimeout(() => {
                this.loadingMoreMessages = false;
            }, 0);
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

    // 发送消息入口：当前查看会话正在生成时拒绝；空白新会话先预建会话拿 id 再发流。
    // 预创建让 conversation_id 在流开始前已知：
    //   ① 侧栏在回复途中即可出现新会话并可高亮（不再等 SSE 首帧——整包聚合时首帧要流末才到）；
    //   ② ChatStreamClient 轮询兜底可凭 conversation_id 解 stream 做增量渲染（整包也逐段显示）。
    // 预创建是异步的：期间用户切走也照常发送到目标会话（后台生成），不丢弃本次提问。
    private sendMessage(text: string): void {
        if (this.isCurrentStreaming()) {
            return;
        }

        if (this.conversationId.length > 0) {
            this.dispatchSend(text, this.conversationId, false);
            return;
        }

        ApiService.createConversation(text).then((created) => {
            const stillOnBlank: boolean = this.conversationId.length === 0;

            if (created.success && created.conversationId.length > 0) {
                hilog.info(DOMAIN, TAG, 'conversation pre-created: %{public}s', created.conversationId);
                this.dispatchSend(text, created.conversationId, stillOnBlank);
                return;
            }

            // 预创建失败：用本地临时键承载本次流，SSE 首帧带回真实 ID 后迁移（会话列表延后出现）
            hilog.warn(DOMAIN, TAG, 'pre-create failed (%{public}s), fallback to sse-head binding', created.message);
            this.dispatchSend(text, this.nextPendingKey(), stillOnBlank);
        });
    }

    // 实际发流：消息写入目标会话缓冲 + 侧栏即时占位（若列表还没有该会话）+ 挂流。
    // targetKey 为该流在本地缓冲/传输锁中的键（真实会话 ID；预创建失败时为本地临时键）；
    // adoptView 表示用户仍停留在发起发送的空白视图上，发送后直接换绑到该流（后台流不劫持当前视图）
    private dispatchSend(text: string, targetKey: string, adoptView: boolean, mode?: SendMode): void {
        if (this.streamingKeys.has(targetKey) || chatStream.isStreamingFor(targetKey)) {
            this.notify('该对话已有回复生成中，请稍候', 1200);
            return;
        }

        const buffer: ConversationBuffer = this.bufferFor(targetKey);
        // 本地消息必须分配连续且唯一的 index：列表 ForEach key 由 message.index 派生，
        // 新建消息若恒为 0 会与首条消息 key 冲突，ArkUI 按 key 复用组件导致列表错位/末条重复
        // （表现：发送瞬间最后一条消息被重复渲染、工具调用段位置错乱；重进会话后索引来自服务端才正常）。
        // 取末条 index + 1 同时与后端持久化索引对齐
        const baseIndex: number = buffer.messages.length > 0 ? buffer.messages[buffer.messages.length - 1].index + 1 : 0;
        const userMessage: ChatMessage = ChatMessage.createUser(text);
        userMessage.index = baseIndex;
        const assistantMessage: ChatMessage = ChatMessage.createAssistant();
        assistantMessage.index = baseIndex + 1;

        // 追加包在显式 animateTo 中：新行插入引起的高度与偏移变化参与同一段动画，避免硬插入突跳。
        // 不用 ListItem 的 .transition() —— LazyForEach 滚动创建行时它同样会播放，
        // 表现为滚动中某行「一帧错位 + 半透明」（用户报的「看不清是什么文本」正是它）
        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
            if (adoptView) {
                if (targetKey.startsWith(PENDING_STREAM_PREFIX)) {
                    this.pendingSendKey = targetKey;
                } else {
                    this.conversationId = targetKey;
                }
            }

            this.appendMessages(targetKey, [userMessage, assistantMessage]);
        });

        this.streamingKeys.add(targetKey);
        this.syncStreamingState();
        this.lastContentLog = -1;
        this.lastReasoningLog = -1;

        // 预创建/既有会话：消息入列后即可让侧栏出现本会话（ensureConversationVisible 内部幂等：
        // 列表或占位里已有则直接返回）。整包聚合传输下不再依赖迟到的 SSE 首帧才显示新会话
        if (!targetKey.startsWith(PENDING_STREAM_PREFIX)) {
            const alreadyVisible: boolean = this.app.conversations
                .some((item: ConversationItem): boolean => item.id === targetKey);

            if (!alreadyVisible) {
                this.app.ensureConversationVisible(targetKey, this.firstQuestionHint(targetKey));
                this.app.refreshConversations().then(() => {
                    this.bumpList();
                });
            }
        }

        if (this.currentBufferKey() === targetKey) {
            this.scrollToEnd('send', true);
        }

        const streamOptions: StreamOptions = {
            message: text,
            conversationId: targetKey.startsWith(PENDING_STREAM_PREFIX) ? undefined : targetKey,
            modelName: this.app.selectedModelName.length > 0 ? this.app.selectedModelName : undefined,
            enableThinking: this.app.enableThinking,
            enableWebSearch: this.app.enableWebSearch,
            enableTools: true,
            toolMode: this.app.forceTools ? 'force' : 'auto_off'
        };

        // 学习会话首问要显式带上模式与运行时载荷：后端据此挂载 NexoraLearning 工具集与画像访谈指令
        if (mode !== undefined) {
            streamOptions.conversationMode = mode.conversationMode;
            streamOptions.conversationModePayload = mode.payload;
        }

        chatStream.start(targetKey, streamOptions, this.listenerFor(assistantMessage, targetKey));
    }

    // 重新生成：通过后端 is_regenerate 机制覆盖目标回答（自动保存旧版本）。
    // 不截断消息列表、不新增用户消息，直接清空目标 assistant 消息并锁定流式更新该消息。
    // 直接接收 ForEach 的数组索引，不依赖 indexOf（@ObjectLink 代理与原数组引用不等）
    private regenerate(targetMessage: ChatMessage): void {
        let targetIndex: number = -1;

        for (let i: number = 0; i < this.messages.length; i++) {
            if (this.messages[i].uid === targetMessage.uid) {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex < 0) {
            hilog.warn(DOMAIN, TAG, '[regenerate] skipped: message not in view');
            return;
        }

        if (this.isCurrentStreaming()) {
            hilog.warn(DOMAIN, TAG, '[regenerate] skipped: current conversation streaming');
            return;
        }

        const key: string = this.currentBufferKey();

        if (key.length === 0) {
            hilog.warn(DOMAIN, TAG, '[regenerate] skipped: no conversation key');
            return;
        }

        if (targetIndex < 0 || targetIndex >= this.messages.length) {
            hilog.warn(DOMAIN, TAG, '[regenerate] skipped: targetIndex out of range=%{public}d', targetIndex);
            return;
        }

        const target: ChatMessage = this.messages[targetIndex];

        let userIndex: number = -1;

        for (let i: number = targetIndex - 1; i >= 0; i--) {
            if (this.messages[i].isUser) {
                userIndex = i;
                break;
            }
        }

        if (userIndex < 0) {
            hilog.warn(DOMAIN, TAG, '[regenerate] skipped: no user message before target targetIndex=%{public}d', targetIndex);
            return;
        }

        const question: string = this.messages[userIndex].content;
        hilog.info(DOMAIN, TAG, '[regenerate] targetIndex=%{public}d target.index=%{public}d userIndex=%{public}d conv=%{public}s',
            targetIndex, target.index, userIndex, this.conversationId);

        // 清空目标 assistant 消息，锁定流式更新该消息（后端按 regenerate_index 截断上下文并覆盖）
        target.content = '';
        target.reasoning = '';
        target.segments = [];
        target.toolCalls = [];
        target.questions = [];
        target.usage = null;
        target.errorMessage = '';
        target.streaming = true;
        target.thinkingExpanded = true;
        this.replaceMessages([...this.messages]);
        // 重答目标就在当前会话缓冲中：视图重建的数组同步回缓冲，保持单一数据源
        this.bufferFor(key).messages = this.messages;

        this.streamingKeys.add(key);
        this.syncStreamingState();
        this.lastContentLog = -1;
        this.lastReasoningLog = -1;

        // 定位到目标消息位置，让用户看到正在重答的消息（以该消息的第一行为目标）
        this.startJumpToMessage(this.firstItemOfMessage(targetIndex), ScrollAlign.CENTER, 'regenerate', () => {});

        chatStream.start(key, {
            message: question,
            conversationId: this.conversationId,
            modelName: this.app.selectedModelName.length > 0 ? this.app.selectedModelName : undefined,
            enableThinking: this.app.enableThinking,
            enableWebSearch: this.app.enableWebSearch,
            enableTools: true,
            toolMode: this.app.forceTools ? 'force' : 'auto_off',
            isRegenerate: true,
            regenerateIndex: target.index
        }, this.listenerFor(target, key));
    }

    // question 作答：写本地回答锁并作为普通用户消息发送
    // （与 Web handleQuestionAnswer 一致：上一条助手消息以 await 收尾，模型把该消息当回答继续）
    private answerQuestion(item: QuestionItem, answer: string): void {
        const text: string = answer.trim();

        if (text.length === 0 || item.answered || item.submitting) {
            return;
        }

        if (this.isCurrentStreaming() || chatStream.isStreamingFor(this.currentBufferKey())) {
            this.notify('当前对话已有回复生成中,请稍候', 1200);
            return;
        }

        item.submitting = true;

        this.app.loadQuestionLocks().then((store: string) => {
            const updated: string = writeQuestionLock(store, this.conversationId, item.cardId, text);
            this.app.saveQuestionLocks(updated);
            item.markAnswered(text);
            this.dispatchSend(text, this.currentBufferKey(), false);
        });
    }

    // 本地回答锁恢复：历史加载 / 分页 / question 帧到达时把已答卡片置为锁定态
    private applyQuestionLocks(conversationId: string, messages: ChatMessage[]): void {
        if (conversationId.length === 0 || messages.length === 0) {
            return;
        }

        this.app.loadQuestionLocks().then((store: string) => {
            for (let m: number = 0; m < messages.length; m++) {
                const message: ChatMessage = messages[m];

                for (let q: number = 0; q < message.questions.length; q++) {
                    const item: QuestionItem = message.questions[q];

                    if (item.answered) {
                        continue;
                    }

                    const locked: string = readQuestionLock(store, conversationId, item.cardId);

                    if (locked.length > 0) {
                        message.markQuestionAnswered(item.callId, locked);
                    }
                }
            }
        });
    }

    // 打开历史会话：切到目标会话并恢复现场，不中断任何进行中的流。
    // 目标会话正在生成时以本地缓冲为准（服务端尚未落盘），其余情况重新拉取权威历史
    private openConversation(conversationId: string, convTitle: string): void {
        this.conversationId = conversationId;
        this.streamUserScrolled = false;
        this.streamFollowPending = false;
        this.pendingSendKey = '';
        this.title = convTitle.length > 0 ? convTitle : '新对话';
        this.activatedActionId = '';
        this.loadError = '';
        this.loadingMoreMessages = false;
        this.cancelJump();
        this.stopBottomLoop();
        this.closeSidebar();

        const buffer: ConversationBuffer | undefined = this.buffers.get(conversationId);

        if (this.streamingKeys.has(conversationId) && buffer !== undefined) {
            this.replaceMessages(buffer.messages);
            this.hasMoreMessages = buffer.hasMore;
            this.oldestLoadedIndex = buffer.oldestIndex;
            this.loadingHistory = false;
            this.syncStreamingState();
            this.scrollToEnd('open-conversation');
            this.activeTurnIndex = this.computeActiveTurnOfLastMessage();
            return;
        }

        this.replaceMessages([]);
        this.hasMoreMessages = false;
        this.oldestLoadedIndex = 0;
        this.syncStreamingState();
        this.loadHistory(conversationId);
    }

    // 新开一轮：切到空白视图回到空白态（顶栏 + 侧栏共用），不中断后台流
    private startNewRound(): void {
        this.conversationId = '';
        this.streamUserScrolled = false;
        this.streamFollowPending = false;
        this.pendingSendKey = '';
        this.title = '新对话';
        this.replaceMessages([]);
        this.cancelJump();
        this.stopBottomLoop();
        this.loadError = '';
        this.loadingHistory = false;
        this.hasMoreMessages = false;
        this.oldestLoadedIndex = 0;
        this.activatedActionId = '';
        this.syncStreamingState();
        this.closeSidebar();
    }

    // 停止当前查看会话的流：后台其他会话的流不受影响
    private stopStreaming(): void {
        const key: string = this.currentBufferKey();

        if (key.length > 0) {
            chatStream.cancel(key);
        }
    }

    // 滚动到底：smooth=true 时用带动画的滚动（首条消息/历史载入），
    // 流式增量期间传 false 快速贴底，避免逐帧动画叠加造成卡顿/闪烁
    private scrollToEnd(reason: string, resumeStreamFollow: boolean = false): void {
        if (this.messages.length === 0) {
            return;
        }

        // 记录调用来源：视口被强行拉回底部时，必须能立刻指认是哪条链路发的请求
        hilog.info(DOMAIN, TAG, '[bottom] request reason=%{public}s total=%{public}d visible=%{public}d-%{public}d',
            reason, this.messages.length, this.visibleStartIndex, this.visibleEndIndex);

        if (resumeStreamFollow) {
            this.streamUserScrolled = false;
            this.streamFollowPending = false;
        }

        if (this.bottomLoopActive) {
            return;
        }

        this.bottomLoopActive = true;
        this.bottomAttempts = 0;
        this.runBottomStep();
    }

    // 触底一步：滚到内容边界后校验末条是否可见。
    // scrollEdge 的「边界」同样来自引擎对内容总高的认知（未测量行按估算计入），
    // 行高还没测全时一次调用会停在内容中部（进入会话停在非底部的直接原因）；
    // 每次调用都会让引擎补测沿途行高，因此逐次校验重试即可逼近真实底部。
    private runBottomStep(): void {
        if (this.messages.length === 0) {
            this.stopBottomLoop();
            return;
        }

        this.bottomAttempts++;
        this.paginationBlockedUntil = Date.now() + JUMP_PAGINATION_HOLD;
        this.scroller.scrollEdge(Edge.Bottom);
        const attempt: number = this.bottomAttempts;

        setTimeout(() => {
            if (this.messages.length === 0 || !this.bottomLoopActive || attempt !== this.bottomAttempts) {
                return;
            }

            const lastIndex: number = this.itemSource.totalCount() - 1;

            if (this.visibleEndIndex >= lastIndex) {
                hilog.info(DOMAIN, TAG, '[bottom] settled attempts=%{public}d visible=%{public}d-%{public}d',
                    this.bottomAttempts, this.visibleStartIndex, this.visibleEndIndex);
                this.stopBottomLoop();
                return;
            }

            if (this.bottomAttempts >= BOTTOM_MAX_ATTEMPTS) {
                hilog.warn(DOMAIN, TAG, '[bottom] give up attempts=%{public}d visible=%{public}d-%{public}d last=%{public}d',
                    this.bottomAttempts, this.visibleStartIndex, this.visibleEndIndex, lastIndex);
                this.stopBottomLoop();
                return;
            }

            this.runBottomStep();
        }, BOTTOM_SETTLE_DELAY);
    }

    private stopBottomLoop(): void {
        this.bottomLoopActive = false;
        this.bottomAttempts = 0;
    }

    // 把同一帧内到达的多个正文增量合并为一次贴底，避免滚动控制 API 与手势连续竞争。
    private scheduleStreamFollowToBottom(): void {
        if (this.streamUserScrolled || this.showScrollBottom || this.streamFollowPending) {
            return;
        }

        this.streamFollowPending = true;
        this.getUIContext().postFrameCallback(new NextFrameCallback(() => {
            this.streamFollowPending = false;

            if (!this.streamUserScrolled && !this.showScrollBottom && this.messages.length > 0) {
                this.scrollToEnd('stream-follow');
            }
        }));
    }

    // 独立区块（工具结果卡 / 选择题卡 / 图片画廊）贴底：这些块是本轮最后的输出时才挂载，
    // 挂载当帧 List 还没为它排版，同步 scrollToIndex 会停在旧底部。
    // 推迟一帧，等区块的真实高度参与排版后再滚动，视口才真正贴住消息末尾。
    private scrollToEndAfterLayout(): void {
        if (this.streamUserScrolled || this.showScrollBottom) {
            return;
        }

        this.getUIContext().postFrameCallback(new NextFrameCallback(() => {
            if (!this.streamUserScrolled && !this.showScrollBottom) {
                this.scrollToEnd('after-layout');
            }
        }));
    }

    // 替换消息数组的唯一入口：同步响应式页面状态与 LazyForEach 数据源，避免两套数据不同步。
    private replaceMessages(messages: ChatMessage[]): void {
        this.messages = messages;
        this.itemSource.replaceAll(this.buildItems(messages));
        this.rebuildItemIndex();
    }

    // 把消息数组整体展开成渲染单元（顺序即渲染顺序）
    private buildItems(messages: ChatMessage[]): ChatRenderItem[] {
        const items: ChatRenderItem[] = [];

        for (let i: number = 0; i < messages.length; i++) {
            const built: ChatRenderItem[] = ChatItemBuilder.build(messages[i]);

            for (let j: number = 0; j < built.length; j++) {
                items.push(built[j]);
            }
        }

        return items;
    }

    // 将滚动索引更新合并到下一帧：活动轮次按视口中心计算，避免底部刚露出的用户消息提前抢占指示器。
    private scheduleScrollIndexUpdate(start: number, end: number, center: number): void {
        this.pendingScrollStart = start;
        this.pendingScrollEnd = end;
        this.pendingScrollCenter = center;

        if (this.scrollIndexFramePending) {
            return;
        }

        this.scrollIndexFramePending = true;
        this.getUIContext().postFrameCallback(new NextFrameCallback(() => {
            this.scrollIndexFramePending = false;

            const nextStart: number = this.pendingScrollStart;
            const nextEnd: number = this.pendingScrollEnd;
            const nextCenter: number = this.pendingScrollCenter;
            this.applyScrollIndex(nextStart, nextEnd, nextCenter);
        }));
    }

    // 应用一帧内最后一次滚动索引：底部按钮仍看 end，轮次指示器只看 center。
    private applyScrollIndex(start: number, end: number, center: number): void {
        const startedAt: number = Date.now();
        this.visibleStartIndex = start;
        this.visibleEndIndex = end;

        const nextShowScrollBottom: boolean = end < this.itemSource.totalCount() - 1;

        if (this.showScrollBottom !== nextShowScrollBottom) {
            this.showScrollBottom = nextShowScrollBottom;
        }

        // 定位在途时不跟随中间落点，等定位落地后一次性带动画设置激活轮次：
        // 否则高亮会随远跳的每一步中间落点闪动
        if (this.jumpTargetIndex < 0 && center >= 0 && center < this.turnIndexByItem.length) {
            const nextActiveTurn: number = this.turnIndexByItem[center];

            if (this.activeTurnIndex !== nextActiveTurn) {
                this.activeTurnIndex = nextActiveTurn;
                hilog.info(DOMAIN, TAG,
                    '[scroll] active turn=%{public}d center=%{public}d start=%{public}d end=%{public}d',
                    nextActiveTurn, center, start, end);
            }
        }

        if (center >= 0) {
            this.scrollCenterBeforeLoad = center;
        }

        // 定位目标已被 List 上报为可见：立即收尾，不必再等单步校验定时器
        if (this.jumpTargetIndex >= start && this.jumpTargetIndex <= end) {
            this.completeJump('visible');
        }

        // 只有用户真正触顶时才加载历史；程序定位经过索引 0 时不能启动分页。
        if (start <= 0 && !this.isPaginationBlocked()) {
            this.loadMoreMessages();
        }

        const cost: number = Date.now() - startedAt;

        if (cost > this.maxScrollIndexCost) {
            this.maxScrollIndexCost = cost;
        }
    }

    // 单元集合变化时重建索引：每个单元继承所属消息的轮次，
    // 滚动回调只读 O(1) 结果，不重复扫描历史
    private rebuildItemIndex(): void {
        const items: ChatRenderItem[] = this.itemSource.snapshot();
        const indexes: number[] = [];
        const starts: number[] = [];
        let turn: number = -1;
        let lastUid: string = '';

        for (let i: number = 0; i < items.length; i++) {
            const item: ChatRenderItem = items[i];

            if (item.message.uid !== lastUid) {
                lastUid = item.message.uid;

                if (item.message.isUser) {
                    turn++;
                }

                starts.push(i);
            }

            indexes.push(turn);
        }

        this.turnIndexByItem = indexes;
        this.messageStartByMessage = starts;

        const nextCount: number = turn + 1;

        if (this.userTurnCount !== nextCount) {
            this.userTurnCount = nextCount;
        }
    }

    // 某条消息的首个单元下标：轮次跳转与重答定位都以「该消息的第一行」为目标
    private firstItemOfMessage(messageIndex: number): number {
        if (messageIndex < 0 || messageIndex >= this.messageStartByMessage.length) {
            return -1;
        }

        return this.messageStartByMessage[messageIndex];
    }

    // 以可见区域索引为基准，读取最后一个位置 ≤ center 的用户轮次索引
    private computeActiveTurn(center: number): number {
        if (center < 0 || center >= this.turnIndexByItem.length) {
            return -1;
        }

        return this.turnIndexByItem[center];
    }

    // 末条消息所在轮次：载入 / 打开会话后直接把指示器定到最后一轮
    private computeActiveTurnOfLastMessage(): number {
        return this.computeActiveTurn(this.itemSource.totalCount() - 1);
    }

    // 生成各轮次用户消息预览文本
    private buildTurnPreviews(): string[] {
        const previews: string[] = [];

        for (let i: number = 0; i < this.messages.length; i++) {
            if (this.messages[i].isUser) {
                const content: string = this.messages[i].content;
                previews.push(content.length > 50 ? content.substring(0, 50) + '…' : content);
            }
        }

        return previews;
    }

    // 跳转到指定轮次：命中目标用户消息后交给分步定位
    private jumpToTurn(turnIndex: number): void {
        let userCount: number = 0;

        for (let i: number = 0; i < this.messages.length; i++) {
            if (this.messages[i].isUser) {
                if (userCount === turnIndex) {
                    const itemIndex: number = this.firstItemOfMessage(i);
                    this.startJumpToMessage(itemIndex, ScrollAlign.CENTER, 'turn=' + turnIndex, () => {
                        this.highlightMessage(i);
                    });
                    return;
                }

                userCount++;
            }
        }
    }

    // 分步定位：List 只能按已测平均行高估算未测量行的偏移，一次远跳会落到估算位置
    // （新建列表连平均行高都没建立时会停在原位）；平滑动画又会与 LazyForEach 的布局更新冲突被丢弃。
    // 因此改为无动画硬定位 + 落地校验：目标进入可视区即完成，否则按二分逼近继续推进。
    private startJumpToMessage(targetIndex: number, align: ScrollAlign, label: string,
        onSettled: () => void): void {
        this.jumpToken = this.jumpToken + 1;
        this.jumpTargetIndex = targetIndex;
        this.jumpAlign = align;
        this.jumpSteps = 0;
        this.jumpSettled = onSettled;
        this.jumpLabel = label;
        this.jumpAnimated = false;
        this.jumpLastStart = -1;
        this.jumpLastEnd = -1;
        this.jumpRearms = 0;

        hilog.info(DOMAIN, TAG, '[jump] start label=%{public}s target=%{public}d total=%{public}d',
            label, targetIndex, this.messages.length);

        this.runJumpStep(label, this.jumpToken);
    }

    // 推进一步：首步直取目标（行高已测准时一步到位），之后剩余距离较大时只推进一半，
    // 让 List 在推进过程中逐段建立真实行高，逐步收敛到目标
    private runJumpStep(label: string, token: number): void {
        if (token !== this.jumpToken || this.jumpTargetIndex < 0) {
            return;
        }

        this.jumpSteps++;
        this.paginationBlockedUntil = Date.now() + JUMP_PAGINATION_HOLD;

        const target: number = this.jumpTargetIndex;
        const from: number = this.visibleCenterIndex();
        const gap: number = target - from;
        let nextIndex: number = target;
        let animated: boolean = true;

        // 远距离先无动画落到「目标前方 JUMP_GLIDE_ROWS 行」：长距离平滑滚动会被框架丢弃
        // （见 ArkUI 论坛结论），也会拖慢跳转；末段那一小段再用动画滑入，保留跳转动画手感
        if (Math.abs(gap) > JUMP_GLIDE_ROWS) {
            nextIndex = target - (gap > 0 ? JUMP_GLIDE_ROWS : -JUMP_GLIDE_ROWS);
            animated = false;
        } else if (this.jumpAnimated) {
            // 动画步整轮只试一次：被框架丢弃后改用无动画步，避免「动画-丢弃-再动画」来回摆动
            animated = false;
        }

        this.jumpAnimated = this.jumpAnimated || animated;

        const startedAt: number = Date.now();
        this.scroller.scrollToIndex(nextIndex, animated, this.jumpAlign);
        hilog.info(DOMAIN, TAG,
            '[jump] step=%{public}d from=%{public}d next=%{public}d target=%{public}d animated=%{public}d elapsed=%{public}dms',
            this.jumpSteps, from, nextIndex, target, animated ? 1 : 0, Date.now() - startedAt);

        setTimeout(() => {
            this.settleJump(label, token);
        }, animated ? JUMP_ANIMATE_SETTLE_DELAY : JUMP_SETTLE_DELAY);
    }

    // 落地校验：目标已进入可视区则完成（含临时高亮）；未进入则继续推进；超过步数上限则放弃
    private settleJump(label: string, token: number): void {
        if (token !== this.jumpToken || this.jumpTargetIndex < 0) {
            return;
        }

        const target: number = this.jumpTargetIndex;

        if (target >= this.visibleStartIndex && target <= this.visibleEndIndex) {
            this.completeJump('verify');
            return;
        }

        // 可视区间相对上次校验还在变化 → 动画正在推进中，继续等它走完。
        // （早先一发现没到位就改发无动画步，会把已经开始的平滑滚动直接截断成瞬移）
        const moved: boolean = this.visibleStartIndex !== this.jumpLastStart
            || this.visibleEndIndex !== this.jumpLastEnd;
        this.jumpLastStart = this.visibleStartIndex;
        this.jumpLastEnd = this.visibleEndIndex;

        if (moved && this.jumpRearms < JUMP_MAX_REARMS) {
            this.jumpRearms++;
            hilog.info(DOMAIN, TAG,
                '[jump] waiting label=%{public}s target=%{public}d visible=%{public}d-%{public}d rearm=%{public}d',
                label, target, this.visibleStartIndex, this.visibleEndIndex, this.jumpRearms);
            setTimeout(() => {
                this.settleJump(label, token);
            }, JUMP_SETTLE_DELAY);
            return;
        }

        if (this.jumpSteps >= JUMP_MAX_STEPS) {
            hilog.warn(DOMAIN, TAG,
                '[jump] give up label=%{public}s target=%{public}d steps=%{public}d visible=%{public}d-%{public}d',
                label, target, this.jumpSteps, this.visibleStartIndex, this.visibleEndIndex);
            this.finishJump();
            return;
        }

        this.runJumpStep(label, token);
    }

    // 定位完成：记录落地方式后收尾，并执行落地回调（临时高亮）。
    // by=verify 表示定时校验确认，by=visible 表示 List 上报的窗口先一步确认
    private completeJump(by: string): void {
        const label: string = this.jumpLabel;
        const target: number = this.jumpTargetIndex;
        const steps: number = this.jumpSteps;
        const onSettled: () => void = this.jumpSettled;

        this.finishJump();

        // 跳转落地才更新激活轮次，并带动画：面板线条随之平滑滑到目标轮次
        // （滚动过程中的跟随更新是瞬时生效，对齐 web「滚动不播动画、跳转才播」）
        if (target >= 0 && target < this.turnIndexByItem.length) {
            animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                this.activeTurnIndex = this.turnIndexByItem[target];
            });
        }

        hilog.info(DOMAIN, TAG, '[jump] settled label=%{public}s target=%{public}d steps=%{public}d by=%{public}s',
            label, target, steps, by);
        onSettled();
    }

    // 定位收尾：清理目标，并继续屏蔽一小段触顶回调，避免定位刚落到索引 0 就触发历史分页
    private finishJump(): void {
        this.jumpTargetIndex = -1;
        this.jumpSettled = () => {};
        this.jumpLabel = '';
        this.paginationBlockedUntil = Date.now() + JUMP_PAGINATION_HOLD;
    }

    // 取消在途定位：列表内容被整体替换后旧目标索引已失效
    private cancelJump(): void {
        this.jumpToken = this.jumpToken + 1;
        this.jumpTargetIndex = -1;
        this.jumpSettled = () => {};
        this.jumpLabel = '';
        this.paginationBlockedUntil = 0;
        this.visibleStartIndex = 0;
        this.visibleEndIndex = 0;
    }

    // 分页屏蔽判定：有在途定位、或刚定位完的一小段时间内，不启动历史分页
    private isPaginationBlocked(): boolean {
        return this.jumpTargetIndex >= 0 || Date.now() < this.paginationBlockedUntil;
    }

    // 当前可见行的正文长度之和：作为该帧渲染子树规模的代理指标（长回答 = 每帧成本高）
    private visibleContentChars(): number {
        const items: ChatRenderItem[] = this.itemSource.snapshot();
        let total: number = 0;

        for (let i: number = this.visibleStartIndex; i <= this.visibleEndIndex && i < items.length; i++) {
            const item: ChatRenderItem = items[i];

            if (item.firstOfMessage) {
                total += item.message.content.length;
            }
        }

        return total;
    }

    // 当前视口中心行：分步推进的起点（List 尚未上报过索引时按 0 起算）
    private visibleCenterIndex(): number {
        return Math.floor((this.visibleStartIndex + this.visibleEndIndex) / 2);
    }

    // 临时高亮指定消息：设置索引后到时自动清除（代次令牌避免旧定时器提前清掉新的高亮）
    private highlightMessage(messageIndex: number): void {
        this.highlightToken = this.highlightToken + 1;
        const token: number = this.highlightToken;

        this.setMessageHighlight(messageIndex, true);
        setTimeout(() => {
            if (token === this.highlightToken) {
                this.setMessageHighlight(messageIndex, false);
            }
        }, HIGHLIGHT_DURATION);
    }

    // 高亮标记写在单元上（单元是 @Observed，行用 @ObjectLink 观察它）：
    // 页面级下标比较不会让 LazyForEach 已创建的行重新渲染，标记必须落在单元自身
    private setMessageHighlight(messageIndex: number, highlighted: boolean): void {
        const items: ChatRenderItem[] = this.itemSource.snapshot();
        const start: number = this.firstItemOfMessage(messageIndex);

        if (start < 0 || start >= items.length) {
            return;
        }

        const uid: string = items[start].message.uid;

        for (let i: number = start; i < items.length && items[i].message.uid === uid; i++) {
            items[i].highlighted = highlighted;
        }
    }

    // 以指定会话缓冲的首条提问生成标题（流结束时用于顶栏与侧栏占位项）
    private deriveTitleFor(key: string): string {
        const buffer: ConversationBuffer | undefined = this.buffers.get(key);

        if (buffer === undefined || buffer.messages.length === 0) {
            return '新对话';
        }

        const first: ChatMessage = buffer.messages[0];

        if (!first.isUser || first.content.length === 0) {
            return '新对话';
        }

        return first.content.length > TITLE_MAX_LENGTH
            ? first.content.substring(0, TITLE_MAX_LENGTH) + '…'
            : first.content;
    }

    // 回复完成 / 中止后轮询刷新会话列表：服务端对"新会话入库 / 标题落盘"存在可见延迟，
    // 单次延时刷新可能拉到的还是旧列表（表现为"重开侧栏才出现新会话"）。
    // 改为按 0.6s/2s/4.5s/9s 递增重试，直到该会话出现在列表里为止（与当前查看哪个会话无关）
    private scheduleListRefresh(targetId: string): void {
        if (targetId.length === 0) {
            return;
        }

        const delays: number[] = [600, 2000, 4500, 9000];
        let attempt: number = 0;

        const pollOnce = (): void => {
            this.app.refreshConversations().then(() => {
                this.bumpList();

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
        if (this.streamingKeys.has(item.id)) {
            this.notify('回复生成中，请先停止再操作', 1600);
            return;
        }

        const error: string = await this.app.deleteConversation(item.id);

        if (error.length > 0) {
            this.notify(error, 1600);
            return;
        }

        this.notify('会话已删除');
        this.bumpList();
        this.buffers.delete(item.id);

        // 删的是当前正在看的会话：复位到新对话空态，避免停留在已删除会话的消息上
        if (item.id === this.conversationId) {
            this.startNewRound();
        }
    }

    // 流式事件到消息模型的映射：所有增量落到该流自己的 assistant 消息上。
    // streamKey 为这条流在本地缓冲/传输锁中的键：新会话预创建失败时是本地临时键，
    // SSE 首帧带回真实会话 ID 后迁移；事件只在流所属会话正在查看时才驱动滚动。
    // 统一经 UI 线程跳板（setTimeout 0）再改 @Observed 消息：
    // http 流回调线程不保证是 UI 线程，直接在此改 @Observed 字段可能不触发界面通知，
    // 表现为"服务端在推、界面一字不流"（曾实测复现），必须回到 UI 线程再落地。
    private listenerFor(assistant: ChatMessage, streamKey: string): StreamListener {
        const context: StreamContext = {
            key: streamKey,
            conversationId: streamKey.startsWith(PENDING_STREAM_PREFIX) ? '' : streamKey
        };

        const onUi = (action: () => void): void => {
            setTimeout(() => {
                action();

                // 本帧改动的消息字段（正文块 / 工具卡 / 用量 / 状态）同步给列表数据源：
                // 原地改写受影响的单元，列表不重建，只有真正变化的那一行重渲染
                if (this.currentBufferKey() === context.key) {
                    this.itemSource.refreshMessage(assistant);
                }
            }, 0);
        };

        let pendingReasoning: string = '';
        let pendingContent: string = '';
        let deltaFlushScheduled: boolean = false;

        const applyPendingDeltas = (): void => {
            const reasoning: string = pendingReasoning;
            const content: string = pendingContent;
            pendingReasoning = '';
            pendingContent = '';

            if (reasoning.length > 0) {
                assistant.appendDelta('reasoning', reasoning);
                this.logStreamProgress(assistant, true);
            }

            if (content.length > 0) {
                // 正文到达：思考阶段结束，折叠 thinking 块
                if (assistant.thinkingExpanded) {
                    assistant.thinkingExpanded = false;
                }

                assistant.appendDelta('content', content);
                this.logStreamProgress(assistant, false);

                if (this.currentBufferKey() === context.key) {
                    this.scheduleStreamFollowToBottom();
                }

                // 胶囊滚动窗口：截取正文末尾 5 字更新灵动岛胶囊（仅退后台活跃时生效）
                LiveViewController.shared.updateContent(assistant.content);
            }
        };

        const scheduleDeltaFlush = (): void => {
            if (deltaFlushScheduled) {
                return;
            }

            deltaFlushScheduled = true;
            this.getUIContext().postFrameCallback(new NextFrameCallback(() => {
                deltaFlushScheduled = false;
                applyPendingDeltas();
            }));
        };

        const flushDeltaNow = (): void => {
            deltaFlushScheduled = false;
            applyPendingDeltas();
        };

        return {
            onConversationId: (conversationId: string) => {
                onUi(() => {
                    this.bindPendingStream(context, conversationId);
                    // 会话已建立：立即本地占位 + 刷新一次列表，让新会话在回复途中就出现在侧栏并可高亮
                    this.app.ensureConversationVisible(conversationId, this.firstQuestionHint(context.key));
                    this.app.refreshConversations().then(() => {
                        this.bumpList();
                    });
                });
            },
            onAssistantIndex: (index: number) => {
                onUi(() => {
                    assistant.index = index;
                    hilog.info(DOMAIN, TAG, 'assistant index bound: %{public}d', index);
                });
            },
            onReasoningDelta: (delta: string) => {
                onUi(() => {
                    pendingReasoning += delta;
                    scheduleDeltaFlush();
                });
            },
            onContentDelta: (delta: string) => {
                onUi(() => {
                    pendingContent += delta;
                    scheduleDeltaFlush();
                });
            },
            onToolCall: (name: string, callId: string, args: string, round: number) => {
                onUi(() => {
                    flushDeltaNow();
                    // 工具调用到达：思考阶段结束，折叠 thinking 块
                    if (assistant.thinkingExpanded) {
                        assistant.thinkingExpanded = false;
                    }

                    assistant.beginToolCall(callId, name, args, round);

                    if (this.currentBufferKey() === context.key) {
                        this.scheduleStreamFollowToBottom();
                    }
                });
            },
            onToolResult: (name: string, callId: string, payload: ToolResultPayload, round: number) => {
                onUi(() => {
                    flushDeltaNow();
                    assistant.completeToolCall(callId, payload);

                    // 工具结果卡是本轮最后输出时后面不再有正文增量，这里必须自己补一次贴底，
                    // 否则结果块（含 Exa 图片画廊）会停在视口下方
                    if (this.currentBufferKey() === context.key) {
                        this.scrollToEndAfterLayout();
                    }
                });
            },
            onQuestion: (callId: string, payload: Object | null, round: number) => {
                onUi(() => {
                    flushDeltaNow();
                    // question 工具等待作答：关闭思考块并挂载交互卡片，回答走 answerQuestion
                    if (assistant.thinkingExpanded) {
                        assistant.thinkingExpanded = false;
                    }

                    assistant.beginQuestion(callId, payload);
                    this.applyQuestionLocks(context.conversationId, [assistant]);

                    // 选择题卡通常是本轮最后一块输出：挂载当帧还没有真实高度，同步滚动会漏底
                    if (this.currentBufferKey() === context.key) {
                        this.scrollToEndAfterLayout();
                    }
                });
            },
            onTokenUsage: (usage: TokenUsage) => {
                onUi(() => {
                    assistant.setUsage(usage);
                });
            },
            onError: (message: string) => {
                onUi(() => {
                    flushDeltaNow();
                    assistant.setError(message);
                    this.finishStream(context.key);

                    // 还有别的会话在生成：实况窗保留，等待最后一个流收尾
                    if (chatStream.streamingCount <= 1) {
                        LiveViewController.shared.stop();
                    }
                });
            },
            onComplete: (finalContent: string) => {
                onUi(() => {
                    flushDeltaNow();
                    // 思考型回复常见「全程 reasoning 帧、正文在结尾一次性到达」：
                    // 只要正文仍为空就必须落进 content，不能因消息已有思考内容而吞掉结尾正文
                    if (assistant.content.length === 0 && finalContent.length > 0) {
                        assistant.appendDelta('content', finalContent);
                    }

                    assistant.finish();
                    this.finishStream(context.key);
                    this.finalizeStreamConversation(context);

                    // 最后一个流完成：胶囊改"回复完成"保留 5 秒后自动关闭
                    if (chatStream.streamingCount <= 1) {
                        LiveViewController.shared.finishGenerating();
                    }
                });
            },
            onAborted: () => {
                onUi(() => {
                    flushDeltaNow();
                    assistant.finish();
                    this.finishStream(context.key);
                    this.finalizeStreamConversation(context);

                    if (chatStream.streamingCount <= 1) {
                        LiveViewController.shared.stop();
                    }
                });
            }
        };
    }

    // 流正常结束/中止后的会话收尾：更新标题与侧栏占位项，并按需刷新会话列表
    private finalizeStreamConversation(context: StreamContext): void {
        const derived: string = this.deriveTitleFor(context.key);

        // 仍停留在该流所属会话且标题还是默认值时，顶栏同步为推导标题
        if (this.currentBufferKey() === context.key && this.title === '新对话') {
            this.title = derived;
        }

        if (context.conversationId.length > 0) {
            this.app.updatePendingConversation(context.conversationId, derived);
        }

        this.scheduleListRefresh(context.conversationId);
    }

    // ---------- 多会话并行辅助 ----------

    // 当前视图对应的缓冲键：已打开会话用会话 ID；空白会话发送中（预创建失败）用本地临时键
    private currentBufferKey(): string {
        return this.conversationId.length > 0 ? this.conversationId : this.pendingSendKey;
    }

    // 当前查看会话是否正在生成
    private isCurrentStreaming(): boolean {
        return this.streamingKeys.has(this.currentBufferKey());
    }

    // 取指定会话的缓冲，不存在则新建
    private bufferFor(key: string): ConversationBuffer {
        const existing: ConversationBuffer | undefined = this.buffers.get(key);

        if (existing !== undefined) {
            return existing;
        }

        const buffer: ConversationBuffer = new ConversationBuffer();
        this.buffers.set(key, buffer);
        return buffer;
    }

    // 向指定会话缓冲追加消息；该会话正是当前视图时同步镜像到 @State 与数据源。
    // 尾部追加必须走数据源的 append（增量 ADD）：走 replaceMessages 会触发 RELOAD，
    // 重建整个列表并清空已测行高 —— 列表位置回到顶部、后续跳转的行高估算全部失真
    private appendMessages(key: string, messages: ChatMessage[]): void {
        const buffer: ConversationBuffer = this.bufferFor(key);
        buffer.messages = [...buffer.messages, ...messages];

        if (this.currentBufferKey() === key) {
            this.messages = buffer.messages;
            this.itemSource.appendItems(this.buildItems(messages));
            this.rebuildItemIndex();
        }
    }

    // 流收尾：从进行中集合移除并同步输入栏/侧栏状态
    private finishStream(key: string): void {
        this.streamingKeys.delete(key);
        this.syncStreamingState();
    }

    // 同步生成态：输入栏当前会话开关 + 侧栏各会话流式指示
    private syncStreamingState(): void {
        this.streaming = this.isCurrentStreaming();
        this.syncStreamingConvIds();
    }

    // 侧栏指示镜像：重算为新数组触发 @Prop 刷新（本地临时键尚未绑定真实会话，不出现在侧栏）
    private syncStreamingConvIds(): void {
        const ids: string[] = [];

        this.streamingKeys.forEach((key: string): void => {
            if (!key.startsWith(PENDING_STREAM_PREFIX)) {
                ids.push(key);
            }
        });

        this.streamingConvIds = ids;
    }

    // 生成新的本地临时流键（新会话预创建失败时使用，SSE 绑定真实 ID 后迁移）
    private nextPendingKey(): string {
        this.pendingKeySeq = this.pendingKeySeq + 1;
        return PENDING_STREAM_PREFIX + Date.now() + ':' + this.pendingKeySeq;
    }

    // 新会话流首次拿到真实会话 ID：迁移本地缓冲与传输锁键；
    // 若用户仍停留在这次空白发送的视图上则直接换绑，消息流不中断
    private bindPendingStream(context: StreamContext, conversationId: string): void {
        const fromKey: string = context.key;

        if (fromKey === conversationId) {
            context.conversationId = conversationId;
            return;
        }

        const buffer: ConversationBuffer | undefined = this.buffers.get(fromKey);

        if (buffer !== undefined) {
            this.buffers.delete(fromKey);
            this.buffers.set(conversationId, buffer);
        }

        this.streamingKeys.delete(fromKey);
        this.streamingKeys.add(conversationId);
        chatStream.rekey(fromKey, conversationId);

        context.key = conversationId;
        context.conversationId = conversationId;

        if (this.pendingSendKey === fromKey) {
            this.pendingSendKey = '';
            this.conversationId = conversationId;
        }

        this.syncStreamingState();
        hilog.info(DOMAIN, TAG, 'conversation bound: %{public}s', conversationId);
    }

    // 历史窗口与本地缓冲按索引合并，取并集：
    //  - 服务端本页覆盖到的索引以服务端为准（落库内容是权威版本）
    //  - 仍在流式生成的助手消息例外：服务端此刻还没有它，增量只能由本地版本承载
    //  - 索引超出本页末条的本地消息：服务端尚未落库，必须保留，否则切回时回复消失
    // windowEnd 为本页窗口右边界（startIndex + 本页条数）
    private mergeHistoryWithLive(history: ChatMessage[], live: ChatMessage[], windowEnd: number): ChatMessage[] {
        const byIndex: Map<number, ChatMessage> = new Map<number, ChatMessage>();

        for (let i: number = 0; i < history.length; i++) {
            byIndex.set(history[i].index, history[i]);
        }

        for (let i: number = 0; i < live.length; i++) {
            const message: ChatMessage = live[i];
            const localOnly: boolean = message.index >= windowEnd || message.streaming;

            if (localOnly) {
                byIndex.set(message.index, message);
            }
        }

        const merged: ChatMessage[] = [];

        byIndex.forEach((message: ChatMessage): void => {
            merged.push(message);
        });
        merged.sort((a: ChatMessage, b: ChatMessage): number => a.index - b.index);

        return merged;
    }

    // ---------- 展示文案 ----------
    // 工程约定：UI 描述一律走普通方法而非组件 getter（getter 在 UI 更新路径曾取到 undefined 触发崩溃 / 脏值）
    private inputPlaceholder(): string {
        return this.conversationId.length > 0 ? '继续追问…' : '给 Nexora 发送消息，或试试下面的能力…';
    }

    // 指定会话缓冲的首问文本（截断），用于回复途中侧栏占位项的标题
    private firstQuestionHint(key: string): string {
        const buffer: ConversationBuffer | undefined = this.buffers.get(key);

        if (buffer === undefined) {
            return '新对话';
        }

        for (let i: number = 0; i < buffer.messages.length; i++) {
            const message: ChatMessage = buffer.messages[i];

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
        AppStorage.setOrCreate('inputModelLabel', this.modelLabel);
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
