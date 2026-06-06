import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChevronLeft,
  FileText,
  Loader2,
  Pencil,
  Rocket,
  Sparkles,
  TriangleAlert,
  Wand2,
  Zap,
} from 'lucide-react'
import { projectsApi, type ArtifactKind, type ProjectArtifact } from '../api/projects'
import { chaptersApi, type Chapter } from '../api/chapters'
import {
  clearAiJob,
  setAiJob,
  useAiJob,
  type AiJob,
} from '../hooks/useAiJobStore'
import { useSSE } from '../hooks/useSSE'
import { useFullBook } from '../hooks/useFullBook'
import { usePipeline } from '../hooks/usePipeline'

type PreflightDrafts = Record<'readme' | 'character_setup', string>

function emptyPreflightDrafts(): PreflightDrafts {
  return { readme: '', character_setup: '' }
}

function confirmedCharacterSetupKey(projectId: string): string {
  return `bookflow.character-setup-confirmed:${projectId}`
}

function readConfirmedCharacterSetupVersion(projectId: string): number | null {
  try {
    const raw = localStorage.getItem(confirmedCharacterSetupKey(projectId))
    if (!raw) return null
    const version = Number.parseInt(raw, 10)
    return Number.isFinite(version) ? version : null
  } catch {
    return null
  }
}

