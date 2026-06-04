import { useCallback, useEffect, useRef, useState } from 'react'

export type SSEStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface SSEState {
  status: SSEStatus
  text: string
  error: string | null
}

export interface UseSSEOptions {
  onDone?: (full: string) => void
  onError?: (message: string) => void
}

interface ParsedEvent {
  event: string
  data: string
}

/**
 * 解析 SSE 文本块，返回完整事件 + 剩余未完成片段
 * SSE 协议：事件以 `\n\n` 分隔，每行 `field: value`
 */
function parseSSEChunk(buffer: string): { events: ParsedEvent[]; rest: string } {
  const events: ParsedEvent[] = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const block of parts) {
    if (!block.trim()) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }
    events.push({ event, data: dataLines.join('\n') })
  }
  return { events, rest }
}

/**
 * POST 触发的 SSE 流 Hook
 *
 * 后端事件协议（与 main.rs::sse_from_stream 对齐）：
 * - event: delta, data: {"text": "..."}
 * - event: error, data: {"message": "..."}
 * - event: done,  data: {}
 */
export function useSSE(opts: UseSSEOptions = {}) {
  const [state, setState] = useState<SSEState>({
    status: 'idle',
    text: '',
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const start = useCallback(async (url: string, body?: unknown) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setState({ status: 'streaming', text: '', error: null })

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      })
      if (!resp.ok || !resp.body) {
        const msg = `HTTP ${resp.status}`
        setState({ status: 'error', text: '', error: msg })
        optsRef.current.onError?.(msg)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      let errored: string | null = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSSEChunk(buffer)
        buffer = rest
        for (const ev of events) {
          if (ev.event === 'delta') {
            try {
              const { text } = JSON.parse(ev.data) as { text: string }
              acc += text
              setState((s) => ({ ...s, text: acc }))
            } catch {
              // 忽略坏帧
            }
          } else if (ev.event === 'error') {
            try {
              const { message } = JSON.parse(ev.data) as { message: string }
              errored = message
            } catch {
              errored = ev.data || 'unknown error'
            }
          } else if (ev.event === 'done') {
            // 后端关流，等下一轮 read() 返回 done
          }
        }
      }

      if (errored) {
        setState({ status: 'error', text: acc, error: errored })
        optsRef.current.onError?.(errored)
      } else {
        setState({ status: 'done', text: acc, error: null })
        optsRef.current.onDone?.(acc)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setState({ status: 'idle', text: '', error: null })
        return
      }
      const msg = (e as Error).message || 'network error'
      setState((s) => ({ ...s, status: 'error', error: msg }))
      optsRef.current.onError?.(msg)
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle', text: '', error: null })
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { ...state, start, abort, reset }
}
