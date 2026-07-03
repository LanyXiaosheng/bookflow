import { api } from './client'
import type { PublishQaResult } from './projects'

export interface Beat {
  id: string
  label: string
  note?: string
}

export interface Chapter {
  id: string
  project_id: string
  idx: number
  title: string
  beats: Beat[]
  body: string
  word_count: number
  updated_at: string
}

export const chaptersApi = {
  async listByProject(projectId: string): Promise<Chapter[]> {
    const { data } = await api.get<Chapter[]>(`/projects/${projectId}/chapters`)
    return data
  },
  async create(projectId: string, title: string): Promise<Chapter> {
    const { data } = await api.post<Chapter>(`/projects/${projectId}/chapters`, { title })
    return data
  },
  async update(id: string, title: string, body: string): Promise<Chapter> {
    const { data } = await api.put<Chapter>(`/chapters/${id}`, { title, body })
    return data
  },
  async aiBeats(id: string, chapter_title?: string, signal?: AbortSignal): Promise<{ beats: Beat[] }> {
    const { data } = await api.post<{ beats: Beat[] }>(
      `/chapters/${id}/ai-beats`,
      { chapter_title },
      { timeout: 120_000, signal },
    )
    return data
  },
  async aiWrite(id: string, beat: Beat, prev_tail = '', signal?: AbortSignal): Promise<{ text: string }> {
    const { data } = await api.post<{ text: string }>(
      `/chapters/${id}/ai-write`,
      { beat, prev_tail },
      { timeout: 120_000, signal },
    )
    return data
  },
  aiWriteStreamUrl(id: string): string {
    return `/api/chapters/${id}/ai-write/stream`
  },
  /** 整章一次性写作（SSE）：后端写完直接落库 chapter.body */
  aiWriteFullStreamUrl(id: string): string {
    return `/api/chapters/${id}/ai-write-full/stream`
  },
  /** 章级发布前自检：对本章 body 打分 */
  async aiQa(id: string, signal?: AbortSignal): Promise<PublishQaResult> {
    const { data } = await api.post<PublishQaResult>(
      `/chapters/${id}/ai-qa`,
      {},
      { timeout: 120_000, signal },
    )
    return data
  },
}
