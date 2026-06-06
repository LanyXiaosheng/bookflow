import { api } from './client'
import type { ProjectStatus } from './projects'

export type ReviewStage = '24h' | '72h' | '7d'
export type ReviewResult = '爆' | '平' | '扑'

export interface PendingReview {
  project_id: string
  title: string
  status: ProjectStatus
  stage: ReviewStage
  published_at: string
  track: string
  total_words: number
  data_recorded: boolean
  last_review_result: ReviewResult | null
}

export interface ProjectReview {
  id: string
  project_id: string
  stage: ReviewStage
  published_at: string
  data_recorded: boolean
  read_count: number | null
  completion_rate: number | null
  engagement_count: number | null
  overall_result: ReviewResult | null
  title_result: string | null
  hook_result: string | null
  emotion_result: string | null
  success_reason: string | null
  failure_reason: string | null
  continue_track: string | null
  reusable_conclusion: string | null
  next_action: string | null
  created_at: string
  updated_at: string
}

export interface UpsertProjectReviewInput {
  data_recorded: boolean
  read_count: number | null
  completion_rate: number | null
  engagement_count: number | null
  overall_result: ReviewResult | null
  title_result: string | null
  hook_result: string | null
  emotion_result: string | null
  success_reason: string | null
  failure_reason: string | null
  continue_track: string | null
  reusable_conclusion: string | null
  next_action: string | null
}

export const reviewsApi = {
  async listPending(): Promise<PendingReview[]> {
    const { data } = await api.get<PendingReview[]>('/reviews/pending')
    return data
  },

  async listByProject(projectId: string): Promise<ProjectReview[]> {
    const { data } = await api.get<ProjectReview[]>(`/projects/${projectId}/reviews`)
    return data
  },

  async upsert(
    projectId: string,
    stage: ReviewStage,
    input: UpsertProjectReviewInput,
  ): Promise<ProjectReview> {
    const { data } = await api.put<ProjectReview>(`/projects/${projectId}/reviews/${stage}`, input)
    return data
  },
}
