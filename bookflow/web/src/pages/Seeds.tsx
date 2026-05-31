import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, TriangleAlert, Check, Wand2, X, Loader2 } from 'lucide-react'
import { seedsApi, type AiScoreResponse, type Score, type Tier } from '../api/seeds'

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

export default function Seeds() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['seeds'], queryFn: seedsApi.list })
  const create = useMutation({
    mutationFn: seedsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seeds'] }),
  })

  const [title, setTitle] = useState('')
  const [track, setTrack] = useState('现言婚恋火葬场')
  const [score, setScore] = useState<Score>(DEFAULT_SCORE)
  const [drawer, setDrawer] = useState(false)

  const aiScore = useMutation<AiScoreResponse, Error, { title: string; track: string }>({
    mutationFn: seedsApi.aiScore,
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
  const canSubmit = !!title.trim() && !titleErr && !create.isPending

  function onSubmit() {
    if (!canSubmit) return
    create.mutate(
      { title: title.trim(), track, score },
      {
        onSuccess: () => {
          setTitle('')
          setScore(DEFAULT_SCORE)
        },
      },
    )
  }

  return (
    <>
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-6">
          <header className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <h1 className="text-lg font-semibold">选题评分卡</h1>
            <span className="ml-auto text-xs text-gray-400">7 维 · 每维 1-5 · 立项 ≥28 / 备选 ≥23</span>
          </header>

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
              {create.isPending ? '提交中…' : tier === 'greenlight' ? '立项 →' : tier === 'backlog' ? '入备选池' : '保存（不立项）'}
            </button>
          </div>

          {create.isError && (
            <p className="mt-3 text-sm text-rose-600 flex items-center gap-1">
              <TriangleAlert className="h-4 w-4" />
              提交失败：{(create.error as Error).message}
            </p>
          )}
          {create.isSuccess && !create.isPending && (
            <p className="mt-3 text-sm text-emerald-600 flex items-center gap-1">
              <Check className="h-4 w-4" />
              已落库
            </p>
          )}
        </section>

        <aside className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">最近选题</h2>
          {list.isLoading && <p className="text-sm text-gray-400">加载中…</p>}
          {list.isError && <p className="text-sm text-rose-600">读取失败</p>}
          {list.data && list.data.length === 0 && <p className="text-sm text-gray-400">还没有选题</p>}
          <ul className="space-y-2" data-testid="seeds-list">
            {list.data?.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-gray-200 p-2 text-xs"
                data-testid="seed-item"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 truncate">{s.title}</span>
                  <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold ${TIER_BG[s.tier]}`}>
                    {TIER_LABEL[s.tier]}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-gray-500">
                  <span>{s.track}</span>
                  <span className="font-mono">{s.total_score}</span>
                </div>
              </li>
            ))}
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
