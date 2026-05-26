import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../api/client'

export default function Settings() {
  const [platform, setPlatform] = useState('fanqie')
  const [cookie, setCookie] = useState('')

  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: api.getStatus,
  })

  const saveMutation = useMutation({
    mutationFn: () => api.updateCookie(platform, cookie),
    onSuccess: () => setCookie(''),
  })

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">设置</h2>

      <div className="bg-white rounded-lg p-6 border mb-6">
        <h3 className="font-semibold mb-4">系统状态</h3>
        {status && (
          <div className="space-y-2 text-sm">
            <div>LLM: {status.llm_configured ? `已配置 (${status.llm_model})` : '未配置'}</div>
            <div>已绑定平台:</div>
            {status.accounts.length === 0 ? (
              <div className="text-slate-500 ml-4">无</div>
            ) : (
              status.accounts.map(a => (
                <div key={a.id} className="ml-4">
                  {a.platform} {a.name && `(${a.name})`} — Cookie {a.cookie_set ? '已设置' : '未设置'}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg p-6 border">
        <h3 className="font-semibold mb-4">更新平台 Cookie</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">平台</label>
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="border rounded px-3 py-2 w-full"
            >
              <option value="fanqie">番茄小说</option>
              <option value="douyin">抖音</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cookie</label>
            <textarea
              value={cookie}
              onChange={e => setCookie(e.target.value)}
              className="w-full border rounded px-3 py-2 h-32 font-mono text-xs"
              placeholder="从浏览器开发者工具复制 Cookie..."
            />
          </div>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!cookie || saveMutation.isPending}
            className="px-4 py-2 bg-slate-800 text-white rounded text-sm disabled:opacity-50"
          >
            保存
          </button>
          {saveMutation.isSuccess && (
            <span className="text-sm text-green-600 ml-3">已保存</span>
          )}
        </div>
      </div>
    </div>
  )
}
