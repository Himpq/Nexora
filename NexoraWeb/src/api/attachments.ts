/**
 * attachments.ts — 消息附件输入类型
 *
 * 对齐原版 uploadedFileIds 条目:
 *   type=sandbox_file 的附件携带 sandbox_path / stored_path,
 *   后端 /api/chat/stream 的 user_attachments 按此结构归一化。
 */

export interface AttachmentInput {
    type: 'sandbox_file' | 'file' | string
    name: string
    original_name?: string
    sandbox_path?: string
    stored_path?: string
    size?: number
}