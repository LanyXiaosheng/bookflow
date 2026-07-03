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
      <main className="mx-auto flex min-h-[320px] max-w-md items-center justify-center px-4 py-12 text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在确认登录状态
      </main>
    )
  }

  if (!auth.data) {
    return (
      <main className="mx-auto max-w-md px-4 py-12" data-testid="login-required">
        <div className="rounded-2xl border border-blue-100 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">需要登录</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            登录后才能继续管理项目、写作正文和使用 AI 生成能力。
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link
              to={loginHref(redirectPath)}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              data-testid="login-required-login"
            >
              去登录
            </Link>
            <Link
              to={`${loginHref(redirectPath)}&mode=register`}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm text-gray-600 hover:bg-gray-50"
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
