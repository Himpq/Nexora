// Index.ets - 应用宿主入口
// 启动时恢复持久化状态并校验会话，据此在「登录页」与「主对话页」间切换
// 主界面是豆包式单页结构：登录后直挂 MainChat，对话界面即主页，侧栏抽屉 / 弹层全由 MainChat 内部管理

import { common } from '@kit.AbilityKit';
import { AppState } from '../common/AppState';
import { chatStream } from '../common/ChatStreamClient';
import { Size, Space } from '../common/DesignToken';
import { BrandLogo } from '../components/common/BrandLogo';
import { LoginPage } from './LoginPage';
import { MainChat } from './MainChat';
import { LearningSystemEntry } from '../common/LearningSystemEntry';

@Entry
@Component
struct Index {
    @State private app: AppState = AppState.shared;
    @State private ready: boolean = false;
    @State private loggedIn: boolean = false;

    // 沉浸式布局下系统不再替页面避让状态栏，避让高度由 EntryAbility 量好下发。
    // 这里是应用唯一根节点，顶部垫付一次即对全部页面生效，业务页面无需各自处理。
    @StorageProp('insetTop') private insetTop: number = 0;

    aboutToAppear(): void {
        this.bootstrap();
    }

    // 系统返回键：委托给 MainChat 注入的 backHandler（侧边栏→收起，弹层→关闭，对话→新对话）
    onBackPress(): boolean {
        if (this.app.backHandler !== null) {
            return this.app.backHandler();
        }

        return false;
    }

    // 启动链路：恢复本地状态 → 校验会话有效性 → 决定进入登录还是主界面
    private async bootstrap(): Promise<void> {
        AppStorage.setOrCreate('nxSessionReady', false);
        const host = this.getUIContext().getHostContext();

        if (host !== undefined) {
            await this.app.restore(host as common.UIAbilityContext);
        }

        this.loggedIn = await this.app.validateSession();
        AppStorage.setOrCreate('nxSessionReady', this.loggedIn);
        if (!this.loggedIn && host !== undefined) {
            LearningSystemEntry.clear(host);
        }
        this.ready = true;
    }

    build() {
        Stack() {
            if (!this.ready) {
                this.Splash();
            } else if (!this.loggedIn) {
                LoginPage({
                    app: this.app,
                    onLoggedIn: () => {
                        this.enterHome();
                    }
                });
            } else {
                // 单一主页：对话界面即主页，登出回调由宿主执行
                MainChat({
                    app: this.app,
                    onSignOut: () => {
                        this.handleSignOut();
                    }
                });
            }
        }
        .width('100%')
        .height('100%')
        // 顶部让出状态栏；底部不再让出，页面一路铺到物理屏底（手势区由页面底色接管）
        .padding({ top: this.insetTop })
        .background($r('app.color.bg_page'));
    }

    // 登录成功进入主界面，主页 aboutToAppear 自行拉取模型与会话
    private enterHome(): void {
        AppStorage.setOrCreate('nxSessionReady', true);
        this.loggedIn = true;
    }

    // 登出：停掉可能的生成流、清空会话数据后切回登录页
    private async handleSignOut(): Promise<void> {
        AppStorage.setOrCreate('nxSessionReady', false);
        AppStorage.setOrCreate('nxLaunchRoute', '');
        AppStorage.setOrCreate('nxLaunchDecision', '');
        AppStorage.setOrCreate('nxPendingReviewTask', '');
        const host = this.getUIContext().getHostContext();
        if (host !== undefined) {
            LearningSystemEntry.clear(host);
        }
        if (chatStream.isStreaming) {
            chatStream.cancel();
        }

        await this.app.signOut();
        this.loggedIn = false;
    }

    // 启动屏：品牌标识 + 加载指示
    @Builder
    Splash() {
        Column({ space: Space.xl }) {
            BrandLogo({ diameter: 72 });

            LoadingProgress()
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .color($r('app.color.brand_primary'));
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center);
    }
}
