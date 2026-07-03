import { api } from './client'

export interface User {
  id: string
  email: string
  display_name: string
  created_at: string
}

export interface AuthView {
  user: User
}

export interface RegisterInput {
  email: string
  display_name: string
  password: string
  remember_me?: boolean
}

export interface LoginInput {
  email: string
  password: string
  remember_me?: boolean
}

export interface UpdateProfileInput {
  display_name: string
}

export const authApi = {
  async me(): Promise<AuthView> {
    const { data } = await api.get<AuthView>('/auth/me')
    return data
  },
  async register(input: RegisterInput): Promise<AuthView> {
    const { data } = await api.post<AuthView>('/auth/register', input)
    return data
  },
  async login(input: LoginInput): Promise<AuthView> {
    const { data } = await api.post<AuthView>('/auth/login', input)
    return data
  },
  async logout(): Promise<void> {
    await api.post('/auth/logout')
  },
  async updateProfile(input: UpdateProfileInput): Promise<AuthView> {
    const { data } = await api.put<AuthView>('/auth/profile', input)
    return data
  },
}
