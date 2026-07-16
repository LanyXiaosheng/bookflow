import { Flame } from 'lucide-react'

/**
 * 热度徽标：把 AI 给的热度文案映射成 1~4 级，用实心/空心火苗直观分级。
 *   爆款在售 = 4 级（红）/ 上升期 = 3 级（橙）/ 平稳 = 2 级（蓝）/ 冷门 = 1 级（灰）
 */
const HEAT_META: Record<
  string,
  { level: number; ring: string; flame: string; faded: string }
> = {
  爆款在售: { level: 4, ring: 'border-rose-400/30 bg-rose-500/15 text-rose-300', flame: 'text-rose-400', faded: 'text-rose-500/25' },
  上升期: { level: 3, ring: 'border-orange-400/30 bg-orange-500/15 text-orange-300', flame: 'text-orange-400', faded: 'text-orange-500/25' },
  平稳: { level: 2, ring: 'border-sky-400/30 bg-sky-500/15 text-sky-300', flame: 'text-sky-400', faded: 'text-sky-500/25' },
  冷门: { level: 1, ring: 'border-white/15 bg-white/[0.06] text-gray-400', flame: 'text-gray-400', faded: 'text-gray-600' },
}

const FALLBACK = {
  level: 2,
  ring: 'border-white/15 bg-white/[0.06] text-gray-300',
  flame: 'text-gray-400',
  faded: 'text-gray-600',
}

export default function HeatBadge({ heat, className = '' }: { heat?: string; className?: string }) {
  if (!heat) return null
  const meta = HEAT_META[heat] ?? FALLBACK
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.ring} ${className}`}
      title={`热度 ${meta.level}/4 · ${heat}`}
    >
      <span className="inline-flex items-center">
        {[0, 1, 2, 3].map((i) => (
          <Flame
            key={i}
            className={`h-3 w-3 ${i < meta.level ? meta.flame : meta.faded}`}
            fill="currentColor"
          />
        ))}
      </span>
      {heat}
    </span>
  )
}
