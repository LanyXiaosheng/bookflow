/**
 * 无 hook 依赖的「AI 一键全流程」运行器，供批量立项并发调用。
 *
 *   README → 角色设定 → 大纲 → 正文 → 全书汇总 → 配套素材
 *
 * 与 useFullPipeline 的区别：纯函数、不吃 React state，进度通过回调 + aiJobStore
 * 暴露，因此可以同时跑 N 个项目。每步失败带退避自动重试。
 */
import { chaptersApi, type Chapter } from '../api/chapters'
import { projectsApi, type ArtifactKind, type ProjectArtifact } from '../api/projects'
import { setAiJob, clearAiJob, getAiJob } from '../hooks/useAiJobStore'

export type PipelineStepKey =
  | 'readme'
  | 'character_setup'
  | 'outline'
  | 'body'
  | 'book_summary'
  | 'side_dishes'

export const RUN_STEPS: PipelineStepKey[] = [
  'readme',
  'character_setup',
  'outline',
  'body',
  'book_summary',
  'side_dishes',
]

/** 步骤级自动重试：每步最多尝试这么多次（含首次） */
const MAX_STEP_ATTEMPTS = 3

export interface RunPipelineOpts {
  target: number
  signal: AbortSignal
  /** 进入某步骤时回调 */
  onStep?: (step: PipelineStepKey, index: number, total: number) => void
  /** 该步骤失败、即将自动重跑时回调 */
  onStepRetry?: (step: PipelineStepKey, attempt: number, max: number) => void
  /** 正文步骤逐章进度回调 */
  onBodyProgress?: (chapter: number, totalChapters: number) => void
}

const ARTIFACT_KIND_BY_STEP: Partial<Record<PipelineStepKey, ArtifactKind>> = {
  readme: 'readme',
  character_setup: 'character_setup',
  outline: 'outline',
  book_summary: 'book_summary',
  side_dishes: 'side_dishes',
}

interface SSEErr {
  message: string
}

function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

function isAbortError(e: unknown): boolean {
  if (e instanceof Error) return e.name === 'AbortError' || /已中断/.test(e.message)
  return false
}

function hasArtifact(artifacts: ProjectArtifact[], kind: ArtifactKind): boolean {
  return artifacts.some((a) => a.kind === kind && a.content.trim().length > 0)
}

// 占位：后续 Edit 追加 SSE / body / 主流程

/** 跑一个普通 SSE 流式步骤（README / 角色设定 / 大纲 / 全书汇总 / 配套素材） */
async function runSseStep(url: string, signal: AbortSignal): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    signal,
  })
  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`
    try {
      const j = (await resp.json()) as { detail?: string; error?: string }
      detail = j.detail ?? j.error ?? detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let errored: string | null = null
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let event = 'message'
      const dataLines: string[] = []
      for (const rawLine of block.split('\n')) {
        const line = rawLine.replace(/\r$/, '')
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      const data = dataLines.join('\n')
      if (event === 'error') {
        try {
          errored = (JSON.parse(data) as SSEErr).message
        } catch {
          errored = data || 'unknown error'
        }
      }
    }
  }
  if (errored) throw new Error(errored)
}

/** 整章一次性流式写作：后端写完直接落库 chapter.body。这里只消费流、等它结束。 */
async function streamWriteFullChapter(chapterId: string, signal: AbortSignal): Promise<void> {
  const resp = await fetch(chaptersApi.aiWriteFullStreamUrl(chapterId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({}),
    signal,
  })
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let errored: string | null = null
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let event = 'message'
      const dataLines: string[] = []
      for (const rawLine of block.split('\n')) {
        const line = rawLine.replace(/\r$/, '')
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      const data = dataLines.join('\n')
      if (event === 'error') {
        try {
          errored = (JSON.parse(data) as SSEErr).message
        } catch {
          errored = data || 'unknown stream error'
        }
      }
    }
  }
  if (errored) throw new Error(errored)
}

/** 大纲里的单章：章号 + 标题。用于建章时对齐标题和顺序。 */
interface OutlineChapter {
  num: number
  title: string
}

/**
 * 从大纲 markdown 抽出 `### 第N章 <标题>`（兼容 `第N章：标题` / `第N章 标题`），按章号升序返回。
 * 后端 ai-write-full 是按 chapter.idx 匹配 `### 第N章` 抽大纲段，所以这里让 idx 对齐章号即可。
 */
