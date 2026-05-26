import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../api/client'

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  return n.toLocaleString()
}

export default function WorkDetail() {
  const { id } = useParams<{ id: string }>()
  const workId = Number(id)

  const { data: work } = useQuery({
    queryKey: ['work', workId],
    queryFn: () => api.getWork(workId),
  })

  const { data: daily } = useQuery({
    queryKey: ['work-daily', workId],
    queryFn: () => api.getWorkDaily(workId),
  })

  if (!work) return <div className="text-slate-500">加载中...</div>

  const chartData = daily?.map(d => ({
    date: d.date,
    曝光: d.show_count,
    阅读: d.read_count,
    完读: d.read_100_percent,
    完读率: d.read_count > 0 ? Math.round(d.read_100_percent / d.read_count * 100) : 0,
    '15s留存': d.read_count > 0 ? Math.round(d.read_15s / d.read_count * 100) : 0,
  })) ?? []

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">{work.title}</h2>
      <div className="text-sm text-slate-500 mb-6">
        {work.platform} · {work.category} · {work.word_count.toLocaleString()} 字
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        {[
          { label: '曝光', value: fmt(work.show_count) },
          { label: '阅读', value: fmt(work.read_count) },
          { label: '点击率', value: `${(work.click_rate * 100).toFixed(1)}%` },
          { label: '点赞', value: work.digg_count },
          { label: '评论', value: work.comment_count },
          { label: '收藏', value: work.shelf_count },
        ].map(item => (
          <div key={item.label} className="bg-white rounded p-3 border text-center">
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="text-lg font-bold">{item.value}</div>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-4">日增长曲线</h3>
          <div className="bg-white rounded-lg p-4 border mb-6">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="曝光" stroke="#6366f1" />
                <Line yAxisId="left" type="monotone" dataKey="阅读" stroke="#06b6d4" />
                <Line yAxisId="right" type="monotone" dataKey="完读率" stroke="#10b981" unit="%" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h3 className="text-lg font-semibold mb-4">留存率趋势</h3>
          <div className="bg-white rounded-lg p-4 border">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="完读率" stroke="#10b981" unit="%" />
                <Line type="monotone" dataKey="15s留存" stroke="#f59e0b" unit="%" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
