import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Lock, Mail, User as UserIcon } from 'lucide-react'
import { authApi } from '../api/auth'

const REMEMBER_KEY = 'bookflow.auth.remember.v1'

function readRememberedAuth(): { email: string; rememberMe: boolean } {
  if (typeof window === 'undefined') {
    return { email: '', rememberMe: true }
  }
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY)
    if (!raw) return { email: '', rememberMe: true }
    const parsed = JSON.parse(raw) as Partial<{ email: string; rememberMe: boolean }>
    return {
      email: typeof parsed.email === 'string' ? parsed.email : '',
      rememberMe: parsed.rememberMe !== false,
    }
  } catch {
    return { email: '', rememberMe: true }
  }
}

export default function Auth() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'register' ? 'register' : 'login'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const redirect = safeRedirect(params.get('redirect'))
  const [email, setEmail] = useState(() => readRememberedAuth().email)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(() => readRememberedAuth().rememberMe)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (rememberMe) {
      window.localStorage.setItem(
        REMEMBER_KEY,
        JSON.stringify({ email: email.trim(), rememberMe: true }),
      )
      return
    }
    window.localStorage.removeItem(REMEMBER_KEY)
  }, [email, rememberMe])

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === 'register') {
        return authApi.register({ email, display_name: displayName, password, remember_me: rememberMe })
      }
      return authApi.login({ email, password, remember_me: rememberMe })
    },
    onSuccess: async () => {
      if (typeof window !== 'undefined') {
        if (rememberMe) {
          window.localStorage.setItem(
            REMEMBER_KEY,
            JSON.stringify({ email: email.trim(), rememberMe: true }),
          )
        } else {
          window.localStorage.removeItem(REMEMBER_KEY)
        }
      }
      setPassword('')
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      navigate(redirect, { replace: true })
    },
  })

  const title = useMemo(() => (mode === 'register' ? '注册账号' : '登录账号'), [mode])

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {mode === 'register' ? '创建你的 BookFlow 账号。' : '登录后继续你的项目流。'}
          </p>
        </div>
        <form
          className="grid gap-4 px-6 py-6"
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
        >
          <label className="grid gap-1.5 text-sm text-gray-700">
            <span>邮箱</span>
            <div className="flex items-center rounded-lg border border-gray-300 px-3">
              <Mail className="h-4 w-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 outline-none"
                placeholder="you@example.com"
                required
              />
            </div>
          </label>
          {mode === 'register' && (
            <label className="grid gap-1.5 text-sm text-gray-700">
              <span>昵称</span>
              <div className="flex items-center rounded-lg border border-gray-300 px-3">
                <UserIcon className="h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 outline-none"
                  placeholder="作者昵称"
                  required
                />
              </div>
            </label>
          )}
          <label className="grid gap-1.5 text-sm text-gray-700">
            <span>密码</span>
            <div className="flex items-center rounded-lg border border-gray-300 px-3">
              <Lock className="h-4 w-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 outline-none"
                placeholder="至少 6 位"
                required
              />
            </div>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded border-gray-300"
            />
            记住我
          </label>
          {mutation.isError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {(mutation.error as Error).message}
            </p>
          )}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : title}
          </button>
          <div className="text-sm text-gray-500">
            {mode === 'register' ? '已有账号？' : '还没有账号？'}{' '}
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('mode', mode === 'register' ? 'login' : 'register')
                setParams(next)
              }}
              className="font-medium text-blue-600 hover:text-blue-700"
            >
              {mode === 'register' ? '去登录' : '去注册'}
            </button>
          </div>
          <Link to="/" className="text-sm text-gray-400 hover:text-gray-600">
            返回看板
          </Link>
        </form>
      </div>
    </main>
  )
}

function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
