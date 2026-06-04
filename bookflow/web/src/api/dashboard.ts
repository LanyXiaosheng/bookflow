import { api } from './client'
import type { Project } from './projects'
import type { Seed } from './seeds'

export interface DashboardCounts {
  writing: number
  ready: number
  published: number
  archived: number
  seeds_total: number
  seeds_greenlight: number
  seeds_backlog: number
}

export interface PipelineStage {
  key: 'seed' | 'plan' | 'write' | 'ready' | 'published' | 'archive'
  label: string
  count: number
  line1: string
  line2: string | null
  line2_warn: boolean
}

export interface HealthMetrics {
  in_progress: number
  in_progress_detail: string
  weekly_published: number
  weekly_delta: number
  pending_review: number
  pending_review_overdue: number
  wc_warnings: number
  wc_warning_detail: string
}

export interface LlmStatus {
  configured: boolean
  provider: string
  model: string
}

export interface DashboardSummary {
  counts: DashboardCounts
  pipeline: PipelineStage[]
  health: HealthMetrics
  llm: LlmStatus
  recent_seeds: Seed[]
  recent_projects: Project[]
}

export const dashboardApi = {
  async summary(): Promise<DashboardSummary> {
    const { data } = await api.get<DashboardSummary>('/dashboard/summary')
    return data
  },
}
