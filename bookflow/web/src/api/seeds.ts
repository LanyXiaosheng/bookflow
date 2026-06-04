import { api } from './client'

export type Tier = 'greenlight' | 'backlog' | 'reject'

export interface Score {
  title: number
  opening: number
  slap: number
  emotion: number
  twist: number
  hook: number
  finish: number
}

export interface Seed {
  id: string
  title: string
  track: string
  score: Score
  total_score: number
  tier: Tier
  created_at: string
}

export interface NewSeed {
  title: string
  track: string
  score: Score
}

export interface AiScoreResponse {
  score: Score
  rationale: string
  suggestions: string[]
}

export interface AiSeedCandidate {
  title: string
  score: Score
  why_buy: string
}

export interface AiSeedGenerated {
  track: string
  candidates: AiSeedCandidate[]
}

export interface AiSeedDraft {
  id: string
  track: string
  title: string
  score: Score
  total_score: number
  why_buy: string
  batch_id: string
  created_at: string
}

export const seedsApi = {
  async list(): Promise<Seed[]> {
    const { data } = await api.get<Seed[]>('/seeds')
    return data
  },
  async create(payload: NewSeed): Promise<Seed> {
    const { data } = await api.post<Seed>('/seeds', payload)
    return data
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/seeds/${id}`)
  },
  async aiScore(payload: { title: string; track: string }): Promise<AiScoreResponse> {
    const { data } = await api.post<AiScoreResponse>('/seeds/ai-score', payload, {
      timeout: 90_000,
    })
    return data
  },
  async aiGenerate(track: string): Promise<AiSeedGenerated> {
    const { data } = await api.post<AiSeedGenerated>(
      '/seeds/ai-generate',
      { track },
      { timeout: 120_000 }
    )
    return data
  },
  async aiDrafts(track?: string, limit = 50): Promise<AiSeedDraft[]> {
    const { data } = await api.get<AiSeedDraft[]>('/seeds/ai-drafts', {
      params: { track, limit },
    })
    return data
  },
  /** AI 一键立项：后端 generate → 取最高分 → createSeed → createFromSeed → 返 project */
  async aiLaunch(track: string): Promise<{ id: string; title: string; track: string }> {
    const { data } = await api.post<{ id: string; title: string; track: string }>(
      '/seeds/ai-launch',
      { track },
      { timeout: 180_000 }
    )
    return data
  },
}
