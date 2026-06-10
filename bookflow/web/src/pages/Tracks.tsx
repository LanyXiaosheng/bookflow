import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, FileText, Layers3, Loader2, Tags } from 'lucide-react'
import { tracksApi } from '../api/docs'
import {
  TRACK_PLOT_OPTIONS,
  TRACK_PRIMARY_OPTIONS,
} from '../lib/tracks'

export default function Tracks() {
  const [active, setActive] = useState<string | null>('现言婚恋火葬场')
  const [primaryKeyword, setPrimaryKeyword] = useState('')
  const [plotKeyword, setPlotKeyword] = useState('')

  const list = useQuery({
    queryKey: ['tracks', 'list'],
    queryFn: () => tracksApi.list(),
  })

  const detail = useQuery({
    queryKey: ['tracks', 'one', active],
    queryFn: () => tracksApi.get(active!),
    enabled: !!active,
  })

  const filteredPrimary = useMemo(() => {
    const keyword = primaryKeyword.trim()
    if (!keyword) return TRACK_PRIMARY_OPTIONS
    return TRACK_PRIMARY_OPTIONS.filter((item) => item.includes(keyword))
  }, [primaryKeyword])

  const filteredPlot = useMemo(() => {
    const keyword = plotKeyword.trim()
    if (!keyword) return TRACK_PLOT_OPTIONS
    return TRACK_PLOT_OPTIONS.filter((item) => item.includes(keyword))
  }, [plotKeyword])

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">赛道库</h1>
        <p className="mt-2 text-sm text-gray-500">
          左侧看 4 篇赛道公式文档，右侧直接查主分类和情节词库。立项时先定大类，再补情节钩子。
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <aside className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            赛道文档
          </div>
          {list.isLoading && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中
            </div>
          )}
          {list.isError && (
            <div className="px-4 py-3 text-sm text-red-600">
              加载失败：{(list.error as Error)?.message}
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {list.data?.map((it) => (
              <li key={it.slug}>
                <button
                  type="button"
                  onClick={() => setActive(it.slug)}
                  data-testid={`doc-item-${it.slug}`}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-blue-50 ${
                    active === it.slug ? 'bg-blue-50' : ''
                  }`}
                >
                  <FileText
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      active === it.slug ? 'text-blue-600' : 'text-gray-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <div
                      className={`text-sm font-semibold ${
                        active === it.slug ? 'text-blue-700' : 'text-gray-900'
                      }`}
                    >
                      {it.title}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{it.summary}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          {!active && (
            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-16 text-center">
              <BookOpen className="h-12 w-12 text-gray-300" />
              <p className="mt-4 text-sm text-gray-500">从左侧选择一篇赛道文档</p>
            </div>
          )}
          {active && detail.isLoading && (
            <div className="flex items-center gap-2 px-6 py-10 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中
            </div>
          )}
          {active && detail.isError && (
            <div className="m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              加载失败：{(detail.error as Error)?.message}
            </div>
          )}
          {active && detail.data && (
            <article className="px-6 py-6 lg:px-8 lg:py-8">
              <div
                className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h1:mb-4 prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-base prose-h3:mt-6 prose-p:leading-7 prose-li:my-1 prose-table:text-sm prose-th:bg-gray-50 prose-code:bg-gray-100 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:before:hidden prose-code:after:hidden"
                data-testid="doc-content"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {detail.data.body}
                </ReactMarkdown>
              </div>
            </article>
          )}
        </section>

        <section className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="track-primary-card">
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">主分类</h2>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              先确定大盘受众和情绪基本盘。当前词库共 {TRACK_PRIMARY_OPTIONS.length} 个主分类。
            </p>
            <input
              type="text"
              value={primaryKeyword}
              onChange={(e) => setPrimaryKeyword(e.target.value)}
              placeholder="搜索主分类"
              className="mt-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              data-testid="track-primary-search"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {filteredPrimary.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="track-plot-card">
            <div className="flex items-center gap-2">
              <Tags className="h-5 w-5 text-violet-600" />
              <h2 className="text-lg font-semibold text-gray-900">情节标签</h2>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              再补冲突钩子、关系结构和爽点方向。当前词库共 {TRACK_PLOT_OPTIONS.length} 个情节标签。
            </p>
            <input
              type="text"
              value={plotKeyword}
              onChange={(e) => setPlotKeyword(e.target.value)}
              placeholder="搜索情节标签"
              className="mt-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              data-testid="track-plot-search"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {filteredPlot.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
