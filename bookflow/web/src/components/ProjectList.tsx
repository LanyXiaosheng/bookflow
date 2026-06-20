import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText, Loader2, Rocket, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { projectsApi, type Project, type ProjectStatus } from '../api/projects'
import { chaptersApi } from '../api/chapters'
import { seedsApi } from '../api/seeds'
import { aiJobKindLabel, useAllAiJobs, type AiJob } from '../hooks/useAiJobStore'
import { useBatchLaunch, type BatchInput } from '../hooks/useBatchLaunch'
import BatchLaunchPanel from './BatchLaunchPanel'
import HeatBadge from './HeatBadge'
import { useConfirm } from './ConfirmDialog'
import TrackPills from './TrackPills'
import { looksLikeTestData } from '../lib/looksLikeTestData'

type FilterStatus = ProjectStatus | 'all'

const STATUS_LABEL: Record<ProjectStatus, string> = {
  writing: '写作中',
  ready: '待发',
  published: '已发',
  archived: '归档',
}

const STATUS_BG: Record<ProjectStatus, string> = {
  writing: 'bg-blue-50 text-blue-700 border-blue-200',
  ready: 'bg-amber-50 text-amber-700 border-amber-200',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-slate-50 text-slate-600 border-slate-200',
}

const NEXT_LABEL: Record<ProjectStatus, string | null> = {
  writing: '标记定稿 → 待发',
  ready: '标记已发 → 已发',
  published: '归档 → 归档',
  archived: null,
}


interface ProjectListProps {
  /** 'all' = 显示所有状态，并展示状态 tab 切换 */
  status: FilterStatus
  title: string
  emptyHint?: string
  includeStatuses?: ProjectStatus[]
}

interface ProjectCardData {
  project: Project
  chapter_count: number
  total_words: number
}

const STATUS_TABS: Array<{ key: FilterStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'writing', label: '写作中' },
  { key: 'ready', label: '待发' },
  { key: 'published', label: '已发' },
  { key: 'archived', label: '归档' },
]

function renderAiJobText(job: AiJob): string {
  const title = job.title || aiJobKindLabel(job.kind)
  const chars = job.chars > 0 ? ` · ${job.chars.toLocaleString('zh-CN')} 字` : ''
  if (job.kind === 'full_book' && job.chapter && job.totalChapters) {
    return `AI 生成中 · ${title}运行中 · 第 ${job.chapter}/${job.totalChapters} 章 · 段 ${job.beat ?? 0}/${job.totalBeats ?? 0}${chars}`
  }
  return `AI 生成中 · ${title}运行中${chars}`
}

