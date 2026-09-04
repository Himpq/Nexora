// UserAvatar.ets - 用户头像
// 服务端头像地址可用时优先加载网络图；缺失、加载失败时回落为「首字母 + 品牌渐变底」的本地头像

import { sanitizeDisplayName } from '../../common/AppConfig';
import { Size } from '../../common/DesignToken';

@Component
export struct UserAvatar {
    @Prop name: string = '';
    // 头像地址变化时必须复位 loadFailed，否则首次加载失败后会永久卡在默认头像
    @Prop @Watch('onAvatarUrlChanged') avatarUrl: string = '';
    @Prop diameter: number = Size.avatarLarge;

    @State private loadFailed: boolean = false;

    // 头像地址变更（如登录后拉到真实 URL、刷新版本号变化）时复位失败标记，重新尝试加载网络图
    private onAvatarUrlChanged(): void {
        this.loadFailed = false;
    }

    build() {
        Stack() {
            if (this.avatarUrl.length > 0 && !this.loadFailed) {
                Image(this.avatarUrl)
                    .width(this.diameter)
                    .height(this.diameter)
                    .borderRadius(this.diameter / 2)
                    .objectFit(ImageFit.Cover)
                    .onError(() => {
                        this.loadFailed = true;
                    });
            } else {
                Text(this.initialLetter)
                    .fontSize(this.diameter * 0.42)
                    .fontWeight(FontWeight.Bold)
                    .fontColor($r('app.color.text_inverse'));
            }
        }
        .width(this.diameter)
        .height(this.diameter)
        .borderRadius(this.diameter / 2)
        .linearGradient({
            angle: 135,
            colors: [
                [$r('app.color.brand_primary'), 0],
                [$r('app.color.brand_secondary'), 1]
            ]
        })
        .clip(true);
    }

    // 首字母：清洗后的昵称取首个字符，字母统一大写，无昵称时显示占位符
    private get initialLetter(): string {
        const name: string = sanitizeDisplayName(this.name);

        if (name.length === 0) {
            return '?';
        }

        const head: string = name.substring(0, 1);
        const code: number = head.charCodeAt(0);

        if (code >= 97 && code <= 122) {
            return head.toUpperCase();
        }

        return head;
    }
}
