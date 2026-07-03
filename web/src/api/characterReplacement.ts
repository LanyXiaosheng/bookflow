import { api } from './client'

export interface CharacterNameCandidate {
  name: string
}

export interface CharacterRenameRecommendation {
  old_name: string
  recommended_name: string
  reason: string
}

export interface CharacterNameRecommendationView {
  candidates: CharacterNameCandidate[]
}

export interface CharacterReplacementPreviewItem {
  scope: string
  label: string
  hits: number
  before_excerpt: string
  after_excerpt: string
}

export interface CharacterReplacementPreview {
  old_name: string
  new_name: string
  items: CharacterReplacementPreviewItem[]
}

export interface CharacterReplacementMapping {
  old_name: string
  new_name: string
}

export const characterReplacementApi = {
  async recommendations(projectId: string): Promise<CharacterNameRecommendationView> {
    const { data } = await api.get<CharacterNameRecommendationView>(
      `/projects/${projectId}/character-name-recommendations`,
    )
    return data
  },
  async recommend(
    projectId: string,
    old_name: string,
  ): Promise<CharacterRenameRecommendation> {
    const { data } = await api.post<CharacterRenameRecommendation>(
      `/projects/${projectId}/character-name-recommend`,
      { old_name },
      { timeout: 30_000 },
    )
    return data
  },
  async preview(
    projectId: string,
    old_name: string,
    new_name: string,
  ): Promise<CharacterReplacementPreview> {
    const { data } = await api.post<CharacterReplacementPreview>(
      `/projects/${projectId}/character-name-preview`,
      { old_name, new_name },
    )
    return data
  },
  async apply(
    projectId: string,
    old_name: string,
    new_name: string,
  ): Promise<CharacterReplacementPreview> {
    const { data } = await api.post<CharacterReplacementPreview>(
      `/projects/${projectId}/character-name-apply`,
      { old_name, new_name },
    )
    return data
  },
}
