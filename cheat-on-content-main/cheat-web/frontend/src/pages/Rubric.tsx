import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export default function Rubric() {
  const { data: rubric } = useQuery({
    queryKey: ['rubric'],
    queryFn: api.getRubric,
  })

  const { data: history } = useQuery({
    queryKey: ['rubric-history'],
    queryFn: api.getRubricHistory,
  })

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Rubric 管理</h2>

      {rubric ? (
        <div className="bg-white rounded-lg p-6 border mb-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-lg font-semibold">当前版本: {rubric.version}</span>
            <span className="text-sm text-slate-500">{rubric.created_at}</span>
          </div>
          <h4 className="font-medium mb-2">维度定义</h4>
          <pre className="text-sm bg-slate-50 p-3 rounded overflow-auto">
            {JSON.stringify(rubric.dimensions, null, 2)}
          </pre>
          <h4 className="font-medium mt-4 mb-2">Bucket 区间</h4>
          <pre className="text-sm bg-slate-50 p-3 rounded overflow-auto">
            {JSON.stringify(rubric.bucket_ranges, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="text-slate-500 bg-white rounded-lg p-8 border text-center mb-6">
          尚未创建 Rubric。请在设置中初始化。
        </div>
      )}

      {history && history.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">版本历史</h3>
          <div className="space-y-2">
            {history.map((v: any) => (
              <div key={v.id} className="bg-white rounded p-3 border flex items-center gap-4">
                <span className="font-mono font-bold">{v.version}</span>
                <span className="text-sm text-slate-500">{v.created_at}</span>
                {v.notes && <span className="text-sm">{v.notes}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
