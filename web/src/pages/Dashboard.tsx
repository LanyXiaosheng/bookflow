import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { looksLikeTestData } from '../lib/looksLikeTestData'
import {
  AlarmClock,
  Archive,
  ArrowRight,
  BookMarked,
  Check,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FilePlus,
  Flag,
  Flame,
  Layers,
  LineChart,
  MessageCircle,
  PenLine,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  Settings2,
  Sparkles,
  Square,
  Target,
  TriangleAlert,
} from 'lucide-react'
import { dashboardApi, type PipelineStage, type AuthorStat } from '../api/dashboard'
import { reviewsApi, type PendingReview } from '../api/reviews'
import type { Seed } from '../api/seeds'
import type { Project } from '../api/projects'
import { aiJobKindLabel, useAllAiJobs, type AiJob } from '../hooks/useAiJobStore'

const TRACK_TAGS = [
  { name: '现言婚恋火葬场', cls: 'border-orange-400/20 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20' },
  { name: '古言重生打脸', cls: 'border-green-400/20 bg-green-500/10 text-green-300 hover:bg-green-500/20' },
  { name: '古言替嫁冲喜', cls: 'border-blue-400/20 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20' },
  { name: '悬疑规则怪谈', cls: 'border-purple-400/20 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20' },
]

function renderAiJobText(job: AiJob): string {
  if (job.kind === 'full_book' && job.chapter && job.totalChapters) {
    return `AI 第 ${job.chapter}/${job.totalChapters} 章`
  }
  return `AI ${job.title || aiJobKindLabel(job.kind)}`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.summary(),
  })
  const pendingReviews = useQuery({
    queryKey: ['reviews', 'pending'],
    queryFn: () => reviewsApi.listPending(),
  })

  const data = summary.data

  return (
    <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      {/* ① 页头 */}
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">生产看板</h1>
          <p className="mt-1 text-sm leading-6 text-gray-400">
            从一个脑洞到发布上线再到复盘归档，全流程在这一页。当前赛道：
            <span className="font-medium text-gray-100">现言婚恋火葬场</span> · 账号：
            <span className="font-medium text-gray-100">新号</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => summary.refetch()}
            className="glass-pill inline-flex h-10 items-center px-4 text-sm font-semibold text-gray-200"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${summary.isFetching ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => navigate('/seeds')}
            className="inline-flex h-10 items-center rounded-full bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
          >
            <Plus className="mr-2 h-4 w-4" />
            新建选题
          </button>
        </div>
      </header>

      {/* ② QUICK START */}
      <QuickStart
        llmConfigured={data?.llm.configured ?? false}
        llmModel={data?.llm.model ?? '–'}
        seedsTotal={data?.counts.seeds_total ?? 0}
        weeklyPublished={data?.health.weekly_published ?? 0}
        inProgress={data?.health.in_progress ?? 0}
      />

      {/* ③ 生产流水线 + 右侧 3 卡 */}
      <Pipeline
        stages={data?.pipeline}
        recentProjects={data?.recent_projects ?? []}
        pendingReviewCount={data?.health.pending_review ?? 0}
        pendingReviews={pendingReviews.data ?? []}
      />

      {/* ④ 健康指标 4 联 */}
      <HealthTiles
        inProgress={data?.health.in_progress ?? 0}
        inProgressDetail={data?.health.in_progress_detail ?? ''}
        weeklyPublished={data?.health.weekly_published ?? 0}
        weeklyDelta={data?.health.weekly_delta ?? 0}
        pendingReview={data?.health.pending_review ?? 0}
        pendingReviewOverdue={data?.health.pending_review_overdue ?? 0}
        wcWarnings={data?.health.wc_warnings ?? 0}
        wcWarningDetail={data?.health.wc_warning_detail ?? ''}
      />

      {/* ⑤ 作者统计 */}
      {data?.author_stats && data.author_stats.length > 0 && (
        <AuthorStats stats={data.author_stats} />
      )}

      {/* ⑥ Lanes 3 栏 */}
      <section className="mb-8 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <WritingMaterials />
        <RecentOutput recentProjects={data?.recent_projects ?? []} recentSeeds={data?.recent_seeds ?? []} />
        <ExternalResources />
      </section>

      {/* ⑥ 技能资源 3 卡 */}
      <SkillResources />
    </main>
  )
}

