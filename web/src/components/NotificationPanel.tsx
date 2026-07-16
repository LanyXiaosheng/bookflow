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
      return 'bg-rose-500/15 text-rose-300'
    case 'warning':
      return 'bg-amber-500/15 text-amber-300'
    case 'info':
    default:
      return 'bg-sky-500/15 text-sky-300'
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
      className="glass-card absolute right-0 top-full mt-2 w-[360px] overflow-hidden"
      data-testid="notification-panel"
    >
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">通知中心</div>
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
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50"
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
                ? 'bg-white text-black font-medium'
                : 'border border-white/10 text-gray-300 hover:bg-white/5'
            }`}
            data-testid="notifications-unread-toggle"
          >
            仅看未读
          </button>
          <button
            type="button"
            onClick={() => actions.clearResolved.mutate()}
            disabled={batchBusy}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-50"
            data-testid="notifications-clear-resolved"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空已处理
          </button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载通知中
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            {emptyText}
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={`rounded-xl border px-3 py-3 ${
                  item.status === 'unread'
                    ? 'border-white/15 bg-white/[0.06]'
                    : 'border-white/[0.06] bg-white/[0.02]'
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
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black">
                          未读
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-gray-400">
                      {item.body}
                    </div>
                    <div className="mt-2 text-[11px] text-gray-500">
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
                      className="inline-flex items-center rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-gray-200"
                      data-testid="notification-primary-action"
                    >
                      {item.action_label ?? '查看'}
                    </Link>
                  )}
                  {item.status === 'unread' && (
                    <button
                      type="button"
                      onClick={() => actions.markRead.mutate(item.id)}
                      className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5"
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