function parseOutlineChapters(outline: string): OutlineChapter[] {
  const out: OutlineChapter[] = []
  const re = /^\s*#{2,4}\s*第\s*(\d+)\s*章\s*[：:\s]?\s*(.*?)\s*$/
  for (const rawLine of outline.split('\n')) {
    const m = rawLine.match(re)
    if (!m) continue
    const num = Number(m[1])
    if (!Number.isFinite(num) || num <= 0) continue
    const title = m[2].trim()
    out.push({ num, title })
  }
  out.sort((a, b) => a.num - b.num)
  return out
}

/** 章标题是否是占位（空 / 「第N章」样式）——占位才允许用大纲标题覆盖，避免踩掉手改标题。 */
function isPlaceholderTitle(title: string | undefined): boolean {
  const t = (title ?? '').trim()
  if (t === '') return true
  return /^第\s*\d+\s*章\s*$/.test(t)
}

/** 章级 QA 及格线（含）——低于此分触发一次重写 */
const CHAPTER_QA_PASS = 30

/**
 * 正文步骤：按大纲标题+顺序补齐到 target 章 → 每章整章一次性写 → 章级 QA → 低于 30 分重写 1 次。
 * - 章标题取自大纲 `### 第N章 <标题>`，idx 对齐大纲章号（后端 ai-write-full 按 idx 抽大纲段）。
 * - 去重按 idx 位置：list 里已有第 i 章就复用，绝不按标题字符串匹配，避免引号/冒号导致重复建章。
 */
async function runBody(
  projectId: string,
  target: number,
  signal: AbortSignal,
  onChapter?: (chapter: number, total: number) => void,
  skipIfChars = 100,
): Promise<void> {
  // 读大纲，抽每章标题（缺失则回退占位「第N章」）
  let outlineChapters: OutlineChapter[] = []
  try {
    const arts = await projectsApi.listArtifacts(projectId)
    const outline = arts.find((a) => a.kind === 'outline')?.content ?? ''
    outlineChapters = parseOutlineChapters(outline)
  } catch {
    outlineChapters = []
  }
  const titleForChapter = (chapterNum: number): string => {
    const hit = outlineChapters.find((o) => o.num === chapterNum)
    const t = hit?.title?.trim()
    return t && t.length > 0 ? t : `第${chapterNum}章`
  }

  // 按 idx 位置补齐/对齐：已有第 i 章复用，缺失才创建；占位标题用大纲标题覆盖
  let list = await chaptersApi.listByProject(projectId)
  for (let i = 0; i < target; i++) {
    const chapterNum = i + 1
    const desiredTitle = titleForChapter(chapterNum)
    if (i >= list.length) {
      const c = await chaptersApi.create(projectId, desiredTitle)
      list = [...list, c]
    } else if (isPlaceholderTitle(list[i].title) && desiredTitle !== (list[i].title ?? '').trim()) {
      const updated = await chaptersApi.update(list[i].id, desiredTitle, list[i].body ?? '')
      list = list.map((x) => (x.id === updated.id ? updated : x))
    }
  }

  for (let i = 0; i < target; i++) {
    if (signal.aborted) throw new Error('已中断')
    onChapter?.(i + 1, target)
    const ch: Chapter = list[i]
    // 已有足够正文的章跳过（续跑/重入场景）
    if (Array.from(ch.body ?? '').length >= skipIfChars) continue

    // 整章一次性写（后端流式写完直接落库 chapter.body）
    await streamWriteFullChapter(ch.id, signal)

    // 章级 QA：低于 30 分重写 1 次（最多重试 1 次），再不过就标记待人工
    try {
      let qa = await chaptersApi.aiQa(ch.id, signal)
      if (qa.total_score < CHAPTER_QA_PASS) {
        if (signal.aborted) throw new Error('已中断')
        await streamWriteFullChapter(ch.id, signal)
        qa = await chaptersApi.aiQa(ch.id, signal)
        if (qa.total_score < CHAPTER_QA_PASS) {
          const msg = `第${ch.idx}章 QA ${qa.total_score} 分未过（<${CHAPTER_QA_PASS}），已标记待人工：${qa.quick_fix || qa.verdict}`
          console.warn('[runPipeline] chapter QA below pass:', msg)
          const job = getAiJob(projectId)
          if (job) setAiJob({ ...job, warning: msg })
        }
      }
    } catch (e) {
      if (isAbortError(e) || signal.aborted) throw e
      // QA 是非阻塞质检：调用本身失败（如上游偶发）不该中断整本正文，记一笔继续
      console.warn('[runPipeline] chapter QA call failed, skipping gate:', e)
    }
  }
}

