import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Works from './pages/Works'
import WorkDetail from './pages/WorkDetail'
import Predict from './pages/Predict'
import Retro from './pages/Retro'
import Rubric from './pages/Rubric'
import Seeds from './pages/Seeds'
import Settings from './pages/Settings'

const navItems = [
  { path: '/', label: '总览' },
  { path: '/works', label: '作品' },
  { path: '/predict', label: '预测' },
  { path: '/retro', label: '复盘' },
  { path: '/rubric', label: 'Rubric' },
  { path: '/seeds', label: '选题' },
  { path: '/settings', label: '设置' },
]

export default function App() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex">
      <nav className="w-48 bg-slate-900 text-white p-4 flex flex-col gap-1">
        <h1 className="text-lg font-bold mb-6 px-3">Cheat</h1>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`px-3 py-2 rounded text-sm transition-colors ${
              location.pathname === item.path
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/works" element={<Works />} />
          <Route path="/works/:id" element={<WorkDetail />} />
          <Route path="/predict" element={<Predict />} />
          <Route path="/retro" element={<Retro />} />
          <Route path="/rubric" element={<Rubric />} />
          <Route path="/seeds" element={<Seeds />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
