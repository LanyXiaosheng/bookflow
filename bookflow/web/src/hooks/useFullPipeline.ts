/**
 * AI 一键全流程编排：
 *
 *   README → 角色设定 → 大纲 → 正文（useFullBook）→ 全书汇总 → 优化升华 → 配套素材
 *
 * 串行而非并行 —— 后续步骤依赖前置产物（角色设定要 README、大纲要角色设定、
 * 全书汇总要正文…），并行做不到，且本地代理账号池小，并发还会触发 429。
 *
 * 智能跳过：每步开始前查 artifacts，已有产物的步骤直接跳过。
 * 半途中断后再点一键，会从下一个未完成的步骤接着跑。
 *
 * 中断：一个 AbortController 串通所有步骤；正文步骤把 signal 透给 useFullBook
 * 通过 abort() 联动。
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { projectsApi, type ArtifactKind, type ProjectArtifact } from '../api/projects'
import { useFullBook } from './useFullBook'

export type PipelineStepKey =
  | 'readme'
  | 'character_setup'
  | 'outline'
  | 'body'
  | 'book_summary'
  | 'book_polished'
  | 'side_dishes'
  | 'blurb'

export const PIPELINE_STEP_LABELS: Record<PipelineStepKey, string> = {
  readme: 'README',
  character_setup: '角色设定',
  outline: '大纲',
  body: '正文',
  book_summary: '全书汇总',
  book_polished: '优化升华',
  blurb: '导语',
  side_dishes: '配套素材',
}

const ALL_STEPS: PipelineStepKey[] = [
  'readme',
  'character_setup',
  'outline',
  'body',
  'book_summary',
  'book_polished',
  'side_dishes',
]

export interface FullPipelineProgress {
  running: boolean
  /** 当前正在跑的步骤；null 表示未运行 */
  currentKey: PipelineStepKey | null
  /** 已完成步骤数（含跳过） */
  done: number
  /** 总步骤数（始终 = ALL_STEPS.length） */
  total: number
  /** 当前步骤累积字数（流式步骤），正文步骤展示当前章/段进度 */
  chars: number
  /** 正文步骤专用：第 N 章 / 共 M 章 / 第 j 段 / 共 k 段 */
  bodyChapter?: number
  bodyTotalChapters?: number
  bodyBeat?: number
  bodyTotalBeats?: number
  /** 跳过的步骤（已有产物） */
  skipped: PipelineStepKey[]
  /** 当前步骤后端正在重试时的信息（null = 未在重试，或有 delta 到达后清空） */
  retry: { attempt: number; max: number } | null
  /** 当前步骤整体失败后、本地正在自动重跑该步骤的信息（null = 未在重跑） */
  stepRetry: { attempt: number; max: number } | null
  error?: string
}

const initial: FullPipelineProgress = {
  running: false,
  currentKey: null,
  done: 0,
  total: ALL_STEPS.length,
  chars: 0,
  skipped: [],
  retry: null,
  stepRetry: null,
}

/** 步骤级自动重试：每步最多尝试这么多次（含首次） */
const MAX_STEP_ATTEMPTS = 3

/** 可中断的等待；signal abort 时立即 resolve，让中断能打断退避 */
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

/** 用户主动中断引发的错误不该触发重试 */
function isAbortError(e: unknown): boolean {
  if (e instanceof Error) {
    return e.name === 'AbortError' || /已中断/.test(e.message)
  }
  return false
}

export interface RunFullPipelineOpts {
  projectId: string
  /** 目标章节数，传给 useFullBook */
  target: number
  /** 强制重跑哪些步骤（覆盖跳过逻辑）。默认 []，已有产物的步骤都会跳过。 */
  forceSteps?: PipelineStepKey[]
}

interface SSEEventDelta {
  text: string
}
interface SSEEventError {
  message: string
}
interface SSERetry {
  attempt: number
  max: number
}

/** 跑一个普通 SSE 流式步骤（README / 角色设定 / 大纲 / 全书汇总 / 配套素材） */
async function runSseStep(
  url: string,
  onChars: (chars: number) => void,
  onRetry: (info: SSERetry | null) => void,
  signal: AbortSignal,
): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
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
  let chars = 0
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
          const { text } = JSON.parse(data) as SSEEventDelta
          chars += text.length
          onChars(chars)
          onRetry(null) // 有正文了，清空重试提示
        } catch {
          /* skip bad frame */
        }
      } else if (event === 'retry') {
        try {
          onRetry(JSON.parse(data) as SSERetry)
        } catch {
          /* skip */
        }
      } else if (event === 'error') {
        try {
          const { message } = JSON.parse(data) as SSEEventError
          errored = message
        } catch {
          errored = data || 'unknown error'
        }
      }
    }
  }
  if (errored) throw new Error(errored)
}

const ARTIFACT_KIND_BY_STEP: Partial<Record<PipelineStepKey, ArtifactKind>> = {
  readme: 'readme',
  character_setup: 'character_setup',
  outline: 'outline',
  book_summary: 'book_summary',
  book_polished: 'book_polished',
  blurb: 'blurb',
  side_dishes: 'side_dishes',
}

function hasArtifact(artifacts: ProjectArtifact[], kind: ArtifactKind): boolean {
  return artifacts.some((a) => a.kind === kind && a.content.trim().length > 0)
}