// ============ ② QUICK START ============
function QuickStart(props: {
  llmConfigured: boolean
  llmModel: string
  seedsTotal: number
  weeklyPublished: number
  inProgress: number
}) {
  return (
    <section className="glass-card mb-8 overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">QUICK START</p>
          <h2 className="mt-2 text-xl font-semibold text-white">三步启动你的生产线</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
            接 LLM、配赛道与 playbook、立第一个项目。已配置的步骤会显示绿勾，点击仍可调整。
          </p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <span className="mr-2 h-1.5 w-1.5 rounded-full bg-current" />
          基础已就绪
        </span>
      </div>
      <div className="grid grid-cols-1 divide-y divide-white/10 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {/* 1. LLM */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <StepBadge done={props.llmConfigured} />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-white">接 LLM API</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                用于选题加速 / 写作 / 去 AI 味。当前接入：
                <span className="font-medium text-gray-200">{props.llmModel}</span>。
              </p>
              <Link
                to="/settings"
                className="glass-pill mt-4 inline-flex items-center px-3 py-2 text-sm font-medium text-gray-200"
              >
                <Settings2 className="mr-1.5 h-4 w-4" />
                调整
              </Link>
            </div>
          </div>
        </div>

        {/* 2. 赛道 */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <StepBadge done />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-white">配置赛道与 playbook</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                已就绪主分类 + 情节词库，以及 11 篇 playbook。新号当前主攻"婚姻家庭·追妻火葬场"。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {TRACK_TAGS.map((t) => (
                  <span
                    key={t.name}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium ${t.cls}`}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 3. 立项 */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <StepBadge done={props.seedsTotal > 0} number={3} />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-white">立第一个项目</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                从一句话脑洞开始，30 分钟到待发。当前在产 {props.inProgress} 个项目，本周已发{' '}
                {props.weeklyPublished} 篇。
              </p>
              <Link
                to="/seeds"
                className="mt-4 inline-flex items-center rounded-full bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              >
                新建选题
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function StepBadge({ done, number }: { done?: boolean; number?: number }) {
  if (done) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-white">
        <Check className="h-5 w-5" />
      </div>
    )
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-gray-300 ring-1 ring-white/15">
      {number ?? '?'}
    </div>
  )
}

// ============ ③ 生产流水线 ============
const STAGE_ICONS: Record<PipelineStage['key'], React.ComponentType<{ className?: string }>> = {
  seed: Target,
  plan: ClipboardList,
  write: PenLine,
  ready: Send,
  published: Rocket,
  archive: Archive,
}

const STAGE_BG: Record<PipelineStage['key'], string> = {
  seed: 'bg-blue-500/15 text-blue-300',
  plan: 'bg-violet-500/15 text-violet-300',
  write: 'bg-amber-500/15 text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  published: 'bg-emerald-500/15 text-emerald-300',
  archive: 'bg-slate-500/15 text-slate-300',
}

const STAGE_BADGE: Record<PipelineStage['key'], string> = {
  seed: 'bg-violet-500/15 text-violet-300',
  plan: 'bg-emerald-500/15 text-emerald-300',
  write: 'bg-amber-500/15 text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  published: 'bg-blue-500/15 text-blue-300',
  archive: 'bg-slate-500/15 text-slate-300',
}

const STAGE_ROUTE: Record<PipelineStage['key'], string> = {
  seed: '/seeds',
  plan: '/projects',
  write: '/projects',
  ready: '/ready',
  published: '/published',
  archive: '/archived',
}

function Pipeline({
  stages,
  recentProjects = [],
  pendingReviewCount = 0,
  pendingReviews = [],
}: {
  stages?: PipelineStage[]
  recentProjects?: Project[]
  pendingReviewCount?: number
  pendingReviews?: PendingReview[]
}) {
  const inProg = stages?.find((s) => s.key === 'write')?.count ?? 0
  const watch = stages?.find((s) => s.key === 'ready')?.count ?? 0

  return (
    <section
      className="glass-card mb-8 overflow-hidden"
      data-testid="pipeline-section"
    >
      <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">生产流水线</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-400">
            6 个阶段串起一篇文章的完整生命周期。点击节点查看该阶段所有项目，拖拽不直接迁移——会先跑 SOP 判定。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-300">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-current" />
            进行中 {inProg}
          </span>
          <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-current" />
            待关注 {watch}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">阶段节点</h3>
              <p className="mt-1 text-sm leading-6 text-gray-400">
                选题 → 立项 → 写作 → 待发 → 已发 → 归档
              </p>
            </div>
            <Link
              to="/projects"
              className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300"
            >
              查看完整 Kanban <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stages?.map((s) => (
              <PipelineNode key={s.key} stage={s} />
            ))}
            {!stages &&
              Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="glass-inset h-32 animate-pulse"
                />
              ))}
          </div>
        </div>

        {/* 右侧 360 三件套 */}
        <aside className="space-y-4 2xl:max-w-[360px]">
          <NextPublishCard recentProjects={recentProjects} />
          <ReviewReminderCard pendingReviewCount={pendingReviewCount} pendingReviews={pendingReviews} />
          <WeekGoalCard />
        </aside>
      </div>
    </section>
  )
}

function reviewProjectStatusLabel(status: Project['status']): string {
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

function PipelineNode({ stage }: { stage: PipelineStage }) {
  const Icon = STAGE_ICONS[stage.key]
  const isWrite = stage.key === 'write'
  return (
    <Link
      to={STAGE_ROUTE[stage.key]}
      data-testid={`pipeline-${stage.key}`}
      className={`glass-inset glass-inset-hover block p-5 focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
        isWrite ? 'border-amber-400/30 bg-amber-500/[0.07]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${STAGE_BG[stage.key]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-base font-semibold text-white">{stage.label}</h4>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STAGE_BADGE[stage.key]}`}
            >
              {stage.count} 项
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-gray-400">
            <li>{stage.line1}</li>
            {stage.line2 && (
              <li className={stage.line2_warn ? 'text-amber-300' : ''}>{stage.line2}</li>
            )}
          </ul>
        </div>
      </div>
    </Link>
  )
}

// 右侧三件套（v0.3 静态文案，v0.4 接 next-publish 算法）
function projectDetailRoute(projectId?: string, query?: string): string {
  if (!projectId) return '/projects'
  return query ? `/projects/${projectId}?${query}` : `/projects/${projectId}`
}

function reviewRoute(item?: Pick<PendingReview, 'project_id' | 'stage'>): string {
  if (!item) return '/review'
  return `/review?project_id=${item.project_id}&stage=${item.stage}`
}

function reviewStageMeta(stage: PendingReview['stage']): string {
  switch (stage) {
    case '24h':
      return '24h'
    case '72h':
      return '72h'
    case '7d':
      return '7d'
  }
}

function NextPublishCard({ recentProjects }: { recentProjects: Project[] }) {
  const mainRecommendation = recentProjects[0]
  const backupRecommendation = recentProjects[1] ?? recentProjects[0]

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.07] p-5 backdrop-blur-xl" data-testid="dashboard-next-publish-card">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-300" />
        <h3 className="text-sm font-semibold text-blue-200">下一篇发什么</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-blue-200/70">基于 next-publish 算法 · 今晚 21:00 档</p>
      <Link
        to={projectDetailRoute(mainRecommendation?.id)}
        data-testid="dashboard-next-publish-main"
        className="mt-4 block rounded-lg border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.08]"
      >
        <div className="text-sm font-semibold text-gray-100 line-clamp-2">
          {mainRecommendation?.title ?? '闺蜜订婚宴上她未婚夫把我当小三我先公开了合伙协议'}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-300">
            {mainRecommendation?.track ?? '现言火葬场'}
          </span>
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">10,456 字</span>
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-300">评分 33</span>
        </div>
        <p className="mt-2 text-xs text-gray-400 leading-5">现言适合晚间沉浸阅读 · 与上一篇题材不重复</p>
      </Link>
      <Link
        to={projectDetailRoute(backupRecommendation?.id)}
        data-testid="dashboard-next-publish-backup"
        className="mt-3 block rounded-lg border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.08]"
      >
        <div className="text-xs text-gray-400 mb-1">备选 #2 · 12:00 午休档</div>
        <div className="text-sm text-gray-100 line-clamp-1">
          {backupRecommendation?.title ?? '公司上市敲钟那天前夫发现首席法务官是我'}
        </div>
      </Link>
      <Link
        to={projectDetailRoute(mainRecommendation?.id, 'from=dashboard-next-publish')}
        data-testid="dashboard-next-publish-reason"
        className="mt-4 inline-flex items-center text-sm font-medium text-blue-300 hover:text-blue-200"
      >
        查看推荐理由 <ArrowRight className="ml-1 h-4 w-4" />
      </Link>
    </div>
  )
}

