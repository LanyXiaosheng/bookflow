/**
 * 无 hook 依赖的「AI 一键全流程」运行器，供批量立项并发调用。
 *
 *   README → 角色设定 → 大纲 → 正文 → 全书汇总 → 优化升华 → 配套素材
 *
 * 与 useFullPipeline 的区别：纯函数、不吃 React state，进度通过回调 + aiJobStore
 * 暴露，因此可以同时跑 N 个项目。每步失败带退避自动重试。
 */
import { chaptersApi, type Beat, type Chapter } from '../api/chapters'
import { projectsApi, type ArtifactKind, type ProjectArtifact } from '../api/projects'
import { setAiJob, clearAiJob } from '../hooks/useAiJobStore'

export type PipelineStepKey =
  | 'readme'
  | 'character_setup'
  | 'outline'
  | 'body'
  | 'book_summary'
  | 'book_polished'
  | 'side_dishes'

export const RUN_STEPS: PipelineStepKey[] = [
  'readme',
  'character_setup',
  'outline',
  'body',
  'book_summary',
  'book_polished',
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
  book_polished: 'book_polished',
  side_dishes: 'side_dishes',
}

interface SSEDelta {
  text: string
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

/** 流式写一段正文，返回完整段文本 */
async function streamWriteOne(
  chapterId: string,
  beat: Beat,
  prevTail: string,
  signal: AbortSignal,
): Promise<string> {
  const resp = await fetch(chaptersApi.aiWriteStreamUrl(chapterId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ beat, prev_tail: prevTail }),
    signal,
  })
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
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
      if (event === 'delta') {
        try {
          acc += (JSON.parse(data) as SSEDelta).text
        } catch {
          /* ignore */
        }
      } else if (event === 'error') {
        try {
          errored = (JSON.parse(data) as SSEErr).message
        } catch {
          errored = data || 'unknown stream error'
        }
      }
    }
  }
  if (errored) throw new Error(errored)
  return acc
}

/** 正文步骤：补齐到 target 章 → 每章拆 beats → 逐 beat 流式写 → 按段落落库 */
async function runBody(
  projectId: string,
  target: number,
  signal: AbortSignal,
  onChapter?: (chapter: number, total: number) => void,
  skipIfChars = 100,
): Promise<void> {
  let list = await chaptersApi.listByProject(projectId)
  while (list.length < target) {
    const c = await chaptersApi.create(projectId, `第${list.length + 1}章`)
    list = [...list, c]
  }
  for (let i = 0; i < target; i++) {
    if (signal.aborted) throw new Error('已中断')
    onChapter?.(i + 1, target)
    const ch: Chapter = list[i]
    const title = ch.title?.trim() || `第${ch.idx}章`
    let beats = ch.beats ?? []
    if (beats.length === 0) {
      beats = (await chaptersApi.aiBeats(ch.id, title, signal)).beats
    }
    let body = ch.body ?? ''
    if (Array.from(body).length < skipIfChars) {
      for (let j = 0; j < beats.length; j++) {
        if (signal.aborted) throw new Error('已中断')
        const tail = body.slice(-200)
        const sep = body && !body.endsWith('\n') ? '\n\n' : body ? '\n' : ''
        const text = await streamWriteOne(ch.id, beats[j], tail, signal)
        body = body + sep + text
        const updated = await chaptersApi.update(ch.id, title, body)
        list = list.map((x) => (x.id === updated.id ? updated : x))
      }
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
    case 'book_polished':
      return `/api/projects/${projectId}/ai-book-polish/stream`
    case 'side_dishes':
      return `/api/projects/${projectId}/ai-side-dishes/stream`
    case 'body':
      throw new Error('body 步骤不走单一 SSE')
  }
}


