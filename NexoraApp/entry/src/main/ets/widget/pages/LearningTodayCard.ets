const cardStorage: LocalStorage = new LocalStorage();

@Entry(cardStorage)
@Component
struct LearningTodayCard {
    @LocalStorageProp('title') title: string = '打开 Nexora，登录后查看学习安排';
    @LocalStorageProp('minutes') minutes: string = '';
    @LocalStorageProp('actionable') actionable: boolean = false;
    @LocalStorageProp('decisionId') decisionId: string = '';
    @LocalStorageProp('identityToken') identityToken: string = '';

    private reply(response: string): void {
        postCardAction(this, {
            action: 'message',
            params: { response: response, decision_id: this.decisionId, identity_token: this.identityToken },
        });
    }

    build() {
        Column({ space: 8 }) {
            Text('Nexora 学习')
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor('#263A63')
                .width('100%')
            Text(this.title)
                .fontSize(15)
                .lineHeight(21)
                .fontColor('#1E293B')
                .maxLines(3)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .layoutWeight(1)
            if (this.minutes.length > 0) {
                Text(this.minutes)
                    .fontSize(11)
                    .fontColor('#63708A')
                    .width('100%')
            }
            if (this.actionable) {
                Row({ space: 8 }) {
                    Button('好')
                        .fontSize(13)
                        .height(30)
                        .layoutWeight(1)
                        .backgroundColor('#355EA8')
                        .fontColor('#FFFFFF')
                        .onClick(() => { this.reply('accept'); })
                    Button('晚点')
                        .fontSize(13)
                        .height(30)
                        .layoutWeight(1)
                        .backgroundColor('#DCE5F5')
                        .fontColor('#263A63')
                        .onClick(() => { this.reply('defer'); })
                }.width('100%')
            } else {
                Button('打开 Nexora')
                    .fontSize(13)
                    .height(30)
                    .width('100%')
                    .backgroundColor('#DCE5F5')
                    .fontColor('#263A63')
                    .onClick(() => {
                        postCardAction(this, {
                            action: 'router', abilityName: 'EntryAbility', params: { nx_route: 'day' },
                        });
                    })
            }
        }
        .width('100%')
        .height('100%')
        .padding(14)
        .backgroundColor('#F0F4FC')
    }
}
