import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Ban,
  BarChart3,
  CheckCircle2,
  Flame,
  Lightbulb,
  Loader2,
  Plus,
  Target,
  Trophy,
} from 'lucide-react'
import {
  accountApi,
  type AccountStrategy,
  type FanqieStat,
  type FanqieStatsSummary,
} from '../api/account'

// CTR 阈值：>30% 绿色高亮，<5% 红色警告
const CTR_GOOD = 0.3
const CTR_BAD = 0.05

function fmtInt(n: number | undefined | null): string {
  if (n == null) return '–'
  return n.toLocaleString('zh-CN')
}

function fmtPct(n: number | undefined | null, digits = 1): string {
  if (n == null) return '–'
  return `${(n * 100).toFixed(digits)}%`
}

function ctrClass(ctr: number): string {
  if (ctr >= CTR_GOOD) return 'text-emerald-300 font-semibold'
  if (ctr > 0 && ctr < CTR_BAD) return 'text-rose-300 font-semibold'
  return 'text-gray-200'
}

export default function AccountReview() {
  const strategyQuery = useQuery({
    queryKey: ['account', 'strategy'],
    queryFn: () => accountApi.strategy(),
  })
  const statsQuery = useQuery({
    queryKey: ['account', 'fanqie-stats'],
    queryFn: () => accountApi.fanqieStats(),
  })

  const strategy = strategyQuery.data ?? {}
  const summary = statsQuery.data?.summary
  const works = statsQuery.data?.works ?? []

  const loading = strategyQuery.isLoading || statsQuery.isLoading

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-6 flex flex-col gap-2 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
            <BarChart3 className="h-7 w-7 text-blue-300" />
            账号复盘
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            番茄作品表现 + 验证过的爆款公式，选题时自动注入这些策略。
          </p>
        </div>
        {strategy.last_review_date && (
          <span className="text-xs text-gray-500">
            最近复盘：{strategy.last_review_date}
          </span>
        )}
      </header>

      {loading && (
        <div className="glass-card flex items-center gap-2 px-4 py-10 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载账号数据中…
        </div>
      )}

      {!loading && (
        <div className="space-y-6">
          <AccountOverview summary={summary} strategy={strategy} />
          <TopWorks works={works} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ProvenFormulaCard strategy={strategy} />
            <BannedTracksCard strategy={strategy} />
            <KeyInsightsCard strategy={strategy} />
            <NextActionsCard strategy={strategy} />
          </div>
          <SuggestedTopics strategy={strategy} />
        </div>
      )}
    </main>
  )
}

