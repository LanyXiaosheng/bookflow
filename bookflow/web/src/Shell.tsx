import { Link, NavLink, Outlet } from 'react-router-dom'
import { Bell, ChevronDown, Languages, User } from 'lucide-react'

const NAV: Array<{ to: string; label: string }> = [
  { to: '/', label: '看板' },
  { to: '/seeds', label: '选题' },
  { to: '/projects', label: '项目' },
  { to: '/published', label: '已发' },
  { to: '/review', label: '复盘' },
  { to: '/tracks', label: '赛道' },
  { to: '/playbook', label: '手册' },
  { to: '/settings', label: '设置' },
]

export default function Shell() {
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
            <button
              type="button"
              className="relative hidden h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:inline-flex"
              aria-label="通知"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 inline-flex h-2 w-2 rounded-full bg-red-500" />
            </button>
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
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <span className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-blue-600" />
              </span>
              <ChevronDown className="hidden h-4 w-4 sm:block" />
            </button>
          </div>
        </div>
      </nav>
      <div className="pt-14">
        <Outlet />
      </div>
    </div>
  )
}
