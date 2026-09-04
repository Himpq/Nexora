// TimeUtil.ets - 时间戳到展示文案的转换
// 后端时间戳秒 / 毫秒混用，统一在此判定量级后格式化

const SECONDS_BOUNDARY: number = 10000000000;
const ONE_DAY_MS: number = 24 * 60 * 60 * 1000;

export class TimeUtil {
    // 归一化到毫秒：小于 1e10 视为秒级
    static toMillis(timestamp: number): number {
        if (timestamp <= 0) {
            return 0;
        }

        return timestamp < SECONDS_BOUNDARY ? timestamp * 1000 : timestamp;
    }

    // 列表场景的短格式：今天显示时分，昨天显示「昨天」，更早显示月-日
    static short(timestamp: number): string {
        const millis: number = TimeUtil.toMillis(timestamp);

        if (millis === 0) {
            return '';
        }

        const target: Date = new Date(millis);
        const now: Date = new Date();
        const todayStart: number = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        if (millis >= todayStart) {
            return TimeUtil.pad(target.getHours()) + ':' + TimeUtil.pad(target.getMinutes());
        }

        if (millis >= todayStart - ONE_DAY_MS) {
            return '昨天';
        }

        return TimeUtil.pad(target.getMonth() + 1) + '-' + TimeUtil.pad(target.getDate());
    }

    // 会话内时间戳：精确到时分
    static clock(timestamp: number): string {
        const millis: number = TimeUtil.toMillis(timestamp);

        if (millis === 0) {
            return '';
        }

        const target: Date = new Date(millis);
        return TimeUtil.pad(target.getHours()) + ':' + TimeUtil.pad(target.getMinutes());
    }

    private static pad(value: number): string {
        return value < 10 ? '0' + value : value.toString();
    }
}