function TopWorks({ works }: { works: FanqieStat[] }) {
  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-6 py-4">
        <Trophy className="h-5 w-5 text-amber-300" />
        <h2 className="text-base font-semibold text-white">TOP 作品排行</h2>
        <span className="text-xs text-gray-500">按阅读量降序</span>
      </div>
      {works.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-500">
          还没有番茄作品数据
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-white/[0.02] text-xs text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">标题</th>
                <th className="px-4 py-2 text-right font-medium">阅读</th>
                <th className="px-4 py-2 text-right font-medium">CTR</th>
                <th className="px-4 py-2 text-right font-medium">付费率</th>
                <th className="px-4 py-2 text-right font-medium">赞</th>
                <th className="px-4 py-2 text-right font-medium">评</th>
                <th className="px-4 py-2 text-right font-medium">藏</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {works.map((w, i) => (
                <tr key={w.book_id} className="transition-colors hover:bg-white/5">
                  <td className="px-4 py-2 text-gray-500 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-white">{w.title}</div>
                    {w.category.length > 0 && (
                      <div className="mt-0.5 text-xs text-gray-500">
                        {w.category.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-200">
                    {fmtInt(w.read_count)}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${ctrClass(w.click_rate)}`}>
                    {fmtPct(w.click_rate)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-200">
                    {fmtPct(w.douyin_pay_rate, 2)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400">{fmtInt(w.digg_count)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">{fmtInt(w.comment_count)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">{fmtInt(w.shelf_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CardShell({
  icon,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode
  title: string
  accent: string
  children: React.ReactNode
}) {
  return (
    <section className="glass-card overflow-hidden">
      <div className={`flex items-center gap-2 border-b border-white/[0.06] px-5 py-3 ${accent}`}>
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-5 text-sm text-gray-200">{children}</div>
    </section>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-gray-500">{text}</p>
}

function ProvenFormulaCard({ strategy }: { strategy: AccountStrategy }) {
  const formula = strategy.proven_formula
  const tracks = formula?.best_tracks ?? []
  const examples = formula?.examples ?? []
  const ctrs = formula?.validated_ctr ?? []
  const hasData = formula?.title_pattern || tracks.length || examples.length || ctrs.length
  return (
    <CardShell
      icon={<CheckCircle2 className="h-4 w-4 text-emerald-300" />}
      title="验证有效公式"
      accent="text-emerald-300 bg-emerald-500/10"
    >
      {!hasData ? (
        <EmptyHint text="还没有沉淀验证过的公式，复盘后会出现在这里" />
      ) : (
        <div className="space-y-3">
          {formula?.title_pattern && (
            <div>
              <div className="text-xs font-medium text-gray-400">标题模板</div>
              <div className="mt-1 rounded-md bg-emerald-500/10 px-3 py-2 font-medium text-emerald-300">
                {formula.title_pattern}
              </div>
            </div>
          )}
          {ctrs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400">验证 CTR</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ctrs.map((c, i) => (
                  <span
                    key={i}
                    className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-300"
                  >
                    {fmtPct(c)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {tracks.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400">优势赛道</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tracks.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {examples.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400">爆款示例</div>
              <ul className="mt-1 space-y-1 text-xs text-gray-400">
                {examples.map((e, i) => (
                  <li key={i} className="truncate">· {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}

function BannedTracksCard({ strategy }: { strategy: AccountStrategy }) {
  const banned = strategy.banned_tracks ?? []
  return (
    <CardShell
      icon={<Ban className="h-4 w-4 text-rose-300" />}
      title="禁止赛道"
      accent="text-rose-300 bg-rose-500/10"
    >
      {banned.length === 0 ? (
        <EmptyHint text="暂无禁用赛道" />
      ) : (
        <ul className="space-y-1.5">
          {banned.map((t) => (
            <li key={t} className="flex items-center gap-2 text-rose-300">
              <Ban className="h-3.5 w-3.5 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

function KeyInsightsCard({ strategy }: { strategy: AccountStrategy }) {
  const insights = strategy.key_insights ?? []
  return (
    <CardShell
      icon={<Lightbulb className="h-4 w-4 text-amber-300" />}
      title="关键洞察"
      accent="text-amber-300 bg-amber-500/10"
    >
      {insights.length === 0 ? (
        <EmptyHint text="暂无洞察" />
      ) : (
        <ul className="space-y-2">
          {insights.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

function NextActionsCard({ strategy }: { strategy: AccountStrategy }) {
  const actions = strategy.next_actions ?? []
  return (
    <CardShell
      icon={<Target className="h-4 w-4 text-blue-300" />}
      title="下一步行动"
      accent="text-blue-300 bg-blue-500/10"
    >
      {actions.length === 0 ? (
        <EmptyHint text="暂无行动项" />
      ) : (
        <ul className="space-y-2">
          {actions.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-blue-400/30 text-[10px] text-blue-300">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

function SuggestedTopics({ strategy }: { strategy: AccountStrategy }) {
  const navigate = useNavigate()
  const topics = useMemo(() => strategy.suggested_topics ?? [], [strategy])

  // P2：点击直接带着标题去选题页（预填，由用户确认评分后立项）
  const createFromTopic = (topic: string) => {
    navigate(`/seeds?title=${encodeURIComponent(topic)}`)
  }

  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-6 py-4">
        <Flame className="h-5 w-5 text-orange-400" />
        <h2 className="text-base font-semibold text-white">推荐选题池</h2>
        <span className="text-xs text-gray-500">点击带去选题页立项</span>
      </div>
      <div className="p-6">
        {topics.length === 0 ? (
          <EmptyHint text="复盘后 AI 会把推荐选题放在这里" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {topics.map((t, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => createFromTopic(t)}
                  className="glass-inset glass-inset-hover group flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0 truncate text-sm text-gray-200">{t}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-blue-300 opacity-0 transition group-hover:opacity-100">
                    <Plus className="h-3.5 w-3.5" />
                    立项
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}


function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'good' | 'bad'
}) {
  const valueCls =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-white'
  return (
    <div className="glass-inset px-4 py-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  )
}

function AccountOverview({
  summary,
  strategy,
}: {
  summary?: FanqieStatsSummary
  strategy: AccountStrategy
}) {
  // 优先用后端实时汇总，没有再退回 strategy 快照
  const snap = strategy.account_summary ?? {}
  const totalWorks = summary?.total_works ?? snap.total_works
  const totalReads = summary?.total_reads ?? snap.total_reads
  const avgCtr = summary?.avg_ctr ?? snap.avg_ctr
  const payRate = summary?.avg_douyin_pay_rate ?? snap.douyin_pay_rate
  const over10k = summary?.works_over_10k ?? snap.works_over_10k
  const readIncrease = summary?.total_read_increase

  const hitRate =
    snap.hit_rate ??
    (totalWorks && over10k != null && totalWorks > 0 ? over10k / totalWorks : undefined)

  const ctrTone =
    avgCtr == null ? 'default' : avgCtr >= CTR_GOOD ? 'good' : avgCtr < CTR_BAD ? 'bad' : 'default'

  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/10 px-6 py-4">
        <BarChart3 className="h-5 w-5 text-blue-300" />
        <h2 className="text-base font-semibold text-white">账号总览</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="总作品" value={fmtInt(totalWorks)} />
        <StatTile label="总阅读" value={fmtInt(totalReads)} />
        <StatTile label="平均 CTR" value={fmtPct(avgCtr)} tone={ctrTone} />
        <StatTile label="抖音付费率" value={fmtPct(payRate, 2)} />
        <StatTile
          label="爆款率"
          value={hitRate == null ? '–' : fmtPct(hitRate)}
          hint={over10k != null ? `破万 ${over10k} 部` : undefined}
        />
        <StatTile
          label="今日增量"
          value={readIncrease == null ? '–' : `+${fmtInt(readIncrease)}`}
          hint="阅读"
        />
      </div>
    </section>
  )
}

