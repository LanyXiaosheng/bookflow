/**
 * 批量立项 + 批量跑「AI 一键全流程」。
 *
 * 对选中的每个 seed：createFromSeed → runProjectPipeline（带步骤重试）。
 * 并发上限 BATCH_CONCURRENCY（账号池小，3 并发，底层还有退避重试兜底）。
 * 每个条目的状态对外暴露，UI 实时展示。
 */
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../api/projects'
import { runProjectPipeline, type PipelineStepKey } from '../lib/runPipeline'

export const BATCH_CONCURRENCY = 3

export type BatchItemStatus =
  | 'pending'
  | 'launching'
  | 'running'
  | 'done'
  | 'failed'
  | 'aborted'

export interface BatchItem {
  seedId: string
  title: string
  status: BatchItemStatus
  projectId?: string
  step?: PipelineStepKey
  stepIndex?: number
  stepTotal?: number
  retry?: { attempt: number; max: number }
  error?: string
}

export interface BatchState {
  running: boolean
  items: BatchItem[]
}

export interface BatchSeedInput {
  seedId: string
  title: string
}

export function useBatchLaunch() {
  const qc = useQueryClient()
  const [state, setState] = useState<BatchState>({ running: false, items: [] })
  const abortRef = useRef<AbortController | null>(null)

  const update = useCallback((seedId: string, patch: Partial<BatchItem>) => {
    setState((s) => ({
      ...s,
      items: s.items.map((it) => (it.seedId === seedId ? { ...it, ...patch } : it)),
    }))
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => setState({ running: false, items: [] }), [])

  const run = useCallback(
    async (seeds: BatchSeedInput[], target: number): Promise<void> => {
      if (state.running || seeds.length === 0) return
      const ac = new AbortController()
      abortRef.current = ac

      setState({
        running: true,
        items: seeds.map((s) => ({ seedId: s.seedId, title: s.title, status: 'pending' })),
      })

      const runOne = async (seed: BatchSeedInput): Promise<void> => {
        if (ac.signal.aborted) {
          update(seed.seedId, { status: 'aborted' })
          return
        }
        // 1. 立项
        update(seed.seedId, { status: 'launching' })
        let projectId: string
        try {
          const proj = await projectsApi.createFromSeed(seed.seedId)
          projectId = proj.id
          update(seed.seedId, { projectId, status: 'running' })
          qc.invalidateQueries({ queryKey: ['projects'] })
          qc.invalidateQueries({ queryKey: ['seeds'] })
        } catch (e) {
          update(seed.seedId, {
            status: 'failed',
            error: e instanceof Error ? e.message : '立项失败',
          })
          return
        }
        // 2. 跑全流程
        try {
          await runProjectPipeline(projectId, {
            target,
            signal: ac.signal,
            onStep: (step, idx, total) =>
              update(seed.seedId, {
                step,
                stepIndex: idx,
                stepTotal: total,
                retry: undefined,
              }),
            onStepRetry: (_step, attempt, max) =>
              update(seed.seedId, { retry: { attempt, max } }),
          })
          update(seed.seedId, { status: 'done', retry: undefined })
        } catch (e) {
          const aborted =
            ac.signal.aborted ||
            (e instanceof Error && (/已中断/.test(e.message) || e.name === 'AbortError'))
          update(seed.seedId, {
            status: aborted ? 'aborted' : 'failed',
            error: aborted ? undefined : e instanceof Error ? e.message : '全流程失败',
            retry: undefined,
          })
        } finally {
          qc.invalidateQueries({ queryKey: ['projects'] })
        }
      }

      // 并发限流：维持 BATCH_CONCURRENCY 个 worker 从队列取活
      const queue = [...seeds]
      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          if (ac.signal.aborted) {
            // 剩余未开工的标记中断
            const rest = queue.splice(0)
            rest.forEach((s) => update(s.seedId, { status: 'aborted' }))
            break
          }
          const next = queue.shift()
          if (!next) break
          await runOne(next)
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(BATCH_CONCURRENCY, seeds.length) }, () => worker()),
      )

      setState((s) => ({ ...s, running: false }))
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['seeds'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    [state.running, qc, update],
  )

  return { state, run, abort, reset }
}
