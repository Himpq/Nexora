import type { ConversationSummary } from '@/api/conversations'
import type { ConversationBranchRow } from '@/stores/conversation'
import type { NexoraCodeProject } from '@/api/nexoracodeLocal'

export interface NexoraCodeProjectConversationGroup {
    project: NexoraCodeProject
    rows: ConversationBranchRow[]
}

/** 读取 NexoraCode 项目关联；项目归属由本地会话 metadata 持久化。 */
export function readNexoraCodeProject(conversation: ConversationSummary): NexoraCodeProject | null {
    const metadata = conversation.metadata && typeof conversation.metadata === 'object'
        ? conversation.metadata
        : {}
    const nested = metadata.nexoracode_project
    const raw = nested && typeof nested === 'object'
        ? nested as Record<string, unknown>
        : conversation.nexoracode_project && typeof conversation.nexoracode_project === 'object'
            ? conversation.nexoracode_project as Record<string, unknown>
            : null

    if (!raw) {
        return null
    }

    const path = String(raw.path || raw.root || '').trim()
    const name = String(raw.name || raw.title || projectNameFromPath(path) || '').trim()
    const projectId = String(raw.project_id || raw.id || path || name).trim()

    if (!projectId) {
        return null
    }

    return {
        project_id: projectId,
        name: name || 'NexoraCode 项目',
        path,
        subtitle: String(raw.subtitle || path || '本地项目').trim(),
        tree_scanned_at: String(raw.tree_scanned_at || '').trim(),
    }
}

/** 按项目 metadata 将分支树行分组，维持会话列表当前的最近活动顺序。 */
export function groupNexoraCodeProjectRows(rows: ConversationBranchRow[]): NexoraCodeProjectConversationGroup[] {
    const groups = new Map<string, NexoraCodeProjectConversationGroup>()

    rows.forEach((row) => {
        const project = readNexoraCodeProject(row.conversation)

        if (!project) {
            return
        }

        const group = groups.get(project.project_id) || { project, rows: [] }
        group.rows.push(row)
        groups.set(project.project_id, group)
    })

    return Array.from(groups.values())
}

function projectNameFromPath(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean)

    return parts[parts.length - 1] || ''
}
