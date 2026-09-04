// JsonUtil.ets - JSON 解析与字段读取
// 后端返回结构不稳定，所有取值都在这里做类型收敛，业务层不再出现裸 JSON 操作

export class Json {
    // 解析为字典，失败或不是字典时返回 null，由调用方显式处理
    static parseObject(text: string): Record<string, Object> | null {
        if (text.length === 0) {
            return null;
        }

        try {
            const parsed: Object = JSON.parse(text) as Object;

            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return null;
            }

            return parsed as Record<string, Object>;
        } catch {
            return null;
        }
    }

    // 解析为数组，失败或不是数组时返回 null
    static parseArray(text: string): Object[] | null {
        if (text.length === 0) {
            return null;
        }

        try {
            const parsed: Object = JSON.parse(text) as Object;

            if (!Array.isArray(parsed)) {
                return null;
            }

            return parsed as Object[];
        } catch {
            return null;
        }
    }

    // 读取字典字段，缺失时返回 null（区分「字段不存在」与「空字符串」）
    static fieldOrNull(source: Record<string, Object>, key: string): Object | null {
        const value: Object | undefined = source[key];

        if (value === undefined || value === null) {
            return null;
        }

        return value;
    }

    static string(source: Record<string, Object>, key: string): string {
        const value: Object | null = Json.fieldOrNull(source, key);
        return typeof value === 'string' ? value as string : '';
    }

    static number(source: Record<string, Object>, key: string): number {
        const value: Object | null = Json.fieldOrNull(source, key);
        return typeof value === 'number' ? value as number : 0;
    }

    static boolean(source: Record<string, Object>, key: string): boolean {
        const value: Object | null = Json.fieldOrNull(source, key);
        return value === true;
    }

    // 读取对象数组字段，非数组时返回空数组
    static array(source: Record<string, Object>, key: string): Object[] {
        const value: Object | null = Json.fieldOrNull(source, key);

        if (!Array.isArray(value)) {
            return [];
        }

        return value as Object[];
    }

    // 读取嵌套字典字段
    static object(source: Record<string, Object>, key: string): Record<string, Object> | null {
        const value: Object | null = Json.fieldOrNull(source, key);

        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        return value as Record<string, Object>;
    }
}
