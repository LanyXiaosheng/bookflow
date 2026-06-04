import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText, Loader2, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { projectsApi, type Project, type ProjectStatus } from '../api/projects'
import { chaptersApi } from '../api/chapters'
import { useAllAiJobs } from '../hooks/useAiJobStore'

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
  status: ProjectStatus
  title: string
  emptyHint?: string
}

interface ProjectCardData {
  project: Project
  chapter_count: number
  total_words: number
}

export default function ProjectList({ status, title, emptyHint }: ProjectListProps) {
  const qc = useQueryClient()
  const aiJobs = useAllAiJobs()

  const list = useQuery({
    queryKey: ['projects', status],
    queryFn: async () => {
      const projects = await projectsApi.list(status)
      const enriched = await Promise.all(
        projects.map(async (p) => {
          const chapters = await chaptersApi.listByProject(p.id)
          const total_words = chapters.reduce((a, c) => a + c.word_count, 0)
          return { project: p, chapter_count: chapters.length, total_words } as ProjectCardData
        }),
      )
      return enriched
    },
  })

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
      <header className="flex items-center gap-3 mb-4">
        <FileText className="h-5 w-5 text-blue-600" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <span className="ml-auto text-xs text-gray-400">
          {list.data ? `${list.data.length} 个项目` : ''}
        </span>
      </header>

      {list.isLoading && <p className="text-sm text-gray-500">加载中…</p>}
      {list.isError && (
        <p className="text-sm text-rose-600 inline-flex items-center gap-1">
          <TriangleAlert className="h-4 w-4" /> 加载失败
        </p>
      )}
      {list.data && list.data.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          {emptyHint ?? '这里还没有项目'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="project-list">
        {list.data?.map(({ project, chapter_count, total_words }) => {
          const next = nextStatus(project.status)
          const job = aiJobs[project.id]
          return (
            <article
              key={project.id}
              className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4 flex flex-col"
              data-testid="project-card"
            >
              <header className="flex items-start gap-2 mb-2">
                <h2 className="font-semibold text-gray-900 text-[15px] leading-snug flex-1">
                  {project.title}
                </h2>
                <span
                  className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_BG[project.status]}`}
                >
                  {STATUS_LABEL[project.status]}
                </span>
              </header>
              <div className="text-xs text-gray-500 mb-3">{project.track}</div>
              {job && (
                <div
                  className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700"
                  data-testid="ai-job-badge"
                >
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  AI 生成中 · 第 {job.chapter}/{job.totalChapters} 章 · 段 {job.beat}/{job.totalBeats}
                  {job.chars > 0 && <span className="text-violet-500">· {job.chars} 字</span>}
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
                  onClick={() => {
                    if (
                      confirm(
                        `确定删除「${project.title}」？\n章节 / AI 产物 / 草稿都会一起删除，不可恢复。`,
                      )
                    ) {
                      remove.mutate(project.id)
                    }
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
