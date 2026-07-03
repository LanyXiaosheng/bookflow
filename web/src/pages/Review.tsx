import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2, Save, Sparkles, Zap } from 'lucide-react'
import {
  reviewsApi,
  type AiAnalyzeReviewResponse,
  type PendingReview,
  type ProjectReview,
  type ReviewResult,
  type ReviewStage,
  type UpsertProjectReviewInput,
} from '../api/reviews'
import type { ProjectStatus } from '../api/projects'
import TrackPills from '../components/TrackPills'
import { looksLikeTestData } from '../lib/looksLikeTestData'

interface ReviewFormState {
  read_count: string
  completion_rate: string
  engagement_count: string
  show_count: string
  comment_count: string
  like_count: string
  library_count: string
  overall_result: '' | ReviewResult
  title_result: string
  hook_result: string
  emotion_result: string
  success_reason: string
  failure_reason: string
  continue_track: string
  reusable_conclusion: string
  next_action: string
}

function emptyForm(): ReviewFormState {
  return {
    read_count: '',
    completion_rate: '',
    engagement_count: '',
    show_count: '',
    comment_count: '',
    like_count: '',
    library_count: '',
    overall_result: '',
    title_result: '',
    hook_result: '',
    emotion_result: '',
    success_reason: '',
    failure_reason: '',
    continue_track: '',
    reusable_conclusion: '',
    next_action: '',
  }
}

function pendingKey(item: PendingReview): string {
  return `${item.project_id}:${item.stage}`
}

function stageLabel(stage: ReviewStage): string {
  switch (stage) {
    case '24h':
      return '24 小时复盘'
    case '72h':
      return '72 小时复盘'
    case '7d':
      return '7 天复盘'
  }
}

function statusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'published':
      return '已发'
    case 'archived':
      return '已归档'
    case 'ready':
      return '待发'
    case 'writing':
    default:
      return '写作中'
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formFromReview(review?: ProjectReview | null): ReviewFormState {
  if (!review) return emptyForm()
  return {
    read_count: review.read_count === null ? '' : String(review.read_count),
    completion_rate: review.completion_rate === null ? '' : String(review.completion_rate),
    engagement_count: review.engagement_count === null ? '' : String(review.engagement_count),
    show_count: review.show_count === null ? '' : String(review.show_count),
    comment_count: review.comment_count === null ? '' : String(review.comment_count),
    like_count: review.like_count === null ? '' : String(review.like_count),
    library_count: review.library_count === null ? '' : String(review.library_count),
    overall_result: review.overall_result ?? '',
    title_result: review.title_result ?? '',
    hook_result: review.hook_result ?? '',
    emotion_result: review.emotion_result ?? '',
    success_reason: review.success_reason ?? '',
    failure_reason: review.failure_reason ?? '',
    continue_track: review.continue_track ?? '',
    reusable_conclusion: review.reusable_conclusion ?? '',
    next_action: review.next_action ?? '',
  }
}

function toNullableNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toNullableString(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toPayload(form: ReviewFormState): UpsertProjectReviewInput {
  const read_count = toNullableNumber(form.read_count)
  const completion_rate = toNullableNumber(form.completion_rate)
  const engagement_count = toNullableNumber(form.engagement_count)
  return {
    data_recorded:
      read_count !== null || completion_rate !== null || engagement_count !== null,
    read_count,
    completion_rate,
    engagement_count,
    show_count: toNullableNumber(form.show_count),
    comment_count: toNullableNumber(form.comment_count),
    like_count: toNullableNumber(form.like_count),
    library_count: toNullableNumber(form.library_count),
    overall_result: form.overall_result || null,
    title_result: toNullableString(form.title_result),
    hook_result: toNullableString(form.hook_result),
    emotion_result: toNullableString(form.emotion_result),
    success_reason: toNullableString(form.success_reason),
    failure_reason: toNullableString(form.failure_reason),
    continue_track: toNullableString(form.continue_track),
    reusable_conclusion: toNullableString(form.reusable_conclusion),
    next_action: toNullableString(form.next_action),
  }
}

export default function Review() {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const pending = useQuery({
    queryKey: ['reviews', 'pending'],
    queryFn: () => reviewsApi.listPending(),
  })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [form, setForm] = useState<ReviewFormState>(emptyForm)
  const [notice, setNotice] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const hydratedKeyRef = useRef<string | null>(null)
  const requestedProjectId = searchParams.get('project_id')
  const requestedStage = searchParams.get('stage')

  useEffect(() => {
    if (pending.data === undefined) {
      return
    }
    if (pending.data.length === 0) {
      setSelectedKey(null)
      return
    }
    if (requestedProjectId && requestedStage) {
      const requested = pending.data.find(
        (item) => item.project_id === requestedProjectId && item.stage === requestedStage,
      )
      if (requested) {
        const requestedKey = pendingKey(requested)
        if (selectedKey !== requestedKey) {
          setSelectedKey(requestedKey)
        }
        return
      }
    }
    if (!selectedKey || !pending.data.some((item) => pendingKey(item) === selectedKey)) {
      setSelectedKey(pendingKey(pending.data[0]))
    }
  }, [pending.data, requestedProjectId, requestedStage, selectedKey])

  const selectedPending = pending.data?.find((item) => pendingKey(item) === selectedKey) ?? null
  const currentPendingKey = selectedPending ? pendingKey(selectedPending) : null

  const projectReviews = useQuery({
    queryKey: ['reviews', 'project', selectedPending?.project_id],
    queryFn: () => reviewsApi.listByProject(selectedPending!.project_id),
    enabled: !!selectedPending,
  })

  useEffect(() => {
    if (!currentPendingKey || !selectedPending) {
      if (pending.data === undefined) {
        return
      }
      setForm(emptyForm())
      setIsDirty(false)
      hydratedKeyRef.current = null
      return
    }
    const selectedItemChanged = hydratedKeyRef.current !== currentPendingKey
    const currentReview =
      projectReviews.data?.find((item) => item.stage === selectedPending.stage) ?? null
    if (selectedItemChanged || !isDirty) {
      setForm(formFromReview(currentReview))
      hydratedKeyRef.current = currentPendingKey
      if (selectedItemChanged) {
        setIsDirty(false)
      }
    }
  }, [currentPendingKey, pending.data, projectReviews.data, selectedPending?.stage])

  useEffect(() => {
    setNotice('')
  }, [selectedKey])

  const save = useMutation({
    mutationFn: async (vars: {
      projectId: string
      stage: ReviewStage
      payload: UpsertProjectReviewInput
    }) => reviewsApi.upsert(vars.projectId, vars.stage, vars.payload),
    onSuccess: async (data, vars) => {
      setNotice('已保存复盘')
      setForm(formFromReview(data))
      setIsDirty(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reviews', 'pending'] }),
        qc.invalidateQueries({ queryKey: ['reviews', 'project', vars.projectId] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
    },
    onError: () => {
      setNotice('')
    },
  })

  const aiAnalyze = useMutation({
    mutationFn: async () => {
      if (!selectedPending) throw new Error('no selection')
      return reviewsApi.aiAnalyze(selectedPending.project_id, selectedPending.stage, {
        track: selectedPending.track,
        total_words: selectedPending.total_words,
        read_count: form.read_count ? Number(form.read_count) : 0,
        word_number: selectedPending.total_words,
        categories_json: null,
      })
    },
    onSuccess: (data: AiAnalyzeReviewResponse) => {
      updateForm({
        overall_result: data.overall_result as '' | ReviewResult,
        title_result: data.title_result,
        hook_result: data.hook_result,
        emotion_result: data.emotion_result,
        success_reason: data.success_reason,
        failure_reason: data.failure_reason,
        next_action: data.next_action,
      })
      setNotice('AI 分析完成，请检查后保存')
    },
    onError: () => {
      setNotice('')
    },
  })

  const selectedReview =
    projectReviews.data?.find((item) => item.stage === selectedPending?.stage) ?? null

  const updateForm = (patch: Partial<ReviewFormState>) => {
    setForm((current) => ({ ...current, ...patch }))
    setIsDirty(true)
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          返回看板
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">复盘</h1>
        <Link
          to="/review/quick"
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Zap className="h-3.5 w-3.5" />
          快捷复盘
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">待复盘</h2>
            <span className="text-xs text-gray-500">{pending.data?.length ?? 0} 条</span>
          </div>
          {pending.isLoading && <p className="mt-4 text-sm text-gray-500">加载中…</p>}
          {pending.isError && <p className="mt-4 text-sm text-rose-600">待复盘加载失败</p>}
          {!pending.isLoading && !pending.isError && (
            <ul className="mt-4 space-y-2" data-testid="review-pending-list">
              {pending.data
                ?.filter((item) => !looksLikeTestData(item.title))
                .map((item) => {
                const active = pendingKey(item) === selectedKey
                return (
                  <li key={pendingKey(item)}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(pendingKey(item))}
                      className={[
                        'w-full rounded-lg border px-3 py-3 text-left transition',
                        active
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white',
                      ].join(' ')}
                    >
                      <div className="text-sm font-medium text-gray-900 line-clamp-2">{item.title}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {stageLabel(item.stage)}
                      </div>
                      <TrackPills track={item.track} compact />
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
                        <span>{statusLabel(item.status)} {formatDate(item.published_at)}</span>
                        <span>{item.total_words} 字</span>
                        <span>{item.data_recorded ? '已录数据' : '待录数据'}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
              {pending.data?.length === 0 && (
                <li className="rounded-lg border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">
                  暂无待复盘项目
                </li>
              )}
            </ul>
          )}
        </aside>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          {!selectedPending && !pending.isLoading && (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500">
              暂无可复盘项目
            </div>
          )}

          {selectedPending && (
            <>
              <header
                className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                data-testid="review-project-summary"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-blue-600">
                      {stageLabel(selectedPending.stage)}
                    </div>
                    <h2 className="mt-1 text-xl font-semibold text-gray-900">{selectedPending.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-500">
                      <TrackPills track={selectedPending.track} compact />
                      <span>{selectedPending.total_words} 字</span>
                      <span>发布时间 {formatDate(selectedPending.published_at)}</span>
                      <span>
                        已存复盘 {projectReviews.data?.length ?? 0} 条
                        {selectedPending.last_review_result
                          ? ` · 最近结论 ${selectedPending.last_review_result}`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <Link
                    to={`/projects/${selectedPending.project_id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                    data-testid="review-project-detail-link"
                  >
                    项目详情
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              </header>

              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Field label="展现量" htmlFor="review-show-count">
                  <input
                    id="review-show-count"
                    data-testid="review-show-count"
                    type="number"
                    min="0"
                    value={form.show_count}
                    onChange={(e) => updateForm({ show_count: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="阅读量" htmlFor="review-read-count">
                  <input
                    id="review-read-count"
                    data-testid="review-read-count"
                    type="number"
                    min="0"
                    value={form.read_count}
                    onChange={(e) => updateForm({ read_count: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="点击率" htmlFor="review-completion-rate">
                  <input
                    id="review-completion-rate"
                    data-testid="review-completion-rate"
                    type="number"
                    min="0"
                    max="1"
                    step="0.001"
                    value={form.completion_rate}
                    onChange={(e) => updateForm({ completion_rate: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="评论数" htmlFor="review-comment-count">
                  <input
                    id="review-comment-count"
                    data-testid="review-comment-count"
                    type="number"
                    min="0"
                    value={form.comment_count}
                    onChange={(e) => updateForm({ comment_count: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="点赞数" htmlFor="review-like-count">
                  <input
                    id="review-like-count"
                    data-testid="review-like-count"
                    type="number"
                    min="0"
                    value={form.like_count}
                    onChange={(e) => updateForm({ like_count: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="书架量" htmlFor="review-library-count">
                  <input
                    id="review-library-count"
                    data-testid="review-library-count"
                    type="number"
                    min="0"
                    value={form.library_count}
                    onChange={(e) => updateForm({ library_count: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="互动量" htmlFor="review-engagement-count">
                  <input
                    id="review-engagement-count"
                    data-testid="review-engagement-count"
                    type="number"
                    min="0"
                    value={form.engagement_count}
                    onChange={(e) => updateForm({ engagement_count: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="整体结果" htmlFor="review-overall-result">
                  <select
                    id="review-overall-result"
                    data-testid="review-overall-result"
                    value={form.overall_result}
                    onChange={(e) => updateForm({ overall_result: e.target.value as '' | ReviewResult })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="">未选择</option>
                    <option value="爆">爆</option>
                    <option value="平">平</option>
                    <option value="扑">扑</option>
                  </select>
                </Field>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Field label="标题结论" htmlFor="review-title-result">
                  <textarea
                    id="review-title-result"
                    data-testid="review-title-result"
                    value={form.title_result}
                    onChange={(e) => updateForm({ title_result: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="开头结论" htmlFor="review-hook-result">
                  <textarea
                    id="review-hook-result"
                    data-testid="review-hook-result"
                    value={form.hook_result}
                    onChange={(e) => updateForm({ hook_result: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="情绪结论" htmlFor="review-emotion-result">
                  <textarea
                    id="review-emotion-result"
                    data-testid="review-emotion-result"
                    value={form.emotion_result}
                    onChange={(e) => updateForm({ emotion_result: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="成功原因" htmlFor="review-success-reason">
                  <textarea
                    id="review-success-reason"
                    data-testid="review-success-reason"
                    value={form.success_reason}
                    onChange={(e) => updateForm({ success_reason: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="失败原因" htmlFor="review-failure-reason">
                  <textarea
                    id="review-failure-reason"
                    data-testid="review-failure-reason"
                    value={form.failure_reason}
                    onChange={(e) => updateForm({ failure_reason: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="是否继续这个赛道" htmlFor="review-continue-track">
                  <textarea
                    id="review-continue-track"
                    data-testid="review-continue-track"
                    value={form.continue_track}
                    onChange={(e) => updateForm({ continue_track: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="可复用结论" htmlFor="review-reusable-conclusion">
                  <textarea
                    id="review-reusable-conclusion"
                    data-testid="review-reusable-conclusion"
                    value={form.reusable_conclusion}
                    onChange={(e) => updateForm({ reusable_conclusion: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
                <Field label="下一步动作" htmlFor="review-next-action">
                  <textarea
                    id="review-next-action"
                    data-testid="review-next-action"
                    value={form.next_action}
                    onChange={(e) => updateForm({ next_action: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  />
                </Field>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => aiAnalyze.mutate()}
                  disabled={aiAnalyze.isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                  data-testid="review-ai-analyze-btn"
                >
                  {aiAnalyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  AI 一键分析
                </button>
                {aiAnalyze.isError && (
                  <span className="text-sm text-rose-600">
                    {aiAnalyze.error instanceof Error ? aiAnalyze.error.message : 'AI 分析失败'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    save.mutate({
                      projectId: selectedPending.project_id,
                      stage: selectedPending.stage,
                      payload: toPayload(form),
                    })
                  }
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  data-testid="review-save-btn"
                >
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存
                </button>
                {notice && <span className="text-sm text-emerald-600">{notice}</span>}
                {save.isError && (
                  <span className="text-sm text-rose-600">
                    {save.error instanceof Error ? save.error.message : '保存失败'}
                  </span>
                )}
                {selectedReview?.updated_at && (
                  <span className="text-sm text-gray-500">
                    最近更新 {formatDate(selectedReview.updated_at)}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <div className="mb-1 text-sm font-medium text-gray-700">{label}</div>
      {children}
    </label>
  )
}