function ReviewReminderCard({
  pendingReviewCount,
  pendingReviews,
}: {
  pendingReviewCount: number
  pendingReviews: PendingReview[]
}) {
  const fallbackItems: PendingReview[] = [
    {
      project_id: 'demo-review-1',
      title: '陪他创业八年公司上市敲钟名单里没有我的名字',
      stage: '72h',
      status: 'published',
      published_at: '2026-06-01T00:00:00Z',
      track: '现言婚恋火葬场',
      total_words: 0,
      data_recorded: false,
      last_review_result: null,
    },
    {
      project_id: 'demo-review-2',
      title: '银行流水那天他十年工资全进了陌生女人账户',
      stage: '72h',
      status: 'published',
      published_at: '2026-06-01T00:00:00Z',
      track: '现言婚恋火葬场',
      total_words: 0,
      data_recorded: false,
      last_review_result: null,
    },
  ]
  const items = pendingReviews.length > 0 ? pendingReviews.slice(0, 2) : fallbackItems

  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] p-5 backdrop-blur-xl" data-testid="dashboard-review-card">
      <div className="flex items-center gap-2">
        <AlarmClock className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-semibold text-amber-200">催复盘</h3>
        <Link
          to="/review"
          data-testid="dashboard-review-count-link"
          className="ml-auto inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30"
        >
          {pendingReviewCount}
        </Link>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((item, index) => (
          <li key={`${item.project_id}-${item.stage}`}>
            <Link
              to={reviewRoute(item)}
              data-testid={`dashboard-review-item-${index}`}
              className="block rounded-md border border-white/10 bg-white/[0.04] p-2.5 transition hover:bg-white/[0.08]"
            >
              <div className="text-gray-100 line-clamp-1">{item.title}</div>
              <div className="mt-1 text-xs text-amber-300">
                {reviewProjectStatusLabel(item.status)} {reviewStageMeta(item.stage)} · {item.data_recorded ? '已录数据' : '数据未录入'}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function WeekGoalCard() {
  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.07] p-5 backdrop-blur-xl" data-testid="dashboard-week-goal-card">
      <div className="flex items-center gap-2">
        <Flag className="h-4 w-4 text-emerald-300" />
        <h3 className="text-sm font-semibold text-emerald-200">本周目标</h3>
      </div>
      <ul className="mt-3 space-y-2 text-sm text-emerald-100/90">
        <li>
          <Link
            to="/seeds"
            data-testid="dashboard-week-goal-seeds"
            className="flex items-start gap-2 rounded-md px-1 py-1 transition hover:bg-emerald-500/10"
          >
            <Square className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>新号选题：现言婚恋火葬场方向批量出题</span>
          </Link>
        </li>
        <li>
          <Link
            to="/projects"
            data-testid="dashboard-week-goal-projects"
            className="flex items-start gap-2 rounded-md px-1 py-1 transition hover:bg-emerald-500/10"
          >
            <Square className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>新号立项：完成第一批大纲</span>
          </Link>
        </li>
      </ul>
      <div className="mt-3 h-1.5 w-full rounded-full bg-emerald-500/20">
        <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: '50%' }} />
      </div>
      <p className="mt-2 text-xs text-emerald-300/80">完成度 50% · 还剩 2 天</p>
    </div>
  )
}

