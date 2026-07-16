import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Loader2, Lock, Mail, User as UserIcon } from 'lucide-react'
import { authApi } from '../api/auth'

const REMEMBER_KEY = 'bookflow.auth.remember.v1'
const HERO_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_094145_4a271a6c-3869-4f1c-8aa7-aeb0cb227994.mp4'

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
    <div className="auth-cinematic fixed inset-0 z-40 flex flex-col overflow-hidden">
      {/* 背景视频 */}
      <video
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
        src={HERO_VIDEO}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden
      />
      {/* 底部模糊遮罩：只糊底部，无暗色渐变 */}
      <div className="auth-bottom-blur pointer-events-none absolute inset-0 z-[1] backdrop-blur-xl" />

      {/* 顶栏 */}
      <header className="relative z-10 flex items-center justify-between px-4 py-5 sm:px-6 md:px-12 md:py-6">
        <Link
          to="/"
          className="animate-blur-fade-up text-lg font-semibold tracking-tight text-white sm:text-xl"
          style={{ animationDelay: '0ms' }}
        >
          BOOKFLOW
        </Link>
        <Link
          to="/"
          className="liquid-glass animate-blur-fade-up rounded-full px-4 py-2 text-sm text-white/90 transition-colors hover:text-white md:px-6"
          style={{ animationDelay: '350ms' }}
        >
          返回看板
        </Link>
      </header>

      {/* 内容区：底部对齐 */}
      <main className="relative z-10 flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6 md:flex-row md:items-end md:gap-10 md:px-12 md:pb-16">
        {/* 左侧文案 */}
        <div className="flex-1">
          <p
            className="animate-blur-fade-up mb-4 text-xs uppercase tracking-[0.3em] text-white/60 sm:text-sm"
            style={{ animationDelay: '300ms' }}
          >
            AI 短篇小说创作流
          </p>
          <h1
            className="animate-blur-fade-up mb-4 text-3xl font-normal text-white sm:text-5xl md:mb-6 md:text-6xl lg:text-7xl"
            style={{ animationDelay: '400ms', letterSpacing: '-0.04em' }}
          >
            Step Through.
            <br />
            Work Smarter.
          </h1>
          <p
            className="animate-blur-fade-up mb-6 max-w-xl text-base text-gray-300 sm:text-lg md:mb-0 md:text-xl"
            style={{ animationDelay: '500ms' }}
          >
            从选题到成稿，一条流水线跑通。登录后继续你的项目流。
          </p>
        </div>

        {/* 右侧登录/注册玻璃卡 */}
        <div
          className="animate-blur-fade-up mt-8 w-full md:mt-0 md:max-w-sm"
          style={{ animationDelay: '600ms' }}
        >
          <div className="liquid-glass rounded-3xl p-6 sm:p-7">
            <h2 className="text-xl font-medium text-white">{title}</h2>
            <p className="mt-1 text-sm text-white/60">
              {mode === 'register' ? '创建你的 BookFlow 账号。' : '登录后继续你的项目流。'}
            </p>
            <form
              className="mt-5 grid gap-3.5"
              onSubmit={(e) => {
                e.preventDefault()
                mutation.mutate()
              }}
            >
              <label className="grid gap-1.5 text-sm text-white/80">
                <span>邮箱</span>
                <div className="liquid-glass flex items-center rounded-xl px-3">
                  <Mail className="h-4 w-4 text-white/50" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-transparent px-3 py-2.5 text-white placeholder:text-white/40 outline-none"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </label>
              {mode === 'register' && (
                <label className="grid gap-1.5 text-sm text-white/80">
                  <span>昵称</span>
                  <div className="liquid-glass flex items-center rounded-xl px-3">
                    <UserIcon className="h-4 w-4 text-white/50" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full bg-transparent px-3 py-2.5 text-white placeholder:text-white/40 outline-none"
                      placeholder="作者昵称"
                      required
                    />
                  </div>
                </label>
              )}
              <label className="grid gap-1.5 text-sm text-white/80">
                <span>密码</span>
                <div className="liquid-glass flex items-center rounded-xl px-3">
                  <Lock className="h-4 w-4 text-white/50" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent px-3 py-2.5 text-white placeholder:text-white/40 outline-none"
                    placeholder="至少 6 位"
                    required
                  />
                </div>
              </label>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-white/30 bg-transparent"
                />
                记住我
              </label>
              {mutation.isError && (
                <p className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-200">
                  {(mutation.error as Error).message}
                </p>
              )}
              <button
                type="submit"
                disabled={mutation.isPending}
                className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {title}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              <div className="text-sm text-white/60">
                {mode === 'register' ? '已有账号？' : '还没有账号？'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.set('mode', mode === 'register' ? 'login' : 'register')
                    setParams(next)
                  }}
                  className="font-medium text-white hover:text-white/80"
                >
                  {mode === 'register' ? '去登录' : '去注册'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}

function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
