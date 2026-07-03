import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  Plus,
  Rocket,
  Sparkles,
  TriangleAlert,
  Wand2,
  X,
} from 'lucide-react'
import { projectsApi, type PublishQaResult } from '../api/projects'
import { chaptersApi, type Beat, type Chapter } from '../api/chapters'
import { useSSE } from '../hooks/useSSE'
import { useFullBook } from '../hooks/useFullBook'
import { useConfirm } from '../components/ConfirmDialog'

/** axios 用 AbortSignal 取消时抛 CanceledError（code=ERR_CANCELED）；原生 fetch 抛 AbortError */
function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const err = e as { name?: string; code?: string }
  return err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED'
}

/** 章节 idx 1/3/5/8/10 为爆点章 */
const EXPLOSIVE_IDXS = new Set([1, 3, 5, 8, 10])

export default function Write() {
  const { id } = useParams<{ id: string }>()
  const projectId = id!
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

  const chapters = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => chaptersApi.listByProject(projectId),
    enabled: !!projectId,
  })

  const [activeId, setActiveId] = useState<string | null>(null)
  // 自动选第一个 / 新建后的最新一章
  useEffect(() => {
    if (!chapters.data || chapters.data.length === 0) {
      setActiveId(null)
      return
    }
    if (!activeId || !chapters.data.some((c) => c.id === activeId)) {
      setActiveId(chapters.data[0].id)
    }
  }, [chapters.data, activeId])

  const active = useMemo(
    () => chapters.data?.find((c) => c.id === activeId) ?? null,
    [chapters.data, activeId],
  )

  const createChapter = useMutation({
    mutationFn: () =>
      chaptersApi.create(projectId, `第${(chapters.data?.length ?? 0) + 1}章`),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['chapters', projectId] })
      setActiveId(c.id)
    },
  })

  const finalize = useMutation({
    mutationFn: () => projectsApi.transition(projectId, 'ready'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      navigate('/ready')
    },
  })

  const [qaResult, setQaResult] = useState<PublishQaResult | null>(null)
  const [qaOpen, setQaOpen] = useState(false)
  const publishQa = useMutation({
    mutationFn: () => projectsApi.publishQa(projectId),
    onSuccess: (r) => { setQaResult(r); setQaOpen(true) },
  })

  /** AI 一键全篇：编排在 useFullBook hook 里 */
  const fullBook = useFullBook()

  async function generateFullBook() {
    if (fullBook.progress.running) return
    const targetRaw = window.prompt('目标章节数（短篇推荐 10 章）', '10')
    if (!targetRaw) return
    const target = parseInt(targetRaw, 10)
    if (!Number.isFinite(target) || target < 1 || target > 20) {
      alert('章节数得在 1 - 20 之间')
      return
    }
    await fullBook.run({ projectId, target })
  }

  return (
    <div className="bg-gray-50">
      <header className="sticky top-14 z-20 bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}`)}
            className="text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> 返回
          </button>
          <span className="text-gray-300">/</span>
          <span className="font-semibold text-gray-900 truncate">{project.data?.title ?? '…'}</span>
          <span className="text-xs text-gray-400 truncate">{project.data?.track}</span>
          <span className="ml-auto text-xs text-gray-500">
            {chapters.data ? `${chapters.data.length} 章 · 共 ${totalWords(chapters.data)} 字` : ''}
          </span>
          {project.data?.status === 'writing' && (
            <button
              type="button"
              onClick={generateFullBook}
              disabled={fullBook.progress.running || finalize.isPending}
              data-testid="ai-full-book-btn"
              title="基于项目标题：补齐到 N 章 → 每章 AI 拆段 + AI 写满"
              className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            >
              {fullBook.progress.running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Rocket className="h-3 w-3" />
              )}
              {fullBook.progress.running
                ? `第 ${fullBook.progress.chapter}/${fullBook.progress.totalChapters} 章 · 段 ${fullBook.progress.beat}/${fullBook.progress.totalBeats} · ${fullBook.progress.chars}字`
                : 'AI 一键全篇'}
            </button>
          )}
          {fullBook.progress.running && (
            <button
              type="button"
              onClick={fullBook.abort}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              data-testid="ai-full-book-abort-btn"
              title="中断后已写入的段会保留"
            >
              中断
            </button>
          )}
          {fullBook.progress.error && (
            <span className="text-xs text-rose-600 inline-flex items-center gap-1">
              <TriangleAlert className="h-3 w-3" /> 全篇失败：{fullBook.progress.error}
            </span>
          )}
          {project.data?.status === 'writing' && (
            <>
              {(() => {
                const total = chapters.data?.reduce((a, c) => a + c.word_count, 0) ?? 0
                const need = 10000
                const enough = total >= need
                return (
                  <>
                    {enough && (
                      <button
                        type="button"
                        onClick={() => publishQa.mutate()}
                        disabled={publishQa.isPending}
                        data-testid="qa-check-btn"
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {publishQa.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardCheck className="h-3 w-3" />}
                        QA 自检
                      </button>
                    )}
                    <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        title: '定稿进入「待发」？',
                        description:
                          '定稿后该项目不可再编辑章节，仅能继续生成发布稿/配套。',
                        confirmText: '定稿',
                      })
                      if (ok) finalize.mutate()
                    }}
                    disabled={
                      finalize.isPending ||
                      !chapters.data ||
                      chapters.data.length === 0 ||
                      !enough
                    }
                    title={
                      enough
                        ? '正文 ≥ 10000 字，可定稿'
                        : `SOP 硬底线：正文 ≥10000 字才能定稿，还差 ${need - total} 字`
                    }
                    className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                      enough
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-gray-300 cursor-not-allowed'
                    }`}
                    data-testid="finalize-btn"
                  >
                    {finalize.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    {enough
                      ? '定稿 → 待发'
                      : `定稿 (${total}/${need})`}
                  </button>
                  </>
                )
              })()}
            </>
          )}
          {finalize.isError && (
            <span className="text-xs text-rose-600 inline-flex items-center gap-1">
              <TriangleAlert className="h-3 w-3" />
              定稿失败：{(finalize.error as { response?: { data?: { detail?: string } }; message?: string }).response?.data?.detail ?? (finalize.error as Error).message}
            </span>
          )}
        </div>
      </header>

      {/* QA 自检结果横幅 */}
      {qaOpen && qaResult && <QaBanner result={qaResult} onClose={() => setQaOpen(false)} />}

      {/* 字数进度条 */}
      <WordCountBar chapters={chapters.data ?? []} />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
          {/* 左栏：章节列表 */}
          <aside className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-3 h-fit">
            <header className="flex items-center mb-2">
              <span className="text-sm font-semibold text-gray-700">章节</span>
              <button
                type="button"
                onClick={() => createChapter.mutate()}
                disabled={createChapter.isPending}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                data-testid="new-chapter-btn"
              >
                {createChapter.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                新章
              </button>
            </header>
            <ul className="flex flex-col gap-1">
              {chapters.data?.map((c) => {
                const explosive = EXPLOSIVE_IDXS.has(c.idx)
                return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-sm transition ${
                      c.id === activeId
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${
                        explosive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {explosive ? '★' : c.idx}
                      </span>
                      <span className="flex-1 truncate">{c.title || '（未命名）'}</span>
                      <span className="text-[10px] text-gray-400">{c.word_count}字</span>
                    </div>
                  </button>
                </li>
                )
              })}
            </ul>
            {chapters.data?.length === 0 && (
              <p className="text-xs text-gray-400 px-2 py-3">点「新章」开始第 1 章</p>
            )}
          </aside>

          {/* 中栏：正文编辑 */}
          <section className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-5 min-h-[60vh]">
            {active ? (
              <ChapterEditor
                key={active.id}
                chapter={active}
                editable={project.data?.status === 'writing'}
                liveText={
                  fullBook.progress.liveBody?.chapterId === active.id
                    ? fullBook.progress.liveBody.text
                    : null
                }
              />
            ) : (
              <div className="text-sm text-gray-500 py-12 text-center">
                左边新建一章开始写作。
              </div>
            )}
          </section>

          {/* 右栏：AI 助手 + playbook */}
          <aside className="space-y-3 lg:sticky lg:top-[100px] lg:self-start lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
            <div className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4">
              {active ? (
                <AiPanel chapter={active} disabled={project.data?.status !== 'writing'} />
              ) : (
                <p className="text-xs text-gray-400">先选一章。</p>
              )}
            </div>
            <PlaybookLinks />
          </aside>
        </div>
      </main>
    </div>
  )
}

function totalWords(list: Chapter[]) {
  return list.reduce((a, c) => a + c.word_count, 0)
}

function WordCountBar({ chapters }: { chapters: Chapter[] }) {
  const total = totalWords(chapters)
  const need = 10000
  const pct = Math.min(100, Math.round((total / need) * 100))
  const done = total >= need
  return (
    <div className={`sticky top-[104px] z-10 border-b ${done ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-1.5">
        <div className="flex items-center gap-3 text-xs overflow-x-auto">
          {!done && <TriangleAlert className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
          <span className={`font-medium shrink-0 ${done ? 'text-emerald-800' : 'text-amber-800'}`}>
            {total.toLocaleString('zh-CN')} / {need.toLocaleString('zh-CN')} 字
          </span>
          <div className="w-20 shrink-0">
            <div className={`h-1.5 w-full rounded-full overflow-hidden ${done ? 'bg-emerald-100' : 'bg-amber-100'}`}>
              <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <span className="text-gray-300 shrink-0">·</span>
          <div className="flex items-center gap-1 overflow-x-auto">
            {chapters.map((c) => (
              <span key={c.id} className={`px-1.5 py-0.5 rounded font-mono shrink-0 text-[11px] ${
                c.word_count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
              }`}>
                {c.idx}:{c.word_count > 0 ? c.word_count : '—'}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const QA_DIMS: Array<{ label: string; sk: keyof PublishQaResult; ck: keyof PublishQaResult }> = [
  { label: '首句冲击力', sk: 'first_sentence_score', ck: 'first_sentence_comment' },
  { label: '前200字留人率', sk: 'retention_score', ck: 'retention_comment' },
  { label: '节奏密度', sk: 'pacing_score', ck: 'pacing_comment' },
  { label: 'AI味浓度', sk: 'anti_ai_score', ck: 'anti_ai_comment' },
  { label: '标题匹配度', sk: 'title_match_score', ck: 'title_match_comment' },
]
const VERDICT_STYLE = {
  pass:   { wrap: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-900', badge: 'bg-emerald-100 text-emerald-800', label: '通过' },
  revise: { wrap: 'bg-amber-50 border-amber-200',   text: 'text-amber-900',   badge: 'bg-amber-100 text-amber-800',   label: '需修改' },
  reject: { wrap: 'bg-rose-50 border-rose-200',     text: 'text-rose-900',    badge: 'bg-rose-100 text-rose-800',     label: '不发' },
}

function QaBanner({ result, onClose }: { result: PublishQaResult; onClose: () => void }) {
  const s = VERDICT_STYLE[result.verdict]
  return (
    <div className={`border-b ${s.wrap} ${s.text}`}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold font-mono">{result.total_score}/50</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${s.badge}`}>{s.label}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-5">
              {QA_DIMS.map((d) => (
                <div key={d.label}>
                  <div className="font-medium">{d.label} <span className="font-mono">{result[d.sk] as number}</span></div>
                  <div className="mt-0.5 opacity-75 leading-relaxed">{result[d.ck] as string}</div>
                </div>
              ))}
            </div>
            {result.verdict !== 'pass' && (result.kill_reasons.length > 0 || result.quick_fix) && (
              <div className="mt-2 space-y-0.5 text-xs">
                {result.kill_reasons.length > 0 && (
                  <div><span className="font-semibold">❌ 致命问题：</span>{result.kill_reasons.join(' · ')}</div>
                )}
                {result.quick_fix && (
                  <div><span className="font-semibold">🔧 快速修复：</span>{result.quick_fix}</div>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1 hover:bg-black/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

const PLAYBOOK_LINKS = [
  { label: '去 AI 味 · 短句节奏', color: 'text-amber-600' },
  { label: '爆点节奏 · 高潮设计', color: 'text-emerald-600' },
  { label: '代入感 · 场景优先', color: 'text-blue-600' },
  { label: '钩子 · 章尾悬念', color: 'text-violet-600' },
]

function PlaybookLinks() {
  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Playbook 参考</h3>
        <a href="/playbook" className="text-xs text-blue-600 hover:underline">全部</a>
      </div>
      <div className="p-2 space-y-0.5">
        {PLAYBOOK_LINKS.map((l) => (
          <a key={l.label} href="/playbook" className="flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-gray-50 text-xs">
            <span className="flex items-center gap-2 text-gray-700">
              <BookOpen className={`h-3.5 w-3.5 shrink-0 ${l.color}`} />
              {l.label}
            </span>
            <ExternalLink className="h-3 w-3 text-gray-400 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  )
}

interface ChapterEditorProps {
  chapter: Chapter
  editable: boolean
  /** AI 全篇 / 全章流式生成时，本章实时累积文本；非 null 时覆盖编辑器只读展示 */
  liveText?: string | null
}

function ChapterEditor({ chapter, editable, liveText }: ChapterEditorProps) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(chapter.title)
  const [body, setBody] = useState(chapter.body)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // 切章节时重置
  useEffect(() => {
    setTitle(chapter.title)
    setBody(chapter.body)
    setSavedAt(null)
  }, [chapter.id])

  // AI 流式段落落库后会更新 chapter.body，把它同步到本地 state（仅当用户没在改）
  useEffect(() => {
    if (liveText == null) {
      setBody(chapter.body)
    }
  }, [chapter.body, liveText])

  const streaming = liveText != null
  const displayBody = streaming ? liveText! : body
  const wc = useMemo(() => Array.from(displayBody).length, [displayBody])
  const dirty = !streaming && (title !== chapter.title || body !== chapter.body)

  const save = useMutation({
    mutationFn: () => chaptersApi.update(chapter.id, title, body),
    onSuccess: (c) => {
      qc.setQueryData<Chapter[]>(['chapters', c.project_id], (prev) =>
        prev ? prev.map((x) => (x.id === c.id ? c : x)) : prev,
      )
      qc.invalidateQueries({ queryKey: ['chapters', c.project_id] })
      setSavedAt(new Date())
    },
  })

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-gray-400">#{chapter.idx}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="章节标题"
          disabled={!editable || streaming}
          className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-medium outline-none focus:border-blue-500 disabled:bg-gray-50"
          data-testid="chapter-title-input"
        />
        {streaming && (
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-[11px] text-violet-700">
            <Sparkles className="h-3 w-3 animate-pulse" /> AI 写入中
          </span>
        )}
      </div>
      <textarea
        value={displayBody}
        onChange={(e) => !streaming && setBody(e.target.value)}
        placeholder={
          editable ? '在这里写正文，或者用右边 AI 工具拆 beats / 段写。' : '已定稿（只读）'
        }
        readOnly={!editable || streaming}
        className={`flex-1 min-h-[420px] resize-y rounded-md border bg-white px-3 py-2 font-mono text-[14px] leading-7 outline-none whitespace-pre-wrap ${
          streaming ? 'border-violet-300 bg-violet-50/30' : 'border-gray-200 focus:border-blue-500'
        } disabled:bg-gray-50`}
        data-testid="chapter-body-textarea"
      />
      <footer className="flex items-center gap-3 text-xs text-gray-500">
        <span data-testid="chapter-wc">
          字数 <span className="font-mono font-semibold text-gray-900">{wc}</span>
        </span>
        {streaming && <span className="text-violet-600">AI 流式生成中…</span>}
        {!streaming && savedAt && (
          <span className="text-emerald-600">已保存 {savedAt.toLocaleTimeString()}</span>
        )}
        {editable && !streaming && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            data-testid="save-chapter-btn"
          >
            {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            保存
          </button>
        )}
      </footer>
    </div>
  )
}

interface AiPanelProps {
  chapter: Chapter
  disabled: boolean
}

function AiPanel({ chapter, disabled }: AiPanelProps) {
  const qc = useQueryClient()
  const [beats, setBeats] = useState<Beat[]>(chapter.beats ?? [])
  const [activeBeatId, setActiveBeatId] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')
  const writeStream = useSSE({
    onDone: (full) => setDraft(full),
  })
  const writing = writeStream.status === 'streaming'
  /** AI 一键全章的中断控制器：点「停止」时 abort，已写好的段落会落库保留 */
  const fullChapterAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    setBeats(chapter.beats ?? [])
    setActiveBeatId(null)
    setDraft('')
  }, [chapter.id])

  // 切章 / 卸载时中断仍在跑的全章生成
  useEffect(() => {
    return () => {
      fullChapterAbort.current?.abort()
    }
  }, [chapter.id])

  const aiBeats = useMutation({
    mutationFn: () =>
      chaptersApi.aiBeats(chapter.id, chapter.title || undefined),
    onSuccess: (r) => {
      setBeats(r.beats)
      qc.invalidateQueries({ queryKey: ['chapters', chapter.project_id] })
    },
  })

  function startWrite(beat: Beat) {
    const tail = chapter.body.slice(-200)
    setActiveBeatId(beat.id)
    setDraft('')
    writeStream.start(chaptersApi.aiWriteStreamUrl(chapter.id), { beat, prev_tail: tail })
  }

  const adopt = useMutation({
    mutationFn: async () => {
      const sep = chapter.body && !chapter.body.endsWith('\n') ? '\n\n' : chapter.body ? '\n' : ''
      const newBody = chapter.body + sep + (writeStream.text || draft)
      return chaptersApi.update(chapter.id, chapter.title, newBody)
    },
    onSuccess: (c) => {
      qc.setQueryData<Chapter[]>(['chapters', c.project_id], (prev) =>
        prev ? prev.map((x) => (x.id === c.id ? c : x)) : prev,
      )
      qc.invalidateQueries({ queryKey: ['chapters', c.project_id] })
      setDraft('')
    },
  })

  /** AI 全章生成：beats（没有就先生成）→ 逐 beat ai-write → 拼接 → update chapter */
  const [fullChapter, setFullChapter] = useState<{ running: boolean; current: number; total: number; error?: string }>(
    { running: false, current: 0, total: 0 },
  )
  async function generateFullChapter() {
    if (fullChapter.running) return
    if (!chapter.title.trim()) return
    setFullChapter({ running: true, current: 0, total: 0 })
    const ac = new AbortController()
    fullChapterAbort.current = ac
    const aborted = () => ac.signal.aborted
    let body = chapter.body
    /** 把当前已生成的正文落库（中断 / 跑完都用它，保住已写好的段落） */
    const persist = async () => {
      if (body === chapter.body) return
      const updated = await chaptersApi.update(chapter.id, chapter.title, body)
      qc.setQueryData<Chapter[]>(['chapters', updated.project_id], (prev) =>
        prev ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev,
      )
      qc.invalidateQueries({ queryKey: ['chapters', updated.project_id] })
    }
    try {
      let workingBeats = beats
      if (workingBeats.length === 0) {
        const r = await chaptersApi.aiBeats(chapter.id, chapter.title, ac.signal)
        workingBeats = r.beats
        setBeats(workingBeats)
      }
      setFullChapter({ running: true, current: 0, total: workingBeats.length })

      for (let i = 0; i < workingBeats.length; i++) {
        if (aborted()) break
        const b = workingBeats[i]
        setFullChapter({ running: true, current: i + 1, total: workingBeats.length })
        setActiveBeatId(b.id)
        const tail = body.slice(-200)
        const r = await chaptersApi.aiWrite(chapter.id, b, tail, ac.signal)
        const sep = body && !body.endsWith('\n') ? '\n\n' : body ? '\n' : ''
        body = body + sep + r.text
      }
      await persist()
      setActiveBeatId(null)
      setFullChapter({ running: false, current: 0, total: 0 })
    } catch (e) {
      // 用户主动中断不算错误：把已写好的段落落库后静默收尾
      if (isAbortError(e) || aborted()) {
        try {
          await persist()
        } catch {
          // 落库失败就算了，正文还在内存里，用户可手动重试
        }
        setActiveBeatId(null)
        setFullChapter({ running: false, current: 0, total: 0 })
        return
      }
      setFullChapter({
        running: false,
        current: 0,
        total: 0,
        error: e instanceof Error ? e.message : '未知错误',
      })
    } finally {
      fullChapterAbort.current = null
    }
  }

  function stopFullChapter() {
    fullChapterAbort.current?.abort()
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <header className="flex items-center gap-1 text-violet-700">
        <Sparkles className="h-4 w-4" />
        <span className="font-semibold">AI 辅助</span>
      </header>

      <button
        type="button"
        onClick={() => aiBeats.mutate()}
        disabled={disabled || aiBeats.isPending || fullChapter.running || !chapter.title.trim()}
        className="inline-flex items-center justify-center gap-1 rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        data-testid="ai-beats-btn"
      >
        {aiBeats.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
        {beats.length > 0 ? '重新拆段（覆盖）' : 'AI 拆段（5-7 个 beat）'}
      </button>

      {/* AI 全章生成：拆段 + 逐节奏续写 + 落库一气呵成；运行中可点「停止」中断，已写好的段落会保留 */}
      {fullChapter.running ? (
        <button
          type="button"
          onClick={stopFullChapter}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
          data-testid="ai-full-chapter-stop-btn"
          title="停止全章生成，已写好的段落会保留并落库"
        >
          <TriangleAlert className="h-3 w-3" />
          停止（已写 {fullChapter.current}/{fullChapter.total} 段）
        </button>
      ) : (
        <button
          type="button"
          onClick={generateFullChapter}
          disabled={disabled || aiBeats.isPending || !chapter.title.trim()}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          data-testid="ai-full-chapter-btn"
          title="基于章节标题：AI 拆 5-7 个 beat → 逐 beat 写一段 → 直接拼到正文末"
        >
          <Rocket className="h-3 w-3" />
          AI 一键全章
        </button>
      )}
      {fullChapter.running && (
        <p className="text-xs text-emerald-700 inline-flex items-center gap-1" data-testid="ai-full-chapter-progress">
          <Loader2 className="h-3 w-3 animate-spin" />
          {fullChapter.total > 0
            ? `AI 写第 ${fullChapter.current}/${fullChapter.total} 段…`
            : 'AI 拆段中…'}
        </p>
      )}
      {fullChapter.error && (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1">
          <TriangleAlert className="h-3 w-3" /> 全章生成失败：{fullChapter.error}
        </p>
      )}
      {writing && writeStream.retry && (
        <p className="text-xs text-amber-600 inline-flex items-center gap-1" data-testid="write-retry-status">
          <Loader2 className="h-3 w-3 animate-spin" /> 上游繁忙，正在重试（{writeStream.retry.attempt}/{writeStream.retry.max}）…
        </p>
      )}
      {writeStream.status === 'error' && (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1">
          <TriangleAlert className="h-3 w-3" /> 段落生成失败：{writeStream.error}
        </p>
      )}
      {!chapter.title.trim() && (
        <p className="text-xs text-gray-400">先写章节标题再拆段。</p>
      )}
      {aiBeats.isError && (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1">
          <TriangleAlert className="h-3 w-3" /> 拆段失败，可重试
        </p>
      )}

      {beats.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="beats-list">
          {beats.map((b) => (
            <article
              key={b.id}
              className={`rounded-md border p-2 ${
                activeBeatId === b.id ? 'border-violet-300 bg-violet-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-gray-400 mt-0.5">{b.id}</span>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-gray-900">{b.label}</div>
                  {b.note && <div className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{b.note}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => startWrite(b)}
                  disabled={disabled || writing || fullChapter.running}
                  className="shrink-0 inline-flex items-center gap-1 rounded border border-violet-200 bg-white px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  data-testid={`ai-write-${b.id}`}
                >
                  {writing && activeBeatId === b.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  写
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {(draft || writeStream.text) && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3" data-testid="ai-draft">
          <div className="text-xs text-emerald-700 font-semibold mb-1.5">
            AI 草稿（{Array.from(writeStream.text || draft).length} 字）
          </div>
          <div className="text-[12px] leading-6 text-gray-800 whitespace-pre-wrap">
            {writeStream.text || draft}
            {writing && <span className="inline-block w-2 h-4 bg-emerald-400 align-text-bottom animate-pulse ml-0.5" />}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => adopt.mutate()}
              disabled={adopt.isPending || writing}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              data-testid="adopt-draft-btn"
            >
              {adopt.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
              追加到正文末
            </button>
            <button
              type="button"
              onClick={() => {
                writeStream.abort()
                setDraft('')
              }}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              {writing ? '停止' : '丢弃'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
