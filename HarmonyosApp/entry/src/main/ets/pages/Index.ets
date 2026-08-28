/**
 * Nexora 学习伙伴首页：拉取学习上下文与今日规划，支持继续学习与章节内提问。
 */
import {
  AgentApi,
  AgentEnvelope,
  ContextData,
  PlanData,
  OpenSessionData,
  LearnTarget,
  AskAnswer,
  ContextLecture,
} from '../services/AgentApi';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { router } from '@kit.ArkUI';

@Entry
@Component
struct Index {
  @State loading: boolean = false;
  @State errorText: string = '';
  @State courseTitle: string = '未选择课程';
  @State courseProgress: number = 0;
  @State courseChapter: string = '';
  @State planChapter: string = '';
  @State planBook: string = '';
  @State planMinutes: number = 0;
  @State planReason: string = '';
  @State sessionUrl: string = '';
  @State askInput: string = '';
  @State askAnswer: string = '';
  @State asking: boolean = false;
  @State hasPlan: boolean = false;
  @State hasSession: boolean = false;
  private api: AgentApi = new AgentApi();
  private planTarget: LearnTarget | null = null;

  aboutToAppear(): void {
    this.loadHome();
  }

  async loadHome(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const ctxEnv: AgentEnvelope = await this.api.getContext();
      const ctxData: ContextData = ctxEnv.data as ContextData;
      if (ctxData.lectures.length > 0) {
        const first: ContextLecture = ctxData.lectures[0];
        this.courseTitle = first.title;
        this.courseProgress = first.progress_percent;
        this.courseChapter = first.current_chapter;
      }
      const planEnv: AgentEnvelope = await this.api.postPlan('continue_learning', 30);
      const planData: PlanData = planEnv.data as PlanData;
      this.planChapter = planData.plan.target.chapter_name;
      this.planBook = planData.plan.target.book_title;
      this.planMinutes = planData.plan.estimated_minutes;
      this.planReason = planData.plan.reason;
      this.planTarget = planData.plan.target;
      this.hasPlan = true;
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '加载学习上下文失败';
    } finally {
      this.loading = false;
    }
  }

  async openSession(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const env: AgentEnvelope = await this.api.postOpenSession();
      const data: OpenSessionData = env.data as OpenSessionData;
      this.sessionUrl = data.entry_url;
      this.hasSession = true;
      await this.openInBrowser(data.entry_url);
    } catch (err) {
      const e = err as BusinessError;
      this.errorText = e.message.length > 0 ? e.message : '打开学习会话失败';
    } finally {
      this.loading = false;
    }
  }

  async openInBrowser(url: string): Promise<void> {
    const context: common.Context | undefined = this.getUIContext().getHostContext();
    if (context === undefined) {
      throw new Error('无法获取应用上下文');
    }
    const abilityContext: common.UIAbilityContext = context as common.UIAbilityContext;
    await abilityContext.startAbility({
      action: 'ohos.want.action.viewData',
      uri: url,
    });
  }

  async ask(): Promise<void> {
    const question: string = this.askInput.trim();
    if (question.length === 0) {
      this.askAnswer = '请先输入问题。';
      return;
    }
    if (this.planTarget === null) {
      this.askAnswer = '暂无学习上下文，请先加载今日规划。';
      return;
    }
    this.asking = true;
    this.askAnswer = '';
    try {
      const env: AgentEnvelope = await this.api.postAskInContext(question, this.planTarget);
      const data: AskAnswer = env.data as AskAnswer;
      this.askAnswer = data.answer.length > 0 ? data.answer : '（服务端未返回答案）';
    } catch (err) {
      const e = err as BusinessError;
      this.askAnswer = '提问失败：' + (e.message.length > 0 ? e.message : '网络错误');
    } finally {
      this.asking = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text('Nexora 学习伙伴')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .width('100%')
        Text(this.errorText.length > 0 ? this.errorText : '同步你的学习进度，规划下一步，陪你在章节内提问。')
          .fontSize(13)
          .fontColor(this.errorText.length > 0 ? '#E64545' : '#8A8A8A')
          .width('100%')

        if (this.loading) {
          LoadingProgress()
            .width(40)
            .height(40)
            .margin({ top: 24 })
        }

        if (this.hasPlan) {
          Column({ space: 8 }) {
            Row() {
              Text('今日下一步')
                .fontSize(15)
                .fontWeight(FontWeight.Medium)
              Blank()
              Text(this.planMinutes > 0 ? '约 ' + this.planMinutes + ' 分钟' : '')
                .fontSize(13)
                .fontColor('#4A7DFF')
            }
            .width('100%')

            Text(this.planChapter)
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .width('100%')
            Text(this.planBook)
              .fontSize(13)
              .fontColor('#8A8A8A')
              .width('100%')
            if (this.planReason.length > 0) {
              Text(this.planReason)
                .fontSize(12)
                .fontColor('#8A8A8A')
                .width('100%')
            }
            Button('开始学习')
              .width('100%')
              .height(38)
              .fontSize(14)
              .onClick(() => {
                this.openSession();
              })
            if (this.hasSession) {
              Text(this.sessionUrl)
                .fontSize(11)
                .fontColor('#4A7DFF')
                .width('100%')
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
          }
          .width('100%')
          .padding(16)
          .borderRadius(14)
          .backgroundColor('#F1F5FF')
        }

        Column({ space: 8 }) {
          Text('学习进度')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .width('100%')
          Text(this.courseTitle)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .width('100%')
          Text(this.courseChapter.length > 0 ? '当前章节：' + this.courseChapter : '暂无章节信息')
            .fontSize(13)
            .fontColor('#8A8A8A')
            .width('100%')
          Progress({ value: this.courseProgress, total: 100, type: ProgressType.Linear })
            .width('100%')
            .height(6)
          Row() {
            Text('已完成 ' + this.courseProgress + '%')
              .fontSize(12)
              .fontColor('#8A8A8A')
            Blank()
            Button('今日任务与复习')
              .height(32)
              .fontSize(12)
              .onClick(() => {
                router.pushUrl({ url: 'pages/TodayTask' });
              })
          }
          .width('100%')
        }
        .width('100%')
        .padding(16)
        .borderRadius(14)
        .backgroundColor('#F5F5F5')

        Column({ space: 8 }) {
          Text('章节内提问')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .width('100%')
          Text('基于当前教材与章节上下文回答，优先引用教材内容。')
            .fontSize(12)
            .fontColor('#8A8A8A')
            .width('100%')
          Row({ space: 8 }) {
            TextInput({ placeholder: '例如：用一句话解释什么是备份', text: this.askInput })
              .layoutWeight(1)
              .height(38)
              .fontSize(13)
              .onChange((value: string) => {
                this.askInput = value;
              })
            Button(this.asking ? '提问中…' : '提问')
              .height(38)
              .fontSize(13)
              .enabled(!this.asking)
              .onClick(() => {
                this.ask();
              })
          }
          .width('100%')
          if (this.askAnswer.length > 0) {
            Text(this.askAnswer)
              .fontSize(13)
              .lineHeight(20)
              .width('100%')
          }
        }
        .width('100%')
        .padding(16)
        .borderRadius(14)
        .backgroundColor('#F5F5F5')
      }
      .width('100%')
      .padding(16)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#FFFFFF')
    .align(Alignment.TopStart)
  }
}
