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
  /** 推荐原因：为什么现在推这题 */
  recommend_reason?: string
  /** 目前热度：爆款在售 / 上升期 / 平稳 / 冷门 */
  heat?: string
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
  recommend_reason?: string
  heat?: string
  batch_id: string
  created_at: string
}

export interface AiTrackRecommendation {
  primary: string
  plots: string[]
  reason?: string
  heat?: string
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
  /** AI 推荐主分类+情节组合 */
  async aiRecommendTrack(
    primaries: string[],
    plots: string[],
  ): Promise<AiTrackRecommendation[]> {
    const { data } = await api.post<{ recommendations: AiTrackRecommendation[] }>(
      '/seeds/ai-recommend-track',
      { primaries, plots },
      { timeout: 120_000 }
    )
    return data.recommendations
  },
  /** 回填历史候选的热度+推荐原因（一次最多 60 个标题，可多次点） */
  async aiBackfillHeat(): Promise<{ updated_titles: number; updated_rows: number }> {
    const { data } = await api.post<{ updated_titles: number; updated_rows: number }>(
      '/seeds/ai-backfill-heat',
      {},
      { timeout: 180_000 }
    )
    return data
  },
}
