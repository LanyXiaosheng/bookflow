import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Loader2,
  Plus,
  Rocket,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react'
import { projectsApi } from '../api/projects'
import { chaptersApi, type Beat, type Chapter } from '../api/chapters'
import { useSSE } from '../hooks/useSSE'
import { useFullBook } from '../hooks/useFullBook'
import { useConfirm } from '../components/ConfirmDialog'

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
            onClick={() => navigate('/projects')}
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

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_400px]">
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
              {chapters.data?.map((c) => (
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
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">#{c.idx}</span>
                      <span className="flex-1 truncate">{c.title || '（未命名）'}</span>
                      <span className="text-[10px] text-gray-400">{c.word_count}字</span>
                    </div>
                  </button>
                </li>
              ))}
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

          {/* 右栏：AI 抽屉 */}
          <aside className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4 h-fit">
            {active ? (
              <AiPanel chapter={active} disabled={project.data?.status !== 'writing'} />
            ) : (
              <p className="text-xs text-gray-400">先选一章。</p>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}

function totalWords(list: Chapter[]) {
  return list.reduce((a, c) => a + c.word_count, 0)
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

  useEffect(() => {
    setBeats(chapter.beats ?? [])
    setActiveBeatId(null)
    setDraft('')
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
    try {
      let workingBeats = beats
      if (workingBeats.length === 0) {
        const r = await chaptersApi.aiBeats(chapter.id, chapter.title)
        workingBeats = r.beats
        setBeats(workingBeats)
      }
      setFullChapter({ running: true, current: 0, total: workingBeats.length })

      let body = chapter.body
      for (let i = 0; i < workingBeats.length; i++) {
        const b = workingBeats[i]
        setFullChapter({ running: true, current: i + 1, total: workingBeats.length })
        setActiveBeatId(b.id)
        const tail = body.slice(-200)
        const r = await chaptersApi.aiWrite(chapter.id, b, tail)
        const sep = body && !body.endsWith('\n') ? '\n\n' : body ? '\n' : ''
        body = body + sep + r.text
      }
      const updated = await chaptersApi.update(chapter.id, chapter.title, body)
      qc.setQueryData<Chapter[]>(['chapters', updated.project_id], (prev) =>
        prev ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev,
      )
      qc.invalidateQueries({ queryKey: ['chapters', updated.project_id] })
      setActiveBeatId(null)
      setFullChapter({ running: false, current: 0, total: 0 })
    } catch (e) {
      setFullChapter({
        running: false,
        current: 0,
        total: 0,
        error: e instanceof Error ? e.message : '未知错误',
      })
    }
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

      {/* AI 全章生成：拆段 + 逐节奏续写 + 落库一气呵成 */}
      <button
        type="button"
        onClick={generateFullChapter}
        disabled={disabled || aiBeats.isPending || fullChapter.running || !chapter.title.trim()}
        className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        data-testid="ai-full-chapter-btn"
        title="基于章节标题：AI 拆 5-7 个 beat → 逐 beat 写一段 → 直接拼到正文末"
      >
        {fullChapter.running ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Rocket className="h-3 w-3" />
        )}
        {fullChapter.running
          ? `AI 写第 ${fullChapter.current}/${fullChapter.total} 段…`
          : 'AI 一键全章'}
      </button>
      {fullChapter.error && (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1">
          <TriangleAlert className="h-3 w-3" /> 全章生成失败：{fullChapter.error}
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
                  disabled={disabled || writing}
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
