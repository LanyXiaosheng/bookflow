import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Rocket,
  Sparkles,
  TriangleAlert,
  Wand2,
  Zap,
} from 'lucide-react'
import { projectsApi, type ArtifactKind, type ProjectArtifact } from '../api/projects'
import { chaptersApi, type Chapter } from '../api/chapters'
import { imagesApi, type StoryImagePayload } from '../api/images'
import { extractErrorMessage } from '../api/errors'
import {
  characterReplacementApi,
  type CharacterReplacementMapping,
  type CharacterReplacementPreview,
} from '../api/characterReplacement'
import TrackPills from '../components/TrackPills'
import { useConfirm } from '../components/ConfirmDialog'
import {
  clearAiJob,
  setAiJob,
  useAiJob,
  type AiJob,
} from '../hooks/useAiJobStore'
import { useSSE } from '../hooks/useSSE'
import { useFullBook } from '../hooks/useFullBook'
import { useFullPipeline, PIPELINE_STEP_LABELS } from '../hooks/useFullPipeline'
import { usePipeline } from '../hooks/usePipeline'
import { renderedMarkdownToPlainText } from '../lib/copyRenderedMarkdown'
import { extractCharacterNamesFromReadme } from '../lib/extractCharacterNames'

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
  const blurb = useMemo(
    () => pickLatest(artifacts.data, 'blurb'),
    [artifacts.data],
  )
  const storyImage = useMemo(
    () => pickLatest(artifacts.data, 'story_image'),
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
  /** 一键全流程：README → 角色设定 → 大纲 → 正文 → 全书汇总 → 配套素材 */
  const fullPipeline = useFullPipeline()
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
            <div className="sm:hidden">
              {project.data?.track ? <TrackPills track={project.data.track} compact /> : null}
            </div>
          </div>
          <div className="hidden sm:block">
            {project.data?.track ? <TrackPills track={project.data.track} compact /> : null}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            {/* AI 一键全流程：README → 角色设定 → 大纲 → 正文 → 全书汇总 → 配套素材，已有产物的步骤会跳过 */}
            <button
              type="button"
              onClick={() => fullPipeline.run({ projectId, target: 10 })}
              disabled={
                fullPipeline.progress.running ||
                pipeline.progress.running ||
                project.data?.status !== 'writing'
              }
              title="串行跑完 6 步：README → 角色设定 → 大纲 → 正文 → 全书汇总 → 配套素材。已有产物的步骤会跳过。"
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
              data-testid="full-pipeline-btn"
            >
              {fullPipeline.progress.running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Rocket className="h-3 w-3" />
              )}
              {fullPipeline.progress.running
                ? `第 ${fullPipeline.progress.done + 1}/${fullPipeline.progress.total} · ${
                    fullPipeline.progress.currentKey
                      ? PIPELINE_STEP_LABELS[fullPipeline.progress.currentKey]
                      : ''
                  }${
                    fullPipeline.progress.currentKey === 'body' &&
                    fullPipeline.progress.bodyChapter
                      ? ` ${fullPipeline.progress.bodyChapter}/${fullPipeline.progress.bodyTotalChapters}章`
                      : fullPipeline.progress.chars > 0
                        ? ` · ${fullPipeline.progress.chars}字`
                        : ''
                  }`
                : 'AI 一键全流程'}
            </button>
            {fullPipeline.progress.running && (
              <button
                type="button"
                onClick={fullPipeline.abort}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 sm:flex-none"
                data-testid="full-pipeline-abort-btn"
              >
                中断
              </button>
            )}
            <button
              type="button"
              onClick={runProjectizeFlow}
              disabled={pipeline.progress.running || fullPipeline.progress.running}
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
        {fullPipeline.progress.error && (
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pb-2 text-xs text-rose-600 inline-flex items-center gap-1">
            <TriangleAlert className="h-3 w-3" />
            一键全流程中断/失败：{fullPipeline.progress.error}
            {fullPipeline.progress.skipped.length > 0 && (
              <span className="ml-2 text-gray-400">
                （已跳过：
                {fullPipeline.progress.skipped
                  .map((k) => PIPELINE_STEP_LABELS[k])
                  .join(' / ')}
                ）
              </span>
            )}
          </div>
        )}
        {fullPipeline.progress.running && fullPipeline.progress.skipped.length > 0 && (
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pb-2 text-xs text-gray-500">
            已跳过（产物已存在）：
            {fullPipeline.progress.skipped
              .map((k) => PIPELINE_STEP_LABELS[k])
              .join(' / ')}
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
            hasBookSummary={!!bookSummary}
            hasSideDishes={!!sideDishes}
            hasBlurb={!!blurb}
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
            readme={readme}
            characterSetup={characterSetup}
            outline={outline}
            publishPost={publishPost}
            chapters={chapters.data}
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
            emptyHint="AI 会基于全章节正文整合出一版连贯完整正文。断章可续。"
            onDone={refreshArtifacts}
            copyable
            globalJob={aiJob}
            resumable
          />
          <ArtifactStreamCard
            projectId={projectId}
            kind="book_polished"
            title="优化升华"
            artifact={bookPolished}
            endpoint={`/api/projects/${projectId}/ai-book-polish/stream`}
            disabled={!bookSummary}
            disabledHint="先生成全书汇总，再做优化升华。"
            emptyHint="AI 会做去 AI 味、增强代入感、优化阅读节奏，不改剧情不走结局。"
            onDone={refreshArtifacts}
            copyable
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
            emptyHint="生成配套.md：标题变体、平台简介、推送语、标签、选段引流、评论区埋线。"
            onDone={refreshArtifacts}
            copyable
            globalJob={aiJob}
          />
          <ArtifactStreamCard
            projectId={projectId}
            kind="blurb"
            title="导语"
            artifact={blurb}
            endpoint={`/api/projects/${projectId}/ai-blurb/stream`}
            disabled={!readme || !outline}
            disabledHint="先生成 README 和大纲，再生成导语。"
            emptyHint="生成 100-200 字叙事导语（四要素：开篇即冲突、人设清晰、强钩子、贴故事主线）。"
            onDone={refreshArtifacts}
            copyable
            globalJob={aiJob}
          />
          <StoryImageCard
            projectId={projectId}
            artifact={storyImage}
            disabled={!readme}
            disabledHint="先生成 README，再生成小说配图。"
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
  hasBookSummary: boolean
  hasSideDishes: boolean
  hasBlurb: boolean
}

function WorkflowStrip({
  hasReadme,
  hasCharacterSetup,
  characterSetupNeedsRegeneration,
  characterSetupConfirmed,
  hasOutline,
  chapterCount,
  totalWords,
  hasBookSummary,
  hasSideDishes,
  hasBlurb,
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
      label: '全书汇总',
      done: hasBookSummary,
      hint: hasBookSummary
        ? '已生成'
        : chapterCount > 0 && totalWords > 0
          ? '可生成'
          : '先写正文',
    },
    {
      label: '配套',
      done: hasSideDishes,
      hint: hasSideDishes ? '已生成' : hasOutline ? '可生成' : '先生成大纲',
    },
    {
      label: '导语',
      done: hasBlurb,
      hint: hasBlurb ? '已生成' : hasOutline ? '可生成' : '先生成大纲',
    },
  ]

  return (
    <section className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
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

function parseStoryImageArtifact(
  artifact?: ProjectArtifact,
): StoryImagePayload | null {
  if (!artifact?.content) return null
  try {
    return JSON.parse(artifact.content) as StoryImagePayload
  } catch {
    return null
  }
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

function copyDisplayText(kind: ArtifactKind, display: string): string {
  switch (kind) {
    case 'readme':
    case 'character_setup':
    case 'outline':
    case 'publish_post':
    case 'side_dishes':
    case 'blurb':
    case 'book_summary':
    case 'book_polished':
      return renderedMarkdownToPlainText(display)
    case 'story_image':
      return display
  }
}

async function downloadCompositedCover(
  dataUrl: string,
  filename: string,
  _titleText?: string | null,
  authorName?: string | null,
  showAuthor?: boolean,
  options?: {
    format?: 'png' | 'jpg' | 'jpeg'
    quality?: number
    fit?: 'stretch' | 'cover'
  },
): Promise<void> {
  const img = new Image()
  const imageReady = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
  })
  img.src = dataUrl
  await imageReady

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('封面导出失败：canvas 不可用')

  const fit = options?.fit ?? 'stretch'
  if (fit === 'cover') {
    // 保持原图像素，按 3:4 比例裁剪：水平居中、顶部对齐（保留画面上部主体）
    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    const ratio = 3 / 4 // 宽 : 高
    let cropW: number
    let cropH: number
    if (srcW / srcH > ratio) {
      // 原图偏宽：保留全高，按 3:4 裁掉左右
      cropH = srcH
      cropW = Math.round(srcH * ratio)
    } else {
      // 原图偏高：保留全宽，按 3:4 裁掉底部
      cropW = srcW
      cropH = Math.min(srcH, Math.round(srcW / ratio))
    }
    const sx = Math.round((srcW - cropW) / 2) // 水平居中
    const sy = 0 // 顶部对齐
    canvas.width = cropW
    canvas.height = cropH
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, cropW, cropH)
  } else {
    const targetWidth = 600
    const targetHeight = 800
    canvas.width = targetWidth
    canvas.height = targetHeight
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  }

  if (showAuthor && authorName?.trim()) {
    const text = authorName.trim()
    const fontSize = Math.max(24, Math.round(canvas.width * 0.045))
    const padX = Math.round(fontSize * 0.9)
    const padY = Math.round(fontSize * 0.55)
    ctx.font = `600 ${fontSize}px sans-serif`
    const textWidth = ctx.measureText(text).width
    const badgeWidth = textWidth + padX * 2
    const badgeHeight = fontSize + padY * 2
    const x = canvas.width - badgeWidth - Math.round(canvas.width * 0.04)
    const y = canvas.height - badgeHeight - Math.round(canvas.height * 0.04)
    const radius = badgeHeight / 2

    ctx.fillStyle = 'rgba(0,0,0,0.58)'
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + badgeWidth - radius, y)
    ctx.quadraticCurveTo(x + badgeWidth, y, x + badgeWidth, y + radius)
    ctx.lineTo(x + badgeWidth, y + badgeHeight - radius)
    ctx.quadraticCurveTo(x + badgeWidth, y + badgeHeight, x + badgeWidth - radius, y + badgeHeight)
    ctx.lineTo(x + radius, y + badgeHeight)
    ctx.quadraticCurveTo(x, y + badgeHeight, x, y + badgeHeight - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + padX, y + badgeHeight / 2 + 1)
  }

  const format = options?.format ?? 'png'
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
  const quality = Math.min(0.95, Math.max(0.6, options?.quality ?? 0.88))
  const out = format === 'png'
    ? canvas.toDataURL(mimeType)
    : canvas.toDataURL(mimeType, quality)
  const a = document.createElement('a')
  a.href = out
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function storyImageFilename(projectId: string, format: 'png' | 'jpg' | 'jpeg'): string {
  return `story-image-${projectId}.${format}`
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
  resumable?: boolean
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
  resumable = false,
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
              const ok = await copyText(copyDisplayText(kind, display))
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
        {resumable && sse.status === 'error' && artifact && (
          <button
            type="button"
            onClick={() => {
              // 统计已有内容的章节数（每章以 "# 第" 开头）
              const existing = artifact?.content ?? ''
              const chapterCount = (existing.match(/^# 第/gm) || []).length
              sse.start(`${endpoint}?from=${chapterCount}`)
            }}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            中断续传
          </button>
        )}
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
      {streaming && sse.retry && (
        <p
          className="mb-2 inline-flex items-center gap-1 text-xs text-amber-600"
          data-testid={`${kind}-retry-status`}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          上游繁忙，正在重试（{sse.retry.attempt}/{sse.retry.max}）…
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
  readme?: ProjectArtifact
  characterSetup?: ProjectArtifact
  outline?: ProjectArtifact
  publishPost?: ProjectArtifact
  chapters?: Chapter[]
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
  readme,
  characterSetup,
  outline,
  publishPost,
  chapters,
  hasReadme,
  characterSetupConfirmed,
  characterSetupNeedsRegeneration,
  onConfirm,
  onDone,
  globalJob,
  externalText,
  externalStreaming,
}: CharacterSetupCardProps) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [replaceOpen, setReplaceOpen] = useState(true)
  const [detected, setDetected] = useState(false)
  const [detectedCandidates, setDetectedCandidates] = useState<string[]>([])
  const [mappings, setMappings] = useState<CharacterReplacementMapping[]>([])
  const [activeRecommendationName, setActiveRecommendationName] = useState('')
  const recommendationQuery = useQuery({
    queryKey: ['character-name-recommend', projectId, activeRecommendationName, characterSetup?.version],
    queryFn: () => characterReplacementApi.recommend(projectId, activeRecommendationName),
    enabled: replaceOpen && detected && !!readme && !!activeRecommendationName,
  })
  const previewMutation = useMutation({
    mutationFn: async () => {
      const firstReady = mappings.find((item) => item.new_name.trim())
      if (!firstReady) throw new Error('请先填写至少一个新名字')
      return characterReplacementApi.preview(projectId, firstReady.old_name, firstReady.new_name)
    },
  })
  const applyMutation = useMutation({
    mutationFn: async () => {
      const firstReady = mappings.find((item) => item.new_name.trim())
      if (!firstReady) throw new Error('请先填写至少一个新名字')
      return characterReplacementApi.apply(projectId, firstReady.old_name, firstReady.new_name)
    },
    onSuccess: async () => {
      await onDone()
      await qc.invalidateQueries({ queryKey: ['chapters', projectId] })
      setReplaceOpen(false)
    },
  })
  const recommendation = recommendationQuery.data
  const requestRecommendation = (oldName: string) => {
    previewMutation.reset()
    if (activeRecommendationName === oldName) {
      void recommendationQuery.refetch()
      return
    }
    setActiveRecommendationName(oldName)
  }

  useEffect(() => {
    if (!detectedCandidates.length) return
    setMappings((prev) => {
      const map = new Map(prev.map((item) => [item.old_name, item]))
      return detectedCandidates.map((oldName) => map.get(oldName) ?? { old_name: oldName, new_name: '' })
    })
  }, [detectedCandidates])

  useEffect(() => {
    if (!recommendation) return
    setMappings((prev) =>
      prev.map((row) =>
        row.old_name === recommendation.old_name
          ? { ...row, new_name: row.new_name || recommendation.recommended_name }
          : row,
      ),
    )
  }, [recommendation])

  const preview = previewMutation.data

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
        <div className="mt-3 flex flex-col gap-3 text-xs">
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3" data-testid="character-name-replace-panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-gray-900">替换角色名称</div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    从角色设定里识别旧名字，按赛道主分类和情节分类生成本地推荐新名，再预览后统一替换到角色设定、README、大纲、正文、发布稿。
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplaceOpen((open) => !open)
                    setActiveRecommendationName('')
                    previewMutation.reset()
                  }}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  data-testid="character-name-replace-toggle"
                >
                  {replaceOpen ? '收起' : '打开'}
                </button>
              </div>
              {replaceOpen && (
                <div className="mt-3 space-y-3">
                  {!characterSetup && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      先生成角色设定，再识别旧角色名。当前还没有可供识别的角色设定正文。
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!readme) return
                        const candidates = extractCharacterNamesFromReadme(readme.content)
                        setDetected(true)
                        setDetectedCandidates(candidates)
                        setActiveRecommendationName('')
                        setMappings(candidates.map((name) => ({ old_name: name, new_name: '' })))
                        previewMutation.reset()
                      }}
                      disabled={!readme}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      data-testid="character-name-detect-btn"
                    >
                      {!readme ? '等待 README 生成' : '识别旧角色名'}
                    </button>
                  </div>
                  {detected &&
                    detectedCandidates.length === 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        还没从项目 README 里识别到可替换的旧名字。请先确认 README 里已经出现明确角色名，再继续。
                      </div>
                    )}
                  {detected && mappings.length > 0 && (
                    <div className="space-y-2" data-testid="character-name-mapping-list">
                      {mappings.map((item, idx) => (
                        <div
                          key={item.old_name}
                          className="grid gap-2 rounded-md border border-gray-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                        >
                          <label className="grid gap-1 text-gray-600">
                            <span>旧名字</span>
                            <input
                              value={item.old_name}
                              readOnly
                              className="h-10 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
                              data-testid={`character-name-old-${idx}`}
                            />
                            <span className="text-[11px] text-gray-400">
                              命中范围：{
                                summarizeImpacts(item.old_name, {
                                  readme,
                                  characterSetup,
                                  outline,
                                  publishPost,
                                  chapters,
                                }).join(' / ') || '暂未命中'
                              }
                            </span>
                          </label>
                          <label className="grid gap-1 text-gray-600">
                            <span>新名字</span>
                            <input
                              value={item.new_name}
                              onChange={(e) => {
                                const value = e.target.value
                                setMappings((prev) =>
                                  prev.map((row) =>
                                    row.old_name === item.old_name ? { ...row, new_name: value } : row,
                                  ),
                                )
                              }}
                              className="h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
                              data-testid={`character-name-new-${idx}`}
                            />
                            <span className="invisible text-[11px] text-gray-400">
                              命中范围占位
                            </span>
                          </label>
                          <div className="grid gap-1 text-gray-600">
                            <span className="invisible">操作</span>
                            <button
                              type="button"
                              onClick={() => {
                                requestRecommendation(item.old_name)
                              }}
                              className="h-10 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100"
                              data-testid={`character-name-pick-${idx}`}
                            >
                              本地推荐
                            </button>
                            <span className="invisible text-[11px] text-gray-400">
                              命中范围占位
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeRecommendationName &&
                    (recommendationQuery.isLoading || recommendationQuery.isFetching) && (
                    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
                      正在为“{activeRecommendationName}”生成本地推荐新名…
                    </div>
                  )}
                  {activeRecommendationName && recommendationQuery.isError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      推荐加载失败：{(recommendationQuery.error as Error).message}。你仍然可以手动填写新名字并继续预览替换。
                    </div>
                  )}
                  {recommendation && (
                    <div
                      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700"
                      data-testid="character-name-recommendation"
                    >
                      本地推荐：{recommendation.recommended_name} · {recommendation.reason}
                      <button
                        type="button"
                        onClick={() => {
                          setMappings((prev) =>
                            prev.map((row) =>
                              row.old_name === recommendation.old_name
                                ? { ...row, new_name: recommendation.recommended_name }
                                : row,
                            ),
                          )
                          setActiveRecommendationName('')
                        }}
                        className="ml-3 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50"
                        data-testid="character-name-use-recommendation"
                      >
                        用推荐名
                      </button>
                    </div>
                  )}
                  {detected && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => previewMutation.mutate()}
                      disabled={!mappings.some((item) => item.new_name.trim()) || previewMutation.isPending}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      data-testid="character-name-preview-btn"
                    >
                      预览替换
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({
                          title: '确认全项目替换角色名称？',
                          description: '会把角色设定、README、大纲、正文、发布稿中的同名内容统一替换并保存新版本。',
                          confirmText: '确认替换',
                        })
                        if (!ok) return
                        applyMutation.mutate()
                      }}
                      disabled={!preview || preview.items.length === 0 || applyMutation.isPending}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      data-testid="character-name-apply-btn"
                    >
                      确认保存
                    </button>
                  </div>
                  )}
                  {previewMutation.isError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      预览失败：{(previewMutation.error as Error).message}
                    </div>
                  )}
                  {applyMutation.isError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      保存失败：{(applyMutation.error as Error).message}
                    </div>
                  )}
                  {preview && (
                    <CharacterReplacementPreviewPanel preview={preview} />
                  )}
                </div>
              )}
            </div>
          <div className="flex flex-wrap items-center gap-2">
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
        </div>
      }
    />
  )
}

