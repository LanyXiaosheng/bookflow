/**
 * AI 任务全局状态 store
 *
 * 用 localStorage + window event 做跨页面同步：
 * - useFullBook 跑全篇时写入 ai_jobs[projectId]
 * - ProjectList / Dashboard / 项目详情页订阅 → 显示「⚡ AI 生成中」徽章
 *
 * 不打 schema、不靠后端，纯前端 ephemeral 信号。停电就丢，无所谓。
 */
import { useEffect, useState } from 'react'

const KEY = 'bookflow.ai_jobs.v1'
const EVENT = 'bookflow:ai-jobs-changed'

export interface AiJob {
  projectId: string
  /** 哪个动作 */
  kind: 'full_book' | 'full_chapter'
  /** 0..total */
  chapter: number
  totalChapters: number
  beat: number
  totalBeats: number
  /** 累积字数（流式） */
  chars: number
  startedAt: number
}

type AiJobs = Record<string, AiJob>

function read(): AiJobs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw) as AiJobs
  } catch {
    return {}
  }
}

function write(jobs: AiJobs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs))
  } catch {
    // ignore quota
  }
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function setAiJob(job: AiJob) {
  const jobs = read()
  jobs[job.projectId] = job
  write(jobs)
}

export function clearAiJob(projectId: string) {
  const jobs = read()
  if (projectId in jobs) {
    delete jobs[projectId]
    write(jobs)
  }
}

export function getAiJob(projectId: string): AiJob | undefined {
  return read()[projectId]
}

/** 订阅某个 projectId 的 AI 任务状态；undefined 表示当前没有正在跑 */
export function useAiJob(projectId: string | undefined): AiJob | undefined {
  const [job, setJob] = useState<AiJob | undefined>(() =>
    projectId ? getAiJob(projectId) : undefined,
  )
  useEffect(() => {
    if (!projectId) {
      setJob(undefined)
      return
    }
    const refresh = () => setJob(getAiJob(projectId))
    refresh()
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [projectId])
  return job
}

/** 订阅所有 AI 任务（列表页用） */
export function useAllAiJobs(): AiJobs {
  const [jobs, setJobs] = useState<AiJobs>(() => read())
  useEffect(() => {
    const refresh = () => setJobs(read())
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return jobs
}
