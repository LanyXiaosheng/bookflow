/**
 * 批量立项 + 批量跑「AI 一键全流程」。
 *
 * 支持三种输入：
 *  - seed：已有种子 → createFromSeed → 跑流程
 *  - draft：历史候选 → 先 create 建种子 → createFromSeed → 跑流程
 *  - project：已有项目 → 跳过立项，直接跑流程
 *
 * 并发上限 BATCH_CONCURRENCY；底层每步还有退避重试 + AI 调用级重试兜底 429。
 * 每个条目的状态对外暴露，UI 实时展示。
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../api/projects'
import { seedsApi, type Score } from '../api/seeds'
import { extractErrorMessage } from '../api/errors'
import { runProjectPipeline, type PipelineStepKey } from '../lib/runPipeline'

export const BATCH_CONCURRENCY = 20

export type BatchItemStatus =
  | 'pending'
  | 'launching'
  | 'running'
  | 'done'
  | 'failed'
  | 'aborted'

export interface BatchItem {
  /** 稳定 key（seedId / draftId / projectId），用于状态定位 */
  key: string
  title: string
  status: BatchItemStatus
  projectId?: string
  step?: PipelineStepKey
  stepIndex?: number
  stepTotal?: number
  bodyChapter?: number
  bodyTotalChapters?: number
  retry?: { attempt: number; max: number }
  error?: string
}

export interface BatchState {
  running: boolean
  items: BatchItem[]
}

/** 三种批量输入 */
export type BatchInput =
  | { kind: 'seed'; key: string; title: string; seedId: string }
  | {
      kind: 'draft'
      key: string
      title: string
      track: string
      score: Score
    }
  | { kind: 'project'; key: string; title: string; projectId: string }

export function useBatchLaunch() {
  const qc = useQueryClient()
  const [state, setState] = useState<BatchState>({ running: false, items: [] })
  const abortRef = useRef<AbortController | null>(null)
  // 记住本轮所有输入，供「重试失败项」复用
  const inputsRef = useRef<BatchInput[]>([])
  const targetRef = useRef(10)
  // 节流刷新项目/种子列表：20 并发时避免每个项目都触发 N+1 重查导致页面卡顿
  const lastInvalidateRef = useRef(0)
  const throttledInvalidate = useCallback(() => {
    const now = Date.now()
    if (now - lastInvalidateRef.current < 2500) return
    lastInvalidateRef.current = now
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['seeds'] })
  }, [qc])

  const update = useCallback((key: string, patch: Partial<BatchItem>) => {
    setState((s) => ({
      ...s,
      items: s.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }))
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => setState({ running: false, items: [] }), [])

  const run = useCallback(
    async (inputs: BatchInput[], target: number): Promise<void> => {
      if (state.running || inputs.length === 0) return
      const ac = new AbortController()
      abortRef.current = ac
      inputsRef.current = inputs
      targetRef.current = target

      setState({
        running: true,
        items: inputs.map((i) => ({ key: i.key, title: i.title, status: 'pending' })),
      })

      /** 把输入解析成 projectId（建种子 / 立项 / 直接用），失败 throw */
      const resolveProjectId = async (input: BatchInput): Promise<string> => {
        if (input.kind === 'project') return input.projectId
        if (input.kind === 'seed') {
          const proj = await projectsApi.createFromSeed(input.seedId)
          return proj.id
        }
        // draft：先建种子，再立项
        const seed = await seedsApi.create({
          title: input.title,
          track: input.track,
          score: input.score,
        })
        const proj = await projectsApi.createFromSeed(seed.id)
        return proj.id
      }

      const runOne = async (input: BatchInput): Promise<void> => {
        if (ac.signal.aborted) {
          update(input.key, { status: 'aborted' })
          return
        }
        // 1. 解析/立项（已有项目则瞬时完成）
        let projectId: string
        try {
          if (input.kind !== 'project') update(input.key, { status: 'launching' })
          projectId = await resolveProjectId(input)
          update(input.key, { projectId, status: 'running' })
          throttledInvalidate()
        } catch (e) {
          update(input.key, {
            status: 'failed',
            error: extractErrorMessage(e),
          })
          return
        }
        // 2. 跑全流程
        try {
          await runProjectPipeline(projectId, {
            target,
            signal: ac.signal,
            onStep: (step, idx, total) =>
              update(input.key, {
                step,
                stepIndex: idx,
                stepTotal: total,
                retry: undefined,
                bodyChapter: undefined,
                bodyTotalChapters: undefined,
              }),
            onStepRetry: (_step, attempt, max) =>
              update(input.key, { retry: { attempt, max } }),
            onBodyProgress: (chapter, totalChapters) =>
              update(input.key, { bodyChapter: chapter, bodyTotalChapters: totalChapters }),
          })
          update(input.key, { status: 'done', retry: undefined })
        } catch (e) {
          const aborted =
            ac.signal.aborted ||
            (e instanceof Error && (/已中断/.test(e.message) || e.name === 'AbortError'))
          update(input.key, {
            status: aborted ? 'aborted' : 'failed',
            error: aborted ? undefined : e instanceof Error ? e.message : '全流程失败',
            retry: undefined,
          })
        } finally {
          throttledInvalidate()
        }
      }

      // 并发限流：维持 BATCH_CONCURRENCY 个 worker 从队列取活
      const queue = [...inputs]
      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          if (ac.signal.aborted) {
            const rest = queue.splice(0)
            rest.forEach((i) => update(i.key, { status: 'aborted' }))
            break
          }
          const next = queue.shift()
          if (!next) break
          await runOne(next)
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(BATCH_CONCURRENCY, inputs.length) }, () => worker()),
      )

      setState((s) => ({ ...s, running: false }))
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['seeds'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    [state.running, qc, update, throttledInvalidate],
  )

  /** 仅重跑失败的条目（复用本轮输入）。项目已建好的，重跑只补缺步骤。 */
  const retryFailed = useCallback(() => {
    if (state.running) return
    const failedKeys = new Set(
      state.items.filter((i) => i.status === 'failed').map((i) => i.key),
    )
    if (failedKeys.size === 0) return
    const picks = inputsRef.current.filter((i) => failedKeys.has(i.key))
    if (picks.length > 0) run(picks, targetRef.current)
  }, [state.running, state.items, run])

  return { state, run, abort, reset, retryFailed }
}
