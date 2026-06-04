import { useCallback, useRef, useState } from 'react'

export interface PipelineStep {
  key: 'readme' | 'outline' | 'body'
  label: string
  url: string
  /** 可选 body */
  body?: unknown
  /** 流式：true=SSE 解析；false=普通 fetch（保留位） */
  stream?: boolean
}

export interface PipelineProgress {
  running: boolean
  currentKey: PipelineStep['key'] | null
  /** 已完成步骤数 / 全部步骤数 */
  done: number
  total: number
  /** 当前步骤累积字数（流式） */
  chars: number
  error?: string
}

const initial: PipelineProgress = {
  running: false,
  currentKey: null,
  done: 0,
  total: 0,
  chars: 0,
}

interface SSEEventDelta {
  text: string
}
interface SSEEventError {
  message: string
}

/** 跑一个 SSE 流式 step；done 后 resolve */
async function runStep(
  step: PipelineStep,
  onDelta: (chars: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const resp = await fetch(step.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: step.body === undefined ? undefined : JSON.stringify(step.body),
    signal,
  })
  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`
    try {
      const j = (await resp.json()) as { detail?: string; error?: string }
      detail = j.detail ?? j.error ?? detail
    } catch {
      // ignore
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
          onDelta(chars)
        } catch {
          // skip bad frame
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

/**
 * SOP 阶段 2 「一键立项流」：链式跑 README → 大纲（→ 可选 body 等）
 *
 * 串行而非并行 — 大纲依赖 README 内容，并行会让 outline prompt 拿不到上下文。
 * 用户视角是"一键"，引擎做的是 sequential SSE。
 */
export function usePipeline() {
  const [progress, setProgress] = useState<PipelineProgress>(initial)
  const abortRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => setProgress(initial), [])

  const run = useCallback(async (steps: PipelineStep[]): Promise<boolean> => {
    if (progress.running) return false
    if (steps.length === 0) return true
    const ac = new AbortController()
    abortRef.current = ac
    setProgress({
      running: true,
      currentKey: steps[0].key,
      done: 0,
      total: steps.length,
      chars: 0,
    })
    try {
      for (let i = 0; i < steps.length; i++) {
        if (ac.signal.aborted) throw new Error('已中断')
        const step = steps[i]
        setProgress((s) => ({ ...s, currentKey: step.key, chars: 0 }))
        await runStep(
          step,
          (chars) => setProgress((s) => ({ ...s, chars })),
          ac.signal,
        )
        setProgress((s) => ({ ...s, done: i + 1 }))
      }
      setProgress(initial)
      return true
    } catch (e) {
      setProgress({
        ...initial,
        error: e instanceof Error ? e.message : '未知错误',
      })
      return false
    }
  }, [progress.running])

  return { progress, run, abort, reset }
}
