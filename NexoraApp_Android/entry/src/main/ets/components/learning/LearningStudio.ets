// LearningStudio.ets - 学习资源与学习动态
// 资源来自学习工作台产出（文章 / 视频，正文为 Markdown），动态来自学习社区；
// 两者都不是教材正文，因此独立成页，不挤占阅读入口。

import { LearningFormat } from '../../common/LearningFormat';
import {
    LearningFeedItem,
    LearningResource,
    LearningStudioApi,
    NO_RESOURCE,
} from '../../common/LearningStudioApi';
import { FontSize, LineHeight, Motion, Radius, Size, Space } from '../../common/DesignToken';
import { IconButton } from '../common/IconButton';
import { LoadingBlock, Placeholder, SectionHeader, TagPill } from './LearningWidgets';
import { MarkdownView } from './MarkdownView';

const RESOURCE_LIMIT: number = 30;
const FEED_LIMIT: number = 20;
// 正文向下滚过这个距离后，顶栏才接手显示标题（避免与正文标题同时出现两条）
const TITLE_REVEAL_OFFSET: number = 56;

@Component
export struct LearningStudio {
    onOpenArticle: (resource: LearningResource) => void = () => {};

    @State private resources: LearningResource[] = [];
    @State private feeds: LearningFeedItem[] = [];
    @State private loading: boolean = true;
    @State private errorMessage: string = '';

    aboutToAppear(): void {
        this.load().then(() => {
        });
    }

    private async load(): Promise<void> {
        this.loading = true;
        this.errorMessage = '';

        const resourceTask = LearningStudioApi.shared.getResources(RESOURCE_LIMIT);
        const feedTask = LearningStudioApi.shared.getFeeds(FEED_LIMIT);

        const resourceResult = await resourceTask;
        const feedResult = await feedTask;

        this.loading = false;

        if (!resourceResult.success && !feedResult.success) {
            this.errorMessage = resourceResult.message;
            return;
        }

        this.resources = resourceResult.resources;
        this.feeds = feedResult.items;
    }

    build() {
        Column() {
            if (this.loading) {
                LoadingBlock({ label: '正在加载学习资源' });
            } else if (this.errorMessage.length > 0 && this.resources.length === 0 && this.feeds.length === 0) {
                Placeholder({
                    icon: $r('app.media.ic_error'),
                    title: '学习资源加载失败',
                    hint: this.errorMessage,
                    actionLabel: '重新加载',
                    onAction: () => {
                        this.load().then(() => {
                        });
                    }
                });
            } else {
                List({ space: Space.md }) {
                    if (this.resources.length > 0) {
                        ListItem() {
                            SectionHeader({
                                title: '资源库',
                                subtitle: this.resources.length + ' 份产出物',
                            })
                        }

                        ForEach(this.resources, (resource: LearningResource) => {
                            ListItem() {
                                this.ResourceCard(resource)
                            }
                        }, (resource: LearningResource) => 'res_' + resource.id)
                    }

                    if (this.feeds.length > 0) {
                        ListItem() {
                            SectionHeader({
                                title: '学习动态',
                                subtitle: '学习社区里的最新讨论',
                            })
                                .margin({ top: Space.md })
                        }

                        ForEach(this.feeds, (feed: LearningFeedItem) => {
                            ListItem() {
                                this.FeedCard(feed)
                            }
                        }, (feed: LearningFeedItem) => 'feed_' + feed.id)
                    }

                    if (this.resources.length === 0 && this.feeds.length === 0) {
                        ListItem() {
                            Placeholder({
                                icon: $r('app.media.ic_spark'),
                                title: '还没有学习资源',
                                hint: '在 NexoraLearning 工作台生成学习资源后，这里会自动出现',
                            })
                        }
                    }
                }
                .layoutWeight(1)
                .width('100%')
                .scrollBar(BarState.Off)
                .padding({ left: Space.lg, right: Space.lg })
                // 纵向留白走 contentStart/EndOffset：写在 padding 上会变成裁切死带，
                // 表现为「最后一张卡与底部栏之间永远空一条」（底部空线）
                .contentStartOffset(Space.md)
                .contentEndOffset(Space.md);
            }
        }
        .width('100%')
        .height('100%');
    }

    @Builder
    ResourceCard(resource: LearningResource) {
        Column({ space: Space.sm }) {
            Row({ space: Space.sm }) {
                TagPill({
                    text: resource.resourceType.length > 0 ? resource.resourceType : '学习资源',
                    tint: $r('app.color.text_brand'),
                    bg: $r('app.color.brand_soft'),
                });

                Blank();

                Text(LearningFormat.day(resource.publishedAt))
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'));
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            Text(resource.title)
                .fontSize(FontSize.bodyLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%');

            // 摘要可能为空：没有摘要就不占位，避免列表里出现一行「点击查看完整内容」的水词
            if (resource.summary.length > 0) {
                Text(resource.summary)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .maxLines(3)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .lineHeight(20)
                    .width('100%');
            }

            Row({ space: Space.xs }) {
                Image($r('app.media.ic_book'))
                    .width(Size.iconSmall)
                    .height(Size.iconSmall)
                    .fillColor($r('app.color.icon_secondary'));

                Text(resource.lectureTitle.length > 0 ? resource.lectureTitle : '通用')
                    .fontSize(FontSize.caption)
                    .fontColor($r('app.color.text_tertiary'))
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis });
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
            this.onOpenArticle(resource);
        });
    }