// ============ ④ 健康指标 4 联 ============
function HealthTiles(props: {
  inProgress: number
  inProgressDetail: string
  weeklyPublished: number
  weeklyDelta: number
  pendingReview: number
  pendingReviewOverdue: number
  wcWarnings: number
  wcWarningDetail: string
}) {
  return (
    <section
      className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4"
      data-testid="health-tiles"
    >
      <HealthCard
        title="在产项目"
        Icon={Layers}
        iconCls="text-blue-400"
        value={props.inProgress}
        sub={props.inProgressDetail}
      />
      <HealthCard
        title="本周已发"
        Icon={Rocket}
        iconCls="text-emerald-400"
        value={props.weeklyPublished}
        sub={`较上周 ${props.weeklyDelta >= 0 ? '+' : ''}${props.weeklyDelta}`}
      />
      <HealthCard
        title="待复盘"
        Icon={ClipboardCheck}
        iconCls="text-amber-400"
        value={props.pendingReview}
        sub={`已超 72h：${props.pendingReviewOverdue}`}
      />
      <HealthCard
        title="字数告警"
        Icon={TriangleAlert}
        iconCls="text-red-400"
        value={props.wcWarnings}
        sub={props.wcWarningDetail}
      />
    </section>
  )
}

function HealthCard({
  title,
  Icon,
  iconCls,
  value,
  sub,
}: {
  title: string
  Icon: React.ComponentType<{ className?: string }>
  iconCls: string
  value: number
  sub: string
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <Icon className={`h-5 w-5 ${iconCls}`} />
      </div>
      <div className="mt-5 text-3xl font-bold text-white">{value}</div>
      <div className="mt-2 text-sm font-medium text-gray-400">{sub}</div>
    </div>
  )
}

