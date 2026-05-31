import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  timeout: 8000,
})

export type Tier = 'greenlight' | 'backlog' | 'reject'

export interface Score {
  title: number
  opening: number
  slap: number
  emotion: number
  twist: number
  hook: number
  finish: number
}

export interface Seed {
  id: string
  title: string
  track: string
  score: Score
  total_score: number
  tier: Tier
  created_at: string
}

export interface NewSeed {
  title: string
  track: string
  score: Score
}

export const seedsApi = {
  async list(): Promise<Seed[]> {
    const { data } = await api.get<Seed[]>('/seeds')
    return data
  },
  async create(payload: NewSeed): Promise<Seed> {
    const { data } = await api.post<Seed>('/seeds', payload)
    return data
  },
}
