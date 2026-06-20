import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import Shell from './Shell'
import Dashboard from './pages/Dashboard'
import Seeds from './pages/Seeds'
import Projects from './pages/Projects'
import Ready from './pages/Ready'
import Published from './pages/Published'
import Archived from './pages/Archived'
import Write from './pages/Write'
import ProjectDetail from './pages/ProjectDetail'
import Review from './pages/Review'
import QuickRetro from './pages/QuickRetro'
import Stub from './pages/Stub'
import Settings from './pages/Settings'
import Tracks from './pages/Tracks'
import Playbook from './pages/Playbook'
import Auth from './pages/Auth'
import { ConfirmProvider } from './components/ConfirmDialog'
import RequireAuth from './components/RequireAuth'

if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  const next = new URL(window.location.href)
  next.hostname = '127.0.0.1'
  window.location.replace(next.toString())
}

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="/seeds" element={<RequireAuth><Seeds /></RequireAuth>} />
              <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
              <Route path="/projects/:id" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
              <Route path="/projects/:id/write" element={<RequireAuth><Write /></RequireAuth>} />
              <Route path="/ready" element={<RequireAuth><Ready /></RequireAuth>} />
              <Route path="/published" element={<RequireAuth><Published /></RequireAuth>} />
              <Route path="/archived" element={<RequireAuth><Archived /></RequireAuth>} />
              <Route path="/review" element={<RequireAuth><Review /></RequireAuth>} />
              <Route path="/review/quick" element={<RequireAuth><QuickRetro /></RequireAuth>} />
              <Route path="/tracks" element={<Tracks />} />
              <Route path="/playbook" element={<Playbook />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="*" element={<Stub />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
)
