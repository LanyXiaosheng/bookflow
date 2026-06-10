import { api } from './client'
import type { ProjectArtifact } from './projects'

export interface StoryImagePayload {
  model: string
  prompt: string
  mime_type: string
  data_url: string
  title_text: string
  cover_size?: string | null
  author_name?: string | null
  show_author: boolean
}

export interface GenerateStoryImageInput {
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high'
  author_name?: string
  show_author?: boolean
}

export const imagesApi = {
  async generateStoryImage(
    projectId: string,
    input?: GenerateStoryImageInput,
  ): Promise<ProjectArtifact> {
    const { data } = await api.post<ProjectArtifact>(`/projects/${projectId}/ai-story-image`, input)
    return data
  },
}
