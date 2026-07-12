import { api } from './client'

export type Tier = 'greenlight' | 'backlog' | 'reject'

/** 选题评分 V2：4 维，每维 1-10，满分 40。 */
export interface Score {
  title_ctr: number
  conflict: number
  tagfit: number
  novelty: number
}

/** 旧版 7 维评分（每维 1-5）。历史 seed / 草稿仍是这个结构。 */
export interface LegacyScore {
  title: number
  opening: number
  slap: number
  emotion: number
  twist: number
  hook: number
  finish: number
  tagfit?: number
}

/** 后端 score 字段可能是新 4 维或旧 7 维，按 title_ctr 区分。 */
export type AnyScore = Score | LegacyScore

/** V2（4 维）评分卡的维度元信息，按顺序展示。 */
export const SCORE_V2_DIMS = [
  { key: 'title_ctr', label: '标题点击欲', desc: '推荐流里看到会不会点' },
  { key: 'conflict', label: '冲突明确度', desc: '一眼能否看出核心矛盾' },
  { key: 'tagfit', label: '赛道辨识度', desc: '是否自带品类关键词' },
  { key: 'novelty', label: '差异化', desc: '跟现有爆款撞车越少越高' },
] as const satisfies ReadonlyArray<{ key: keyof Score; label: string; desc: string }>

/** 是否是新版 4 维评分。 */
export function isScoreV2(s: AnyScore | null | undefined): s is Score {
  return !!s && typeof (s as Score).title_ctr === 'number'
}

/** V2 立项阈值：≥30 立项 / 22-29 备选 / <22 不做。 */
export function tierOfV2(total: number): Tier {
  if (total >= 30) return 'greenlight'
  if (total >= 22) return 'backlog'
  return 'reject'
}

/** 旧版立项阈值：≥32 立项 / 26-31 备选 / <26 不做。 */
export function tierOfLegacy(total: number): Tier {
  if (total >= 32) return 'greenlight'
  if (total >= 26) return 'backlog'
  return 'reject'
}

/** 对任意版本 score 求总分。 */
export function totalOfScore(s: AnyScore): number {
  if (isScoreV2(s)) {
    return s.title_ctr + s.conflict + s.tagfit + s.novelty
  }
  const l = s as LegacyScore
  return l.title + l.opening + l.slap + l.emotion + l.twist + l.hook + l.finish
}

/** 对任意版本 score 判段位（统一用 V2 阈值，与后端一致）。 */
export function tierOfScore(s: AnyScore): Tier {
  const total = totalOfScore(s)
  return tierOfV2(total)
}

/**
 * 把任意版本 score 规整成新版 4 维（用于「填入评分卡」/ 立项时入库）。
 * 已是 V2 直接返回；旧 7 维按近义维度映射并把 1-5 缩放到 1-10：
 *   title_ctr←title，conflict←slap，tagfit←tagfit||title，novelty←twist。
 */
export function toScoreV2(s: AnyScore): Score {
  if (isScoreV2(s)) return s
  const l = s as LegacyScore
  const up = (v: number | undefined, fallback: number) => {
    const base = typeof v === 'number' ? v : fallback
    return Math.min(10, Math.max(1, Math.round(base * 2)))
  }
  return {
    title_ctr: up(l.title, 4),
    conflict: up(l.slap, 4),
    tagfit: up(l.tagfit ?? l.title, 4),
    novelty: up(l.twist, 4),
  }
}

export interface Seed {
  id: string
  title: string
  track: string
  score: AnyScore
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
  total: number
  tier: Tier
  /** 对标 hot_tracks 里最相似的爆款 + 差异点 */
  benchmark?: string
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
  score: AnyScore
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
