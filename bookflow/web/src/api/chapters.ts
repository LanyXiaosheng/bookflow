import { api } from './client'

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
  async aiBeats(id: string, chapter_title?: string): Promise<{ beats: Beat[] }> {
    const { data } = await api.post<{ beats: Beat[] }>(
      `/chapters/${id}/ai-beats`,
      { chapter_title },
      { timeout: 120_000 },
    )
    return data
  },
  async aiWrite(id: string, beat: Beat, prev_tail = ''): Promise<{ text: string }> {
    const { data } = await api.post<{ text: string }>(
      `/chapters/${id}/ai-write`,
      { beat, prev_tail },
      { timeout: 120_000 },
    )
    return data
  },
  aiWriteStreamUrl(id: string): string {
    return `/api/chapters/${id}/ai-write/stream`
  },
}
