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
import Stub from './pages/Stub'
import Settings from './pages/Settings'
import Tracks from './pages/Tracks'
import Playbook from './pages/Playbook'
import { ConfirmProvider } from './components/ConfirmDialog'

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
              <Route path="/seeds" element={<Seeds />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/projects/:id/write" element={<Write />} />
              <Route path="/ready" element={<Ready />} />
              <Route path="/published" element={<Published />} />
              <Route path="/archived" element={<Archived />} />
              <Route path="/review" element={<Review />} />
              <Route path="/tracks" element={<Tracks />} />
              <Route path="/playbook" element={<Playbook />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Stub />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
)