/**
 * 跑完整流程。成功 resolve，失败 throw（带步骤上下文）。中断也 throw。
 * 进度通过 onStep / onStepRetry 回调，并写入 aiJobStore（列表页徽标）。
 */
export async function runProjectPipeline(
  projectId: string,
  opts: RunPipelineOpts,
): Promise<void> {
  const { target, signal, onStep, onStepRetry } = opts
  const startedAt = Date.now()

  let artifacts: ProjectArtifact[] = []
  try {
    artifacts = await projectsApi.listArtifacts(projectId)
  } catch {
    artifacts = []
  }

  try {
    for (let i = 0; i < RUN_STEPS.length; i++) {
      if (signal.aborted) throw new Error('已中断')
      const step = RUN_STEPS[i]

      // 跳过已有产物（正文除外，runBody 自己按章跳过）
      if (step !== 'body') {
        const kind = ARTIFACT_KIND_BY_STEP[step]
        if (kind && hasArtifact(artifacts, kind)) continue
      }

      onStep?.(step, i, RUN_STEPS.length)
      setAiJob({
        projectId,
        kind: step === 'body' ? 'full_book' : step,
        chars: 0,
        startedAt,
      })

      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw new Error('已中断')
        try {
          if (step === 'body') {
            await runBody(projectId, target, signal, (ch, tot) =>
              opts.onBodyProgress?.(ch, tot),
            )
          } else {
            await runSseStep(endpointForStep(projectId, step), signal)
          }
          break
        } catch (e) {
          if (isAbortError(e) || signal.aborted) throw e
          if (attempt >= MAX_STEP_ATTEMPTS) throw e
          onStepRetry?.(step, attempt + 1, MAX_STEP_ATTEMPTS)
          await interruptibleSleep(1000 * 2 ** (attempt - 1), signal)
        }
      }
      if (step === 'body') await checkBodyDuplicates(projectId)
    }
  } finally {
    clearAiJob(projectId)
  }
}

function endpointForStep(projectId: string, step: PipelineStepKey): string {
  switch (step) {
    case 'readme':
      return `/api/projects/${projectId}/ai-readme/stream`
    case 'character_setup':
      return `/api/projects/${projectId}/ai-character-setup/stream`
    case 'outline':
      return `/api/projects/${projectId}/ai-outline/stream`
    case 'book_summary':
      return `/api/projects/${projectId}/ai-book-summary/stream`
    case 'side_dishes':
      return `/api/projects/${projectId}/ai-side-dishes/stream`
    case 'body':
      throw new Error('body 步骤不走单一 SSE')
  }
}

function charSimilarity(a: string, b: string): number {
  const sa = new Set([...a])
  const sb = new Set([...b])
  let common = 0
  for (const c of sa) if (sb.has(c)) common++
  return common / Math.max(sa.size, sb.size)
}

async function checkBodyDuplicates(projectId: string): Promise<void> {
  try {
    const chapters = await chaptersApi.listByProject(projectId)
    const snippets = chapters
      .map((c) => ({ title: c.title ?? '', head: Array.from((c.body ?? '').trimStart()).slice(0, 50).join('') }))
      .filter((c) => c.head.length >= 10)
    for (let i = 0; i < snippets.length; i++) {
      for (let j = i + 1; j < snippets.length; j++) {
        const sim = charSimilarity(snippets[i].head, snippets[j].head)
        if (sim > 0.6) {
          const msg = `重复疑似：「${snippets[i].title}」与「${snippets[j].title}」前50字相似度 ${(sim * 100).toFixed(0)}%`
          console.warn('[runPipeline] body duplicate detected:', msg)
          const job = getAiJob(projectId)
          if (job) setAiJob({ ...job, warning: msg })
          return
        }
      }
    }
  } catch {
    // non-critical
  }
}
