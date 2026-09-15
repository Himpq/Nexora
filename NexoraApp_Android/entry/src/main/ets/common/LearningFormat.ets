// LearningFormat.ets - 学习域展示格式化
// 时间与时长在首页通知、学习动态、资源列表、学习报告中反复出现，统一在此实现，避免各页面各写一份。

export class LearningFormat {
    // 时间戳（秒）-> 今天 / 昨天 / MM-DD / YYYY-MM-DD
    static day(seconds: number): string {
        if (seconds <= 0) {
            return '';
        }

        const target: Date = new Date(seconds * 1000);
        const now: Date = new Date();
        const days: number = LearningFormat.dayGap(target, now);

        if (days === 0) {
            return '今天';
        }

        if (days === 1) {
            return '昨天';
        }

        return LearningFormat.pad(target.getMonth() + 1) + '-' + LearningFormat.pad(target.getDate());
    }

    // 时间戳（秒）-> 今天 HH:mm / 昨天 HH:mm / MM-DD HH:mm
    static moment(seconds: number): string {
        if (seconds <= 0) {
            return '';
        }

        const target: Date = new Date(seconds * 1000);
        const clock: string = LearningFormat.pad(target.getHours()) + ':' + LearningFormat.pad(target.getMinutes());
        const days: number = LearningFormat.dayGap(target, new Date());

        if (days === 0) {
            return '今天 ' + clock;
        }

        if (days === 1) {
            return '昨天 ' + clock;
        }

        return LearningFormat.pad(target.getMonth() + 1) + '-' + LearningFormat.pad(target.getDate()) + ' ' + clock;
    }

    // 学习时长：不足 1 小时按分钟，其余保留一位小数
    static hours(hours: number): string {
        if (hours <= 0) {
            return '0 分钟';
        }

        if (hours < 1) {
            return Math.round(hours * 60) + ' 分钟';
        }

        return (Math.round(hours * 10) / 10) + ' 小时';
    }

    // 字数：按千字 / 万字收敛，避免大数字撑破卡片
    static chars(count: number): string {
        if (count <= 0) {
            return '0 字';
        }

        if (count < 10000) {
            return count + ' 字';
        }

        return (Math.round(count / 1000) / 10) + ' 万字';
    }

    static percent(ratio: number): string {
        const value: number = ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio);

        return Math.round(value * 100) + '%';
    }

    // 相差天数（按自然日计算）
    private static dayGap(target: Date, now: Date): number {
        const start: number = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const end: number = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();

        return Math.round((start - end) / 86400000);
    }

    private static pad(value: number): string {
        return value < 10 ? '0' + value : value + '';
    }
}
