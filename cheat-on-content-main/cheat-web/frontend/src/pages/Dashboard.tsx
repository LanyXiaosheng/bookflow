import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  return n.toLocaleString()
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
  })

  if (isLoading) return <div className="text-slate-500">加载中...</div>
  if (!data) return <div className="text-slate-500">无数据</div>

  const cards = [
    { label: '总作品', value: data.total_works },
    { label: '总阅读', value: fmt(data.total_reads) },
    { label: '总曝光', value: fmt(data.total_shows) },
    { label: '点击率', value: `${(data.click_rate * 100).toFixed(1)}%` },
    { label: '总点赞', value: fmt(data.total_digg) },
    { label: '总评论', value: fmt(data.total_comments) },
    { label: '总收藏', value: fmt(data.total_shelf) },
    { label: '今日+阅读', value: `+${fmt(data.today_read_increase)}` },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">账号总览</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-lg p-4 shadow-sm border">
            <div className="text-sm text-slate-500">{card.label}</div>
            <div className="text-2xl font-bold mt-1">{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