// ============ ⑤ 作者统计 ============
function AuthorStats({ stats }: { stats: AuthorStat[] }) {
  return (
    <section className="glass-card mb-8 overflow-hidden">
      <div className="border-b border-white/10 px-6 py-4">
        <h2 className="text-base font-semibold text-white">作者统计</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-white/[0.03] text-xs text-gray-400">
            <tr>
              <th className="px-4 py-2 text-left font-medium">作者</th>
              <th className="px-4 py-2 text-right font-medium">项目数</th>
              <th className="px-4 py-2 text-right font-medium">写作中</th>
              <th className="px-4 py-2 text-right font-medium">待发</th>
              <th className="px-4 py-2 text-right font-medium">已发</th>
              <th className="px-4 py-2 text-right font-medium">归档</th>
              <th className="px-4 py-2 text-right font-medium">均阅读</th>
              <th className="px-4 py-2 text-right font-medium">爆</th>
              <th className="px-4 py-2 text-right font-medium">平</th>
              <th className="px-4 py-2 text-right font-medium">扑</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {stats.map((s) => (
              <tr key={s.author} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2 font-medium text-gray-100">{s.author}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-300">{s.project_count}</td>
                <td className="px-4 py-2 text-right text-blue-300">{s.writing}</td>
                <td className="px-4 py-2 text-right text-amber-300">{s.ready}</td>
                <td className="px-4 py-2 text-right text-emerald-300">{s.published}</td>
                <td className="px-4 py-2 text-right text-slate-400">{s.archived}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-300">{s.avg_read_count}</td>
                <td className="px-4 py-2 text-right text-emerald-400">{s.explode}</td>
                <td className="px-4 py-2 text-right text-gray-400">{s.flat}</td>
                <td className="px-4 py-2 text-right text-rose-400">{s.flop}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ============ ⑤ Lane 1 写作素材 ============
function WritingMaterials() {
  return (
    <section className="glass-card p-5" data-testid="lane-materials">
      <h2 className="text-xl font-semibold text-white">写作素材</h2>
      <p className="mt-2 text-sm leading-6 text-gray-400">模板与选题 — 写作时一键打开</p>
      <div className="mt-5 grid gap-3">
        <MaterialRow Icon={FilePlus} title="项目模板" desc="立项时一键复制" count="1" to="/seeds" />
      </div>
    </section>
  )
}

function MaterialRow({
  Icon,
  title,
  desc,
  count,
  to,
}: {
  Icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  count: string
  to: string
}) {
  return (
    <Link
      to={to}
      className="glass-inset glass-inset-hover grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 p-3"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-gray-300">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-gray-100">{title}</span>
        <span className="mt-1 block truncate text-xs text-gray-400">{desc}</span>
      </span>
      <span className="whitespace-nowrap text-sm font-bold text-gray-100">{count}</span>
    </Link>
  )
}

// ============ ⑤ Lane 2 近期产出 ============
function RecentOutput({
  recentProjects,
  recentSeeds,
}: {
  recentProjects: Project[]
  recentSeeds: Seed[]
}) {
  // 合并去重，按 updated_at/created_at 倒序，取前 5
  const aiJobs = useAllAiJobs()
  type Row = {
    id: string
    realProjectId?: string
    title: string
    status: string
    when: string
    daysAgo: number
    isPublished: boolean
  }
  const now = Date.now()
  const rows: Row[] = []
  for (const p of recentProjects) {
    if (looksLikeTestData(p.title)) continue
    const t = new Date(p.updated_at).getTime()
    rows.push({
      id: `p:${p.id}`,
      realProjectId: p.id,
      title: p.title,
      status: STATUS_CN[p.status] ?? p.status,
      when: new Date(p.updated_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      daysAgo: Math.max(0, Math.floor((now - t) / 86_400_000)),
      isPublished: p.status === 'published' || p.status === 'archived',
    })
  }
  for (const s of recentSeeds) {
    if (recentProjects.some((p) => p.seed_id === s.id)) continue
    if (looksLikeTestData(s.title)) continue
    const t = new Date(s.created_at).getTime()
    rows.push({
      id: `s:${s.id}`,
      title: s.title,
      status: `立项 · 评分 ${s.total_score}`,
      when: new Date(s.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      daysAgo: Math.max(0, Math.floor((now - t) / 86_400_000)),
      isPublished: false,
    })
  }
  rows.sort((a, b) => a.daysAgo - b.daysAgo)
  const top5 = rows.slice(0, 5)

  return (
    <section className="glass-card p-5" data-testid="lane-recent">
      <h2 className="text-xl font-semibold text-white">近期产出</h2>
      <p className="mt-2 text-sm leading-6 text-gray-400">最近 5 篇按时间倒序，点击跳详情</p>
      <div className="mt-5 grid gap-3">
        {top5.map((r) => {
          const job = r.realProjectId ? aiJobs[r.realProjectId] : undefined
          return (
            <Link
              key={r.id}
              to={r.id.startsWith('p:') ? `/projects/${r.id.slice(2)}` : '/seeds'}
              className="glass-inset glass-inset-hover grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 p-3"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                  r.isPublished
                    ? 'border-emerald-400/20 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/10 bg-white/[0.04] text-gray-300'
                }`}
              >
                <Rocket className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-100">{r.title}</span>
                <span className="mt-1 flex items-center gap-2 truncate text-xs text-gray-400">
                  <span className="truncate">{r.status} · {r.when} · 新号</span>
                  {job && (
                    <span className="inline-flex items-center gap-1 rounded border border-violet-400/20 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                      <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                      {renderAiJobText(job)}
                    </span>
                  )}
                </span>
              </span>
              <span className="whitespace-nowrap text-xs text-amber-300">
                {r.isPublished ? `+${r.daysAgo * 24}h` : `${r.daysAgo}d`}
              </span>
            </Link>
          )
        })}
        {top5.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-xs text-gray-500">
            暂无产出
          </div>
        )}
      </div>
    </section>
  )
}

const STATUS_CN: Record<string, string> = {
  writing: '写作中',
  ready: '待发',
  published: '已发',
  archived: '归档',
}

// ============ ⑤ Lane 3 外部资源 ============
function ExternalResources() {
  return (
    <section className="glass-card p-5" data-testid="lane-external">
      <h2 className="text-xl font-semibold text-white">外部资源</h2>
      <p className="mt-2 text-sm leading-6 text-gray-400">选题加速 / 对标分析 / 数据回收</p>
      <div className="mt-5 grid gap-3">
        <ExternalRow Icon={Flame} title="番茄热榜" desc="爆款标题拆解法的素材源" />
        <ExternalRow Icon={MessageCircle} title="评论区痛点挖掘" desc="同赛道爆款评论 → 痛点 → 选题" />
        <ExternalRow Icon={LineChart} title="番茄作者后台" desc="复盘数据回收源（手动录入）" />
      </div>
    </section>
  )
}

function ExternalRow({
  Icon,
  title,
  desc,
}: {
  Icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
}) {
  return (
    <a
      href="#"
      target="_blank"
      rel="noreferrer"
      className="glass-inset glass-inset-hover grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 p-3"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-gray-300">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-gray-100">{title}</span>
        <span className="mt-1 block truncate text-xs text-gray-400">{desc}</span>
      </span>
      <ExternalLink className="h-4 w-4 text-gray-500" />
    </a>
  )
}

// ============ ⑥ 技能资源 3 卡 ============
function SkillResources() {
  return (
    <section data-testid="skill-resources">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-white">技能资源</h2>
        <p className="mt-1 text-sm text-gray-400">流程权威源 · 写作手册 · 命令参考。点击在新页打开。</p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SkillCard
          Icon={BookMarked}
          iconBg="bg-blue-500/15 text-blue-300"
          title="SOP 流程速查"
          desc="6 个阶段的入场/出场标准、字数硬底线、阶段迁移规则。"
          cta="打开 SOP.md"
          href="/SOP.md"
        />
      </div>
    </section>
  )
}

function SkillCard({
  Icon,
  iconBg,
  title,
  desc,
  cta,
  href,
}: {
  Icon: React.ComponentType<{ className?: string }>
  iconBg: string
  title: string
  desc: string
  cta: string
  href: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="glass-card p-5 transition hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-gray-400">{desc}</p>
          <span className="mt-4 inline-flex items-center text-sm font-medium text-blue-400">
            {cta} <ExternalLink className="ml-1.5 h-4 w-4" />
          </span>
        </div>
      </div>
    </a>
  )
}
