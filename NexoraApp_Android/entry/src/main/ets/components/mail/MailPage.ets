// MailPage.ets - 邮件页（MainChat 全屏覆盖层）
// 收件箱 / 已发送双视图 + 列表 + 页内详情二级态；列表/切箱/已读状态挂在 AppState，
// 详情为一次性读取，由本组件直接经 ApiService 拉取（与 KnowledgeEditorSheet 同策略，不进全局状态）
// 详情态开关由宿主 @Link 持有：系统返回键在宿主 handleBackPress 先退详情再退页面
// 正文渲染：HTML 邮件用 Web 组件加载（禁脚本），纯文本邮件用 Text 直出

import { hilog } from '@kit.PerformanceAnalysisKit';
import { webview } from '@kit.ArkWeb';
import { AppState } from '../../common/AppState';
import { ApiService, MailDetailResult } from '../../common/ApiService';
import { MailDetail, MailItem } from '../../common/AppConfig';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMail';

@Component
export struct MailPage {
    @ObjectLink app: AppState;
    // 详情态开关（宿主持有，双向）：返回键优先级由宿主统一编排
    @Link @Watch('onDetailOpenChanged') mailDetailOpen: boolean;
    onBack: () => void = () => {};

    // 沉浸式布局下页面铺到物理屏底，列表末尾要让出一次手势区，否则最后一条永远差一截
    @StorageProp('insetBottom') private insetBottom: number = 0;

    @State private detail: MailDetail | null = null;
    @State private detailLoading: boolean = false;
    @State private detailError: string = '';
    // 搜索框草稿：onChange 实时记录，回车提交（触发带 q 参数的服务端搜索）
    @State private searchDraft: string = '';
    // 当前打开详情的邮件来源箱：详情元信息行与已读标记都按它判定（切换器仅在列表态可见，不会中途变化）
    private openBox: string = 'inbox';
    // 详情打开前的列表滚动位置：详情态会销毁列表分支，返回重建后由 onAppear 恢复，避免浏览位置丢回顶部
    private listRestoreOffset: number = 0;
    // Web 组件控制器：WebOptions 必填项（正文经 src 声明式加载，控制器仅作挂载与后续扩展操作入口）
    private webController: webview.WebviewController = new webview.WebviewController();
    private listScroller: Scroller = new Scroller();

    build() {
        Column() {
            this.TopBar();

            // 列表态与详情态互斥切换：详情从右侧滑入，列表淡出（页内二级导航）
            if (this.mailDetailOpen) {
                Column() {
                    this.DetailArea();
                }
                .width('100%')
                .layoutWeight(1)
                .transition(TransitionEffect.asymmetric(
                    TransitionEffect.translate({ x: '100%' }).combine(TransitionEffect.OPACITY),
                    TransitionEffect.OPACITY
                ).animation({ duration: Motion.durationBase, curve: Motion.easeInOut }));
            } else {
                Column() {
                    this.BoxSwitcher();

                    this.SearchBar();

                    if (this.app.mailError.length > 0) {
                        this.ErrorHint();
                    } else if (this.app.mailList.length === 0 && this.app.mailLoading) {
                        this.LoadingHint();
                    } else if (this.app.mailList.length === 0) {
                        this.EmptyHint();
                    } else {
                        List({ scroller: this.listScroller, space: 1 }) {
                            ForEach(this.app.mailList, (item: MailItem) => {
                                ListItem() {
                                    this.MailRow(item);
                                }
                            }, (item: MailItem) => item.box + '_' + item.id);
                        }
                        .layoutWeight(1)
                        .width('100%')
                        .edgeEffect(EdgeEffect.Spring)
                        .scrollBar(BarState.Off)
                        .padding({ left: Space.md, right: Space.md })
                        // 手势区避让同样走 contentEndOffset：写在 padding 上就是一条永远空着的死带
                        .contentEndOffset(Space.lg + this.insetBottom)
                        .onAppear(() => {
                            // 列表重建（详情返回）后恢复浏览位置：详情打开前保存的偏移只消费一次
                            if (this.listRestoreOffset > 0) {
                                this.listScroller.scrollTo({ xOffset: 0, yOffset: this.listRestoreOffset });
                                this.listRestoreOffset = 0;
                            }
                        });
                    }
                }
                .width('100%')
                .layoutWeight(1)
                .transition(TransitionEffect.OPACITY.animation({ duration: Motion.durationBase, curve: Motion.easeOut }));
            }
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    // ---------- 区域 ----------

    // 顶栏：返回（详情态先退详情，列表态退页面）+ 标题 + 刷新（仅列表态）
    @Builder
    TopBar() {
        Row({ space: Space.xs }) {
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.icon,
                buttonSize: Size.touchTarget,
                onTap: () => {
                    if (this.mailDetailOpen) {
                        this.mailDetailOpen = false;
                        return;
                    }

                    this.onBack();
                }
            });

            Text(this.titleText())
                .fontSize(FontSize.title)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis });

