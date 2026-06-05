import { api } from './client'

export type ProjectStatus = 'writing' | 'ready' | 'published' | 'archived'

export interface Project {
  id: string
  seed_id: string
  title: string
  track: string
  status: ProjectStatus
  created_at: string
  updated_at: string
}

export type ArtifactKind =
  | 'readme'
  | 'outline'
  | 'publish_post'
  | 'side_dishes'
  | 'book_summary'
  | 'book_polished'

export interface ProjectArtifact {
  id: string
  project_id: string
  kind: ArtifactKind
  version: number
  content: string
  created_at: string
}

export const projectsApi = {
  async list(status?: ProjectStatus): Promise<Project[]> {
    const { data } = await api.get<Project[]>('/projects', {
      params: status ? { status } : {},
    })
    return data
  },
  async get(id: string): Promise<Project> {
    const { data } = await api.get<Project>(`/projects/${id}`)
    return data
  },
  async createFromSeed(seed_id: string): Promise<Project> {
    const { data } = await api.post<Project>('/projects', { seed_id })
    return data
  },
  async transition(id: string, to: ProjectStatus): Promise<Project> {
    const { data } = await api.post<Project>(`/projects/${id}/transition`, { to })
    return data
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/projects/${id}`)
  },
  async listArtifacts(id: string): Promise<ProjectArtifact[]> {
    const { data } = await api.get<ProjectArtifact[]>(`/projects/${id}/artifacts`)
    return data
  },
}
