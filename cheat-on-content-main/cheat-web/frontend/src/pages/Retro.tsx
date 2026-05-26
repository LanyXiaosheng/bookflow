import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export default function Retro() {
  const { data: retros, isLoading } = useQuery({
    queryKey: ['retros'],
    queryFn: api.getRetros,
  })

  if (isLoading) return <div className="text-slate-500">加载中...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">复盘记录</h2>

      {(!retros || retros.length === 0) ? (
        <div className="text-slate-500 bg-white rounded-lg p-8 border text-center">
          暂无复盘记录。发布作品后可在作品详情页触发复盘。
        </div>
      ) : (
        <div className="space-y-4">
          {retros.map((retro: any) => (
            <div key={retro.id} className="bg-white rounded-lg p-4 border">
              <div className="flex items-center gap-3 mb-2">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  retro.hit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {retro.hit ? '命中' : '偏差'}
                </span>
                <span className="text-sm text-slate-500">{retro.retro_at}</span>
              </div>
              {retro.analysis && <p className="text-sm">{retro.analysis}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