export default function ProjectList({
  status: initialStatus,
  title,
  emptyHint,
  includeStatuses,
}: ProjectListProps) {
  const qc = useQueryClient()
  const aiJobs = useAllAiJobs()
  const confirm = useConfirm()
  const [status, setStatus] = useState<FilterStatus>(initialStatus)
  const [hideTestData, setHideTestData] = useState(true)

  // 批量跑全流程
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

  const list = useQuery({
    queryKey: ['projects', status, includeStatuses?.join(',') ?? ''],
    queryFn: async () => {
      const projects = includeStatuses?.length
        ? (await Promise.all(includeStatuses.map((s) => projectsApi.list(s)))).flat()
        : status === 'all'
          ? await projectsApi.list()
          : await projectsApi.list(status)
      const enriched = await Promise.all(
        projects.map(async (p) => {
          const chapters = await chaptersApi.listByProject(p.id)
          const total_words = chapters.reduce((a, c) => a + c.word_count, 0)
          return { project: p, chapter_count: chapters.length, total_words } as ProjectCardData
        }),
      )
      return enriched
    },
    // 列表查询是 N+1（每个项目再拉章节）；批量跑时失效频繁，
    // 给 staleTime 让 2s 内的重复失效复用缓存，避免请求风暴拖卡页面
    staleTime: 2000,
  })

  // 候选历史里带的热度/推荐原因，按标题匹配回填到项目卡（项目本身不存这俩字段）
  const drafts = useQuery({
    queryKey: ['ai-drafts'],
    queryFn: () => seedsApi.aiDrafts(undefined, 200),
    staleTime: 60_000,
  })
  const metaByTitle = useMemo(() => {
    const m = new Map<string, { heat?: string; reason?: string }>()
    for (const d of drafts.data ?? []) {
      if (d.heat || d.recommend_reason) {
        m.set(d.title, { heat: d.heat, reason: d.recommend_reason })
      }
    }
    return m
  }, [drafts.data])

  const visible = useMemo(() => {
    if (!list.data) return []
    return hideTestData
      ? list.data.filter((row) => !looksLikeTestData(row.project.title))
      : list.data
  }, [list.data, hideTestData])
  const hiddenCount = (list.data?.length ?? 0) - visible.length
  const runningJobs = useMemo(() => Object.values(aiJobs), [aiJobs])
  const projectTitleById = useMemo(() => {
    const titles = new Map<string, string>()
    for (const row of list.data ?? []) {
      titles.set(row.project.id, row.project.title)
    }
    return titles
  }, [list.data])

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.project.id))
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (visible.every((r) => prev.has(r.project.id))) {
        const next = new Set(prev)
        visible.forEach((r) => next.delete(r.project.id))
        return next
      }
      const next = new Set(prev)
      visible.forEach((r) => next.add(r.project.id))
      return next
    })
  const runBatch = () => {
    const picks: BatchInput[] = visible
      .filter((r) => selected.has(r.project.id))
      .map((r) => ({
        kind: 'project' as const,
        key: r.project.id,
        title: r.project.title,
        projectId: r.project.id,
      }))
    if (picks.length === 0) return
    batch.run(picks, batchTarget)
    setSelected(new Set())
  }

  const transition = useMutation({
    mutationFn: async (vars: { id: string; to: ProjectStatus }) =>
      projectsApi.transition(vars.id, vars.to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['seeds'] })
    },
  })

  return (
    <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <BatchLaunchPanel
        state={batch.state}
        onAbort={batch.abort}
        onClose={batch.reset}
        onRetryFailed={batch.retryFailed}
      />
      <header className="flex items-center gap-3 mb-3">
        <FileText className="h-5 w-5 text-blue-600" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <span className="ml-auto text-xs text-gray-400">
          {list.data
            ? `${visible.length}${hiddenCount > 0 ? ` · 隐藏 ${hiddenCount}` : ''} 个项目`
            : ''}
        </span>
      </header>

      {/* 状态 tab：仅在 initialStatus='all' 时显示，避免 /ready /published 多余切换 */}
      {initialStatus === 'all' && (
        <nav className="mb-4 flex flex-wrap items-center gap-2" data-testid="status-tabs">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              data-testid={`status-tab-${t.key}`}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition ${
                status === t.key
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
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
        </nav>
      )}
      {initialStatus !== 'all' && (
        <div className="mb-4 flex items-center gap-2">
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
        </div>
      )}

      {list.isLoading && <p className="text-sm text-gray-500">加载中…</p>}
      {list.isError && (
        <p className="text-sm text-rose-600 inline-flex items-center gap-1">
          <TriangleAlert className="h-4 w-4" /> 加载失败
        </p>
      )}
      {runningJobs.length > 0 && (
        <div
          className="mb-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700"
          data-testid="ai-jobs-summary"
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在运行的 AI 任务
          </div>
          <div className="flex flex-wrap gap-2">
            {runningJobs.map((job) => {
              const projectTitle = projectTitleById.get(job.projectId)
              return (
                <span
                  key={`${job.projectId}-${job.startedAt}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5"
                >
                  {projectTitle && (
                    <span className="max-w-[18rem] truncate text-violet-500">{projectTitle}</span>
                  )}
                  <span className="font-medium">{renderAiJobText(job)}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
      {visible.length === 0 && !list.isLoading && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          {hiddenCount > 0
            ? '当前 tab 全部被「隐藏测试」过滤'
            : (emptyHint ?? '这里还没有项目')}
        </div>
      )}

      {visible.length > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2"
          data-testid="project-batch-bar"
        >
          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 accent-violet-600"
              data-testid="project-select-all"
            />
            全选（{visible.length}）
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
              data-testid="project-batch-target"
            />
          </label>
          <button
            type="button"
            onClick={runBatch}
            disabled={selected.size === 0 || batch.state.running}
            className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            data-testid="project-batch-launch-btn"
            title="并发跑全流程，已有产物的步骤自动跳过，失败自动重试"
          >
            {batch.state.running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            批量跑全流程
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="project-list">
        {visible.map(({ project, chapter_count, total_words }) => {
          const next = nextStatus(project.status)
          const job = aiJobs[project.id]
          const meta = metaByTitle.get(project.title)
          return (
            <article
              key={project.id}
              className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4 flex flex-col"
              data-testid="project-card"
            >
              <header className="flex items-start gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={selected.has(project.id)}
                  onChange={() => toggleSelect(project.id)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-violet-600"
                  data-testid="project-select"
                  aria-label={`选择 ${project.title}`}
                />
                <h2 className="font-semibold text-gray-900 text-[15px] leading-snug flex-1">
                  {project.title}
                </h2>
                <span
                  className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_BG[project.status]}`}
                >
                  {STATUS_LABEL[project.status]}
                </span>
              </header>
              {job && (
                <div
                  className="mb-3 flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700"
                  data-testid="ai-job-badge"
                >
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="min-w-0 truncate">{renderAiJobText(job)}</span>
                </div>
              )}
              <div className="mb-3">
                <TrackPills track={project.track} compact />
              </div>
              {(meta?.heat || meta?.reason) && (
                <div className="mb-3 space-y-1">
                  {meta.heat && <HeatBadge heat={meta.heat} />}
                  {meta.reason && (
                    <p className="flex items-start gap-1 text-[11px] leading-5 text-violet-600">
                      <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="line-clamp-2">推荐：{meta.reason}</span>
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-3">
                <div>
                  <div className="text-[11px] text-gray-400">章节</div>
                  <div className="font-mono font-semibold text-gray-900">{chapter_count}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">字数</div>
                  <div className="font-mono font-semibold text-gray-900">{total_words}</div>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2">
                <Link
                  to={`/projects/${project.id}`}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  data-testid="project-open-btn"
                >
                  打开 <ArrowRight className="h-3 w-3" />
                </Link>
                {next && NEXT_LABEL[project.status] && (
                  <button
                    type="button"
                    onClick={() => transition.mutate({ id: project.id, to: next })}
                    disabled={transition.isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    data-testid="project-next-btn"
                  >
                    {transition.isPending && transition.variables?.id === project.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {nextLabelShort(project.status)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `删除「${project.title}」？`,
                      description: (
                        <>
                          章节、AI 产物（README/大纲/发布稿/配套）、草稿都会一起删除，
                          <span className="font-semibold text-rose-600">不可恢复</span>。
                        </>
                      ),
                      confirmText: '删除',
                      tone: 'danger',
                    })
                    if (ok) remove.mutate(project.id)
                  }}
                  disabled={remove.isPending && remove.variables === project.id}
                  className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-white p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                  title="删除项目"
                  data-testid="project-delete-btn"
                  aria-label="删除项目"
                >
                  {remove.isPending && remove.variables === project.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </main>
  )
}

function nextStatus(s: ProjectStatus): ProjectStatus | null {
  switch (s) {
    case 'writing':
      return 'ready'
    case 'ready':
      return 'published'
    case 'published':
      return 'archived'
    case 'archived':
      return null
  }
}

function nextLabelShort(s: ProjectStatus): string {
  switch (s) {
    case 'writing':
      return '定稿'
    case 'ready':
      return '标已发'
    case 'published':
      return '归档'
    case 'archived':
      return ''
  }
}
