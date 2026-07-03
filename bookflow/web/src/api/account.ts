import { api } from './client'

/** 已验证的爆款公式（strategy.proven_formula） */
export interface ProvenFormula {
  title_pattern?: string
  validated_ctr?: number[]
  best_tracks?: string[]
  examples?: string[]
}

/** 账号总览快照（strategy.account_summary，AI 复盘时写入） */
export interface AccountSummary {
  total_works?: number
  total_reads?: number
  total_shows?: number
  avg_ctr?: number
  works_over_10k?: number
  works_over_1k?: number
  hit_rate?: number
  douyin_pay_rate?: number
}

/**
 * 账号复盘策略：整块是后端 users.strategy jsonb，字段都可选。
 * 结构松散（由 AI 复盘产出），前端按存在与否渲染。
 */
export interface AccountStrategy {
  last_review_date?: string
  account_summary?: AccountSummary
  proven_formula?: ProvenFormula
  banned_tracks?: string[]
  key_insights?: string[]
  next_actions?: string[]
  suggested_topics?: string[]
  [key: string]: unknown
}

/** 单部番茄作品数据 */
export interface FanqieStat {
  book_id: string
  title: string
  category: string[]
  sign_status: string
  read_count: number
  show_count: number
  click_rate: number
  digg_count: number
  comment_count: number
  shelf_count: number
  read_count_increase: number
  show_count_increase: number
  douyin_pay_rate: number
  fanqie_created_at: string | null
  recorded_at: string | null
}

/** 番茄作品数据汇总（后端实时算的，权威值） */
export interface FanqieStatsSummary {
  total_works: number
  total_reads: number
  total_shows: number
  avg_ctr: number
  works_over_10k: number
  works_over_1k: number
  total_read_increase: number
  avg_douyin_pay_rate: number
}

export interface FanqieStatsView {
  summary: FanqieStatsSummary
  works: FanqieStat[]
}

export const accountApi = {
  async strategy(): Promise<AccountStrategy> {
    const { data } = await api.get<AccountStrategy>('/users/me/strategy')
    return data ?? {}
  },
  async updateStrategy(strategy: AccountStrategy): Promise<AccountStrategy> {
    const { data } = await api.put<AccountStrategy>('/users/me/strategy', strategy)
    return data
  },
  async fanqieStats(): Promise<FanqieStatsView> {
    const { data } = await api.get<FanqieStatsView>('/users/me/fanqie-stats')
    return data
  },
}
