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
  show_count: number | null
  comment_count: number | null
  like_count: number | null
  library_count: number | null
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
  show_count: number | null
  comment_count: number | null
  like_count: number | null
  library_count: number | null
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

  async quickBatch(
    items: QuickBatchItem[],
  ): Promise<QuickBatchItemResult[]> {
    const { data } = await api.post<QuickBatchItemResult[]>('/reviews/quick-batch', { items })
    return data
  },

  async aiAnalyze(
    projectId: string,
    stage: ReviewStage,
    input: AiAnalyzeReviewInput,
  ): Promise<AiAnalyzeReviewResponse> {
    const { data } = await api.post<AiAnalyzeReviewResponse>(
      `/projects/${projectId}/reviews/${stage}/ai-analyze`,
      input,
    )
    return data
  },

  async fanqieFetchAll(cookies: string, aid?: string): Promise<FanqieFetchAllResult> {
    const { data } = await api.post<FanqieFetchAllResult>('/fanqie/fetch-all', {
      cookies,
      aid: aid || '2503',
    })
    return data
  },

  async fanqieFetchFromCurl(curl: string, stage: ReviewStage = '7d'): Promise<FanqieFetchFromCurlResult> {
    const { data } = await api.post<FanqieFetchFromCurlResult>('/fanqie/fetch-from-curl', {
      curl,
      stage,
    })
    return data
  },
}

export interface AiAnalyzeReviewInput {
  track: string
  total_words: number
  read_count: number
  word_number: number
  categories_json: string | null
}

export interface AiAnalyzeReviewResponse {
  overall_result: string
  title_result: string
  hook_result: string
  emotion_result: string
  success_reason: string
  failure_reason: string
  next_action: string
}

export interface QuickBatchItem {
  title: string
  read_count: number
  word_number: number
  categories: string[]
  show_count?: number | null
  comment_count?: number | null
  like_count?: number | null
  library_count?: number | null
  completion_rate?: number | null
}

export interface QuickBatchItemResult {
  title: string
  matched: boolean
  project_id: string | null
  skip_reason: string | null
  updated: boolean
}

export interface FanqieFetchAllItem {
  book_id: string
  title: string
  read_count: number
  word_number: number
  categories: string[]
  show_count: number | null
  completion_rate: number | null
  comment_count: number | null
  like_count: number | null
  library_count: number | null
}

export interface FanqieFetchAllResult {
  items: FanqieFetchAllItem[]
  total_count: number
  detail_success: number
  detail_failed: number
  errors: string[]
}

export interface FanqieFetchFromCurlResult extends FanqieFetchAllResult {
  batch_results: QuickBatchItemResult[]
  stage: ReviewStage
}
