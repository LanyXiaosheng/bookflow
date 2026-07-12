import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronDown, Languages, LogOut, Pencil, User } from 'lucide-react'
import { authApi } from './api/auth'
import NotificationPanel from './components/NotificationPanel'
import { useNotifications } from './hooks/useNotifications'

const NAV: Array<{ to: string; label: string }> = [
  { to: '/', label: '看板' },
  { to: '/seeds', label: '选题' },
  { to: '/projects', label: '项目' },
  { to: '/published', label: '已发' },
  { to: '/review', label: '复盘' },
  { to: '/account-review', label: '账号复盘' },
  { to: '/settings', label: '设置' },
]

export default function Shell() {
  const qc = useQueryClient()
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const notificationRef = useRef<HTMLDivElement | null>(null)
  const auth = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    retry: false,
  })
  const notifications = useNotifications(false)
  const unreadCount = notifications.data?.unread_count ?? 0

  useEffect(() => {
    if (!userMenuOpen && !notificationOpen) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!userMenuRef.current?.contains(target)) {
        setUserMenuOpen(false)
      }
      if (!notificationRef.current?.contains(target)) {
        setNotificationOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [notificationOpen, userMenuOpen])

  const renameUser = async () => {
    if (!auth.data) return
    const next = window.prompt('修改昵称', auth.data.user.display_name)
    if (!next || next.trim() === auth.data.user.display_name) return
    await authApi.updateProfile({ display_name: next.trim() })
    await qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    setUserMenuOpen(false)
  }

  const logout = async () => {
    await authApi.logout()
    await qc.cancelQueries({ queryKey: ['auth', 'me'] })
    qc.setQueryData(['auth', 'me'], null)
    setUserMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="fixed inset-x-0 top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
          <Link to="/" className="shrink-0 text-sm font-semibold tracking-tight sm:text-base">
            BookFlow
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  [
                    'shrink-0 whitespace-nowrap text-sm transition-colors sm:text-[15px]',
                    isActive ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:gap-3">
            <div className="relative hidden sm:block" ref={notificationRef}>
              <button
                type="button"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="通知"
                aria-expanded={notificationOpen}
                onClick={() => {
                  setNotificationOpen((open) => !open)
                  setUserMenuOpen(false)
                }}
                data-testid="notification-trigger"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <>
                    <span className="absolute top-1.5 right-1.5 inline-flex h-2 w-2 rounded-full bg-red-500" />
                    <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-[18px] text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  </>
                )}
              </button>
              {notificationOpen && (
                <NotificationPanel onNavigate={() => setNotificationOpen(false)} />
              )}
            </div>
            <div className="hidden md:flex items-center rounded-lg border border-gray-200 bg-white px-2 py-1 shadow-sm">
              <Languages className="w-4 h-4 text-gray-400 mr-1.5" />
              <select
                className="appearance-none bg-transparent pr-5 text-sm font-medium text-gray-700 outline-none cursor-pointer"
                defaultValue="zh"
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </div>
            {auth.data ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  data-testid="user-menu-trigger"
                >
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-100 px-2 text-xs font-semibold text-blue-700">
                    {auth.data.user.display_name.slice(0, 2)}
                  </span>
                  <span className="hidden sm:inline">{auth.data.user.display_name}</span>
                  <ChevronDown className={`hidden h-4 w-4 transition sm:block ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {userMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg"
                    role="menu"
                    data-testid="user-menu"
                  >
                    <div className="border-b border-gray-100 px-3 py-2">
                      <div className="font-medium text-gray-900">{auth.data.user.display_name}</div>
                      <div className="truncate text-xs text-gray-400">{auth.data.user.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={renameUser}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      role="menuitem"
                      data-testid="user-menu-rename"
                    >
                      <Pencil className="h-4 w-4" />
                      修改昵称
                    </button>
                    <button
                      type="button"
                      onClick={logout}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                      role="menuitem"
                      data-testid="user-menu-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/auth"
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
              >
                <span className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-600" />
                </span>
                <span className="hidden sm:inline">登录 / 注册</span>
              </Link>
            )}
          </div>
        </div>
      </nav>
      <div className="pt-14">
        <Outlet />
      </div>
    </div>
  )
}
