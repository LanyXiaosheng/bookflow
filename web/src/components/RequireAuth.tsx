import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import { authApi } from '../api/auth'

interface RequireAuthProps {
  children: React.ReactNode
}

function loginHref(path: string): string {
  return `/auth?redirect=${encodeURIComponent(path)}`
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation()
  const auth = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    retry: false,
  })
  const redirectPath = `${location.pathname}${location.search}`

  if (auth.isLoading) {
    return (
      <main className="mx-auto flex min-h-[320px] max-w-md items-center justify-center px-4 py-12 text-sm text-gray-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在确认登录状态
      </main>
    )
  }

  if (!auth.data) {
    return (
      <main className="mx-auto max-w-md px-4 py-12" data-testid="login-required">
        <div className="glass-card p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold text-white">需要登录</h1>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            登录后才能继续管理项目、写作正文和使用 AI 生成能力。
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link
              to={loginHref(redirectPath)}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500"
              data-testid="login-required-login"
            >
              去登录
            </Link>
            <Link
              to={`${loginHref(redirectPath)}&mode=register`}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-white/10 px-4 text-sm text-gray-400 hover:bg-white/5"
            >
              注册账号
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return <>{children}</>
}