    @Builder
    FeedCard(feed: LearningFeedItem) {
        Row({ space: Space.md }) {
            Stack() {
                Text(feed.authorName.length > 0 ? feed.authorName.substring(0, 1) : '学')
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.brand_text'));
            }
            .width(32)
            .height(32)
            .borderRadius(Radius.full)
            .backgroundColor($r('app.color.brand_soft'));

            Column({ space: Space.xs }) {
                Row() {
                    Text(feed.authorName.length > 0 ? feed.authorName : '匿名')
                        .fontSize(FontSize.small)
                        .fontColor($r('app.color.text_secondary'));

                    Blank();

                    Text(LearningFormat.moment(feed.timestamp))
                        .fontSize(FontSize.micro)
                        .fontColor($r('app.color.text_tertiary'));
                }
                .width('100%')
                .alignItems(VerticalAlign.Center);

                Text(feed.content)
                    .fontSize(FontSize.body)
                    .fontColor($r('app.color.text_primary'))
                    .lineHeight(LineHeight.body)
                    .width('100%');

                Text('赞 ' + feed.likesCount + ' · 评论 ' + feed.commentsCount)
                    .fontSize(FontSize.micro)
                    .fontColor($r('app.color.text_tertiary'));
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start);
        }
        .width('100%')
        .padding(Space.lg)
        .borderRadius(Radius.lg)
        .backgroundColor($r('app.color.bg_card'))
        .alignItems(VerticalAlign.Top);
    }
}

// 资源正文阅读：正文为 Markdown，渲染交给共享的 MarkdownView，
// 与「个性化章节」用的是同一份渲染（同一类内容不该有两套排版）。
@Component
export struct LearningArticle {
    @Prop resource: LearningResource = NO_RESOURCE;
    onBack: () => void = () => {};
    // 沉浸式布局下页面铺到物理屏底，正文尾部要自己让开手势区
    @StorageProp('insetBottom') private insetBottom: number = 0;
    // 顶栏标题随正文滚动淡入：正文标题就在顶栏正下方，一进来就重复显示是噪音
    @State private titleInBar: boolean = false;
    private scroller: Scroller = new Scroller();

    build() {
        Column() {
            this.TopBar()

            Scroll(this.scroller) {
                Column({ space: Space.md }) {
                    this.ArticleHeader()

                    MarkdownView({ body: this.resource.content })
                }
                .width('100%')
                .padding({ left: Space.lg, right: Space.lg, bottom: Space.xxxl + this.insetBottom })
                .alignItems(HorizontalAlign.Start);
            }
            .layoutWeight(1)
            .width('100%')
            .scrollBar(BarState.Off)
            .onScroll((xOffset: number, yOffset: number) => {
                this.titleInBar = yOffset > TITLE_REVEAL_OFFSET;
            })
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'));
    }

    @Builder
    TopBar() {
        Row({ space: Space.xs }) {
            // 尺寸由 IconButton 统一约束：直接在 Image 上挂 padding 会把图标内容区压扁
            IconButton({
                icon: $r('app.media.ic_back'),
                iconSize: Size.iconLarge,
                buttonSize: Size.touchTarget,
                tint: $r('app.color.icon_primary'),
                onTap: () => {
                    this.onBack();
                }
            })

            Text(this.resource.title)
                .fontSize(FontSize.body)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                .margin({ left: Space.xs })
                .opacity(this.titleInBar ? 1 : 0)
                .animation({ duration: Motion.durationFast, curve: Motion.easeOut })
        }
        .width('100%')
        .height(48)
        .padding({ left: Space.sm, right: Space.lg })
        .alignItems(VerticalAlign.Center)
        // 顶栏与正文之间只在滚动后划线：正文没动时这条线没有来由
        .border({ width: { bottom: this.titleInBar ? Size.divider : 0 }, color: $r('app.color.divider') })
        .animation({ duration: Motion.durationFast, curve: Motion.easeOut });
    }

    // 文章头：标题 + 类型 / 发布时间 / 所属课程 + 摘要。
    // 这些是判断「要不要读下去」的依据，必须在正文之前一次给全。
    @Builder
    ArticleHeader() {
        Column({ space: Space.sm }) {
            Text(this.resource.title)
                .fontSize(FontSize.titleLarge)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .width('100%');

            Row({ space: Space.sm }) {
                if (this.resource.resourceType.length > 0) {
                    TagPill({
                        text: this.resource.resourceType,
                        tint: $r('app.color.text_brand'),
                        bg: $r('app.color.brand_soft'),
                    });
                }

                if (this.resource.publishedAt > 0) {
                    Text(LearningFormat.day(this.resource.publishedAt))
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'));
                }

                if (this.resource.lectureTitle.length > 0) {
                    Text(this.resource.lectureTitle)
                        .fontSize(FontSize.caption)
                        .fontColor($r('app.color.text_tertiary'))
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .layoutWeight(1);
                }
            }
            .width('100%')
            .alignItems(VerticalAlign.Center);

            if (this.resource.summary.length > 0) {
                Text(this.resource.summary)
                    .fontSize(FontSize.small)
                    .fontColor($r('app.color.text_secondary'))
                    .lineHeight(LineHeight.body)
                    .padding(Space.md)
                    .borderRadius(Radius.md)
                    .backgroundColor($r('app.color.bg_sunken'))
                    .width('100%');
            }
        }
        .width('100%')
        .padding({ bottom: Space.lg })
        .border({ width: { bottom: Size.divider }, color: $r('app.color.divider') })
        .alignItems(HorizontalAlign.Start);
    }
}
