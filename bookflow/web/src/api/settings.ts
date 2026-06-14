import { api } from './client'

export interface SettingsView {
  provider: string
  base_url: string
  api_key_masked: string
  has_api_key: boolean
  model: string
  image_model: string
  duomiapi_key_set: boolean
  timeout_secs: number
}

export interface SettingsPatch {
  provider?: string
  base_url?: string
  api_key?: string
  model?: string
  image_model?: string
  duomiapi_key?: string
  timeout_secs?: number
}

export const settingsApi = {
  async get(): Promise<SettingsView> {
    const { data } = await api.get<SettingsView>('/settings')
    return data
  },
  async update(patch: SettingsPatch): Promise<SettingsView> {
    const { data } = await api.put<SettingsView>('/settings', patch)
    return data
  },
}