function writeConfirmedCharacterSetupVersion(
  projectId: string,
  version: number | null,
) {
  try {
    if (version === null) {
      localStorage.removeItem(confirmedCharacterSetupKey(projectId))
      return
    }
    localStorage.setItem(confirmedCharacterSetupKey(projectId), String(version))
  } catch {
    // ignore storage write errors
  }
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const projectId = id!
  const qc = useQueryClient()

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

  const artifacts = useQuery({
    queryKey: ['project-artifacts', projectId],
    queryFn: () => projectsApi.listArtifacts(projectId),
    enabled: !!projectId,
  })

  const chapters = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => chaptersApi.listByProject(projectId),
    enabled: !!projectId,
  })

  const readme = useMemo(
    () => pickLatest(artifacts.data, 'readme'),
    [artifacts.data],
  )
  const characterSetup = useMemo(
    () => pickLatest(artifacts.data, 'character_setup'),
    [artifacts.data],
  )
  const outline = useMemo(
    () => pickLatest(artifacts.data, 'outline'),
    [artifacts.data],
  )
  const publishPost = useMemo(
    () => pickLatest(artifacts.data, 'publish_post'),
    [artifacts.data],
  )
  const sideDishes = useMemo(
    () => pickLatest(artifacts.data, 'side_dishes'),
    [artifacts.data],
  )
  const bookSummary = useMemo(
    () => pickLatest(artifacts.data, 'book_summary'),
    [artifacts.data],
  )
  const bookPolished = useMemo(
    () => pickLatest(artifacts.data, 'book_polished'),
    [artifacts.data],
  )
  const aiJob = useAiJob(projectId)
  const bodyChars = useMemo(() => countBodyChars(chapters.data), [chapters.data])
  const [preflightDrafts, setPreflightDrafts] = useState<PreflightDrafts>(() =>
    emptyPreflightDrafts(),
  )
  const [confirmedCharacterSetupVersion, setConfirmedCharacterSetupVersion] = useState<number | null>(
    () => readConfirmedCharacterSetupVersion(projectId),
  )
  const readmeIsNewerThanCharacterSetup =
    !!readme && !!characterSetup && artifactTs(readme) > artifactTs(characterSetup)
  const characterSetupConfirmed =
    !!characterSetup &&
    !readmeIsNewerThanCharacterSetup &&
    confirmedCharacterSetupVersion === characterSetup.version
  const outlineNeedsRefresh =
    !!outline &&
    !!characterSetup &&
    (artifactTs(outline) < artifactTs(characterSetup) || !characterSetupConfirmed)
  const bodyNeedsRefresh =
    bodyChars > 0 &&
    (!!characterSetup &&
      (!outline || artifactTs(outline) < artifactTs(characterSetup) || !characterSetupConfirmed))

  const refreshArtifacts = () =>
    qc.invalidateQueries({ queryKey: ['project-artifacts', projectId] })

  useEffect(() => {
    setPreflightDrafts(emptyPreflightDrafts())
    setConfirmedCharacterSetupVersion(readConfirmedCharacterSetupVersion(projectId))
  }, [projectId])

  useEffect(() => {
    writeConfirmedCharacterSetupVersion(projectId, confirmedCharacterSetupVersion)
  }, [confirmedCharacterSetupVersion, projectId])

  /** SOP 阶段 2 前期方案流：README → 角色设定（链式 SSE，自动落库） */
  const pipeline = usePipeline()
  const runProjectizeFlow = async () => {
    setPreflightDrafts(emptyPreflightDrafts())
    const ok = await pipeline.run([
      {
        key: 'readme',
        label: 'README',
        url: `/api/projects/${projectId}/ai-readme/stream`,
        stream: true,
        onText: (full) =>
          setPreflightDrafts((drafts) => ({ ...drafts, readme: full })),
      },
      {
        key: 'character_setup',
        label: '角色设定',
        url: `/api/projects/${projectId}/ai-character-setup/stream`,
        stream: true,
        onText: (full) =>
          setPreflightDrafts((drafts) => ({ ...drafts, character_setup: full })),
      },
    ])
    if (ok) await refreshArtifacts()
    setPreflightDrafts(emptyPreflightDrafts())
  }

  return (
    <div className="bg-gray-50">
      <header className="sticky top-14 z-20 bg-white border-b border-gray-200">
        <div className="mx-auto flex min-h-12 max-w-[1200px] flex-wrap items-center gap-2 px-4 py-3 text-sm sm:gap-3 sm:px-6 lg:px-8">
          <Link
            to="/projects"
            className="inline-flex shrink-0 items-center gap-1 text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" /> 返回项目列表
          </Link>
          <span className="hidden text-gray-300 sm:inline">/</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-gray-900">
              {project.data?.title ?? '…'}
            </div>
            <div className="truncate text-xs text-gray-400 sm:hidden">
              {project.data?.track}
            </div>
          </div>
          <span className="hidden truncate text-xs text-gray-400 sm:inline">
            {project.data?.track}
          </span>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={runProjectizeFlow}
              disabled={pipeline.progress.running}
              title="串行重新生成 README → 角色设定，确认后再生成大纲"
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 sm:flex-none"
              data-testid="projectize-flow-btn"
            >
              {pipeline.progress.running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              {pipeline.progress.running
                ? `${pipelineLabel(pipeline.progress.currentKey)} · ${pipeline.progress.chars}字`
                : '重新生成前期方案'}
            </button>
            {pipeline.progress.running && (
              <button
                type="button"
                onClick={pipeline.abort}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 sm:flex-none"
                data-testid="projectize-flow-abort-btn"
              >
                中断
              </button>
            )}
            <Link
              to={`/projects/${projectId}/write`}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 sm:flex-none"
            >
              <Pencil className="h-3 w-3" /> 进入写作
            </Link>
          </div>
        </div>
        {pipeline.progress.error && (
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pb-2 text-xs text-rose-600 inline-flex items-center gap-1">
            <TriangleAlert className="h-3 w-3" />
            前期方案流失败：{pipeline.progress.error}
          </div>
        )}
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <WorkflowStrip
            hasReadme={!!readme}
            hasCharacterSetup={!!characterSetup}
            characterSetupNeedsRegeneration={readmeIsNewerThanCharacterSetup}
            characterSetupConfirmed={characterSetupConfirmed}
            hasOutline={!!outline}
            chapterCount={chapters.data?.length ?? 0}
            totalWords={chapters.data?.reduce((a, c) => a + c.word_count, 0) ?? 0}
            hasPublishPost={!!publishPost}
            hasSideDishes={!!sideDishes}
          />
          <ReadmeCard
            projectId={projectId}
            readme={readme}
            onDone={refreshArtifacts}
            globalJob={aiJob}
            externalText={preflightDrafts.readme}
            externalStreaming={pipeline.progress.running && pipeline.progress.currentKey === 'readme'}
          />
          <CharacterSetupCard
            projectId={projectId}
            characterSetup={characterSetup}
            hasReadme={!!readme}
            characterSetupConfirmed={characterSetupConfirmed}
            characterSetupNeedsRegeneration={readmeIsNewerThanCharacterSetup}
            onConfirm={() => {
              if (!characterSetup) return
              setConfirmedCharacterSetupVersion(characterSetup.version)
            }}
            onDone={refreshArtifacts}
            globalJob={aiJob}
            externalText={preflightDrafts.character_setup}
            externalStreaming={
              pipeline.progress.running && pipeline.progress.currentKey === 'character_setup'
            }
          />
          <OutlineCard
            projectId={projectId}
            outline={outline}
            hasReadme={!!readme}
            hasCharacterSetup={!!characterSetup}
            characterSetupCurrent={!readmeIsNewerThanCharacterSetup}
            characterSetupConfirmed={characterSetupConfirmed}
            outlineNeedsRefresh={outlineNeedsRefresh}
            onDone={refreshArtifacts}
            globalJob={aiJob}
          />
          <BodyGenCard
            projectId={projectId}
            chapters={chapters.data}
            hasOutline={!!outline}
            isWriting={project.data?.status === 'writing'}
            globalJob={aiJob}
            bodyNeedsRefresh={bodyNeedsRefresh}
          />
          <ArtifactStreamCard
            projectId={projectId}
            kind="book_summary"
            title="全书汇总"
            artifact={bookSummary}
            endpoint={`/api/projects/${projectId}/ai-book-summary/stream`}
            disabled={bodyChars === 0 || aiJob?.kind === 'full_book'}
            disabledHint={
              bodyChars === 0 ? '先生成至少一章正文，再汇总。' : '正文生成中，暂不能汇总。'
            }
            emptyHint="AI 会基于全章节正文整合出一版连贯完整正文。"
            onDone={refreshArtifacts}
            copyable
            globalJob={aiJob}
          />
          <ArtifactStreamCard
            projectId={projectId}
            kind="book_polished"
            title="优化升华"
            artifact={bookPolished}
            endpoint={`/api/projects/${projectId}/ai-book-polish/stream`}
            disabled={!bookSummary}
            disabledHint="先生成全书汇总，再做优化升华。"
            emptyHint="基于全书汇总继续去 AI 味、增强代入感和爽点节奏。"
            onDone={refreshArtifacts}
            copyable
            globalJob={aiJob}
          />
          <ArtifactStreamCard
            projectId={projectId}
            kind="publish_post"
            title="发布稿"
            artifact={publishPost}
            endpoint={`/api/projects/${projectId}/ai-publish/stream`}
            disabled={!outline}
            disabledHint="先生成 README 和大纲，再生成发布稿。"
            emptyHint="生成面向平台发布的标题、简介、卖点和正文引流文案。"
            onDone={refreshArtifacts}
            globalJob={aiJob}
          />
          <ArtifactStreamCard
            projectId={projectId}
            kind="side_dishes"
            title="配套素材"
            artifact={sideDishes}
            endpoint={`/api/projects/${projectId}/ai-side-dishes/stream`}
            disabled={!readme || !outline}
            disabledHint="先生成 README 和大纲，再生成配套素材。"
            emptyHint="生成配套.md：标题变体、短视频钩子、评论区话术、封面关键词等。"
            onDone={refreshArtifacts}
            globalJob={aiJob}
          />
        </div>

        <aside className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4 h-fit">
          <header className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold">章节</span>
            <span className="ml-auto text-xs text-gray-400">
              {chapters.data
                ? `${chapters.data.length} 章 · ${chapters.data.reduce((a, c) => a + c.word_count, 0)} 字`
                : ''}
            </span>
          </header>
          {chapters.isLoading && <p className="text-xs text-gray-500">加载中…</p>}
          {chapters.data && chapters.data.length === 0 && (
            <p className="text-xs text-gray-400">
              还没有章节。去「进入写作」开始第 1 章。
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {chapters.data?.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-gray-200 px-2 py-1.5"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-400">#{c.idx}</span>
                  <span className="flex-1 truncate">
                    {c.title || '（未命名）'}
                  </span>
                  <span className="text-[10px] text-gray-400">{c.word_count}字</span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  )
}

interface WorkflowStripProps {
  hasReadme: boolean
  hasCharacterSetup: boolean
  characterSetupNeedsRegeneration: boolean
  characterSetupConfirmed: boolean
  hasOutline: boolean
  chapterCount: number
  totalWords: number
  hasPublishPost: boolean
  hasSideDishes: boolean
}

function WorkflowStrip({
  hasReadme,
  hasCharacterSetup,
  characterSetupNeedsRegeneration,
  characterSetupConfirmed,
  hasOutline,
  chapterCount,
  totalWords,
  hasPublishPost,
  hasSideDishes,
}: WorkflowStripProps) {
  const steps = [
    { label: 'README', done: hasReadme, hint: hasReadme ? '已生成' : '点击下方 AI 生成' },
    {
      label: '角色设定',
      done: hasCharacterSetup && characterSetupConfirmed,
      hint: !hasReadme
        ? '先生成 README'
        : hasCharacterSetup
          ? characterSetupNeedsRegeneration
            ? '待重生'
            : characterSetupConfirmed
            ? '已确认'
            : '待确认'
          : '可生成',
    },
    {
      label: '大纲',
      done: hasOutline,
      hint: hasOutline
        ? characterSetupConfirmed
          ? '已生成'
          : '待按新设定重生'
        : !hasReadme
          ? '先生成 README'
          : !hasCharacterSetup
            ? '先出角色设定'
            : characterSetupConfirmed
              ? '可生成'
              : '先确认角色设定',
    },
    {
      label: '正文',
      done: chapterCount > 0 && totalWords > 0,
      hint:
        chapterCount > 0
          ? `${chapterCount} 章 · ${totalWords} 字`
          : hasOutline
            ? '进入写作生成'
            : '大纲后写作',
    },
    {
      label: '发布稿',
      done: hasPublishPost,
      hint: hasPublishPost ? '已生成' : hasOutline ? '可生成' : '先生成大纲',
    },
    {
      label: '配套',
      done: hasSideDishes,
      hint: hasSideDishes ? '已生成' : hasOutline ? '可生成' : '先生成大纲',
    },
  ]

  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={`rounded-md border px-3 py-2 ${
              step.done
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                  step.done ? 'bg-emerald-600 text-white' : 'bg-white text-gray-400 ring-1 ring-gray-200'
                }`}
              >
                {index + 1}
              </span>
              <span className="text-xs font-semibold text-gray-900">{step.label}</span>
            </div>
            <div className="mt-1 truncate text-[11px] text-gray-500">{step.hint}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function pickLatest(
  list: ProjectArtifact[] | undefined,
  kind: ArtifactKind,
): ProjectArtifact | undefined {
  if (!list) return undefined
  return list
    .filter((a) => a.kind === kind)
    .sort((a, b) => b.version - a.version)[0]
}

const PIPELINE_LABELS: Record<'readme' | 'character_setup' | 'outline' | 'body', string> = {
  readme: 'README',
  character_setup: '角色设定',
  outline: '大纲',
  body: '正文',
}
function pipelineLabel(
  key: 'readme' | 'character_setup' | 'outline' | 'body' | null,
): string {
  return key ? PIPELINE_LABELS[key] : ''
}

function countBodyChars(chapters?: Chapter[]): number {
  return chapters?.reduce((sum, c) => sum + Array.from(c.body ?? '').length, 0) ?? 0
}

function artifactTs(artifact?: ProjectArtifact): number {
  if (!artifact) return 0
  const ts = new Date(artifact.created_at).getTime()
  return Number.isFinite(ts) ? ts : 0
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

interface ArtifactStreamCardProps {
  projectId: string
  kind: ArtifactKind
  title: string
  artifact?: ProjectArtifact
  endpoint: string
  disabled: boolean
  disabledHint: string
  emptyHint: string
  onDone: () => void
  copyable?: boolean
  globalJob?: AiJob
  externalText?: string
  externalStreaming?: boolean
  notice?: React.ReactNode
  footer?: React.ReactNode
}

function ArtifactStreamCard({
  projectId,
  kind,
  title,
  artifact,
  endpoint,
  disabled,
  disabledHint,
  emptyHint,
  onDone,
  copyable = false,
  globalJob,
  externalText,
  externalStreaming = false,
  notice,
  footer,
}: ArtifactStreamCardProps) {
  const activeJob = globalJob?.kind === kind ? globalJob : undefined
  const startedAtRef = useRef(0)
  const sse = useSSE({
    preserveOnUnmount: true,
    onStart: () => {
      startedAtRef.current = Date.now()
      setAiJob({
        projectId,
        kind,
        title,
        chars: 0,
        previewText: '',
        startedAt: startedAtRef.current,
      })
    },
    onDelta: (full) => {
      setAiJob({
        projectId,
        kind,
        title,
        chars: Array.from(full).length,
        previewText: full,
        startedAt: startedAtRef.current || Date.now(),
      })
    },
    onDone: () => {
      clearAiJob(projectId)
      onDone()
    },
    onError: () => {
      clearAiJob(projectId)
    },
  })
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const streaming = sse.status === 'streaming' || !!activeJob || externalStreaming
  const display =
    sse.text || activeJob?.previewText || externalText || artifact?.content || ''
  const statusTitle = activeJob?.title || title
  const statusChars =
    activeJob?.chars ?? Array.from(sse.text || externalText || '').length

  return (
    <section
      className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4"
      data-testid={`${kind}-card`}
    >
      <header className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {artifact && !streaming && (
          <span className="text-[10px] text-gray-400">v{artifact.version}</span>
        )}
        {display && copyable && (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(display)
              setCopyState(ok ? 'done' : 'error')
              window.setTimeout(() => setCopyState('idle'), 1500)
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            data-testid={`copy-${kind}-btn`}
          >
            {copyState === 'done' ? '已复制' : copyState === 'error' ? '复制失败' : '复制'}
          </button>
        )}
        <button
          type="button"
          onClick={() => sse.start(endpoint)}
          disabled={streaming || disabled}
          title={disabled ? disabledHint : ''}
          className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          data-testid={`ai-${kind}-btn`}
        >
          {streaming ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {artifact ? '重新生成' : `AI 生成${title}`}
        </button>
      </header>

      {disabled && <p className="text-xs text-gray-400 mb-2">{disabledHint}</p>}
      {streaming && (
        <p
          className="mb-2 inline-flex items-center gap-1 text-xs text-violet-700"
          data-testid={`${kind}-live-status`}
        >
          <Sparkles className="h-3 w-3 animate-pulse" />
          AI 生成中 · {statusTitle}
          {statusChars > 0 ? ` · ${statusChars}字` : ''}
        </p>
      )}
      {sse.status === 'error' && (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1 mb-2">
          <TriangleAlert className="h-3 w-3" /> 生成失败：{sse.error}
        </p>
      )}
      {notice}

      {display ? (
        <MarkdownPreview content={display} maxHeightClass="max-h-[520px]" testId={`${kind}-content`}>
          {streaming && <span className="inline-block w-2 h-4 bg-violet-400 align-text-bottom animate-pulse ml-0.5" />}
        </MarkdownPreview>
      ) : (
        <p className="text-xs text-gray-400">{emptyHint}</p>
      )}
      {footer && <div className="min-w-0">{footer}</div>}
    </section>
  )
}

interface ReadmeCardProps {
  projectId: string
  readme?: ProjectArtifact
  onDone: () => void
  globalJob?: AiJob
  externalText?: string
  externalStreaming?: boolean
}

function ReadmeCard({
  projectId,
  readme,
  onDone,
  globalJob,
  externalText,
  externalStreaming,
}: ReadmeCardProps) {
  return (
    <ArtifactStreamCard
      projectId={projectId}
      kind="readme"
      title="项目 README"
      artifact={readme}
      endpoint={`/api/projects/${projectId}/ai-readme/stream`}
      disabled={false}
      disabledHint=""
      emptyHint="点上面的按钮，让 AI 基于选题生成项目 README（包含赛道、目标、节奏、文风提醒）。"
      onDone={onDone}
      globalJob={globalJob}
      externalText={externalText}
      externalStreaming={externalStreaming}
    />
  )
}

interface CharacterSetupCardProps {
  projectId: string
  characterSetup?: ProjectArtifact
  hasReadme: boolean
  characterSetupConfirmed: boolean
  characterSetupNeedsRegeneration: boolean
  onConfirm: () => void
  onDone: () => void
  globalJob?: AiJob
  externalText?: string
  externalStreaming?: boolean
}

function CharacterSetupCard({
  projectId,
  characterSetup,
  hasReadme,
  characterSetupConfirmed,
  characterSetupNeedsRegeneration,
  onConfirm,
  onDone,
  globalJob,
  externalText,
  externalStreaming,
}: CharacterSetupCardProps) {
  return (
    <ArtifactStreamCard
      projectId={projectId}
      kind="character_setup"
      title="角色设定"
      artifact={characterSetup}
      endpoint={`/api/projects/${projectId}/ai-character-setup/stream`}
      disabled={!hasReadme}
      disabledHint="先生成 README，再生成角色设定。"
      emptyHint="基于 README 产出角色总表、关系图、感情线和正文硬约束，确认后再进入大纲。"
      onDone={onDone}
      globalJob={globalJob}
      externalText={externalText}
      externalStreaming={externalStreaming}
      footer={
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-1 ${
              characterSetupConfirmed
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
            data-testid="character-setup-confirm-state"
          >
            {characterSetup
              ? characterSetupNeedsRegeneration
                ? `README 已更新，当前角色设定 v${characterSetup.version} 待重生`
                : characterSetupConfirmed
                ? `当前版本 v${characterSetup.version} 已确认`
                : `当前版本 v${characterSetup.version} 待确认`
              : '生成后确认，才能解锁大纲'}
          </span>
          {characterSetup && !characterSetupConfirmed && !characterSetupNeedsRegeneration && (
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              data-testid="character-setup-confirm-btn"
            >
              确认并作为大纲依据
            </button>
          )}
        </div>
      }
    />
  )
}

interface OutlineCardProps {
  projectId: string
  outline?: ProjectArtifact
  hasReadme: boolean
  hasCharacterSetup: boolean
  characterSetupCurrent: boolean
  characterSetupConfirmed: boolean
  outlineNeedsRefresh: boolean
  onDone: () => void
  globalJob?: AiJob
}

function OutlineCard({
  projectId,
  outline,
  hasReadme,
  hasCharacterSetup,
  characterSetupCurrent,
  characterSetupConfirmed,
  outlineNeedsRefresh,
  onDone,
  globalJob,
}: OutlineCardProps) {
  const disabled =
    !hasReadme || !hasCharacterSetup || !characterSetupCurrent || !characterSetupConfirmed
  const showStaleNotice = (hasCharacterSetup && !characterSetupConfirmed) || outlineNeedsRefresh
  const disabledHint = !hasReadme
    ? '先生成 README，再生成大纲。'
    : !hasCharacterSetup
      ? '先生成角色设定，再生成大纲。'
      : !characterSetupCurrent
        ? 'README 已更新，请先重生并确认角色设定。'
      : '先确认当前角色设定，再生成大纲。'

  return (
    <ArtifactStreamCard
      projectId={projectId}
      kind="outline"
      title="章节大纲"
      artifact={outline}
      endpoint={`/api/projects/${projectId}/ai-outline/stream`}
      disabled={disabled}
      disabledHint={disabledHint}
      emptyHint="基于 README 生成 6 章左右的章节大纲，每章一段（标题 + 主要冲突 + 钩子）。"
      onDone={onDone}
      globalJob={globalJob}
      notice={
        <div
          className={`mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 ${
            showStaleNotice ? '' : 'hidden'
          }`}
          data-testid="outline-stale-notice"
        >
          {outlineNeedsRefresh
            ? '角色设定已变更，当前大纲可能过期，建议重新生成。'
            : '角色设定当前版本还没确认，现有大纲视为待更新；先确认角色设定，再生成或重生大纲。'}
        </div>
      }
    />
  )
}

interface MarkdownPreviewProps {
  content: string
  maxHeightClass: string
  testId: string
  children?: React.ReactNode
}

function MarkdownPreview({ content, maxHeightClass, testId, children }: MarkdownPreviewProps) {
  return (
    <div
      className={`overflow-auto rounded border border-gray-100 bg-gray-50 p-4 ${maxHeightClass}`}
      data-testid={testId}
    >
      <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-xl prose-h1:mb-3 prose-h2:text-base prose-h2:mt-5 prose-h2:mb-2 prose-h3:text-sm prose-p:leading-7 prose-li:my-1 prose-ul:my-2 prose-ol:my-2 prose-table:text-sm prose-th:bg-white prose-code:bg-white prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:before:hidden prose-code:after:hidden">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        {children}
      </div>
    </div>
  )
}

interface BodyGenCardProps {
  projectId: string
  chapters?: Chapter[]
  hasOutline: boolean
  isWriting: boolean
  globalJob?: AiJob
  bodyNeedsRefresh: boolean
}

/**
 * 项目详情页的「正文」卡片：
 *   补章 → ai-beats → 逐 beat ai-write → update chapter
 * 所有编排在 useFullBook hook 里，这里只负责 UI + 目标章节数选择。
 */
function BodyGenCard({
  projectId,
  chapters,
  hasOutline,
  isWriting,
  globalJob,
  bodyNeedsRefresh,
}: BodyGenCardProps) {
  const { progress, run, abort } = useFullBook()
  const [target, setTarget] = useState(10)
  const chapterCount = chapters?.length ?? 0
  const totalWords = chapters?.reduce((a, c) => a + c.word_count, 0) ?? 0
  const remoteRunning = globalJob?.kind === 'full_book'
  const activeProgress = progress.running
    ? progress
    : remoteRunning
      ? {
          running: true,
          chapter: globalJob.chapter,
          totalChapters: globalJob.totalChapters,
          beat: globalJob.beat,
          totalBeats: globalJob.totalBeats,
          chars: globalJob.chars,
          liveBody: globalJob.liveBody,
        }
      : progress
  const blocked = !isWriting || !hasOutline
  const blockedHint = !isWriting
    ? '项目已定稿，正文不可再生成。'
    : !hasOutline
      ? '先生成 README 和大纲，再生成正文。'
      : ''

  return (
    <section
      className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4"
      data-testid="body-gen-card"
    >
      <header className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold">正文</h2>
        {chapterCount > 0 && !activeProgress.running && (
          <span className="text-[10px] text-gray-400">
            {chapterCount} 章 · {totalWords} 字
          </span>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <label className="inline-flex items-center gap-1 text-xs text-gray-500">
            目标
            <input
              type="number"
              min={1}
              max={20}
              value={target}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v)) setTarget(v)
              }}
              disabled={activeProgress.running || blocked}
              className="w-16 rounded border border-gray-200 bg-white px-2 py-1 text-xs disabled:bg-gray-50"
              data-testid="body-target-input"
            />
            章
          </label>
          <button
            type="button"
            onClick={() => run({ projectId, target })}
            disabled={activeProgress.running || blocked}
            title={blocked ? blockedHint : '基于章节标题：补齐到 N 章 → 每章 AI 拆段 + 写满'}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 sm:flex-none"
            data-testid="ai-body-btn"
          >
            {activeProgress.running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Rocket className="h-3 w-3" />
            )}
            {activeProgress.running
              ? `第 ${activeProgress.chapter}/${activeProgress.totalChapters} 章 · 段 ${activeProgress.beat}/${activeProgress.totalBeats} · ${activeProgress.chars}字`
              : chapterCount > 0
                ? '续写正文'
                : 'AI 一键全篇'}
          </button>
          {progress.running && (
            <button
              type="button"
              onClick={abort}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 sm:flex-none"
              data-testid="ai-body-abort-btn"
              title="中断后已写入的段不会回滚"
            >
              中断
            </button>
          )}
        </div>
      </header>

      {blocked && <p className="text-xs text-gray-400 mb-2">{blockedHint}</p>}
      <div
        className={`mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 ${
          bodyNeedsRefresh ? '' : 'hidden'
        }`}
        data-testid="body-stale-notice"
      >
        当前正文可能基于旧设定或旧大纲生成，建议先确认角色设定并重生大纲后再继续正文。
      </div>
      {progress.error && (
        <p className="text-xs text-rose-600 inline-flex items-center gap-1 mb-2">
          <TriangleAlert className="h-3 w-3" /> 生成失败：{progress.error}
        </p>
      )}
      {activeProgress.running && (
        <div
          className="mb-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700"
          data-testid="body-live-status"
        >
          AI 生成中 · 第 {activeProgress.chapter}/{activeProgress.totalChapters} 章 · 段{' '}
          {activeProgress.beat}/{activeProgress.totalBeats}
          {activeProgress.chars > 0 ? ` · ${activeProgress.chars}字` : ''}
        </div>
      )}
      {activeProgress.liveBody?.text && (
        <div
          className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3"
          data-testid="body-live-preview"
        >
          <div className="mb-1 text-xs font-semibold text-emerald-700">
            正在生成章节预览
          </div>
          <div className="whitespace-pre-wrap text-[12px] leading-6 text-gray-800">
            {activeProgress.liveBody.text}
          </div>
        </div>
      )}

      {chapterCount > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="body-chapters">
          {chapters!.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-gray-200 px-2 py-1.5 flex items-center gap-2 text-xs"
            >
              <span className="font-mono text-gray-400">#{c.idx}</span>
              <span className="flex-1 truncate text-gray-800">{c.title || '（未命名）'}</span>
              <span className="text-gray-400">{c.word_count}字</span>
              <Link
                to={`/projects/${projectId}/write`}
                className="text-violet-600 hover:underline"
              >
                打开
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">
          点上面按钮，AI 会自动建章 → 拆段 → 逐段写满；写完可以去「进入写作」做局部润色。
        </p>
      )}
    </section>
  )
}
