import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  return n.toLocaleString()
}

export default function Works() {
  const { data, isLoading } = useQuery({
    queryKey: ['works'],
    queryFn: () => api.getWorks(),
  })

  const handleSync = async () => {
    await api.triggerSync()
    window.location.reload()
  }

  if (isLoading) return <div className="text-slate-500">加载中...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">作品列表</h2>
        <button
          onClick={handleSync}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          同步数据
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3">标题</th>
              <th className="text-right p-3">阅读</th>
              <th className="text-right p-3">曝光</th>
              <th className="text-right p-3">点击率</th>
              <th className="text-right p-3">赞</th>
              <th className="text-right p-3">评</th>
              <th className="text-right p-3">藏</th>
              <th className="text-right p-3">字数</th>
            </tr>
          </thead>
          <tbody>
            {data?.works.map(work => (
              <tr key={work.id} className="border-b hover:bg-slate-50">
                <td className="p-3">
                  <Link to={`/works/${work.id}`} className="text-blue-600 hover:underline">
                    {work.title}
                  </Link>
                  {work.category && (
                    <span className="ml-2 text-xs text-slate-400">{work.category}</span>
                  )}
                </td>
                <td className="text-right p-3 font-mono">{fmt(work.read_count)}</td>
                <td className="text-right p-3 font-mono">{fmt(work.show_count)}</td>
                <td className="text-right p-3 font-mono">{(work.click_rate * 100).toFixed(1)}%</td>
                <td className="text-right p-3">{work.digg_count}</td>
                <td className="text-right p-3">{work.comment_count}</td>
                <td className="text-right p-3">{work.shelf_count}</td>
                <td className="text-right p-3 text-slate-500">{work.word_count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm text-slate-500">
        共 {data?.total ?? 0} 篇
      </div>
    </div>
  )
}