            Blank()
                .layoutWeight(1);

            if (!this.mailDetailOpen) {
                IconButton({
                    icon: $r('app.media.ic_refresh'),
                    iconSize: Size.icon,
                    buttonSize: Size.touchTarget,
                    onTap: () => {
                        this.app.refreshMailList();
                    }
                });
            }
        }
        .width('100%')
        .padding({ left: Space.xs, right: Space.xs, top: Space.sm, bottom: Space.sm });
    }

    // 箱体切换：收件箱 / 已发送，浅色选中底随状态滑动（与侧栏 ViewSwitcher 同一交互语言）
    @Builder
    BoxSwitcher() {
        Stack({ alignContent: Alignment.TopStart }) {
            Column()
                .width('50%')
                .height(36)
                .borderRadius(Radius.md)
                .backgroundColor($r('app.color.brand_soft'))
                .translate({ x: this.app.mailBox === 'inbox' ? '0%' : '100%' })
                .animation({ duration: Motion.durationBase, curve: Motion.easeOut });

            Row() {
                Text('收件箱')
                    .fontSize(FontSize.body)
                    .fontWeight(this.app.mailBox === 'inbox' ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(this.app.mailBox === 'inbox' ? $r('app.color.text_primary') : $r('app.color.text_secondary'))
                    .layoutWeight(1)
                    .textAlign(TextAlign.Center)
                    .onClick(() => {
                        // 切箱清空搜索草稿：搜索词与箱绑定，AppState.setMailBox 内部同步清 mailQuery
                        this.searchDraft = '';
                        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                            this.app.setMailBox('inbox');
                        });
                    });

                Text('已发送')
                    .fontSize(FontSize.body)
                    .fontWeight(this.app.mailBox === 'sent' ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(this.app.mailBox === 'sent' ? $r('app.color.text_primary') : $r('app.color.text_secondary'))
                    .layoutWeight(1)
                    .textAlign(TextAlign.Center)
                    .onClick(() => {
                        this.searchDraft = '';
                        animateTo({ duration: Motion.durationBase, curve: Motion.easeOut }, () => {
                            this.app.setMailBox('sent');
                        });
                    });
            }
            .width('100%')
            .height(36);
        }
        .width('100%')
        .height(36)
        .padding({ left: Space.lg, right: Space.lg });
    }

    // 搜索框：回车提交触发服务端 q 搜索，有内容时提供一键清除
    @Builder
    SearchBar() {
        Row({ space: Space.sm }) {
            Image($r('app.media.ic_search'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.icon_secondary'));

            TextInput({ placeholder: '搜索邮件', text: this.searchDraft })
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_primary'))
                .placeholderColor($r('app.color.text_tertiary'))
                .backgroundColor(Color.Transparent)
                .padding({ left: 0, right: 0 })
                .layoutWeight(1)
                .height(36)
                .onChange((value: string) => {
                    this.searchDraft = value;
                })
                .onSubmit(() => {
                    this.app.setMailQuery(this.searchDraft);
                });

            if (this.searchDraft.length > 0) {
                IconButton({
                    icon: $r('app.media.ic_close'),
                    iconSize: 14,
                    buttonSize: 28,
                    onTap: () => {
                        this.searchDraft = '';
                        this.app.setMailQuery('');
                    }
                });
            }
        }
        .width('100%')
        .height(40)
        .padding({ left: Space.md, right: Space.xs })
        .backgroundColor($r('app.color.bg_sunken'))
        .borderRadius(Radius.sm)
        .margin({ left: Space.lg, right: Space.lg, bottom: Space.xs });
    }

    // 邮件行：未读点 + 主题（未读加粗）+「发件人/收件人 · 时间」二级行，行高固定 56 保证列表布局确定
    // Column 需显式左对齐：默认居中会让自适应宽度的二级行缩进到中间
    @Builder
    MailRow(item: MailItem) {
        Column({ space: Space.xxs }) {
            Row({ space: Space.xs }) {
                if (item.unread) {
                    Circle()
                        .width(7)
                        .height(7)
                        .fill($r('app.color.brand_primary'));
                }

                Text(item.subject)
                    .fontSize(FontSize.body)
                    .fontWeight(item.unread ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor($r('app.color.text_primary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1);
            }
            .width('100%');

            Text(item.peer + ' · ' + item.time)
                .fontSize(FontSize.caption)
                .lineHeight(LineHeight.caption)
                .fontColor($r('app.color.text_tertiary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis });
        }
        .width('100%')
        .height(56)
        .alignItems(HorizontalAlign.Start)
        .justifyContent(FlexAlign.Center)
        .padding({ left: Space.lg, right: Space.md })
        .borderRadius(Radius.md)
        .onClick(() => {
            this.openMail(item);
        });
    }

    // 详情区：主题 + 收发件人元信息 + 正文滚动区；进入即拉取，载入/错误/正文三态
    @Builder
    DetailArea() {
        if (this.detailLoading) {
            Column() {
                LoadingProgress()
                    .width(32)
                    .height(32)
                    .color($r('app.color.brand_primary'));
            }
            .width('100%')
            .layoutWeight(1)
            .justifyContent(FlexAlign.Center);
        } else if (this.detailError.length > 0) {
            Column({ space: Space.sm }) {
                Image($r('app.media.ic_error'))
                    .width(Size.iconLarge)
                    .height(Size.iconLarge)
                    .fillColor($r('app.color.text_danger'));

                Text(this.detailError)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_danger'));
            }
            .width('100%')
            .layoutWeight(1)
            .justifyContent(FlexAlign.Center)
            .padding({ left: Space.xxl, right: Space.xxl });
        } else if (this.detail !== null) {
            Column({ space: Space.md }) {
                Text(this.detail.subject)
                    .fontSize(FontSize.bodyLarge)
                    .fontWeight(FontWeight.Bold)
                    .fontColor($r('app.color.text_primary'))
                    .width('100%');

                Text(this.detailMetaLine())
                    .fontSize(FontSize.caption)
                    .lineHeight(LineHeight.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%');

                Divider()
                    .strokeWidth(0.5)
                    .color($r('app.color.divider'));

                // 正文：HTML 邮件走 Web 渲染（保留原排版样式，禁脚本），纯文本邮件走 Text 直出
                // src 用 data: URL 声明式加载：绕开 loadData 的编码契约与 onControllerAttached 时序问题
                if (this.detail.contentHtml.length > 0) {
                    Web({ src: this.mailSourceUrl(), controller: this.webController })
                        .width('100%')
                        .layoutWeight(1)
                        .javaScriptAccess(false)
                        .backgroundColor('#FFFFFF')
                        .onPageEnd((event: OnPageEndEvent) => {
                            hilog.info(DOMAIN, TAG, '[mailWeb] page end, url head=%{public}s', event.url.substring(0, 120));
                        })
                        .onErrorReceive((event: OnErrorReceiveEvent) => {
                            hilog.error(DOMAIN, TAG, '[mailWeb] error, url=%{public}s, code=%{public}d, msg=%{public}s',
                                event.request.getRequestUrl(), event.error.getErrorCode(), event.error.getErrorInfo());
                        });
                } else {
                    Scroll() {
                        Text(this.detail.content.length > 0 ? this.detail.content : '（此邮件没有纯文本内容）')
                            .fontSize(FontSize.body)
                            .lineHeight(LineHeight.body)
                            .fontColor($r('app.color.text_primary'))
                            .copyOption(CopyOptions.InApp)
                            .width('100%');
                    }
                    .scrollBar(BarState.Off)
                    .edgeEffect(EdgeEffect.Spring)
                    .layoutWeight(1)
                    .align(Alignment.Top);
                }
            }
            .width('100%')
            .layoutWeight(1)
            .padding({ left: Space.lg, right: Space.lg, top: Space.md, bottom: Space.lg });
        }
    }

    // 邮件 HTML 包装：服务端提取的 content_html 常是缺 head 的片段，
    // 此处补 charset/viewport 并施加阅读约束（图片限宽、长词断行、内边距）；邮件正文不允许执行脚本
    private buildMailHtml(body: string): string {
        return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
            '<style>body{margin:0;padding:16px 16px 32px;color:#1F2430;font-size:15px;line-height:1.6;' +
            'word-break:break-word;}img{max-width:100%;height:auto;}table{max-width:100%;}' +
            'a{color:#4C6FFF;}</style></head><body>' + body + '</body></html>';
    }

    // 邮件正文 data URL：encodeURIComponent 保证 #/% 等保留字符不破坏 URL 结构，
    // 字符集由前缀 charset 声明（包装 HTML 内还有 <meta charset> 双保险）
    private mailSourceUrl(): string {
        if (this.detail === null) {
            return 'about:blank';
        }

        return 'data:text/html;charset=utf-8,' + encodeURIComponent(this.buildMailHtml(this.detail.contentHtml));
    }

    @Builder
    EmptyHint() {
        Column({ space: Space.sm }) {
            Image($r('app.media.ic_mail'))
                .width(Size.iconLarge)
                .height(Size.iconLarge)
                .fillColor($r('app.color.icon_secondary'));

            Text(this.emptyHintText())
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_tertiary'));
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center);
    }

    @Builder
    LoadingHint() {
        Column() {
            LoadingProgress()
                .width(32)
                .height(32)
                .color($r('app.color.brand_primary'));
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center);
    }

    @Builder
    ErrorHint() {
        Row({ space: Space.xs }) {
            Image($r('app.media.ic_error'))
                .width(Size.iconSmall)
                .height(Size.iconSmall)
                .fillColor($r('app.color.text_danger'));

            Text(this.app.mailError)
                .fontSize(FontSize.small)
                .fontColor($r('app.color.text_danger'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1);
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)
        .padding({ left: Space.lg, right: Space.lg, top: Space.sm });
    }

    // ---------- 行为 ----------

    // 空态文案：搜索无结果与空箱区分展示
    private emptyHintText(): string {
        if (this.app.mailQuery.length > 0) {
            return '没有匹配的邮件';
        }

        return this.app.mailBox === 'inbox' ? '收件箱暂无邮件' : '暂无已发送邮件';
    }

    // 顶栏标题：详情态展示主题，列表态固定「邮件」
    private titleText(): string {
        if (this.mailDetailOpen && this.detail !== null && this.detail.subject.length > 0) {
            return this.detail.subject;
        }

        return '邮件';
    }

    // 详情元信息行：按来源箱取发件人或收件人
    private detailMetaLine(): string {
        if (this.detail === null) {
            return '';
        }

        if (this.openBox === 'inbox') {
            return '发件人 ' + this.detail.sender + ' · ' + this.detail.time;
        }

        return '收件人 ' + this.detail.recipient + ' · ' + this.detail.time;
    }

    // 打开详情：先入详情态（宿主返回键即刻生效），再拉正文；收件箱未读项在拉取成功后标记已读
    private openMail(item: MailItem): void {
        // 保存浏览位置：进详情会销毁列表分支，返回时由 List.onAppear 恢复
        this.listRestoreOffset = this.listScroller.currentOffset().yOffset;
        this.detail = null;
        this.detailLoading = true;
        this.detailError = '';
        this.openBox = item.box;
        this.mailDetailOpen = true;

        ApiService.fetchMailDetail(item.box, item.id).then((result: MailDetailResult) => {
            this.detailLoading = false;

            if (!result.success || result.mail === null) {
                this.detailError = result.message;
                return;
            }

            this.detail = result.mail;

            // 诊断日志：正文两路内容的长度与 HTML 头部片段，用于白屏问题时核对服务端实际给了什么
            hilog.info(DOMAIN, TAG, '[openMail] html length=%{public}d, text length=%{public}d, html head=%{public}s',
                result.mail.contentHtml.length, result.mail.content.length, result.mail.contentHtml.substring(0, 160));

            if (item.box === 'inbox' && item.unread) {
                this.app.markMailRead(item.id);
            }
        });
    }

    // 宿主侧关闭详情（返回键）：清掉详情数据与错误态，下次打开重新拉取
    onDetailOpenChanged(): void {
        if (!this.mailDetailOpen) {
            this.detail = null;
            this.detailError = '';
            this.detailLoading = false;
        }
    }
}
