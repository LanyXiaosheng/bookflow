import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Sparkles, TriangleAlert, Check, Wand2, X, Loader2, Brain, ListPlus, Rocket, ArrowRight, History, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { seedsApi, type AiScoreResponse, type AiSeedCandidate, type Score, type Tier } from '../api/seeds'
import { projectsApi, type Project } from '../api/projects'
import { useConfirm } from '../components/ConfirmDialog'

const DIM_LABELS: Record<keyof Score, string> = {
  title: '标题张力',
  opening: '开篇钩子',
  slap: '打脸力度',
  emotion: '情绪饱和度',
  twist: '反转锐度',
  hook: '章末钩子',
  finish: '结局解恨度',
}

const DIM_KEYS = Object.keys(DIM_LABELS) as Array<keyof Score>
const DEFAULT_SCORE: Score = { title: 5, opening: 5, slap: 5, emotion: 4, twist: 4, hook: 5, finish: 5 }

const TRACKS = [
  { value: '现言婚恋火葬场', tone: 'border-orange-200 bg-orange-50 text-orange-700' },
  { value: '古言重生打脸', tone: 'border-green-200 bg-green-50 text-green-700' },
  { value: '古言替嫁冲喜', tone: 'border-blue-200 bg-blue-50 text-blue-700' },
  { value: '悬疑规则怪谈', tone: 'border-purple-200 bg-purple-50 text-purple-700' },
] as const

function tierOf(total: number): Tier {
  if (total >= 28) return 'greenlight'
  if (total >= 23) return 'backlog'
  return 'reject'
}

const TIER_LABEL: Record<Tier, string> = { greenlight: '立项', backlog: '备选', reject: '不做' }
const TIER_BG: Record<Tier, string> = {
  greenlight: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  backlog: 'bg-amber-50 text-amber-700 border-amber-200',
  reject: 'bg-rose-50 text-rose-700 border-rose-200',
}

/** 测试垃圾启发式：以「测试 / e2e / smoke / playwright / test」开头 */
const TEST_PREFIX_RE = /^(测试|e2e|smoke|playwright|test)/i
function looksLikeTestData(title: string): boolean {
  return TEST_PREFIX_RE.test(title.trim())
}

