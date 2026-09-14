// MainChat.ets - 主对话页（豆包式单一主页）
// 登录后的唯一主页 = 对话界面本身，取代旧「HomePage 首页 + ChatPage 详情」的两页跳转：
//  - 顶栏左侧头像点击滑出侧栏抽屉（功能入口：新对话/邮件 / 最近对话 / 视图切换 / 账户行）
//  - 中间列展示会话标题 + 当前模型（可点切换），右侧 + 新建对话
//  - 空态显示问候 + 快捷能力宫格，发送后原地进入消息流（不压栈）
//  - 历史会话从侧栏点选后「原地替换状态」，会话删除后若删的是当前会话则复位空态
//  - 邮件为独立界面：侧栏入口触发，本页全屏覆盖层挂载，返回键先退详情再退页面
// 键盘 RESIZE 避让与系统栏同色已在 EntryAbility 全局配置，本页不重复处理
// 页面级统一 @State 持有进程单例（见工程约定），弹层收敛到单个 bindSheet

import { hilog } from '@kit.PerformanceAnalysisKit';
import { display, promptAction } from '@kit.ArkUI';
import { ApiService } from '../common/ApiService';
import { AppState } from '../common/AppState';
import { ConversationItem, greetingOfHour, KnowledgeItem, QuickAction, QUICK_ACTIONS, sanitizeDisplayName } from '../common/AppConfig';
import { ChatMessage, TokenUsage, ToolResultPayload } from '../common/ChatTypes';
import { chatStream, StreamListener, StreamOptions } from '../common/ChatStreamClient';
import { LiveViewController } from '../common/LiveViewController';
import { NextFrameCallback } from '../common/NextFrame';
import { FontSize, Glow, Motion, Radius, Shadow, Size, Space, StaggerDelay } from '../common/DesignToken';
import { ChatInputBar } from '../components/ChatInputBar';
import { QuickActionGrid } from '../components/QuickActionGrid';
import { ChatItemBuilder } from '../common/ChatItemBuilder';
import { ChatItemDataSource } from '../common/ChatItemDataSource';
import { ChatRenderItem } from '../common/ChatRenderItem';
import { QuestionItem } from '../common/QuestionLocks';
import { ChatItemRow } from '../components/chat/ChatItemRow';
import { TurnIndicatorPanel } from '../components/chat/TurnIndicatorPanel';
import { IconButton } from '../components/common/IconButton';
import { UserAvatar } from '../components/common/UserAvatar';
import { ModelPickerSheet } from '../components/sheets/ModelPickerSheet';
import { SettingsSheet } from '../components/sheets/SettingsSheet';
import { KnowledgeEditorSheet } from '../components/sheets/KnowledgeEditorSheet';
import { SidebarPanel } from '../components/sidebar/SidebarPanel';
import { MailPage } from '../components/mail/MailPage';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMain';
const TITLE_MAX_LENGTH: number = 18;
// 侧栏抽屉宽度：固定 vp，translate 用 -100% 相对自身宽，隐藏时刚好滑出屏幕
const DRAWER_WIDTH: number = 304;
// 上滑历史分页条数：前插的行都没被测量过，列表只能用「已测行平均高度」估算补偿量，
// 误差与插入行数成正比 —— 20 条一页会偏掉近两屏，6 条一页只偏半屏（跳变随页变小）
const HISTORY_PAGE_SIZE: number = 6;
// 触底校验延时（ms）：等该次 scrollEdge 的布局与索引上报完成
const BOTTOM_SETTLE_DELAY: number = 56;
// 触底最大重试次数：引擎对内容边界的认知来自未测量行的行高估算，需逐次逼近
const BOTTOM_MAX_ATTEMPTS: number = 12;
// 程序滚动（定位 / 触底 / 回底）后屏蔽触顶分页的时长（ms）
const JUMP_PAGINATION_HOLD: number = 240;
// 触顶判定要求的连续贴顶帧数：估算修正会让视口单帧路过索引 0，一帧就触发会连锁前插
const TOP_TRIGGER_STREAK: number = 3;
// 前插落地后的分页静默期（ms）：给列表留出修正估算的时间，静默期内不再前插
const PREPEND_PAGINATION_HOLD: number = 2000;
// 帧间隔采样上限（条）：单次手势的样本量封顶，超出丢最旧的，避免长手势把内存撑起来
const SCROLL_GAP_SAMPLE_CAP: number = 8192;
// 轮次跳转高亮的保持时长（ms）
const HIGHLIGHT_DURATION: number = 3000;
// 位置跳变探针：单帧「实际位移 - 要求位移」的绝对值超过它就记一次（vp）。
// 24vp 约等于两行正文的高度 —— 比这小的补偿肉眼分不出来，记下来只会淹没日志
const JUMP_MIN_VP: number = 24;
// 预取窗口（行）。maxCount 既是销毁线、也是空闲时向上/下预加载的行数。
//
// 曾经把窗口放大到 48/192，想「用静态期把行建好、别在滚动期建」——方向错了：
// 引擎会就地预建到 maxCount，打开会话后一次性建出 212 行（整份会话），
// 每行约 470 KB 原生堆（冷启动实测：61 MB → 159 MB，线性），
// ArkTS 堆到 171 MB 后老年代并发标记变成每秒一轮，标记/压实 STW 300~500 ms。
// 于是「每秒冻一次」——滚动期任何编排都碰不到这条路径。
// 现在按「只留视口附近」配置：视口约 15~25 行（行高 30~56vp）+ 两侧少量预取。
const CACHE_MIN_ROWS: number = 4;
const CACHE_MAX_ROWS: number = 12;
// 跳变日志限流（ms）：跳变会成串出现，限流只保留代表性样本；计数仍全量累加
const JUMP_LOG_INTERVAL: number = 120;

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

    // 消息分页：初始只取最近一页，滚到顶部再加载更早的一页，避免长对话一次性渲染卡死主线程
    @State private hasMoreMessages: boolean = false;
    @State private oldestLoadedIndex: number = 0;
    @State private loadingMoreMessages: boolean = false;
    // 加载更多前的可见区域中心索引：前插会改变所有旧消息的下标，用它修正活动轮次
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
    // 拖拽起始时的 translate 值（跟手拖动用，非响应式）
    private dragStartTranslate: number = 0;

    // ---------- 邮件页（全屏覆盖层） ----------
    // 条件挂载 + 右滑转场；mailDetailOpen 以 @Link 下发 MailPage，返回键先退详情再退页面
    @State private mailOpen: boolean = false;
    @State private mailDetailOpen: boolean = false;

    // 回到底部按钮：滚动离开底部时显示，点击平滑回到底部
    @State private showScrollBottom: boolean = false;

    // 轮次指示器：当前激活的用户轮次索引（-1 表示无）
    @State private activeTurnIndex: number = -1;


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
    // 滚动索引回调可能在同一帧触发多次，只保留最后一次结果，避免反复驱动指示器重排
    private scrollIndexFramePending: boolean = false;
    private pendingScrollStart: number = -1;
    private pendingScrollEnd: number = -1;
    private pendingScrollCenter: number = -1;
    // 帧间隔探针：记录超过一帧预算的间隔（60fps = 16.7ms），限流后打日志
    private lastScrollFrameAt: number = 0;
    // 帧间隔全量采样：滑动期间只累加不打印。
    // 原先只留「>=17ms 且距上次日志 >120ms」的样本，在高刷设备上等于只剩尾部还被限流 ——
    // 实测 120Hz 屏上 90% 的帧本是满帧（中位 8.0ms），却据此把满帧误读成持续掉帧。
    private frameGaps: number[] = [];
    // 位置跳变探针。onDidScroll 的第一个入参是「本帧滚动量」而不是绝对偏移
    // （SDK：OnScrollCallback 的 scrollOffset 为 offset this frame did scroll），
    // 所以本帧实际位移直接取它，绝不能再拿两帧的它相减。
    //   applied  = 本帧实际位移
    //   intended = 本帧要求位移（onScrollFrameBegin 累加，语义同为本帧滚动量）
    //   corr     = applied - intended，即引擎为修正行高估算注入的补偿量
    private pendingIntendedOffset: number = 0;
    // 本帧是否真收到过 onScrollFrameBegin：惯性帧该回调可能不触发，
    // 此时 intended 恒为 0，corr 会退化成整个位移，必须按「无样本」剔除
    private intendedFrameSeen: boolean = false;
    // 上一帧实际位移，用于算速度突变
    private lastFrameDelta: number = 0;
    // 首次回调只用来建立基准：此时没有上一帧可比，直接跳过
    private scrollOffsetPrimed: boolean = false;
    private jumpFrames: number = 0;
    private jumpTotal: number = 0;
    private jumpMaxAbs: number = 0;
    // 速度突变计数。帧间隔正常（不掉帧）但相邻帧位移差很大 = 跟手性被破坏，体感就是「跳」。
    // 与 corr 是两回事：corr 是引擎主动修正的位移，jerk 是位移本身的忽快忽慢
    private jerkTotal: number = 0;
    private jerkMaxAbs: number = 0;
    private lastJumpLogAt: number = 0;
    // 列表实测宽度派生出的「可用文本宽度」：切片器靠它推算一行能排多少字，
    // 猜错了每片会白吃一行，行数上升就是滚动期单帧成本的直接来源
    private measuredContentWidth: number = 0;
    // 宽度冻结后若实测值与冻结值不符，只报一次警：用来确认播种是对的
    private widthLockWarned: boolean = false;
    // 滚动索引处理（JS 侧）单帧最大耗时：用于区分掉帧来自 JS 还是渲染引擎
    private maxScrollIndexCost: number = 0;
    // 触底收敛状态：在途标记 + 已尝试次数
    private bottomLoopActive: boolean = false;
    private bottomAttempts: number = 0;
    // 程序滚动后的分页屏蔽截止时间戳：布尔开关在异常路径漏复位会永久锁死分页，时间戳可自愈
    private paginationBlockedUntil: number = 0;
    // 前插落地后的分页静默截止时间戳 + 连续贴顶帧计数
    private prependGuardUntil: number = 0;
    private topStreak: number = 0;
    // 最近一次 List 上报的可视区间：触底收敛与帧间隔探针都读它
    private visibleStartIndex: number = 0;
    private visibleEndIndex: number = 0;
    // 诊断：可见区键序列的限流时间戳（定位"屏幕顺序 vs 数据源顺序"）
    private lastVisibleDumpAt: number = 0;
    // 轮次高亮代次：连续跳转时，旧的清除定时器据此失效
    private highlightToken: number = 0;

    // 块级渲染单元数据源：一条消息按 Markdown AST 拆成多个小行，
    // 流式增量只更新真正变化的那一块，不必重建整条消息对应的行
    private itemSource: ChatItemDataSource = new ChatItemDataSource();
    // 单元索引在单元集合变化时一次性建立，滚动回调只读 O(1) 结果，不再每帧扫描整段历史
    @State private userTurnCount: number = 0;
    private turnIndexByItem: number[] = [];
    // 每条消息的首个单元下标：轮次跳转以「该消息的第一行」为目标
    private messageStartByMessage: number[] = [];

    // 替换消息数组的唯一入口：同步响应式页面状态与 LazyForEach 数据源
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

    aboutToAppear(): void {
        // 必须排在一切构建之前：切片宽度一旦定型就不许再变（键 = uid#order 与内容一一对应），
        // 所以正确的值要在第一次 build 之前就位。列表的 onAreaChange 发生在子行首次布局之后，
        // 只等它会让首屏那批行按缺省值切片、后续行按实测值切片 —— 同一段对话被切成两种口径
        this.seedContentWidth();

        this.greeting = greetingOfHour(new Date().getHours());
        this.labelForModel(this.app.selectedModelId);
        this.app.refreshModels().then(() => {
            this.syncModelLabel();
        });
        this.app.refreshConversations().then(() => {
            this.bumpList();
        });
        this.app.refreshUserProfile();

        // 空态区域交错入场（仅问候 / 快捷能力两个区块，输入栏常驻底部不做位移）
        setTimeout(() => { this.greetingVisible = true; }, StaggerDelay.greeting);
        setTimeout(() => { this.actionsVisible = true; }, StaggerDelay.actions);

        // 注入返回键处理：侧边栏展开→收起，弹层→关闭，有对话→新对话
        this.app.backHandler = (): boolean => {
            return this.handleBackPress();
        };

        // 建行成本探针的定时汇报：静止期的预建（cachedCount）同样产生建行成本，
        // 只在手势结束时汇总会把静止期的账并进下一次手势，看不出归属。
        // 每 3 秒独立汇报一次，是为了让「手不碰屏幕也能看到建行成本」
        setInterval((): void => {
            const cost: string = ChatItemBuilder.takeRowCost();

            if (cost.length > 0) {
                hilog.info(DOMAIN, TAG, '[row] cost %{public}s', cost);
            }
        }, 3000);
    }

    // 系统返回键处理：优先级 邮件页(详情→页面) > 侧边栏 > 弹层 > 对话→新对话
    private handleBackPress(): boolean {
        if (this.mailOpen) {
            if (this.mailDetailOpen) {
                this.mailDetailOpen = false;
                return true;
            }

            this.closeMail();
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
                                },
                                onQuestionAnswer: (target: QuestionItem, answer: string) => {
                                }
                            });
                        }
                        // 键值取「消息身份 + 单元序号」：单元序号在消息内稳定，
                        // 同一条消息的第 N 个块流式期间始终复用同一个节点
                    }, (item: ChatRenderItem) => item.key());
                }
                .width('100%')
                .height('100%')
                .listDirection(Axis.Vertical)
                .edgeEffect(EdgeEffect.Spring)
                // 隐藏滚动条：引擎每次为修正行高估算重新锚定偏移时，thumb 位置
                // （= 偏移 / 内容总高，两个量都在变）都会跟着回跳 —— 它是滚动中最显眼的「跳」。
                // 修正本身避不开，但不必把它画出来；聊天页也不需要滚动条
                .scrollBar(BarState.Off)
                // 预取窗口双值：低于 minCount 就趁空闲预加载，超过 maxCount 才销毁/复用，
                // 空闲时按 maxCount 把上下的行先建好。惯性滑动一屏约 13~16 行，
                // maxCount=64 给一次滑动留出约 4 屏的「已建好」跑道，
                // 滑动期间就不必再建行 —— 建行必然带来一次测量，测量就要重锚偏移
                .cachedCount({ minCount: CACHE_MIN_ROWS, maxCount: CACHE_MAX_ROWS }, false)
                // 切片点必须贴着真实折行位置。可用宽度写死成 360vp 屏的 328 时，
                // 在 392.7vp 的屏上预算偏小，每片都白吃一行。只认实测算出的宽度，不再猜屏宽
                .onAreaChange((oldArea: Area, newArea: Area) => {
                    this.applyContentWidth(newArea.width as number);
                })
                // 关闭「同步加载全部子组件」：默认 true 时无动画跳转/首屏会把沿途尚未布局的行
                // 在同一帧里全部布局完，置 false 后单帧布局超时会把这部分工作顺延到后续帧
                .syncLoad(false)
                // 历史消息只在列表头部前插，交给 List 保持当前可见内容；
                // 不再手动 scrollToIndex 二次定位 —— 手动恢复的落点按估算算，本身就是一次硬跳
                .maintainVisibleContentPosition(true)
                // 纵向留白走 contentStart/EndOffset：写在 padding 上会变成裁切死带，
                // 表现为「最后一条消息与输入栏之间永远空一条」
                .contentStartOffset(Space.xs)
                .contentEndOffset(Space.sm)
                .onScrollIndex((start: number, end: number, center: number) => {
                    this.scheduleScrollIndexUpdate(start, end, center);
                })
                // 该回调只在用户/惯性滚动的每帧开始前触发，scrollToIndex 不会触发它。
                // 一旦用户开始阅读历史内容，流式更新不得再把手势拉回末条
                .onScrollFrameBegin((offset: number, state: ScrollState): OnScrollFrameBeginHandlerResult => {
                    this.probeScrollFrame(offset);
                    this.streamUserScrolled = true;
                    return { offsetRemain: offset };
                })
                // 每帧的实际滚动偏移。与 onScrollFrameBegin 记录的「手势要求位移」作差，
                // 即可量化引擎注入的补偿量 —— 也就是肉眼看到的跳变
                .onDidScroll((offset: number, state: ScrollState) => {
                    this.probeScrollOffset(offset, state);
                })
                .onScrollStop(() => {
                    this.lastScrollFrameAt = 0;
                    this.reportScrollStats();
                    this.reportJumpStats();
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

    // 回到底部浮动按钮：圆形带阴影，点击平滑滚到最后一条消息
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
        .backgroundColor($r('app.color.bg_card'))
        .shadow(Shadow.raised)
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
                    onNewChat: () => {
                        this.startNewRound();
                    },
                    onOpenMail: () => {
                        this.closeSidebar();
                        this.openMail();
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
            .parallelGesture(
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
    private loadHistory(): void {
        this.loadingHistory = true;
        this.loadError = '';
        this.hasMoreMessages = false;
        this.oldestLoadedIndex = 0;

        ApiService.fetchMessages(this.conversationId, 20, 0).then((result) => {
            this.loadingHistory = false;

            if (!result.success) {
                this.loadError = result.message;
                return;
            }

            this.replaceMessages(result.messages);
            this.hasMoreMessages = result.hasMoreBefore;
            this.oldestLoadedIndex = result.startIndex;
            this.streamUserScrolled = false;
            this.scrollToEnd('load-history');
            // scrollToEnd 的 scrollEdge 不一定触发 onScrollIndex，这里主动以末条为基准算出当前轮次
            this.activeTurnIndex = this.computeActiveTurnOfLastMessage();
            hilog.info(DOMAIN, TAG, '[loadHistory] msgCount=%{public}d activeTurn=%{public}d', this.messages.length, this.activeTurnIndex);
        });
    }

    // 加载更早的一页消息：滚到顶部时触发，插入列表头部。
    // List 的 maintainVisibleContentPosition 负责保持当前可见内容，不再手动二次定位
    private loadMoreMessages(): void {
        if (!this.hasMoreMessages || this.loadingMoreMessages || this.oldestLoadedIndex <= 0) {
            return;
        }

        this.loadingMoreMessages = true;
        const centerBeforeLoad: number = this.scrollCenterBeforeLoad;

        ApiService.fetchMessages(this.conversationId, HISTORY_PAGE_SIZE, this.oldestLoadedIndex).then((result) => {
            if (!result.success) {
                this.loadingMoreMessages = false;
                return;
            }

            // 去重：跳过新加载消息中与已有消息 index 重叠的部分
            const existingMinIndex: number = this.messages.length > 0 ? this.messages[0].index : -1;
            const dedupedMessages: ChatMessage[] = [];

            for (let i: number = 0; i < result.messages.length; i++) {
                if (result.messages[i].index < existingMinIndex) {
                    dedupedMessages.push(result.messages[i]);
                }
            }

            if (dedupedMessages.length === 0) {
                this.hasMoreMessages = false;
                this.loadingMoreMessages = false;
                return;
            }

            const insertedCount: number = dedupedMessages.length;
            const insertedItems: ChatRenderItem[] = this.buildItems(dedupedMessages);
            this.messages = [...dedupedMessages, ...this.messages];
            this.itemSource.prependItems(insertedItems);
            this.rebuildItemIndex();
            this.hasMoreMessages = result.hasMoreBefore;
            this.oldestLoadedIndex = result.startIndex;

            // 前插会改变所有旧消息的数组下标；先按偏移修正活动轮次，
            // 避免指示器在旧轮次与新轮次之间出现双高亮
            const preservedCenter: number = centerBeforeLoad + insertedItems.length;

            if (centerBeforeLoad >= 0 && preservedCenter < this.turnIndexByItem.length) {
                this.activeTurnIndex = this.computeActiveTurn(preservedCenter);
            }

            hilog.info(DOMAIN, TAG, '[history] prepend add=%{public}d size=%{public}d',
                insertedCount, this.messages.length);

            // 前插落地后的静默期：视口的估算修正会在随后 1~2 秒内多次甩动，
            // 甩动路过索引 0 若被当成触顶就会连锁前插，这里先把分页入口关掉
            this.prependGuardUntil = Date.now() + PREPEND_PAGINATION_HOLD;
            this.topStreak = 0;

            // 释放加载锁：可见位置由 List 属性保持，不再需要等定位回调
            this.loadingMoreMessages = false;
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
            this.itemSource.appendItems(this.buildItems([userMessage, assistantMessage]));
            this.rebuildItemIndex();
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

        this.scrollToEnd('send', true);

        chatStream.start(this.conversationId, {
            message: text,
            conversationId: this.conversationId.length > 0 ? this.conversationId : undefined,
            modelName: this.app.selectedModelName.length > 0 ? this.app.selectedModelName : undefined,
            enableThinking: this.app.enableThinking,
            enableWebSearch: this.app.enableWebSearch,
            enableTools: true,
            toolMode: this.app.forceTools ? 'force' : 'auto_off'
        } as StreamOptions, this.listenerFor(assistantMessage));
    }

    // 重新生成：通过后端 is_regenerate 机制覆盖目标回答（自动保存旧版本）。
    // 不截断消息列表、不新增用户消息，直接清空目标 assistant 消息并锁定流式更新该消息。
    // 接收 ChatMessage（由 ChatItemRow 的 onRegenerate 回调传入），通过 uid 查找索引
    private regenerate(targetMessage: ChatMessage): void {
        // 页面标志与传输层锁是两条独立状态链：页面可能已收到 done，
        // 但传输层还在等待 dataEnd；反过来也可能是旧页面标志残留。
        // 以真实会话锁裁决是否能重答，避免清空消息后才发现请求被静默拒绝。
        const clientStreaming: boolean = chatStream.isStreamingFor(this.conversationId);

        if (clientStreaming) {
            hilog.warn(DOMAIN, TAG, '[regenerate] skipped: client stream active conv=%{public}s',
                this.conversationId);
            return;
        }

        if (this.streaming) {
            hilog.warn(DOMAIN, TAG, '[regenerate] corrected stale page streaming flag');
            this.streaming = false;
        }

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
        target.usage = null;
        target.errorMessage = '';
        target.streaming = true;
        target.thinkingExpanded = true;
        this.messages = [...this.messages];
        this.itemSource.refreshMessage(target);
        // 清空目标消息会改变它的单元数：其后所有单元下标整体位移，映射必须跟着重建
        this.rebuildItemIndex();

        this.streaming = true;
        this.lastContentLog = -1;
        this.lastReasoningLog = -1;

        // 滚动到目标消息位置，让用户看到正在重答的消息
        const itemIndex: number = this.itemSource.startIndexOf(target.uid);

        if (itemIndex >= 0) {
            // 程序滚动会路过索引 0：触顶分页由时间戳统一挡掉，不能让它启动历史前插
            this.paginationBlockedUntil = Date.now() + JUMP_PAGINATION_HOLD;
            this.scroller.scrollToIndex(itemIndex, true, ScrollAlign.CENTER);
        }

        chatStream.start(this.conversationId, {
            message: question,
            conversationId: this.conversationId,
            modelName: this.app.selectedModelName.length > 0 ? this.app.selectedModelName : undefined,
            enableThinking: this.app.enableThinking,
            enableWebSearch: this.app.enableWebSearch,
            enableTools: true,
            toolMode: this.app.forceTools ? 'force' : 'auto_off',
            isRegenerate: true,
            regenerateIndex: target.index
        } as StreamOptions, this.listenerFor(target));
    }

    // 打开历史会话：原地替换会话状态并载入历史，不做导航压栈
    private openConversation(conversationId: string, convTitle: string): void {
        if (this.streaming) {
            this.stopStreaming();
        }

        this.conversationId = conversationId;
        this.streamUserScrolled = false;
        this.streamFollowPending = false;
        this.stopBottomLoop();
        this.title = convTitle.length > 0 ? convTitle : '新对话';
        this.replaceMessages([]);
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
        this.streamUserScrolled = false;
        this.streamFollowPending = false;
        this.stopBottomLoop();
        this.title = '新对话';
        this.replaceMessages([]);
        this.loadError = '';
        this.hasMoreMessages = false;
        this.oldestLoadedIndex = 0;
        this.activatedActionId = '';
        this.closeSidebar();
    }

    private stopStreaming(): void {
        if (chatStream.isStreaming) {
            chatStream.cancel();
            return;
        }

        // 传输层已结束但页面状态尚未收到终止回调时，不能留下不可操作的停止按钮。
        // 同步结束仍标记为 streaming 的消息行，避免下一次发送继续复用圆点占位。
        if (!this.streaming) {
            return;
        }

        for (let i: number = 0; i < this.messages.length; i++) {
            if (this.messages[i].streaming) {
                this.messages[i].finish();
                this.itemSource.refreshMessage(this.messages[i]);
            }
        }

        this.streaming = false;
        this.stopBottomLoop();
        LiveViewController.shared.stop();
    }

    // 滚动到底：history / send / button / stream-follow 等入口统一走这里，
    // reason 用于把「视口被强行拉回底部」当场归因到具体链路
    private scrollToEnd(reason: string, resumeStreamFollow: boolean = false): void {
        if (this.itemSource.totalCount() === 0) {
            return;
        }

        hilog.info(DOMAIN, TAG, '[bottom] request reason=%{public}s total=%{public}d visible=%{public}d-%{public}d',
            reason, this.itemSource.totalCount(), this.visibleStartIndex, this.visibleEndIndex);

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
    // 每次调用都会让引擎补测沿途行高，逐次校验重试即可逼近真实底部
    private runBottomStep(): void {
        if (this.itemSource.totalCount() === 0) {
            this.stopBottomLoop();
            return;
        }

        this.bottomAttempts++;
        this.paginationBlockedUntil = Date.now() + JUMP_PAGINATION_HOLD;
        this.scroller.scrollEdge(Edge.Bottom);
        const attempt: number = this.bottomAttempts;

        setTimeout(() => {
            if (!this.bottomLoopActive || attempt !== this.bottomAttempts) {
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

    // 以可见区域索引为基准读取用户轮次索引：查 rebuildItemIndex 建立的表，
    // 滚动回调只读 O(1) 结果，不再每帧扫描整段历史
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

    // 指定轮次里用户消息的首个单元下标：轮次跳转以「该轮用户消息的第一行」为目标
    private firstItemOfTurn(turnIndex: number): number {
        let seen: number = -1;

        for (let i: number = 0; i < this.messages.length; i++) {
            if (this.messages[i].isUser) {
                seen++;

                if (seen === turnIndex) {
                    return i < this.messageStartByMessage.length ? this.messageStartByMessage[i] : -1;
                }
            }
        }

        return -1;
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

    // 跳转到指定轮次：滚动使目标用户消息居中，并临时高亮。
    // 目标下标查 rebuildItemIndex 建立的表，不再整表扫描
    private jumpToTurn(turnIndex: number): void {
        const itemIndex: number = this.firstItemOfTurn(turnIndex);

        if (itemIndex < 0) {
            return;
        }

        // 程序滚动会路过索引 0：触顶分页由时间戳统一挡掉，不能让它启动历史前插
        this.paginationBlockedUntil = Date.now() + JUMP_PAGINATION_HOLD;
        this.scroller.scrollToIndex(itemIndex, true, ScrollAlign.CENTER);
        this.highlightMessage(itemIndex);
    }

    // 临时高亮指定消息的所有渲染单元：设置 highlighted 字段后 3 秒自动清除。
    // index 是渲染单元索引，需找到同一条消息的所有单元一起高亮
    private highlightMessage(index: number): void {
        const items: ChatRenderItem[] = this.itemSource.snapshot();

        if (index < 0 || index >= items.length) {
            return;
        }

        const targetUid: string = items[index].message.uid;
        // 代次 +1：连续跳转时，旧定时器不得清掉新目标的高亮
        this.highlightToken++;
        const token: number = this.highlightToken;

        for (let i: number = 0; i < items.length; i++) {
            if (items[i].message.uid === targetUid) {
                items[i].highlighted = true;
            }
        }

        setTimeout(() => {
            if (token !== this.highlightToken) {
                return;
            }

            for (let i: number = 0; i < items.length; i++) {
                if (items[i].message.uid === targetUid) {
                    items[i].highlighted = false;
                }
            }
        }, HIGHLIGHT_DURATION);
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
        const onUi = (action: () => void, reloadMessage: boolean = false): void => {
            setTimeout(() => {
                action();

                // 本帧改动的消息字段同步给列表数据源：
                // 原地改写受影响的单元，列表不重建，只有真正变化的那一行重渲染
                if (reloadMessage) {
                    this.itemSource.reloadMessage(assistant);
                } else {
                    this.itemSource.refreshMessage(assistant);
                }
            }, 0);
        };

        // 同一帧内到达的多个增量合并成一次落地：每条 SSE 增量各自重跑一遍 markdown
        // 解析与单元重建，字符级流式下足以把主线程一直钉在高负载上
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
                this.scheduleStreamFollowToBottom();

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
                    this.conversationId = conversationId;
                    hilog.info(DOMAIN, TAG, 'conversation bound: %{public}s', conversationId);
                    // 会话已建立：立即本地占位 + 刷新一次列表，让新会话在回复途中就出现在侧栏并可高亮
                    this.app.ensureConversationVisible(conversationId, this.firstQuestionHint());
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
                    this.scheduleStreamFollowToBottom();
                });
            },
            onToolResult: (name: string, callId: string, payload: ToolResultPayload, round: number) => {
                onUi(() => {
                    flushDeltaNow();
                    assistant.completeToolCall(callId, payload);

                    // 工具结果卡是本轮最后输出时后面不再有正文增量，这里必须自己补一次贴底，
                    // 否则结果块（含图片画廊）会停在视口下方
                    this.scrollToEndAfterLayout();
                });
            },
            onQuestion: (callId: string, payload: Object | null, round: number) => {
                onUi(() => {
                    flushDeltaNow();
                    assistant.beginQuestion(callId, payload);

                    // 选择题卡通常是本轮最后一块输出：挂载当帧还没有真实高度，同步滚动会漏底
                    this.scrollToEndAfterLayout();
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
                    this.streaming = false;
                    LiveViewController.shared.stop();
                }, true);
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
                    this.streaming = false;
                    this.deriveTitle();
                    this.app.updatePendingConversation(this.conversationId, this.title);
                    this.scheduleListRefresh();
                    // 正常完成：胶囊改"回复完成"保留 5 秒后自动关闭
                    LiveViewController.shared.finishGenerating();
                }, true);
            },
            onAborted: () => {
                onUi(() => {
                    flushDeltaNow();
                    assistant.finish();
                    this.streaming = false;
                    this.deriveTitle();
                    this.app.updatePendingConversation(this.conversationId, this.title);
                    this.scheduleListRefresh();
                    LiveViewController.shared.stop();
                }, true);
            }
        };
    }

    // ---------- 滚动仲裁 ----------
    // 程序滚动（定位 / 触底 / 回底）与前插静默期内屏蔽触顶分页：
    // 定位经过索引 0、前插后的估算修正甩动都会让视口「停在顶部」，
    // 不挡掉就会连锁前插 → 连锁修正 → 滑动动量被反复打断。
    // 用时间戳而不是布尔开关：异常路径漏复位会让分页永久锁死，时间戳能自愈
    private isPaginationBlocked(): boolean {
        const now: number = Date.now();

        return now < this.paginationBlockedUntil || now < this.prependGuardUntil;
    }

    // 滚动索引回调可能在同一帧触发多次，只保留最后一次结果并推迟到下一帧统一应用。
    // 每帧无条件写 @State 会让整页（含侧栏层与轮次面板）重跑一遍 build
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
            this.applyScrollIndex(this.pendingScrollStart, this.pendingScrollEnd, this.pendingScrollCenter);
        }));
    }

    // 诊断探针：打印列表当前可见的单元键（每秒最多一次）。完成即删
    private dumpVisibleKeys(start: number, end: number): void {
        const now: number = Date.now();

        if (now - this.lastVisibleDumpAt < 1000) {
            return;
        }

        this.lastVisibleDumpAt = now;

        const snap: ChatRenderItem[] = this.itemSource.snapshot();
        const keys: string[] = [];

        for (let i: number = start; i <= end && i < snap.length; i++) {
            let t: string = snap[i].renderText().split('\n').join(' ');

            if (t.length > 12) {
                t = t.substring(0, 12);
            }

            keys.push(i + '=' + snap[i].key() + '"' + t + '"');
        }

        hilog.info(DOMAIN, TAG, '[vis] n=%{public}d start=%{public}d end=%{public}d %{public}s',
            snap.length, start, end, keys.join(' '));
    }

    // 应用一帧内最后一次滚动索引：底部按钮看 end，轮次指示器看 center（查表 O(1)）。
    // 两个 @State 都只在值真正变化时才写
    private applyScrollIndex(start: number, end: number, center: number): void {
        const startedAt: number = Date.now();
        this.visibleStartIndex = start;
        this.visibleEndIndex = end;
        this.dumpVisibleKeys(start, end);

        const nextShowScrollBottom: boolean = end < this.itemSource.totalCount() - 1;

        if (this.showScrollBottom !== nextShowScrollBottom) {
            this.showScrollBottom = nextShowScrollBottom;
        }

        if (center >= 0 && center < this.turnIndexByItem.length) {
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

        // 触顶分页必须先确认「用户真的停在顶部」：
        // 前插的估算修正会让视口单帧路过索引 0，一帧就触发会连锁前插
        if (start <= 0) {
            this.topStreak++;
        } else {
            this.topStreak = 0;
        }

        if (this.topStreak >= TOP_TRIGGER_STREAK && !this.isPaginationBlocked()) {
            this.loadMoreMessages();
        }

        const cost: number = Date.now() - startedAt;

        if (cost > this.maxScrollIndexCost) {
            this.maxScrollIndexCost = cost;
        }
    }

    // 帧间隔探针：滑动期间只累加，不在帧内打印（日志本身会成为滚动开销）。
    // js 有值 → 掉帧来自 JS 侧（滚动回调里的处理）；js≈0 而间隔大 → 掉帧在渲染引擎
    // 由列表实测宽度下发可用文本宽度（扣掉行容器左右 padding）
    private applyContentWidth(listWidth: number): void {
        if (listWidth <= 0) {
            return;
        }

        const contentWidth: number = listWidth - Space.lg * 2;

        // 已冻结：这里只核对、不改写。改写会让同一 key 切出不同文本，就是串台本身
        if (ChatItemBuilder.isContentWidthLocked()) {
            if (!this.widthLockWarned && Math.abs(contentWidth - ChatItemBuilder.currentContentWidth()) > 1) {
                this.widthLockWarned = true;
                hilog.warn(DOMAIN, TAG, '[width] locked slice=%{public}d list=%{public}d delta=%{public}d',
                    Math.round(ChatItemBuilder.currentContentWidth()), Math.round(contentWidth),
                    Math.round(contentWidth - ChatItemBuilder.currentContentWidth()));
            }

            return;
        }

        if (Math.abs(contentWidth - this.measuredContentWidth) < 1) {
            return;
        }

        this.measuredContentWidth = contentWidth;
        ChatItemBuilder.setContentWidth(contentWidth);
        hilog.info(DOMAIN, TAG, '[width] list=%{public}d content=%{public}d',
            Math.round(listWidth), Math.round(contentWidth));
    }

    // 构建前播种切片宽度。列表横向铺满，宽度等于屏宽，据此推出可用文本宽度。
    // 播种值只是初值：第一次 build 之前仍允许被列表实测值覆盖；
    // 一旦 build 发生即冻结。取不到显示信息时保持缺省值 —— 口径会偏小，但始终一致
    private seedContentWidth(): void {
        try {
            const screenVp: number = px2vp(display.getDefaultDisplaySync().width);
            const contentWidth: number = screenVp - Space.lg * 2;

            // 区间护栏：手机可用文本宽度落在 200~600vp。取不到合理值就保留缺省值 ——
            // 口径会偏小，但始终一致；宁可多一行也不要按错误宽度定型
            if (contentWidth > 200 && contentWidth < 600) {
                this.measuredContentWidth = contentWidth;
                ChatItemBuilder.setContentWidth(contentWidth);
                hilog.info(DOMAIN, TAG, '[width] seed screen=%{public}d content=%{public}d',
                    Math.round(screenVp), Math.round(contentWidth));
            }
        } catch (err) {
            hilog.warn(DOMAIN, TAG, '[width] seed failed, keep fallback');
        }
    }

    private probeScrollFrame(offset: number): void {
        const now: number = Date.now();
        const gap: number = this.lastScrollFrameAt > 0 ? now - this.lastScrollFrameAt : 0;

        if (gap > 0) {
            if (this.frameGaps.length >= SCROLL_GAP_SAMPLE_CAP) {
                this.frameGaps.shift();
            }

            this.frameGaps.push(gap);
        }

        this.lastScrollFrameAt = now;
        // 本帧要求位移：交给 probeScrollOffset 算补偿量。
        // 累加而非覆盖 —— 同一帧内该回调可能触发多次
        this.pendingIntendedOffset += offset;
        this.intendedFrameSeen = true;
    }

    // 位置跳变探针：本帧实际位移 - 本帧要求位移 = 引擎为修正行高估算注入的补偿量，
    // 也就是手指底下感觉到的「跳变」。索引级 telemetry 看不见它 ——
    // center 单调推进时，内容照样能在视口内整体瞬移。
    // jerk（本帧位移 - 上帧位移）另记一路：它衡量位移本身忽快忽慢，与引擎修正无关
    private probeScrollOffset(offset: number, state: ScrollState): void {
        const applied: number = offset;
        const intended: number = this.pendingIntendedOffset;
        const hasIntended: boolean = this.intendedFrameSeen;
        const jerk: number = this.scrollOffsetPrimed ? applied - this.lastFrameDelta : 0;

        this.pendingIntendedOffset = 0;
        this.intendedFrameSeen = false;
        this.lastFrameDelta = applied;

        if (!this.scrollOffsetPrimed) {
            this.scrollOffsetPrimed = true;
            return;
        }

        this.jumpFrames++;

        if (Math.abs(jerk) > this.jerkMaxAbs) {
            this.jerkMaxAbs = Math.abs(jerk);
        }

        if (Math.abs(jerk) >= JUMP_MIN_VP) {
            this.jerkTotal++;
        }

        if (!hasIntended) {
            return;
        }

        const correction: number = applied - intended;

        if (Math.abs(correction) < JUMP_MIN_VP) {
            return;
        }

        this.jumpTotal++;

        if (Math.abs(correction) > this.jumpMaxAbs) {
            this.jumpMaxAbs = Math.abs(correction);
        }

        const now: number = Date.now();

        if (now - this.lastJumpLogAt < JUMP_LOG_INTERVAL) {
            return;
        }

        this.lastJumpLogAt = now;

        // prog=1 表示此刻有程序滚动在途（贴底收敛循环），它的位移本就没有手势对应，属预期噪声
        hilog.info(DOMAIN, TAG,
            '[scroll] jump corr=%{public}d applied=%{public}d intended=%{public}d jerk=%{public}d state=%{public}d vis=%{public}d-%{public}d prog=%{public}d',
            Math.round(correction), Math.round(applied), Math.round(intended),
            Math.round(jerk), state, this.visibleStartIndex, this.visibleEndIndex,
            this.bottomLoopActive ? 1 : 0);
    }

    // 跳变汇总：frames 为样本数，用于确认 onDidScroll 真的在回调（为 0 说明跨平台未实现）
    private reportJumpStats(): void {
        if (this.jumpFrames === 0) {
            return;
        }

        hilog.info(DOMAIN, TAG,
            '[scroll] jumpstat frames=%{public}d jumps=%{public}d maxAbs=%{public}d vjit=%{public}d vjitMax=%{public}d',
            this.jumpFrames, this.jumpTotal, Math.round(this.jumpMaxAbs),
            this.jerkTotal, Math.round(this.jerkMaxAbs));

        this.jumpFrames = 0;
        this.jumpTotal = 0;
        this.jumpMaxAbs = 0;
        this.jerkTotal = 0;
        this.jerkMaxAbs = 0;
    }

    // 手势结束汇总帧间隔分布。判读方式：
    // p50 ≈ 8ms（120Hz）或 ≈17ms（60Hz）说明帧率本身是够的，掉帧只是分布尾部的少量顿挫；
    // p50 明显高于该值才是真的帧率不足。gt* 是各档累计条数，用于区分「偶发长帧」与「普遍偏慢」
    private reportScrollStats(): void {
        const samples: number[] = this.frameGaps;
        this.frameGaps = [];

        if (samples.length < 2) {
            return;
        }

        samples.sort((a: number, b: number): number => a - b);

        let sum: number = 0;
        let gt9: number = 0;
        let gt13: number = 0;
        let gt17: number = 0;
        let gt25: number = 0;
        let gt40: number = 0;

        for (let i: number = 0; i < samples.length; i++) {
            const gap: number = samples[i];
            sum += gap;

            if (gap > 9) {
                gt9++;
            }

            if (gap > 13) {
                gt13++;
            }

            if (gap > 17) {
                gt17++;
            }

            if (gap > 25) {
                gt25++;
            }

            if (gap > 40) {
                gt40++;
            }
        }

        hilog.info(DOMAIN, TAG,
            '[scroll] stat n=%{public}d avg=%{public}d p50=%{public}d p95=%{public}d max=%{public}d gt9=%{public}d gt13=%{public}d gt17=%{public}d gt25=%{public}d gt40=%{public}d',
            samples.length,
            Math.round(sum / samples.length),
            samples[Math.floor(samples.length / 2)],
            samples[Math.floor(samples.length * 95 / 100)],
            samples[samples.length - 1],
            gt9, gt13, gt17, gt25, gt40);

        const rowCost: string = ChatItemBuilder.takeRowCost();

        if (rowCost.length > 0) {
            hilog.info(DOMAIN, TAG, '[row] cost %{public}s', rowCost);
        }
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

    // 把同一帧内到达的多个正文增量合并为一次贴底，避免滚动控制 API 与手势连续竞争。
    // 用户已接管滚动（或已离开底部）时直接放弃跟手，绝不把视口拽回末条
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

    // 独立区块（工具结果卡 / 选择题卡 / 图片画廊）贴底：这些块挂载当帧 List 还没为它排版，
    // 同步滚动会停在旧底部。推迟一帧，等真实高度参与排版后再滚
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
