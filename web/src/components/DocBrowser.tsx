import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, BookOpen, FileText, Loader2 } from 'lucide-react'
import { type DocItem, type DocFull } from '../api/docs'

interface DocBrowserProps {
  title: string
  subtitle: string
  list: () => Promise<DocItem[]>
  read: (slug: string) => Promise<DocFull>
  cacheKey: string
}

export default function DocBrowser(props: DocBrowserProps) {
  const [active, setActive] = useState<string | null>(null)

  const list = useQuery({ queryKey: [props.cacheKey, 'list'], queryFn: () => props.list() })
  const detail = useQuery({
    queryKey: [props.cacheKey, 'one', active],
    queryFn: () => props.read(active!),
    enabled: !!active,
  })

  return (
    <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-white">{props.title}</h1>
        <p className="mt-2 text-sm text-gray-400">{props.subtitle}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="glass-card overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            目录
          </div>
          {list.isLoading && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中
            </div>
          )}
          {list.isError && (
            <div className="px-4 py-3 text-sm text-rose-300">
              加载失败：{(list.error as Error)?.message}
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400">目录为空</div>
          )}
          <ul className="divide-y divide-white/10">
            {list.data?.map((it) => (
              <li key={it.slug}>
                <button
                  type="button"
                  onClick={() => setActive(it.slug)}
                  data-testid={`doc-item-${it.slug}`}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.06] ${
                    active === it.slug ? 'bg-white/[0.06]' : ''
                  }`}
                >
                  <FileText
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      active === it.slug ? 'text-blue-300' : 'text-gray-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <div
                      className={`text-sm font-semibold ${
                        active === it.slug ? 'text-blue-300' : 'text-gray-100'
                      }`}
                    >
                      {it.title}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-400">{it.summary}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="glass-card">
          {!active && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-6 py-16 text-center">
              <BookOpen className="h-12 w-12 text-gray-500" />
              <p className="mt-4 text-sm text-gray-400">从左侧选择一篇打开</p>
            </div>
          )}
          {active && detail.isLoading && (
            <div className="flex items-center gap-2 px-6 py-10 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中
            </div>
          )}
          {active && detail.isError && (
            <div className="m-6 rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              加载失败：{(detail.error as Error)?.message}
            </div>
          )}
          {active && detail.data && (
            <article className="px-6 py-6 lg:px-8 lg:py-8">
              <div className="mb-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="inline-flex items-center text-sm text-gray-400 hover:text-gray-200 lg:hidden"
                >
                  <ArrowLeft className="mr-1 h-4 w-4" /> 返回目录
                </button>
              </div>
              <div
                className="prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h1:mb-4 prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-base prose-h3:mt-6 prose-p:leading-7 prose-li:my-1 prose-table:text-sm prose-th:bg-white/5 prose-code:bg-white/10 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:before:hidden prose-code:after:hidden"
                data-testid="doc-content"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.data.body}</ReactMarkdown>
              </div>
            </article>
          )}
        </section>
      </div>
    </main>
  )
}
