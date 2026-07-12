import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles, TriangleAlert, Check, Wand2, X, Loader2, Brain, ListPlus, Rocket, ArrowRight, History, ChevronDown, ChevronUp, Trash2, Flame } from 'lucide-react'
import {
  seedsApi,
  SCORE_V2_DIMS,
  isScoreV2,
  totalOfScore,
  tierOfScore,
  tierOfV2,
  toScoreV2,
  type AiScoreResponse,
  type AnyScore,
  type LegacyScore,
  type Score,
  type Tier,
} from '../api/seeds'
import { projectsApi, type Project } from '../api/projects'
import { extractErrorMessage } from '../api/errors'
import { useConfirm } from '../components/ConfirmDialog'
import { useBatchLaunch, type BatchInput } from '../hooks/useBatchLaunch'
import BatchLaunchPanel from '../components/BatchLaunchPanel'
import HeatBadge from '../components/HeatBadge'
import TrackPills from '../components/TrackPills'
import {
  composeTrack,
  DEFAULT_TRACK_PLOT,
  DEFAULT_TRACK_PRIMARY,
  defaultPlotForPrimary,
  splitTrack,
  TRACK_PLOT_OPTIONS,
  TRACK_PRIMARY_OPTIONS,
  type TrackPrimary,
} from '../lib/tracks'
import { looksLikeTestData } from '../lib/looksLikeTestData'

const DIM_LABELS = Object.fromEntries(SCORE_V2_DIMS.map((d) => [d.key, d.label])) as Record<
  keyof Score,
  string
>

const DIM_DESC = Object.fromEntries(SCORE_V2_DIMS.map((d) => [d.key, d.desc])) as Record<
  keyof Score,
  string
>

const DIM_KEYS = SCORE_V2_DIMS.map((d) => d.key)
const DEFAULT_SCORE: Score = { title_ctr: 8, conflict: 8, tagfit: 7, novelty: 7 }

/** 旧版 7 维标签，仅用于历史数据（含 title 字段）的展示。 */
const LEGACY_DIM_LABELS: Record<keyof LegacyScore, string> = {
  title: '标题点击感',
  opening: '开局炸裂度',
  slap: '打脸清晰度',
  emotion: '情绪强度',
  twist: '反转空间',
  hook: '试读卡点',
  finish: '完读驱动',
  tagfit: '赛道辨识度',
}

const TRACK_PILL_TONES = [
  'border-orange-200 bg-orange-50 text-orange-700',
  'border-green-200 bg-green-50 text-green-700',
  'border-blue-200 bg-blue-50 text-blue-700',
  'border-purple-200 bg-purple-50 text-purple-700',
  'border-rose-200 bg-rose-50 text-rose-700',
  'border-cyan-200 bg-cyan-50 text-cyan-700',
] as const

function toneForIndex(index: number): string {
  return TRACK_PILL_TONES[index % TRACK_PILL_TONES.length]
}

function tierOf(total: number): Tier {
  return tierOfV2(total)
}

const TIER_LABEL: Record<Tier, string> = { greenlight: '立项', backlog: '备选', reject: '不做' }
const TIER_BG: Record<Tier, string> = {
  greenlight: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  backlog: 'bg-amber-50 text-amber-700 border-amber-200',
  reject: 'bg-rose-50 text-rose-700 border-rose-200',
}

