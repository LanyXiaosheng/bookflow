import { Link } from 'react-router-dom'
import { Bell, CheckCheck, Loader2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNotificationActions, useNotifications } from '../hooks/useNotifications'
import type { NotificationItem } from '../api/notifications'

function categoryLabel(category: NotificationItem['category']): string {
  switch (category) {
    case 'production':
      return '生产'
    case 'ai':
      return 'AI'
    case 'system':
      return '系统'
  }
}

function levelClass(level: NotificationItem['level']): string {
  switch (level) {
    case 'error':
      return 'bg-rose-100 text-rose-700'
    case 'warning':
      return 'bg-amber-100 text-amber-700'
    case 'info':
    default:
      return 'bg-sky-100 text-sky-700'
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

interface NotificationPanelProps {
  onNavigate?: () => void
}

export default function NotificationPanel({ onNavigate }: NotificationPanelProps) {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const notifications = useNotifications(unreadOnly)
  const actions = useNotificationActions()

  const unreadCount = notifications.data?.unread_count ?? 0
  const items = notifications.data?.items ?? []

  const loading = notifications.isLoading || notifications.isFetching
  const batchBusy =
    actions.markAllRead.isPending || actions.clearResolved.isPending

  const emptyText = useMemo(() => {
    if (unreadOnly) return '当前没有未读通知。'
    return '当前没有通知。'
  }, [unreadOnly])

  return (
    <div
      className="absolute right-0 top-full mt-2 w-[360px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
      data-testid="notification-panel"
    >
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">通知中心</div>
            <div className="text-xs text-gray-400">
              未读 {unreadCount} 条
            </div>
          </div>
          <Bell className="h-4 w-4 text-gray-400" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => actions.markAllRead.mutate()}
            disabled={batchBusy || unreadCount === 0}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            data-testid="notifications-read-all"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            全部已读
          </button>
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={`rounded-md px-2.5 py-1.5 text-xs ${
              unreadOnly
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="notifications-unread-toggle"
          >
            仅看未读
          </button>
          <button
            type="button"
            onClick={() => actions.clearResolved.mutate()}
            disabled={batchBusy}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            data-testid="notifications-clear-resolved"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空已处理
          </button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载通知中
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400">
            {emptyText}
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={`rounded-xl border px-3 py-3 ${
                  item.status === 'unread'
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-gray-200 bg-white'
                }`}
                data-testid="notification-item"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelClass(item.level)}`}
                      >
                        {categoryLabel(item.category)}
                      </span>
                      {item.status === 'unread' && (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          未读
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-medium text-gray-900">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-gray-500">
                      {item.body}
                    </div>
                    <div className="mt-2 text-[11px] text-gray-400">
                      {formatTime(item.updated_at)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.action_href && (
                    <Link
                      to={item.action_href}
                      onClick={() => {
                        if (item.status === 'unread') actions.markRead.mutate(item.id)
                        onNavigate?.()
                      }}
                      className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      data-testid="notification-primary-action"
                    >
                      {item.action_label ?? '查看'}
                    </Link>
                  )}
                  {item.status === 'unread' && (
                    <button
                      type="button"
                      onClick={() => actions.markRead.mutate(item.id)}
                      className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      data-testid="notification-mark-read"
                    >
                      标记已读
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