export function useFullPipeline() {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<FullPipelineProgress>(initial)
  const abortRef = useRef<AbortController | null>(null)
  const fullBook = useFullBook()

  const abort = useCallback(() => {
    abortRef.current?.abort()
    fullBook.abort()
  }, [fullBook])

  const reset = useCallback(() => setProgress(initial), [])

  const run = useCallback(
    async ({
      projectId,
      target,
      forceSteps = [],
    }: RunFullPipelineOpts): Promise<boolean> => {
      if (progress.running) return false
      const ac = new AbortController()
      abortRef.current = ac

      // 跑前先拿一份最新 artifacts，决定哪些步骤跳过
      let artifacts: ProjectArtifact[]
      try {
        artifacts = await projectsApi.listArtifacts(projectId)
      } catch (e) {
        setProgress({ ...initial, error: e instanceof Error ? e.message : '读取 artifacts 失败' })
        return false
      }

      const skipped: PipelineStepKey[] = []
      setProgress({
        running: true,
        currentKey: ALL_STEPS[0],
        done: 0,
        total: ALL_STEPS.length,
        chars: 0,
        skipped,
        retry: null,
        stepRetry: null,
      })

      try {
        for (let i = 0; i < ALL_STEPS.length; i++) {
          if (ac.signal.aborted) throw new Error('已中断')
          const step = ALL_STEPS[i]

          // 跳过判断：已有 artifact 且未在 forceSteps 中
          const force = forceSteps.includes(step)
          if (!force) {
            if (step === 'body') {
              // 正文走 useFullBook，本身有 skipIfChars 智能判断；这里不预跳过
            } else {
              const kind = ARTIFACT_KIND_BY_STEP[step]
              if (kind && hasArtifact(artifacts, kind)) {
                skipped.push(step)
                setProgress((s) => ({
                  ...s,
                  done: i + 1,
                  skipped: [...skipped],
                  currentKey: ALL_STEPS[i + 1] ?? step,
                  chars: 0,
                }))
                continue
              }
            }
          }

          setProgress((s) => ({ ...s, currentKey: step, chars: 0, stepRetry: null }))

          // 步骤级自动重试：本步整体失败（502/网络/解析等）就退避后重跑，
          // 最多 MAX_STEP_ATTEMPTS 次。用户主动中断不重试。
          for (let attempt = 1; ; attempt++) {
            if (ac.signal.aborted) throw new Error('已中断')
            try {
              if (step === 'body') {
                // 用 useFullBook 跑正文。它自己有 skipIfChars，不用我们判断。
                const ok = await fullBook.run({ projectId, target })
                if (!ok) {
                  // useFullBook 内部已设了 error，把它带出来
                  throw new Error(fullBook.progress.error || '正文生成失败')
                }
                qc.invalidateQueries({ queryKey: ['chapters', projectId] })
              } else {
                const url = endpointForStep(projectId, step)
                await runSseStep(
                  url,
                  (chars) => setProgress((s) => ({ ...s, chars, retry: null })),
                  (info) => setProgress((s) => ({ ...s, retry: info })),
                  ac.signal,
                )
              }
              break // 本步成功
            } catch (stepErr) {
              if (isAbortError(stepErr) || ac.signal.aborted) throw stepErr
              if (attempt >= MAX_STEP_ATTEMPTS) throw stepErr
              // 退避重试：1s, 2s（指数）；展示重跑进度
              setProgress((s) => ({
                ...s,
                retry: null,
                stepRetry: { attempt: attempt + 1, max: MAX_STEP_ATTEMPTS },
              }))
              await interruptibleSleep(1000 * 2 ** (attempt - 1), ac.signal)
            }
          }
          setProgress((s) => ({ ...s, stepRetry: null }))

          setProgress((s) => ({ ...s, done: i + 1 }))
          // 这一步如果产出了 artifact，刷新一下查询缓存
          if (step !== 'body') {
            qc.invalidateQueries({ queryKey: ['project-artifacts', projectId] })
          }
        }
        // 全部完成
        qc.invalidateQueries({ queryKey: ['project-artifacts', projectId] })
        qc.invalidateQueries({ queryKey: ['chapters', projectId] })
        qc.invalidateQueries({ queryKey: ['project', projectId] })
        setProgress({ ...initial, skipped })
        return true
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.name === 'AbortError' || /已中断/.test(e.message)
              ? '已中断'
              : e.message
            : '未知错误'
        setProgress({ ...initial, error: msg, skipped })
        return false
      }
    },
    [progress.running, qc, fullBook],
  )

  // 把 useFullBook 的细粒度进度投影出来（章/段），方便上层显示
  const merged: FullPipelineProgress =
    progress.running && progress.currentKey === 'body' && fullBook.progress.running
      ? {
          ...progress,
          chars: fullBook.progress.chars,
          bodyChapter: fullBook.progress.chapter,
          bodyTotalChapters: fullBook.progress.totalChapters,
          bodyBeat: fullBook.progress.beat,
          bodyTotalBeats: fullBook.progress.totalBeats,
        }
      : progress

  return { progress: merged, run, abort, reset }
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
    case 'blurb':
      return `/api/projects/${projectId}/ai-blurb/stream`
    case 'side_dishes':
      return `/api/projects/${projectId}/ai-side-dishes/stream`
    case 'body':
      throw new Error('body 步骤不走单一 SSE，由 useFullBook 接管')
  }
}