/** 测试垃圾启发式：以「测试 / e2e / smoke / playwright / test」开头 */
export default function Seeds() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const list = useQuery({ queryKey: ['seeds'], queryFn: seedsApi.list })
  const projectsList = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const projectBySeedId = useMemo(() => {
    const m = new Map<string, Project>()
    projectsList.data?.forEach((p) => m.set(p.seed_id, p))
    return m
  }, [projectsList.data])

  /** 已被立项且项目状态为 "已发" / "归档" 的标题集合，用于过滤历史候选。
   * 直接用项目标题匹配 draft 标题，不绕 seed_title→draft_title 间接关联。 */
  const finishedDraftTitles = useMemo(() => {
    if (!projectsList.data) return new Set<string>()
    const finished = new Set<string>()
    for (const p of projectsList.data) {
      if (p.status === 'published' || p.status === 'archived') {
        finished.add(p.title)
      }
    }
    return finished
  }, [projectsList.data])

  const create = useMutation({
    mutationFn: seedsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seeds'] }),
  })
  const removeSeed = useMutation({
    mutationFn: (id: string) => seedsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seeds'] })
      qc.invalidateQueries({ queryKey: ['ai-drafts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
  const projectize = useMutation({
    mutationFn: (seed_id: string) => projectsApi.createFromSeed(seed_id),
    onSuccess: (proj) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      navigate(`/projects/${proj.id}`)
    },
  })
  /** AI 候选「直接立项」：先 createSeed 再视情况自动 projectize。score 统一规整成新版 4 维。 */
  const adoptAndCreate = useMutation({
    mutationFn: async (c: { title: string; score: AnyScore }) => {
      const seed = await seedsApi.create({ title: c.title, track, score: toScoreV2(c.score) })
      return seed
    },
    onSuccess: (seed) => {
      qc.invalidateQueries({ queryKey: ['seeds'] })
      if (seed.tier === 'greenlight' || seed.tier === 'backlog') {
        projectize.mutate(seed.id)
      }
    },
  })

  const [title, setTitle] = useState('')
  const [trackPrimary, setTrackPrimary] = useState<TrackPrimary>(DEFAULT_TRACK_PRIMARY)
  const [trackPlots, setTrackPlots] = useState<string[]>([DEFAULT_TRACK_PLOT])
  const track = useMemo(() => composeTrack(trackPrimary, trackPlots), [trackPrimary, trackPlots])
  const [searchParams, setSearchParams] = useSearchParams()

  // 从账号复盘「推荐选题池」跳来时，?title= 预填标题（用一次即清掉，避免刷新重填）
  useEffect(() => {
    const preset = searchParams.get('title')
    if (preset) {
      setTitle(preset)
      const next = new URLSearchParams(searchParams)
      next.delete('title')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const [score, setScore] = useState<Score>(DEFAULT_SCORE)
  const [drawer, setDrawer] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [hideTestData, setHideTestData] = useState(true)
  const [whyBuy, setWhyBuy] = useState('')
  const [source, setSource] = useState('脑洞')
  const [romanceType, setRomanceType] = useState<'angsty' | 'sweet' | 'mixed'>('angsty')

  // 批量立项
  const batch = useBatchLaunch()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchTarget, setBatchTarget] = useState(10)
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // 历史候选批量选择（draftId）
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set())
  const toggleSelectDraft = (id: string) =>
    setSelectedDrafts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** 应用「隐藏测试」过滤后的种子列表 */
  const visibleSeeds = useMemo(() => {
    if (!list.data) return []
    return hideTestData ? list.data.filter((s) => !looksLikeTestData(s.title)) : list.data
  }, [list.data, hideTestData])
  const hiddenCount = (list.data?.length ?? 0) - visibleSeeds.length

  /** 可批量立项的种子：未立项 + 评分非「不做」 */
  const launchableSeeds = useMemo(
    () => visibleSeeds.filter((s) => !projectBySeedId.get(s.id) && s.tier !== 'reject'),
    [visibleSeeds, projectBySeedId],
  )
  const allLaunchableSelected =
    launchableSeeds.length > 0 && launchableSeeds.every((s) => selected.has(s.id))
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (launchableSeeds.every((s) => prev.has(s.id))) {
        const next = new Set(prev)
        launchableSeeds.forEach((s) => next.delete(s.id))
        return next
      }
      const next = new Set(prev)
      launchableSeeds.forEach((s) => next.add(s.id))
      return next
    })

  const runBatch = () => {
    const picks: BatchInput[] = launchableSeeds
      .filter((s) => selected.has(s.id))
      .map((s) => ({ kind: 'seed' as const, key: s.id, title: s.title, seedId: s.id }))
    if (picks.length === 0) return
    batch.run(picks, batchTarget)
    setSelected(new Set())
  }

  /** 历史候选批量：先建种子→立项→跑全流程。已立项为「已发/归档」的候选不可选。 */
  const runBatchDrafts = () => {
    const byTitle = drafts.data ?? []
    const picks: BatchInput[] = byTitle
      .filter((d) => selectedDrafts.has(d.id) && d.total_score >= 22)
      .map((d) => ({
        kind: 'draft' as const,
        key: d.id,
        title: d.title,
        track: d.track,
        score: toScoreV2(d.score),
      }))
    if (picks.length === 0) return
    batch.run(picks, batchTarget)
    setSelectedDrafts(new Set())
  }

  const aiScore = useMutation<AiScoreResponse, Error, { title: string; track: string }>({
    mutationFn: seedsApi.aiScore,
  })

  const aiGen = useMutation({
    mutationFn: (t: string) => seedsApi.aiGenerate(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-drafts'] }),
  })

  /** AI 推荐主分类+情节组合 */
  const aiRecommendTrack = useMutation({
    mutationFn: () =>
      seedsApi.aiRecommendTrack(
        [...TRACK_PRIMARY_OPTIONS],
        [...TRACK_PLOT_OPTIONS],
      ),
  })

  /** 回填历史候选热度+推荐原因 */
  const backfillHeat = useMutation({
    mutationFn: () => seedsApi.aiBackfillHeat(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-drafts'] }),
  })

  /** 应用一条推荐到当前赛道选择（只取选项里合法的值） */
  const applyTrackRecommendation = (rec: { primary: string; plots: string[] }) => {
    const primaryOk = (TRACK_PRIMARY_OPTIONS as readonly string[]).includes(rec.primary)
    if (primaryOk) setTrackPrimary(rec.primary as TrackPrimary)
    const plots = rec.plots.filter((p) =>
      (TRACK_PLOT_OPTIONS as readonly string[]).includes(p),
    )
    if (plots.length > 0) setTrackPlots(plots)
  }

  /** 候选历史：全部赛道、按时间倒序，跨刷新和换标签都在 */
  const drafts = useQuery({
    queryKey: ['ai-drafts'],
    queryFn: () => seedsApi.aiDrafts(undefined, 200),
  })

  /** AI 一键立项：评分卡上的紫色主推按钮 */
  const aiLaunch = useMutation({
    mutationFn: (t: string) => seedsApi.aiLaunch(t),
    onSuccess: (proj) => {
      qc.invalidateQueries({ queryKey: ['seeds'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['ai-drafts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      navigate(`/projects/${proj.id}`)
    },
  })

  const aiTotal = aiScore.data
    ? DIM_KEYS.reduce((a, k) => a + aiScore.data!.score[k], 0)
    : 0
  const aiTier = aiScore.data ? tierOf(aiTotal) : null

  function runAiScore() {
    if (!title.trim() || titleErr) return
    setDrawer(true)
    aiScore.mutate({ title: title.trim(), track })
  }

  function adoptAiScore() {
    if (!aiScore.data) return
    setScore(aiScore.data.score)
    setDrawer(false)
  }

  const total = useMemo(() => DIM_KEYS.reduce((a, k) => a + score[k], 0), [score])
  const tier = tierOf(total)
  const titleLen = useMemo(() => Array.from(title).length, [title])
  const titleErr = titleLen === 0 ? null : titleLen > 25 ? `标题超过 25 字（${titleLen}）` : null
  const canSubmit = !!title.trim() && !titleErr && !create.isPending && !projectize.isPending

  function onSubmit() {
    if (!canSubmit) return
    create.mutate(
      { title: title.trim(), track, score },
      {
        onSuccess: (seed) => {
          setTitle('')
          setScore(DEFAULT_SCORE)
          // 绿灯（>=28）自动立项 + 跳转去项目明细
          if (seed.tier === 'greenlight') {
            projectize.mutate(seed.id)
          }
        },
      },
    )
  }

  function adoptCandidate(c: { title: string; score: AnyScore; why_buy?: string }) {
    setTitle(c.title)
    setScore(toScoreV2(c.score))
    aiScore.reset()
    // 滚到评分卡
    document.querySelector('[data-testid="seed-title"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <>
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <BatchLaunchPanel
        state={batch.state}
        onAbort={batch.abort}
        onClose={batch.reset}
        onRetryFailed={batch.retryFailed}
      />
      {/* AI 批量生成选题（紧凑可折叠） */}
      <section
        className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
        data-testid="ai-generate-panel"
      >
        <button
          type="button"
          onClick={() => setAiPanelOpen((v) => !v)}
          className="flex w-full items-center gap-4 bg-slate-50 px-5 py-4 text-left"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <Brain className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">AI 批量出选题</h2>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-600 shadow-sm">
                {track}
              </span>
              {drafts.data && drafts.data.length > 0 && (
                <span className="text-[11px] text-slate-400">历史 {drafts.data.length} 候选</span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              先定赛道，再批量生成标题，最后挑高分候选推进立项。
            </p>
          </div>
          {aiPanelOpen ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {aiPanelOpen && (
          <div className="border-t border-slate-100 px-5 py-5">
            {/* AI 推荐主分类+情节组合 */}
            <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
                    <Brain className="h-3.5 w-3.5" /> AI 推荐组合
                  </div>
                  <p className="mt-1 text-xs text-violet-500">
                    不知道做什么？让 AI 按当下热度推荐「主分类 + 情节」组合，点一下直接套用。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => aiRecommendTrack.mutate()}
                  disabled={aiRecommendTrack.isPending}
                  data-testid="ai-recommend-track-btn"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
                >
                  {aiRecommendTrack.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  {aiRecommendTrack.isPending ? 'AI 推荐中…' : 'AI 推荐组合'}
                </button>
              </div>
              {aiRecommendTrack.isError && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  推荐失败：{(aiRecommendTrack.error as Error)?.message}
                </div>
              )}
              {aiRecommendTrack.data && aiRecommendTrack.data.length > 0 && (
                <ul className="mt-3 grid gap-2 sm:grid-cols-3" data-testid="track-recommend-list">
                  {aiRecommendTrack.data.map((rec, i) => (
                    <li
                      key={i}
                      className="flex flex-col rounded-xl border border-violet-200 bg-white p-3"
                      data-testid={`track-recommend-${i}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">{rec.primary}</span>
                        {rec.heat && <HeatBadge heat={rec.heat} className="shrink-0" />}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {rec.plots.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                      {rec.reason && (
                        <p className="mt-2 text-[11px] leading-5 text-slate-500 line-clamp-2">
                          {rec.reason}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => applyTrackRecommendation(rec)}
                        className="mt-2 inline-flex items-center justify-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
                        data-testid={`track-recommend-apply-${i}`}
                      >
                        套用这组
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    主分类
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    只能选一个，先定受众和情绪大盘。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2" data-testid="track-primary-grid">
                  {TRACK_PRIMARY_OPTIONS.map((value, index) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setTrackPrimary(value)
                        setTrackPlots((current) =>
                          current.length === 1
                            ? [defaultPlotForPrimary(value)]
                            : current,
                        )
                      }}
                      data-testid={`gen-track-primary-${value}`}
                      className={`relative inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        trackPrimary === value
                          ? `${toneForIndex(index)} ring-2 ring-offset-1 ring-current shadow-sm`
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
                      情节标签
                    </div>
                    <p className="mt-1 text-xs text-violet-500">
                      可多选，补冲突钩子、关系结构和爽点方向。
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700">
                    已选 {trackPlots.length}
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-violet-100 bg-white/80 p-3" data-testid="track-plot-selected">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600">
                        已选情节
                      </div>
                      <button
                        type="button"
                        onClick={() => setTrackPlots([defaultPlotForPrimary(trackPrimary)])}
                        className="text-[11px] text-violet-500 hover:text-violet-700"
                        data-testid="track-plot-reset"
                      >
                        重置
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {trackPlots.map((plot) => (
                        <button
                          key={plot}
                          type="button"
                          onClick={() => {
                            setTrackPlots((current) => {
                              const next = current.filter((item) => item !== plot)
                              return next.length > 0 ? next : [DEFAULT_TRACK_PLOT]
                            })
                          }}
                          data-testid={`gen-track-plot-${plot}`}
                          className="inline-flex items-center rounded-full border border-violet-200 bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 ring-2 ring-offset-1 ring-violet-200 transition"
                        >
                          {plot}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-violet-100 bg-white/60 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600">
                      可选情节
                    </div>
                    <div className="max-h-52 overflow-y-auto px-1 pt-1 pr-1">
                      <div className="flex flex-wrap gap-2 overflow-visible" data-testid="track-plot-available">
                        {TRACK_PLOT_OPTIONS.filter((plot) => !trackPlots.includes(plot)).map((plot) => (
                          <button
                            key={plot}
                            type="button"
                            onClick={() => setTrackPlots((current) => [...current, plot])}
                            data-testid={`gen-track-plot-${plot}`}
                            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                          >
                            {plot}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-600">
                  当前组合赛道
                </div>
                <div className="mt-1 break-all text-sm font-semibold text-slate-900">
                  {track}
                </div>
              </div>
              <button
                type="button"
                onClick={() => aiGen.mutate(track)}
                disabled={aiGen.isPending}
                data-testid="ai-generate-btn"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
              >
                {aiGen.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {aiGen.isPending ? 'AI 生成中…' : `生成 5 个候选`}
              </button>
            </div>

          {aiGen.isError && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">生成失败</div>
                <div className="mt-1 text-xs">{(aiGen.error as Error)?.message}</div>
              </div>
            </div>
          )}

          {aiGen.data && (
            <div className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
                <Wand2 className="h-3.5 w-3.5" /> 本次生成（{aiGen.data.candidates.length}）
              </div>
              <ul className="grid gap-3 lg:grid-cols-2">
                {aiGen.data.candidates.map((c, i) => (
                  <CandidateCard
                    key={`fresh-${i}`}
                    title={c.title}
                    score={c.score}
                    why_buy={c.why_buy}
                    recommendReason={c.recommend_reason}
                    heat={c.heat}
                    testIdPrefix={`gen`}
                    index={i}
                    onAdopt={() => adoptCandidate(c)}
                    onLaunch={() => adoptAndCreate.mutate(c)}
                    isLaunching={adoptAndCreate.isPending && adoptAndCreate.variables === c}
                    disabled={adoptAndCreate.isPending || projectize.isPending}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* 历史候选：全部赛道、按时间倒序，跨刷新和换标签都在。
              已被立项为「已发」/「归档」的标题会被隐藏，不占列表空间。 */}
          {drafts.data && drafts.data.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <History className="h-3.5 w-3.5" /> 历史候选 · 全部赛道（{
                  drafts.data.filter((d) =>
                    !aiGen.data?.candidates.some((c) => c.title === d.title) &&
                    !finishedDraftTitles.has(d.title)
                  ).length
                }）
                <button
                  type="button"
                  onClick={() => backfillHeat.mutate()}
                  disabled={backfillHeat.isPending}
                  className="ml-1 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                  data-testid="backfill-heat-btn"
                  title="给还没有热度的历史候选补全热度+推荐原因（一次最多 60 个，可多次点）"
                >
                  {backfillHeat.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Flame className="h-3 w-3" />
                  )}
                  {backfillHeat.isPending ? '补全中…' : '补全历史热度'}
                </button>
                {backfillHeat.data && (
                  <span className="text-[11px] font-medium normal-case tracking-normal text-emerald-600">
                    已补 {backfillHeat.data.updated_titles} 个标题
                  </span>
                )}
                {selectedDrafts.size > 0 && (
                  <span className="ml-2 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 normal-case tracking-normal">
                    <span className="text-[11px] font-medium text-violet-700">
                      已选 {selectedDrafts.size}
                    </span>
                    <button
                      type="button"
                      onClick={runBatchDrafts}
                      disabled={batch.state.running}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                      data-testid="batch-launch-drafts-btn"
                      title="对选中候选先建种子再立项，并发跑全流程"
                    >
                      {batch.state.running ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Rocket className="h-3 w-3" />
                      )}
                      批量立项 + 全流程
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedDrafts(new Set())}
                      className="text-[11px] text-violet-500 hover:text-violet-700"
                    >
                      清空
                    </button>
                  </span>
                )}
              </div>
              <ul className="grid gap-3 lg:grid-cols-2" data-testid="drafts-list">
                {drafts.data
                  // 已经在「本次生成」批次的，避免重复
                  .filter((d) => !aiGen.data?.candidates.some((c) => c.title === d.title))
                  // 已被立项为「已发」/「归档」项目的候选不再展示
                  .filter((d) => !finishedDraftTitles.has(d.title))
                  .map((d, i) => (
                    <CandidateCard
                      key={d.id}
                      title={d.title}
                      score={d.score}
                      why_buy={d.why_buy}
                      recommendReason={d.recommend_reason}
                      heat={d.heat}
                      track={d.track}
                      testIdPrefix="draft"
                      index={i}
                      muted
                      onAdopt={() =>
                        adoptCandidate({ title: d.title, score: d.score, why_buy: d.why_buy })
                      }
                      onLaunch={() =>
                        adoptAndCreate.mutate({
                          title: d.title,
                          score: d.score,
                        })
                      }
                      isLaunching={false}
                      disabled={adoptAndCreate.isPending || projectize.isPending}
                      selectable={d.total_score >= 22}
                      selected={selectedDrafts.has(d.id)}
                      onToggleSelect={() => toggleSelectDraft(d.id)}
                    />
                  ))}
              </ul>
            </div>
          )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-6 lg:sticky lg:top-20">
          <header className="mb-4 flex flex-wrap items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <h1 className="text-lg font-semibold">选题评分卡</h1>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 sm:inline-flex">
              4 维 · 每维 1-10 · 立项 ≥30 / 备选 ≥22
            </span>
            <button
              type="button"
              onClick={() => aiLaunch.mutate(track)}
              disabled={aiLaunch.isPending}
              data-testid="ai-launch-btn"
              title={`基于赛道「${track}」让 AI 直接生成最高分选题并立项进入项目明细`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
            >
              {aiLaunch.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              {aiLaunch.isPending ? 'AI 生成中…自动跳项目' : 'AI 一键立项'}
            </button>
          </header>
          {aiLaunch.isError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                AI 立项失败：{(aiLaunch.error as Error)?.message}
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700">脑洞标题</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：婚礼彩排那天伴娘群里弹出他和伴娘的开房记录"
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm outline-none ${
                titleErr ? 'border-rose-300 focus:border-rose-500' : 'border-gray-300 focus:border-blue-500'
              }`}
              maxLength={50}
              data-testid="seed-title"
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className={titleErr ? 'text-rose-600' : 'text-gray-400'}>
                {titleErr ?? `${titleLen} / 25`}
              </span>
              <button
                type="button"
                onClick={runAiScore}
                disabled={!title.trim() || !!titleErr || aiScore.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="ai-score-btn"
              >
                {aiScore.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                AI 试评
              </button>
            </div>
          </label>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">来源</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                data-testid="seed-source"
              >
                {['脑洞', '爆款标题拆解', '评论区痛点', '对标账号'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <span className="text-xs text-gray-400">赛道由下方配置生成</span>
            </div>
          </div>

          <label className="block mt-4">
            <span className="text-sm font-medium text-gray-700">一句话卖点</span>
            <textarea
              value={whyBuy}
              onChange={(e) => setWhyBuy(e.target.value)}
              rows={2}
              placeholder="谁 + 在什么死局里 + 怎么反杀"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              data-testid="seed-why-buy"
            />
            <p className="mt-1 text-xs text-gray-400">格式：角色 + 处境 + 动作</p>
          </label>

          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              当前赛道设定
            </div>
            <TrackPills track={track} />
          </div>

          <label className="block mt-4">
            <span className="text-sm font-medium text-gray-700">主分类</span>
            <select
              value={trackPrimary}
              onChange={(e) => {
                const nextPrimary = e.target.value as TrackPrimary
                setTrackPrimary(nextPrimary)
                setTrackPlots((current) =>
                  current.length === 1
                    ? [defaultPlotForPrimary(nextPrimary)]
                    : current,
                )
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              data-testid="seed-track-primary"
            >
              {TRACK_PRIMARY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block mt-4">
            <span className="text-sm font-medium text-gray-700">情节（可多选）</span>
            <div className="mt-2 flex flex-wrap gap-2" data-testid="seed-track-plot">
              {TRACK_PLOT_OPTIONS.map((value) => {
                const active = trackPlots.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setTrackPlots((current) => {
                        if (current.includes(value)) {
                          const next = current.filter((item) => item !== value)
                          return next.length > 0 ? next : [DEFAULT_TRACK_PLOT]
                        }
                        return [...current, value]
                      })
                    }}
                    data-testid={`seed-track-plot-${value}`}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-violet-200 bg-violet-50 text-violet-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
          </label>

          <label className="block mt-4">
            <span className="text-sm font-medium text-gray-700">最终赛道</span>
            <input
              type="text"
              value={track}
              onChange={(e) => {
                const parsed = splitTrack(e.target.value)
                setTrackPrimary(parsed.primary as TrackPrimary)
                setTrackPlots(parsed.plots)
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              data-testid="seed-track"
            />
            <p className="mt-1 text-xs text-gray-400">
              系统按“主分类·情节”组合保存，兼容历史单字符串赛道。
            </p>
          </label>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">4 维度评分</h3>
                <p className="mt-0.5 text-xs text-gray-500">每项 1-10 · 满分 40</p>
              </div>
              <div className="text-right">
                <div className={`text-3xl font-bold font-mono ${tier === 'greenlight' ? 'text-emerald-600' : tier === 'backlog' ? 'text-amber-600' : 'text-rose-600'}`} data-testid="score-total">{total}</div>
                <div className={`text-xs font-semibold ${tier === 'greenlight' ? 'text-emerald-700' : tier === 'backlog' ? 'text-amber-700' : 'text-rose-700'}`} data-testid="tier-label">{TIER_LABEL[tier]}</div>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {DIM_KEYS.map((k) => (
                <div key={k} className="grid grid-cols-[1fr_auto_2fr_auto] items-center gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">{DIM_LABELS[k]}</div>
                    <div className="mt-0.5 text-xs text-gray-500 truncate">{DIM_DESC[k]}</div>
                  </div>
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${score[k] >= 9 ? 'bg-emerald-100 text-emerald-700' : score[k] >= 7 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`} data-testid={`score-${k}`}>
                    {score[k]}
                  </span>
                  <input
                    type="range" min={1} max={10} value={score[k]}
                    onChange={(e) => setScore({ ...score, [k]: Number(e.target.value) })}
                    className="w-full"
                    data-testid={`slider-${k}`}
                    aria-label={DIM_LABELS[k]}
                  />
                  <span className="w-5 text-xs text-gray-400">/10</span>
                </div>
              ))}
            </div>
          </div>

          {/* 言情向附加 */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-900">言情向附加</h3>
              <p className="mt-0.5 text-xs text-gray-500">现言/古言赛道填写</p>
            </div>
            <div className="p-5">
              <div className="text-sm font-medium text-gray-700 mb-2">类型</div>
              <div className="flex flex-wrap gap-2">
                {(['angsty', 'sweet', 'mixed'] as const).map((t) => {
                  const label = { angsty: '虐爽向', sweet: '甜宠向', mixed: '虐爽转甜宠' }[t]
                  return (
                    <label key={t} className={`inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-sm transition ${
                      romanceType === t ? 'border-blue-300 bg-blue-50 font-medium text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                      <input type="radio" name="romance-type" checked={romanceType === t} onChange={() => setRomanceType(t)} className="mr-1.5 h-3.5 w-3.5" />
                      {label}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={onSubmit}
              className="ml-auto inline-flex h-9 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              data-testid="submit-seed"
            >
              {create.isPending ? '提交中…' : projectize.isPending ? '立项中…' : tier === 'greenlight' ? '立项 →' : tier === 'backlog' ? '入备选池' : '保存（不立项）'}
            </button>
          </div>

          {create.isError && (
            <p className="mt-3 text-sm text-rose-600 flex items-center gap-1">
              <TriangleAlert className="h-4 w-4" />
              提交失败：{extractErrorMessage(create.error)}
            </p>
          )}
          {create.isSuccess && !create.isPending && (
            <p className="mt-3 text-sm text-emerald-600 flex items-center gap-1">
              <Check className="h-4 w-4" />
              已落库
            </p>
          )}
        </section>

        <aside className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:sticky lg:top-20">
          <header className="sticky top-0 z-10 -mx-5 -mt-5 mb-4 space-y-2 border-b border-slate-100 bg-white px-5 pt-5 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">最近选题</h2>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {visibleSeeds.length} 条可见
                  {hiddenCount > 0 ? `，已隐藏 ${hiddenCount} 条测试数据` : ''}
                </p>
              </div>
              <label className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideTestData}
                  onChange={(e) => setHideTestData(e.target.checked)}
                  className="h-3 w-3"
                  data-testid="hide-test-data-toggle"
                />
                隐藏测试
              </label>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              绿灯项目可直接点进项目明细，未立项的种子可继续推进。
            </div>
            {/* 批量立项操作条 */}
            {launchableSeeds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2">
                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allLaunchableSelected}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 accent-violet-600"
                    data-testid="batch-select-all"
                  />
                  全选可立项（{launchableSeeds.length}）
                </label>
                <span className="text-[11px] text-violet-500">已选 {selected.size}</span>
                <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-violet-600">
                  章数
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={batchTarget}
                    onChange={(e) => setBatchTarget(Number(e.target.value))}
                    className="w-12 rounded border border-violet-200 px-1.5 py-0.5 text-center text-xs"
                    data-testid="batch-target"
                  />
                </label>
                <button
                  type="button"
                  onClick={runBatch}
                  disabled={selected.size === 0 || batch.state.running}
                  className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
                  data-testid="batch-launch-btn"
                  title="并发跑全流程，带失败自动重试"
                >
                  {batch.state.running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  批量立项 + 全流程
                </button>
              </div>
            )}
          </header>
          {list.isLoading && <p className="text-sm text-gray-400">加载中…</p>}
          {list.isError && <p className="text-sm text-rose-600">读取失败</p>}
          {visibleSeeds.length === 0 && !list.isLoading && (
            <p className="text-sm text-gray-400">
              {hiddenCount > 0 ? '已全部被「隐藏测试」过滤' : '还没有选题'}
            </p>
          )}
          <ul className="space-y-2" data-testid="seeds-list">
            {visibleSeeds.map((s) => {
              const proj = projectBySeedId.get(s.id)
              const canLaunch = !proj && s.tier !== 'reject'
              const onClick = () => {
                if (proj) navigate(`/projects/${proj.id}`)
                else if (canLaunch) projectize.mutate(s.id)
              }
              const clickable = !!proj || canLaunch
              return (
                <li
                  key={s.id}
                  data-testid="seed-item"
                  onClick={clickable ? onClick : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onClick()
                          }
                        }
                      : undefined
                  }
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={`group rounded-md border border-gray-200 p-2 text-xs transition ${
                    clickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/40' : 'opacity-70'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {canLaunch && (
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelect(s.id)}
                            className="h-3.5 w-3.5 shrink-0 accent-violet-600"
                            data-testid="seed-select"
                            aria-label={`选择 ${s.title}`}
                          />
                        )}
                        <span className="font-medium text-gray-900 truncate">{s.title}</span>
                      </span>
                      <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold ${TIER_BG[s.tier]}`}>
                        {TIER_LABEL[s.tier]}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-gray-500">
                      <div className="min-w-0 flex-1">
                        <TrackPills track={s.track} compact />
                      </div>
                      <span className="font-mono">{s.total_score}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    {proj ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-600">
                        <ArrowRight className="h-3 w-3" /> 进项目明细
                      </span>
                    ) : canLaunch ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                        <Rocket className="h-3 w-3" /> 点这一行立项 + 进项目
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-400">评分不足，已归档</span>
                    )}
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const ok = await confirm({
                          title: `删除「${s.title}」？`,
                          description: proj ? (
                            <>
                              这条种子已被项目「{proj.title}」立项，
                              <span className="font-semibold text-rose-600">无法直接删</span>。
                              先删项目再删种子。
                            </>
                          ) : (
                            <>
                              评分卡和 AI 历史候选不会删，
                              仅删除这条种子记录。<span className="text-gray-500">不可恢复</span>。
                            </>
                          ),
                          confirmText: proj ? '我知道了' : '删除',
                          tone: 'danger',
                        })
                        if (ok && !proj) removeSeed.mutate(s.id)
                      }}
                      disabled={removeSeed.isPending && removeSeed.variables === s.id}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded p-1 text-rose-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 transition"
                      title={proj ? '已被立项不可直接删' : '删除种子'}
                      data-testid="seed-delete-btn"
                      aria-label="删除种子"
                    >
                      {removeSeed.isPending && removeSeed.variables === s.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </main>

    {drawer && (
      <div className="fixed inset-0 z-40" data-testid="ai-drawer">
        <div
          className="absolute inset-0 bg-black/30"
          onClick={() => setDrawer(false)}
        />
        <aside className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-white shadow-xl border-l border-gray-200 flex flex-col">
          <header className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
            <Wand2 className="h-4 w-4 text-violet-600" />
            <h2 className="font-semibold text-gray-900">AI 试评</h2>
            <button
              type="button"
              className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onClick={() => setDrawer(false)}
              data-testid="ai-drawer-close"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="text-xs text-gray-500 mb-3">
              用 Claude 按 7 维爽文标准给「{title}」打分。
            </p>

            {aiScore.isPending && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI 评估中（通常 4-10 秒）…
              </div>
            )}

            {aiScore.isError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <div className="flex items-center gap-1 font-medium">
                  <TriangleAlert className="h-4 w-4" />
                  调用失败
                </div>
                <p className="mt-1 text-xs whitespace-pre-wrap">
                  {(aiScore.error as Error).message}
                </p>
                <button
                  type="button"
                  onClick={runAiScore}
                  className="mt-2 inline-flex items-center rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700"
                >
                  重试
                </button>
              </div>
            )}

            {aiScore.data && (
              <div className="space-y-4" data-testid="ai-result">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold font-mono text-gray-900" data-testid="ai-total">
                    {aiTotal}
                  </span>
                  <span className="text-sm text-gray-500">/ 40</span>
                  {aiTier && (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_BG[aiTier]}`}>
                      {TIER_LABEL[aiTier]}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {DIM_KEYS.map((k) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-gray-600">{DIM_LABELS[k]}</span>
                      <span className="font-mono font-semibold text-gray-900">
                        {aiScore.data!.score[k]}
                      </span>
                    </div>
                  ))}
                </div>

                {aiScore.data.benchmark && (
                  <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-xs leading-relaxed text-violet-700" data-testid="ai-benchmark">
                    <span className="font-semibold">对标爆款：</span>
                    {aiScore.data.benchmark}
                  </div>
                )}

                <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm leading-relaxed text-gray-700">
                  {aiScore.data.rationale}
                </div>

                {aiScore.data.suggestions.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-700 mb-1">优化建议</h3>
                    <ul className="space-y-1 text-sm text-gray-600 list-disc pl-5">
                      {aiScore.data.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {aiScore.data && (
            <footer className="border-t border-gray-200 px-5 py-3 flex gap-2">
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={adoptAiScore}
                className="flex-1 rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                data-testid="ai-adopt"
              >
                采纳分数
              </button>
            </footer>
          )}
        </aside>
      </div>
    )}
    </>
  )
}

interface CandidateCardProps {
  title: string
  score: AnyScore
  why_buy: string
  index: number
  testIdPrefix: 'gen' | 'draft'
  onAdopt: () => void
  onLaunch: () => void
  isLaunching: boolean
  disabled: boolean
  muted?: boolean
  /** 历史候选展示自己的赛道，方便跨赛道一眼区分 */
  track?: string
  /** 批量选择（仅历史候选用）；传了才渲染勾选框 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** AI 推荐原因 + 目前热度（仅本次生成的新候选有） */
  recommendReason?: string
  heat?: string
}

function CandidateCard({
  title,
  score,
  why_buy,
  index,
  testIdPrefix,
  onAdopt,
  onLaunch,
  isLaunching,
  disabled,
  muted,
  track,
  selectable,
  selected,
  onToggleSelect,
  recommendReason,
  heat,
}: CandidateCardProps) {
  const total = totalOfScore(score)
  const t = tierOfScore(score)
  // 新旧版本各自渲染对应维度（旧草稿仍是 7 维 1-5）
  const dimEntries: Array<[string, number]> = isScoreV2(score)
    ? SCORE_V2_DIMS.map((d) => [d.label, score[d.key]])
    : (Object.keys(LEGACY_DIM_LABELS) as Array<keyof LegacyScore>)
        .filter((k) => typeof (score as LegacyScore)[k] === 'number')
        .map((k) => [LEGACY_DIM_LABELS[k], (score as LegacyScore)[k] as number])
  return (
    <li
      data-testid={`${testIdPrefix}-candidate-${index}`}
      className={`rounded-2xl border border-slate-200 p-4 ${muted ? 'bg-white' : 'bg-slate-50/70'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {selectable && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              className="mt-1 h-3.5 w-3.5 shrink-0 accent-violet-600"
              data-testid={`${testIdPrefix}-select-${index}`}
              aria-label={`选择 ${title}`}
            />
          )}
          <h3 className="text-sm font-semibold text-gray-900 leading-6">{title}</h3>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_BG[t]}`}
        >
          {TIER_LABEL[t]} · {total}
        </span>
      </div>
      {track && (
        <div className="mt-1.5" data-testid={`${testIdPrefix}-track-${index}`}>
          <TrackPills track={track} compact />
        </div>
      )}
      {heat && (
        <div className="mt-1.5" data-testid={`${testIdPrefix}-heat-${index}`}>
          <HeatBadge heat={heat} />
        </div>
      )}
      <p className="mt-2 text-xs leading-6 text-slate-500 line-clamp-3">{why_buy}</p>
      {recommendReason && (
        <p
          className="mt-1.5 flex items-start gap-1 text-[11px] leading-5 text-violet-600"
          data-testid={`${testIdPrefix}-reason-${index}`}
        >
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">推荐：{recommendReason}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {dimEntries.map(([label, val]) => (
          <span
            key={label}
            className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200"
            title={label}
          >
            {label.slice(0, 2)} {val}
          </span>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onAdopt}
          data-testid={`${testIdPrefix}-adopt-${index}`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <ListPlus className="h-3.5 w-3.5" /> 填入评分卡
        </button>
        <button
          type="button"
          disabled={t === 'reject' || disabled}
          onClick={onLaunch}
          data-testid={`${testIdPrefix}-launch-${index}`}
          title={t === 'reject' ? '评分不足 23 分，先用「填入评分卡」改一下' : ''}
          className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm ${
            t === 'greenlight'
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : t === 'backlog'
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'cursor-not-allowed bg-gray-200 text-gray-500'
          } disabled:opacity-60`}
        >
          {isLaunching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Rocket className="h-3.5 w-3.5" />
          )}
          {t === 'greenlight' ? '立项 + 进项目' : t === 'backlog' ? '立项备选' : '不做'}
        </button>
      </div>
    </li>
  )
}
