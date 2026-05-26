const API_BASE = '/api'

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!resp.ok) throw new Error(`API ${resp.status}: ${resp.statusText}`)
  return resp.json()
}

export const api = {
  getDashboard: () => fetchJson<DashboardData>('/dashboard'),
  getWorks: (params?: string) => fetchJson<WorksResponse>(`/works${params ? `?${params}` : ''}`),
  getWork: (id: number) => fetchJson<WorkWithStats>(`/works/${id}`),
  getWorkStats: (id: number) => fetchJson<WorkStat[]>(`/works/${id}/stats`),
  getWorkDaily: (id: number) => fetchJson<WorkDaily[]>(`/works/${id}/daily`),
  triggerSync: () => fetchJson<{status: string}>('/works/sync', { method: 'POST' }),
  predict: (body: PredictRequest) => fetchJson<any>('/predict', { method: 'POST', body: JSON.stringify(body) }),
  getPredictions: () => fetchJson<any[]>('/predictions'),
  createRetro: (workId: number) => fetchJson<any>(`/retro/${workId}`, { method: 'POST' }),
  getRetros: () => fetchJson<any[]>('/retros'),
  getRubric: () => fetchJson<RubricVersion | null>('/rubric'),
  getRubricHistory: () => fetchJson<RubricVersion[]>('/rubric/history'),
  getCandidates: () => fetchJson<Candidate[]>('/candidates'),
  addCandidate: (body: {title: string; source?: string; notes?: string}) =>
    fetchJson<any>('/candidates', { method: 'POST', body: JSON.stringify(body) }),
  generateSeeds: () => fetchJson<any>('/seeds/generate', { method: 'POST' }),
  getObservations: () => fetchJson<Observation[]>('/observations'),
  addObservation: (body: {content: string; source_type?: string}) =>
    fetchJson<any>('/observations', { method: 'POST', body: JSON.stringify(body) }),
  updateCookie: (platform: string, cookie: string) =>
    fetchJson<any>('/settings/cookie', { method: 'PUT', body: JSON.stringify({ platform, cookie }) }),
  getStatus: () => fetchJson<SystemStatus>('/settings/status'),
}

export interface DashboardData {
  total_works: number
  total_reads: number
  total_shows: number
  click_rate: number
  total_digg: number
  total_comments: number
  total_shelf: number
  today_read_increase: number
  today_show_increase: number
  platforms: { platform: string; work_count: number; total_reads: number }[]
}

export interface WorkWithStats {
  id: number
  platform: string
  platform_id: string
  title: string
  word_count: number
  category: string | null
  create_time: string | null
  read_count: number
  show_count: number
  click_rate: number
  digg_count: number
  comment_count: number
  shelf_count: number
}

export interface WorksResponse {
  works: WorkWithStats[]
  total: number
}

export interface WorkStat {
  id: number
  work_id: number
  read_count: number
  show_count: number
  click_rate: number
  digg_count: number
  comment_count: number
  shelf_count: number
  fetched_at: string
}

export interface WorkDaily {
  id: number
  work_id: number
  date: string
  show_count: number
  read_count: number
  read_100_percent: number
  read_15s: number
  read_30s: number
  read_60s: number
}

export interface PredictRequest {
  script: string
  title?: string
  work_id?: number
}

export interface RubricVersion {
  id: number
  version: string
  dimensions: any
  bucket_ranges: any
  notes: string | null
  created_at: string
}

export interface Candidate {
  id: number
  title: string
  source: string | null
  composite: number | null
  tier: string | null
  status: string
  notes: string | null
  created_at: string
}

export interface Observation {
  id: number
  content: string
  source_type: string | null
  status: string
  created_at: string
}

export interface SystemStatus {
  accounts: { id: number; platform: string; name: string | null; cookie_set: boolean }[]
  llm_configured: boolean
  llm_model: string
}
