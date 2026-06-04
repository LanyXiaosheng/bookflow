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
      <nav className="sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <Link to="/" className="text-base font-semibold tracking-tight shrink-0">
            BookFlow
          </Link>
          <div className="flex-1 min-w-0 flex items-center gap-4 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  [
                    'whitespace-nowrap text-[15px] transition-colors shrink-0',
                    isActive ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>
          <div className="flex items-center gap-2 lg:gap-3 shrink-0">
            <button
              type="button"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
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
              className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <span className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-blue-600" />
              </span>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
