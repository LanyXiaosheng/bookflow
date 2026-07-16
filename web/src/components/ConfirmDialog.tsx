import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, X } from 'lucide-react'

export type ConfirmTone = 'danger' | 'normal'

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  tone?: ConfirmTone
}

interface ConfirmCtx {
  /** 弹确认框；用户点确定 → resolve(true)，取消/关闭 → resolve(false) */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const Ctx = createContext<ConfirmCtx | null>(null)

export function useConfirm(): ConfirmCtx['confirm'] {
  const c = useContext(Ctx)
  if (!c) throw new Error('useConfirm must be inside <ConfirmProvider>')
  return c.confirm
}

interface PendingState extends ConfirmOptions {
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const close = useCallback(
    (v: boolean) => {
      if (!pending) return
      pending.resolve(v)
      setPending(null)
    },
    [pending],
  )

  // ESC 关闭、初次焦点落到「取消」（破坏性默认手抖也安全）
  useEffect(() => {
    if (!pending) return
    cancelBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  const tone: ConfirmTone = pending?.tone ?? 'normal'

  return (
    <Ctx.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          data-testid="confirm-dialog"
        >
          {/* 背景 */}
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-black/60"
            onClick={() => close(false)}
          />
          {/* 弹层 */}
          <div className="glass-card relative w-full max-w-[420px]">
            <header className="flex items-start gap-3 px-5 pt-5">
              {tone === 'danger' && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
                  <AlertTriangle className="h-5 w-5" />
                </span>
              )}
              <div className="flex-1 pt-1">
                <h2 id="confirm-title" className="text-base font-semibold text-white">
                  {pending.title}
                </h2>
                {pending.description && (
                  <div className="mt-1.5 text-sm leading-6 text-gray-400">
                    {pending.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => close(false)}
                className="ml-2 rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <footer className="mt-5 flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={() => close(false)}
                className="rounded-md border border-white/10 bg-white/[0.05] px-4 py-1.5 text-sm font-medium text-gray-200 hover:bg-white/10"
                data-testid="confirm-cancel"
              >
                {pending.cancelText ?? '取消'}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold ${
                  tone === 'danger'
                    ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
                data-testid="confirm-ok"
              >
                {pending.confirmText ?? '确定'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
