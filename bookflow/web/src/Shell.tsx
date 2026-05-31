import { Link, NavLink, Outlet } from 'react-router-dom'

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
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-6">
          <Link to="/" className="text-base font-semibold tracking-tight">
            BookFlow
          </Link>
          <nav className="flex items-center gap-4 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  [
                    'whitespace-nowrap text-[15px] transition-colors',
                    isActive
                      ? 'text-gray-900 font-medium'
                      : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
