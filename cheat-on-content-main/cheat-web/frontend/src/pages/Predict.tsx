import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../api/client'

export default function Predict() {
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('')
  const [result, setResult] = useState<any>(null)

  const mutation = useMutation({
    mutationFn: () => api.predict({ script, title: title || undefined }),
    onSuccess: (data) => setResult(data),
  })

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold mb-6">AI 预测</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">标题</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="作品标题"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">稿子内容</label>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            className="w-full border rounded px-3 py-2 h-64 font-mono text-sm"
            placeholder="粘贴稿子全文..."
          />
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={!script || mutation.isPending}
          className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {mutation.isPending ? '分析中...' : '开始打分 + 预测'}
        </button>
      </div>

      {result && (
        <div className="mt-8 bg-white rounded-lg p-6 border">
          <h3 className="font-semibold mb-4">预测结果</h3>
          <pre className="text-sm bg-slate-50 p-4 rounded overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
