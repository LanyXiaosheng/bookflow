import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { chaptersApi, type Beat, type Chapter } from '../api/chapters'
import { setAiJob, clearAiJob } from './useAiJobStore'

export interface FullBookProgress {
  running: boolean
  chapter: number
  totalChapters: number
  beat: number
  totalBeats: number
  /** 当前段累积字数（流式回填） */
  chars: number
  /** 当前章节实时正文（仅 UI 用，回写按段提交） */
  liveBody?: { chapterId: string; text: string }
  error?: string
}

const initial: FullBookProgress = {
  running: false,
  chapter: 0,
  totalChapters: 0,
  beat: 0,
  totalBeats: 0,
  chars: 0,
}

export interface RunFullBookOpts {
  projectId: string
  /** 目标章节数；不足会补建，已有更多则只对前 target 章生成 */
  target: number
  /** 已存在正文 ≥ skipIfChars 字的章节直接跳过续写（默认 100） */
  skipIfChars?: number
  /**
   * 重新生成：忽略已有 beats 和正文，每章强制重拆段 + 清空重写。
   * 用于「正文太长想重做」——配合后端已收紧的每章约 2000 字参数，重写后会更短。
   */
  forceRegenerate?: boolean
}

interface SSEEventDelta {
  text: string
}
interface SSEEventError {
  message: string
}

/**
 * 流式接口：调 chaptersApi.aiWriteStreamUrl(chapterId)，返回完整段文本
 * - 以 `\n\n` 切 SSE 事件，event=delta 累积；event=error 抛错；event=done 结束
 * - 同时 onDelta 实时把文本推到 UI（用于章节正文预览）
 */
async function streamWriteOne(
  chapterId: string,
  beat: Beat,
  prev_tail: string,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const resp = await fetch(chaptersApi.aiWriteStreamUrl(chapterId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ beat, prev_tail }),
    signal,
  })
  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`)
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
          acc += text
          onDelta(acc)
        } catch {
          // ignore bad frame
        }
      } else if (event === 'error') {
        try {
          const { message } = JSON.parse(data) as SSEEventError
          errored = message
        } catch {
          errored = data || 'unknown stream error'
        }
      }
    }
  }

  if (errored) throw new Error(errored)
  return acc
}

/**
 * AI 一键全篇编排（流式版）：
 *   补齐到 target 章 → 每章 ai-beats（已有则复用） → 逐 beat **流式** ai-write
 *   → 段间累积到章节 body → update chapter（按段落落库，避免一章丢光）
 *
 * 同时把进度写入 useAiJobStore，让 ProjectList / Dashboard 显示「⚡ AI 生成中」
 *
 * 中途出错把 error 写进进度并返回 false；成功 true。
 */
export function useFullBook() {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<FullBookProgress>(initial)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => setProgress(initial), [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const run = useCallback(
    async ({
      projectId,
      target,
      skipIfChars = 100,
      forceRegenerate = false,
    }: RunFullBookOpts): Promise<boolean> => {
      if (progress.running) return false
      if (!Number.isFinite(target) || target < 1 || target > 20) {
        setProgress({ ...initial, error: '章节数得在 1 - 20 之间' })
        return false
      }
      const ac = new AbortController()
      abortRef.current = ac
      const startedAt = Date.now()
      const pushProgress = (p: FullBookProgress) => {
        setProgress(p)
        if (p.running) {
          setAiJob({
            projectId,
            kind: 'full_book',
            chapter: p.chapter,
            totalChapters: p.totalChapters,
            beat: p.beat,
            totalBeats: p.totalBeats,
            chars: p.chars,
            liveBody: p.liveBody,
            startedAt,
          })
        }
      }

      pushProgress({
        running: true,
        chapter: 0,
        totalChapters: target,
        beat: 0,
        totalBeats: 0,
        chars: 0,
      })
      try {
        // 1. 补齐章节
        let list =
          qc.getQueryData<Chapter[]>(['chapters', projectId]) ??
          (await chaptersApi.listByProject(projectId))
        while (list.length < target) {
          const c = await chaptersApi.create(projectId, `第${list.length + 1}章`)
          list = [...list, c]
        }
        qc.setQueryData<Chapter[]>(['chapters', projectId], list)

        // 2. 逐章生成
        for (let i = 0; i < target; i++) {
          if (ac.signal.aborted) throw new Error('已中断')
          const ch = list[i]
          const title = ch.title?.trim() || `第${ch.idx}章`

          // 重新生成：忽略旧 beats，强制重拆段
          let beats = forceRegenerate ? [] : (ch.beats ?? [])
          if (beats.length === 0) {
            const r = await chaptersApi.aiBeats(ch.id, title)
            beats = r.beats
          }
          pushProgress({
            running: true,
            chapter: i + 1,
            totalChapters: target,
            beat: 0,
            totalBeats: beats.length,
            chars: 0,
          })

          // 重新生成：清空旧正文，从头重写；否则保留已有正文做续写判断
          let body = forceRegenerate ? '' : (ch.body ?? '')
          if (forceRegenerate || Array.from(body).length < skipIfChars) {
            for (let j = 0; j < beats.length; j++) {
              if (ac.signal.aborted) throw new Error('已中断')
              const tail = body.slice(-200)
              const sep = body && !body.endsWith('\n') ? '\n\n' : body ? '\n' : ''

              // 流式：实时把 base + sep + 累积文本 推到 liveBody
              const base = body + sep
              const text = await streamWriteOne(
                ch.id,
                beats[j],
                tail,
                (acc) => {
                  pushProgress({
                    running: true,
                    chapter: i + 1,
                    totalChapters: target,
                    beat: j + 1,
                    totalBeats: beats.length,
                    chars: acc.length,
                    liveBody: { chapterId: ch.id, text: base + acc },
                  })
                },
                ac.signal,
              )
              body = base + text
              // 段写完落一次库（更安全 — 中断也能保住已写部分）
              const updated = await chaptersApi.update(ch.id, title, body)
              list = list.map((x) => (x.id === updated.id ? updated : x))
              qc.setQueryData<Chapter[]>(['chapters', projectId], list)
            }
          } else {
            // 已有正文，跳过但仍把 progress 拉到末尾让 UI 不卡
            pushProgress({
              running: true,
              chapter: i + 1,
              totalChapters: target,
              beat: beats.length,
              totalBeats: beats.length,
              chars: Array.from(body).length,
            })
          }
        }
        qc.invalidateQueries({ queryKey: ['chapters', projectId] })
        clearAiJob(projectId)
        setProgress(initial)
        return true
      } catch (e) {
        clearAiJob(projectId)
        setProgress({
          ...initial,
          error: e instanceof Error ? e.message : '未知错误',
        })
        return false
      }
    },
    [progress.running, qc],
  )

  return { progress, run, reset, abort }
}
