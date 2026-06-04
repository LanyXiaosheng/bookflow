import { api } from './client'

export interface DocItem {
  slug: string
  title: string
  summary: string
  bytes: number
}

export interface DocFull {
  slug: string
  title: string
  body: string
}

export const tracksApi = {
  async list(): Promise<DocItem[]> {
    const { data } = await api.get<DocItem[]>('/tracks')
    return data
  },
  async get(slug: string): Promise<DocFull> {
    const { data } = await api.get<DocFull>(`/tracks/${encodeURIComponent(slug)}`)
    return data
  },
}

export const playbookApi = {
  async list(): Promise<DocItem[]> {
    const { data } = await api.get<DocItem[]>('/playbook')
    return data
  },
  async get(slug: string): Promise<DocFull> {
    const { data } = await api.get<DocFull>(`/playbook/${encodeURIComponent(slug)}`)
    return data
  },
}
