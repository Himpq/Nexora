/** User scheduled tasks in ChatDBServer. */

import { apiFetch } from './client'

export interface ScheduledTask {
    task_id: string
    title: string
    prompt: string
    weekdays: number[]
    hour: number
    minute: number
    enabled: boolean
    next_run_at: number
    last_status: string
    last_error: string
    last_knowledge_title: string
    created_at: number
    updated_at: number
}

export interface ScheduledTaskRun {
    run_id: string
    scheduled_at: number
    started_at: number
    finished_at: number | null
    status: string
    knowledge_title: string
    error: string
}

export interface ScheduledTaskInput {
    title: string
    prompt: string
    weekdays: number[]
    hour: number
    minute: number
}


export async function listScheduledTasks(): Promise<ScheduledTask[]> {
    const data = await apiFetch<{ success: boolean; tasks: ScheduledTask[] }>('/api/scheduled-tasks')
    return data.tasks
}


export async function createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const data = await apiFetch<{ success: boolean; task: ScheduledTask }>('/api/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify(input),
    })
    return data.task
}


export async function updateScheduledTask(taskId: string, changes: Partial<ScheduledTaskInput> & { enabled?: boolean }): Promise<ScheduledTask> {
    const data = await apiFetch<{ success: boolean; task: ScheduledTask }>(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
    })
    return data.task
}


export async function deleteScheduledTask(taskId: string): Promise<void> {
    await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
}


export async function listScheduledTaskRuns(taskId: string): Promise<ScheduledTaskRun[]> {
    const data = await apiFetch<{ success: boolean; runs: ScheduledTaskRun[] }>(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/runs`)
    return data.runs
}
