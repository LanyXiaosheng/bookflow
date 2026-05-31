import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import Shell from './Shell'
import Dashboard from './pages/Dashboard'
import Seeds from './pages/Seeds'
import Stub from './pages/Stub'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="/seeds" element={<Seeds />} />
            <Route path="/projects" element={<Stub />} />
            <Route path="/published" element={<Stub />} />
            <Route path="/review" element={<Stub />} />
            <Route path="/tracks" element={<Stub />} />
            <Route path="/playbook" element={<Stub />} />
            <Route path="/settings" element={<Stub />} />
            <Route path="*" element={<Stub />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