function CharacterReplacementPreviewPanel({
  preview,
}: {
  preview: CharacterReplacementPreview
}) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-3"
      data-testid="character-name-preview-panel"
    >
      <div className="text-xs font-medium text-gray-900">
        预览：{preview.old_name} → {preview.new_name}
      </div>
      <ul className="mt-2 space-y-2">
        {preview.items.map((item) => (
          <li key={`${item.scope}-${item.label}`} className="rounded-md bg-gray-50 px-3 py-2">
            <div className="text-[11px] font-medium text-gray-700">
              {item.label} · 命中 {item.hits} 处
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              替换前：{item.before_excerpt}
            </div>
            <div className="mt-1 text-[11px] text-emerald-700">
              替换后：{item.after_excerpt}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function summarizeImpacts(
  oldName: string,
  inputs: {
    readme?: ProjectArtifact
    characterSetup?: ProjectArtifact
    outline?: ProjectArtifact
    publishPost?: ProjectArtifact
    chapters?: Chapter[]
  },
): string[] {
  const hits: string[] = []
  if (inputs.readme?.content.includes(oldName)) hits.push('README')
  if (inputs.characterSetup?.content.includes(oldName)) hits.push('角色设定')
  if (inputs.outline?.content.includes(oldName)) hits.push('大纲')
  if (inputs.publishPost?.content.includes(oldName)) hits.push('发布稿')
  if (inputs.chapters?.some((chapter) => chapter.body.includes(oldName))) hits.push('正文')
  return hits
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

interface StoryImageCardProps {
  projectId: string
  artifact?: ProjectArtifact
  disabled: boolean
  disabledHint: string
  onDone: () => void
  globalJob?: AiJob
}

function StoryImageCard({
  projectId,
  artifact,
  disabled,
  disabledHint,
  onDone,
  globalJob,
}: StoryImageCardProps) {
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [preset, setPreset] = useState<'cover' | 'square' | 'banner' | 'auto' | 'custom'>('cover')
  const [customVal, setCustomVal] = useState('')
  const [showAuthor, setShowAuthor] = useState(false)
  const [authorName, setAuthorName] = useState('')
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg' | 'jpeg'>('png')
  const [exportQuality, setExportQuality] = useState(88)
  const payload = parseStoryImageArtifact(artifact)
  const activeJob = globalJob?.kind === 'story_image' ? globalJob : undefined

  const sizeMap: Record<string, string> = {
    cover: '2:3',
    square: '1:1',
    banner: '3:2',
    auto: 'auto',
  }
  const currentSize = preset === 'custom' ? customVal : (sizeMap[preset] ?? '2:3')

  useEffect(() => {
    if (!payload) return
    setShowAuthor(payload.show_author)
    if (payload.author_name) setAuthorName(payload.author_name)
    if (payload.cover_size) {
      const found = Object.entries(sizeMap).find(([, v]) => v === payload.cover_size)
      if (found) setPreset(found[0] as typeof preset)
      else { setPreset('custom'); setCustomVal(payload.cover_size) }
    }
  }, [payload])

  const start = async () => {
    setError(null)
    setGenerating(true)
    setAiJob({
      projectId,
      kind: 'story_image',
      title: '小说配图',
      chars: 0,
      previewText: '',
      startedAt: Date.now(),
    })
    try {
      await imagesApi.generateStoryImage(projectId, {
        size: currentSize,
        quality: 'high',
        author_name: authorName,
        show_author: showAuthor,
      })
      onDone()
    } catch (e) {
      setError(extractErrorMessage(e))
    } finally {
      clearAiJob(projectId)
      setGenerating(false)
    }
  }

  return (
    <section
      className="rounded-lg bg-white shadow-sm ring-1 ring-gray-200 p-4"
      data-testid="story_image-card"
    >
      <header className="mb-3 flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-sky-600" />
        <h2 className="text-sm font-semibold">小说配图</h2>
        {artifact && !generating && (
          <span className="text-[10px] text-gray-400">v{artifact.version}</span>
        )}
        <button
          type="button"
          onClick={start}
          disabled={generating || !!activeJob || disabled}
          title={disabled ? disabledHint : ''}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          data-testid="ai-story-image-btn"
        >
          {generating || activeJob ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {artifact ? '重新生成' : 'AI 生成小说配图'}
        </button>
      </header>

      {disabled && <p className="mb-2 text-xs text-gray-400">{disabledHint}</p>}

      {/* 尺寸预设 */}
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { key: 'cover', label: '番茄封面' },
          { key: 'square', label: '方图' },
          { key: 'banner', label: '横版宣传图' },
          { key: 'auto', label: '自动' },
        ].map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setPreset(opt.key as typeof preset)}
            className={`rounded-full px-3 py-1 text-[11px] ${
              preset === opt.key
                ? 'bg-sky-100 text-sky-700'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset('custom')}
          className={`rounded-full px-3 py-1 text-[11px] ${
            preset === 'custom'
              ? 'bg-sky-100 text-sky-700'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          自定义
        </button>
      </div>
      {preset === 'custom' && (
        <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <label className="text-xs font-medium text-gray-700">
            自定义尺寸
            <input
              type="text"
              value={customVal}
              onChange={(e) => setCustomVal(e.target.value)}
              placeholder="2:3 或 1024x1792"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
          <p className="mt-1 text-[11px] text-gray-400">支持比例如 2:3 或像素如 1024x1792</p>
        </div>
      )}

      {/* 作者署名 + 导出 */}
      <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <p className="mb-2 text-[11px] leading-5 text-gray-500">
          默认按番茄小说封面尺寸 2:3 生成；预览和下载叠加作品名，作者署名可选。
        </p>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 select-none">
          <input
            type="checkbox"
            checked={showAuthor}
            onChange={(e) => { setShowAuthor(e.target.checked); setAuthorName(a => a || '作者名') }}
            className="h-4 w-4 rounded border-gray-300 accent-sky-600"
          />
          封面带作者署名
        </label>
        {showAuthor && (
          <input
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="输入作者名"
            className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-medium text-gray-600">
            导出格式
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              data-testid="cover-export-format"
            >
              <option value="png">PNG 无损</option>
              <option value="jpg">JPG 压缩</option>
              <option value="jpeg">JPEG 压缩</option>
            </select>
          </label>
          <label className="text-[11px] font-medium text-gray-600">
            JPEG 质量：{exportQuality}%
            <input
              type="range"
              min={60}
              max={95}
              step={1}
              value={exportQuality}
              disabled={exportFormat === 'png'}
              onChange={(e) => setExportQuality(Number(e.target.value))}
              className="mt-2 block w-full accent-sky-600 disabled:opacity-40"
              data-testid="cover-export-quality"
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          平台要求小于 5MB 时优先选 JPG/JPEG；仍超限则降低质量后重新下载。
        </p>
      </div>

      {(generating || activeJob) && (
        <p className="mb-2 inline-flex items-center gap-1 text-xs text-sky-700">
          <Sparkles className="h-3 w-3 animate-pulse" />
          AI 生成中 · {currentSize}
        </p>
      )}
      {error && (
        <p className="mb-2 inline-flex items-center gap-1 text-xs text-rose-600">
          <TriangleAlert className="h-3 w-3" /> 生成失败：{error}
        </p>
      )}

      {payload ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            <img
              src={payload.data_url}
              alt="小说配图"
              className="mx-auto block max-h-[520px] w-full object-contain"
            />
            {payload.show_author && payload.author_name && (
              <div className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
                {payload.author_name}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  setDownloading(true)
                  await downloadCompositedCover(
                    payload.data_url,
                    storyImageFilename(projectId, exportFormat),
                    payload.title_text,
                    payload.author_name,
                    payload.show_author,
                    { format: exportFormat, quality: exportQuality / 100 },
                  )
                } catch (e) {
                  setError(extractErrorMessage(e))
                } finally {
                  setDownloading(false)
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              data-testid="download-story-image-btn"
            >
              {downloading ? '导出中…' : `下载${exportFormat.toUpperCase()}`}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  setDownloading(true)
                  await downloadCompositedCover(
                    payload.data_url,
                    storyImageFilename(projectId, exportFormat),
                    payload.title_text,
                    payload.author_name,
                    payload.show_author,
                    { format: exportFormat, quality: exportQuality / 100, fit: 'cover' },
                  )
                } catch (e) {
                  setError(extractErrorMessage(e))
                } finally {
                  setDownloading(false)
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-100"
              data-testid="crop-story-image-btn"
              title="保持原图像素，按 3:4 比例裁剪（水平居中、顶部对齐）后下载"
            >
              {downloading ? '处理中…' : '快速裁剪 3:4'}
            </button>
            <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] text-sky-700">
              {payload.model}
            </span>
          </div>
          <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-gray-700">
              查看生图提示词
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-gray-600">
              {payload.prompt}
            </pre>
          </details>
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          生成一张小说封面配图，优先吃 README、大纲和配套素材里的封面关键词。
        </p>
      )}
    </section>
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
  const confirm = useConfirm()
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
          {chapterCount > 0 && !activeProgress.running && (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirm({
                  title: '重新生成全部正文？',
                  description: (
                    <>
                      会<span className="font-semibold text-rose-600">清空现有 {chapterCount} 章正文</span>
                      （共 {totalWords} 字），重新拆段并按更短的篇幅（每章约 2000 字）重写全书。
                      <span className="text-gray-500">此操作不可恢复</span>，建议先确认你不需要现有内容。
                    </>
                  ),
                  confirmText: '清空并重写',
                  tone: 'danger',
                })
                if (ok) run({ projectId, target, forceRegenerate: true })
              }}
              disabled={blocked}
              title={blocked ? blockedHint : '清空现有正文，每章约 2000 字重写全书（更短，便于全书汇总）'}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 sm:flex-none"
              data-testid="ai-body-regen-btn"
            >
              <RefreshCw className="h-3 w-3" />
              重新生成
            </button>
          )}
          {activeProgress.running && (
            <button
              type="button"
              onClick={() => {
                // 本页真在跑就中断它；若只是 localStorage 残留的幽灵任务（页面曾被刷新/关闭，
                // 清除逻辑没跑完），abort 是空操作，靠 clearAiJob 把它清掉解锁 UI。
                abort()
                clearAiJob(projectId)
              }}
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
