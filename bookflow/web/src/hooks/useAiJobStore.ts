/**
 * AI 任务全局状态 store
 *
 * 轻量进度用 localStorage + window event 做跨页面同步：
 * - 持久化 chapter/beat/chars 等轻量字段，供跨 tab / 跨页面读取
 * - liveBody 只保存在当前 tab 的内存里，避免每个流式 delta 都写 localStorage
 * - 读取时合并持久化进度和内存态 richer payload；同 tab 优先返回内存态
 *
 * 不打 schema、不靠后端，纯前端 ephemeral 信号。刷新后 liveBody 会丢，轻量进度照旧。
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
  liveBody?: { chapterId: string; text: string }
  startedAt: number
}

type AiJobs = Record<string, AiJob>
type PersistedAiJob = Omit<AiJob, 'liveBody'>
type PersistedAiJobs = Record<string, PersistedAiJob>

const memoryJobs: AiJobs = {}

function readPersisted(): PersistedAiJobs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PersistedAiJobs
  } catch {
    return {}
  }
}

function mergeJobs(persisted: PersistedAiJobs): AiJobs {
  const merged: AiJobs = {}
  for (const [projectId, job] of Object.entries(persisted)) {
    merged[projectId] = {
      ...job,
      ...memoryJobs[projectId],
    }
  }
  for (const [projectId, job] of Object.entries(memoryJobs)) {
    if (!(projectId in merged)) merged[projectId] = job
  }
  return merged
}

function read(): AiJobs {
  return mergeJobs(readPersisted())
}

function stripLiveBody(job: AiJob): PersistedAiJob {
  const { liveBody: _liveBody, ...persisted } = job
  return persisted
}

function write(jobs: PersistedAiJobs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs))
  } catch {
    // ignore quota
  }
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function setAiJob(job: AiJob) {
  memoryJobs[job.projectId] = job
  const jobs = readPersisted()
  jobs[job.projectId] = stripLiveBody(job)
  write(jobs)
}

export function clearAiJob(projectId: string) {
  delete memoryJobs[projectId]
  const jobs = readPersisted()
  if (projectId in jobs) {
    delete jobs[projectId]
    write(jobs)
  } else {
    window.dispatchEvent(new CustomEvent(EVENT))
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
