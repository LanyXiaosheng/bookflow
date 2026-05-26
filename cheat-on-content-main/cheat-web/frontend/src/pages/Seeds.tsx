import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

export default function Seeds() {
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState('')

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates'],
    queryFn: api.getCandidates,
  })

  const addMutation = useMutation({
    mutationFn: () => api.addCandidate({ title: newTitle, source: 'manual' }),
    onSuccess: () => {
      setNewTitle('')
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
    },
  })

  const generateMutation = useMutation({
    mutationFn: api.generateSeeds,
  })

  if (isLoading) return <div className="text-slate-500">加载中...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">选题候选池</h2>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm disabled:opacity-50"
        >
          {generateMutation.isPending ? 'AI 生成中...' : 'AI 推荐选题'}
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          className="flex-1 border rounded px-3 py-2 text-sm"
          placeholder="手动添加选题..."
          onKeyDown={e => e.key === 'Enter' && newTitle && addMutation.mutate()}
        />
        <button
          onClick={() => addMutation.mutate()}
          disabled={!newTitle}
          className="px-4 py-2 bg-slate-800 text-white rounded text-sm disabled:opacity-50"
        >
          添加
        </button>
      </div>

      {(!candidates || candidates.length === 0) ? (
        <div className="text-slate-500 bg-white rounded-lg p-8 border text-center">
          候选池为空。手动添加或让 AI 推荐。
        </div>
      ) : (
        <div className="space-y-2">
          {candidates.map(c => (
            <div key={c.id} className="bg-white rounded-lg p-4 border flex items-center gap-4">
              <div className="flex-1">
                <div className="font-medium">{c.title}</div>
                {c.notes && <div className="text-sm text-slate-500 mt-1">{c.notes}</div>}
              </div>
              {c.tier && (
                <span className={`px-2 py-0.5 rounded text-xs ${
                  c.tier === 'tier1' ? 'bg-green-100 text-green-700' :
                  c.tier === 'tier2' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {c.tier}
                </span>
              )}
              {c.composite && (
                <span className="text-sm font-mono">{c.composite.toFixed(1)}</span>
              )}
              <span className="text-xs text-slate-400">{c.source}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
