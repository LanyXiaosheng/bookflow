import { api } from './client'

export type NotificationCategory = 'production' | 'ai' | 'system'
export type NotificationLevel = 'info' | 'warning' | 'error'
export type NotificationStatus = 'unread' | 'read' | 'resolved' | 'archived'

export interface NotificationItem {
  id: string
  user_id: string
  category: NotificationCategory
  level: NotificationLevel
  status: NotificationStatus
  title: string
  body: string
  action_label: string | null
  action_href: string | null
  source_type: string | null
  source_id: string | null
  fingerprint: string | null
  read_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationListView {
  unread_count: number
  items: NotificationItem[]
}

export const notificationsApi = {
  async list(unreadOnly = false): Promise<NotificationListView> {
    const { data } = await api.get<NotificationListView>('/notifications', {
      params: unreadOnly ? { unread_only: true } : {},
    })
    return data
  },
  async markRead(id: string): Promise<void> {
    await api.post(`/notifications/${id}/read`)
  },
  async markAllRead(): Promise<void> {
    await api.post('/notifications/read-all')
  },
  async clearResolved(): Promise<void> {
    await api.post('/notifications/clear-resolved')
  },
}