/** 抽 axios 错误的人类信息：优先后端 detail，其次 message */
function extractErrorMessage(err: unknown): string {
  if (!err) return '未知错误'
  // axios error
  const anyErr = err as { response?: { data?: { detail?: string; error?: string } }; message?: string }
  const data = anyErr.response?.data
  if (data?.detail) return data.detail
  if (data?.error) return data.error
  return anyErr.message ?? String(err)
}

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
      navigate(`/projects/${proj.id}/write`)
    },
  })
  /** AI 候选「直接立项」：先 createSeed 再视情况自动 projectize */
  const adoptAndCreate = useMutation({
    mutationFn: async (c: AiSeedCandidate) => {
      const seed = await seedsApi.create({ title: c.title, track, score: c.score })
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
  const [track, setTrack] = useState('现言婚恋火葬场')
  const [score, setScore] = useState<Score>(DEFAULT_SCORE)
  const [drawer, setDrawer] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [hideTestData, setHideTestData] = useState(true)

  /** 应用「隐藏测试」过滤后的种子列表 */
  const visibleSeeds = useMemo(() => {
    if (!list.data) return []
    return hideTestData ? list.data.filter((s) => !looksLikeTestData(s.title)) : list.data
  }, [list.data, hideTestData])
  const hiddenCount = (list.data?.length ?? 0) - visibleSeeds.length

  const aiScore = useMutation<AiScoreResponse, Error, { title: string; track: string }>({
    mutationFn: seedsApi.aiScore,
  })

  const aiGen = useMutation({
    mutationFn: (t: string) => seedsApi.aiGenerate(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-drafts'] }),
  })

  /** 候选历史：跟随当前 track */
  const drafts = useQuery({
    queryKey: ['ai-drafts', track],
    queryFn: () => seedsApi.aiDrafts(track, 30),
  })

  /** AI 一键立项：评分卡上的紫色主推按钮 */
  const aiLaunch = useMutation({
    mutationFn: (t: string) => seedsApi.aiLaunch(t),
    onSuccess: (proj) => {
      qc.invalidateQueries({ queryKey: ['seeds'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['ai-drafts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      navigate(`/projects/${proj.id}/write`)
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
          // 绿灯（>=28）自动立项 + 跳转去写作
          if (seed.tier === 'greenlight') {
            projectize.mutate(seed.id)
          }
        },
      },
    )
  }

  function adoptCandidate(c: AiSeedCandidate) {
    setTitle(c.title)
    setScore(c.score)
    aiScore.reset()
    // 滚到评分卡
    document.querySelector('[data-testid="seed-title"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <>
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* AI 批量生成选题（紧凑可折叠） */}
      <section
        className="mb-4 rounded-lg bg-white shadow-sm ring-1 ring-gray-200"
        data-testid="ai-generate-panel"
      >
        <button
          type="button"
          onClick={() => setAiPanelOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-3 text-left"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <Brain className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">AI 批量出选题</h2>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${TRACKS.find((t) => t.value === track)?.tone ?? 'border-gray-200 bg-white text-gray-600'}`}>
                {track}
              </span>
              {drafts.data && drafts.data.length > 0 && (
                <span className="text-[11px] text-gray-400">历史 {drafts.data.length} 候选</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">
              选赛道 → AI 一次出 5 个标题 + 7 维评分 → 一键立项
            </p>
          </div>
          {aiPanelOpen ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </button>

        {aiPanelOpen && (
          <div className="border-t border-gray-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {TRACKS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTrack(t.value)}
                data-testid={`gen-track-${t.value}`}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  track === t.value
                    ? `${t.tone} ring-2 ring-offset-1 ring-current`
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.value}
              </button>
            ))}
            <button
              type="button"
              onClick={() => aiGen.mutate(track)}
              disabled={aiGen.isPending}
              data-testid="ai-generate-btn"
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
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
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-violet-700">
                <Wand2 className="h-3.5 w-3.5" /> 本次生成（{aiGen.data.candidates.length}）
              </div>
              <ul className="grid gap-3 lg:grid-cols-2">
                {aiGen.data.candidates.map((c, i) => (
                  <CandidateCard
                    key={`fresh-${i}`}
                    title={c.title}
                    score={c.score}
                    why_buy={c.why_buy}
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

          {/* 历史候选：跨刷新都在，按 track 分组只看当前 */}
          {drafts.data && drafts.data.length > 0 && (
            <div className="mt-6 border-t border-gray-100 pt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-500">
                <History className="h-3.5 w-3.5" /> 历史候选 · {track}（{drafts.data.length}）
              </div>
              <ul className="grid gap-3 lg:grid-cols-2" data-testid="drafts-list">
                {drafts.data
                  // 已经是「本次生成」批次的，避免重复
                  .filter((d) => !aiGen.data?.candidates.some((c) => c.title === d.title))
                  .map((d, i) => (
                    <CandidateCard
                      key={d.id}
                      title={d.title}
                      score={d.score}
                      why_buy={d.why_buy}
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
                          why_buy: d.why_buy,
                        })
                      }
                      isLaunching={false}
                      disabled={adoptAndCreate.isPending || projectize.isPending}
                    />
                  ))}
              </ul>
            </div>
          )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-6 lg:sticky lg:top-20">
          <header className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <h1 className="text-lg font-semibold">选题评分卡</h1>
            <span className="ml-3 hidden text-xs text-gray-400 sm:inline">7 维 · 每维 1-5 · 立项 ≥28 / 备选 ≥23</span>
            <button
              type="button"
              onClick={() => aiLaunch.mutate(track)}
              disabled={aiLaunch.isPending}
              data-testid="ai-launch-btn"
              title={`基于赛道「${track}」让 AI 直接生成最高分选题并立项跳 Write`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
            >
              {aiLaunch.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              {aiLaunch.isPending ? 'AI 生成中…自动跳 Write' : 'AI 一键立项'}
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

          <label className="block mt-4">
            <span className="text-sm font-medium text-gray-700">赛道</span>
            <input
              type="text"
              value={track}
              onChange={(e) => setTrack(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              data-testid="seed-track"
            />
          </label>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {DIM_KEYS.map((k) => (
              <div key={k}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{DIM_LABELS[k]}</span>
                  <span className="font-mono font-semibold text-gray-900" data-testid={`score-${k}`}>
                    {score[k]}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={score[k]}
                  onChange={(e) => setScore({ ...score, [k]: Number(e.target.value) })}
                  className="mt-1 w-full"
                  data-testid={`slider-${k}`}
                  aria-label={DIM_LABELS[k]}
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3 border-t border-gray-100 pt-4">
            <span className="text-sm text-gray-500">总分</span>
            <span className="text-3xl font-bold text-gray-900 font-mono" data-testid="score-total">
              {total}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_BG[tier]}`} data-testid="tier-label">
              {TIER_LABEL[tier]}
            </span>
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

        <aside className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:sticky lg:top-20">
          <header className="sticky top-0 bg-white pb-2 mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">最近选题</h2>
            <span className="text-[10px] text-gray-400">
              {visibleSeeds.length}
              {hiddenCount > 0 && ` · 隐藏 ${hiddenCount}`}
            </span>
            <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={hideTestData}
                onChange={(e) => setHideTestData(e.target.checked)}
                className="h-3 w-3"
                data-testid="hide-test-data-toggle"
              />
              隐藏测试
            </label>
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
                if (proj) navigate(`/projects/${proj.id}/write`)
                else if (canLaunch) projectize.mutate(s.id)
              }
              const clickable = !!proj || canLaunch
              return (
                <li
                  key={s.id}
                  data-testid="seed-item"
                  className={`group rounded-md border border-gray-200 p-2 text-xs transition ${
                    clickable ? 'hover:border-blue-300 hover:bg-blue-50/40' : 'opacity-70'
                  }`}
                >
                  <div
                    onClick={clickable ? onClick : undefined}
                    className={clickable ? 'cursor-pointer' : ''}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 truncate">{s.title}</span>
                      <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold ${TIER_BG[s.tier]}`}>
                        {TIER_LABEL[s.tier]}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-gray-500">
                      <span className="truncate">{s.track}</span>
                      <span className="font-mono">{s.total_score}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    {proj ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-600">
                        <ArrowRight className="h-3 w-3" /> 进项目继续写
                      </span>
                    ) : canLaunch ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                        <Rocket className="h-3 w-3" /> 点这一行立项 + 去写
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
                  <span className="text-sm text-gray-500">/ 35</span>
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
  score: Score
  why_buy: string
  index: number
  testIdPrefix: 'gen' | 'draft'
  onAdopt: () => void
  onLaunch: () => void
  isLaunching: boolean
  disabled: boolean
  muted?: boolean
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
}: CandidateCardProps) {
  const total = DIM_KEYS.reduce((a, k) => a + score[k], 0)
  const t = tierOf(total)
  return (
    <li
      data-testid={`${testIdPrefix}-candidate-${index}`}
      className={`rounded-lg border border-gray-200 p-4 ${muted ? 'bg-white' : 'bg-gray-50/60'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900 leading-6">{title}</h3>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_BG[t]}`}
        >
          {TIER_LABEL[t]} · {total}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{why_buy}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {DIM_KEYS.map((k) => (
          <span
            key={k}
            className="inline-flex items-center rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200"
            title={DIM_LABELS[k]}
          >
            {DIM_LABELS[k][0]}
            {DIM_LABELS[k][1] ?? ''} {score[k]}
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
          {t === 'greenlight' ? '立项 + 去写' : t === 'backlog' ? '立项备选' : '不做'}
        </button>
      </div>
    </li>
  )
}
