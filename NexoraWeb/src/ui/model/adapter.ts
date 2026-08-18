import { providerIconFallbackText, resolveProviderIconUrl } from '@/api/providerIcons'
import type { ModelItem } from '@/api/config'

import type { ModelSelectOption } from './types'

/** 将配置 API 模型转换成共享选择器所需的展示模型。 */
export function toModelSelectOptions(models: ModelItem[]): ModelSelectOption[] {
    return models.map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        status: model.status,
        context_window: model.context_window,
        providerIconUrl: resolveProviderIconUrl(model.provider),
        providerIconFallback: providerIconFallbackText(model.provider),
    }))
}
