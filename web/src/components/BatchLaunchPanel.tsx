/**
 * 批量立项进度面板。展示每个选中 seed 的立项 + 全流程状态。
 */
import { Loader2, Check, TriangleAlert, RefreshCw, Rocket, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { BatchItem, BatchState } from '../hooks/useBatchLaunch'

const STEP_LABEL: Record<string, string> = {
  readme: 'README',
  character_setup: '角色设定',
  outline: '大纲',
  body: '正文',
  book_summary: '全书汇总',
  side_dishes: '配套素材',
}

const STATUS_META: Record<
  BatchItem['status'],
  { label: string; cls: string }
> = {
  pending: { label: '排队中', cls: 'bg-white/[0.04] text-gray-400 border-white/10' },
  launching: { label: '立项中', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  running: { label: '生成中', cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  done: { label: '完成', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  failed: { label: '失败', cls: 'bg-rose-500/10 text-rose-300 border-rose-400/30' },
  aborted: { label: '已中断', cls: 'bg-white/[0.04] text-gray-400 border-white/10' },
}

interface Props {
  state: BatchState
  onAbort: () => void
  onClose: () => void
  onRetryFailed?: () => void
}

export default function BatchLaunchPanel({ state, onAbort, onClose, onRetryFailed }: Props) {
  if (state.items.length === 0) return null
  const done = state.items.filter((i) => i.status === 'done').length
  const failed = state.items.filter((i) => i.status === 'failed').length

  return (
    <section
      className="mb-5 overflow-hidden glass-card"
      data-testid="batch-launch-panel"
    >
      <header className="flex items-center gap-3 border-b border-white/10 bg-white/[0.02] px-5 py-3">
        <Rocket className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-white">
          批量立项 · {done}/{state.items.length} 完成
          {failed > 0 && <span className="ml-2 text-rose-300">{failed} 失败</span>}
        </h2>
        {state.running ? (
          <button
            type="button"
            onClick={onAbort}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs text-gray-300 hover:bg-white/10"
            data-testid="batch-abort-btn"
          >
            中断全部
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            {failed > 0 && onRetryFailed && (
              <button
                type="button"
                onClick={onRetryFailed}
                className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
                data-testid="batch-retry-failed-btn"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试失败（{failed}）
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-md p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              aria-label="关闭"
              data-testid="batch-close-btn"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>
      <ul className="divide-y divide-white/10" data-testid="batch-items">
        {state.items.map((it) => {
          const meta = STATUS_META[it.status]
          return (
            <li key={it.key} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="shrink-0">
                {it.status === 'running' || it.status === 'launching' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                ) : it.status === 'done' ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : it.status === 'failed' ? (
                  <TriangleAlert className="h-4 w-4 text-rose-400" />
                ) : (
                  <span className="inline-block h-4 w-4 rounded-full border border-white/20" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {it.projectId ? (
                    <Link
                      to={`/projects/${it.projectId}`}
                      className="truncate font-medium text-gray-100 hover:text-violet-300 hover:underline"
                    >
                      {it.title}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-gray-100">{it.title}</span>
                  )}
                </div>
                {it.status === 'running' && it.step && (
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-violet-300">
                    <span>
                      {(it.stepIndex ?? 0) + 1}/{it.stepTotal} · {STEP_LABEL[it.step] ?? it.step}
                      {it.step === 'body' && it.bodyChapter
                        ? ` ${it.bodyChapter}/${it.bodyTotalChapters}章`
                        : ''}
                    </span>
                    {it.retry && (
                      <span className="inline-flex items-center gap-0.5 text-amber-300">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        重试 {it.retry.attempt}/{it.retry.max}
                      </span>
                    )}
                  </div>
                )}
                {it.status === 'failed' && it.error && (
                  <div className="mt-0.5 truncate text-[11px] text-rose-400" title={it.error}>
                    {it.error}
                  </div>
                )}
              </div>
              <span
                className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
              >
                {meta.label}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
