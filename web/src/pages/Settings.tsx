import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Brain,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ServerCog,
  TriangleAlert,
} from 'lucide-react'
import { settingsApi, type SettingsPatch, type SettingsView } from '../api/settings'

const PROVIDERS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'anthropic', label: 'Anthropic（Claude）', hint: '官方 / 兼容 /v1/messages' },
  { value: 'openai', label: 'OpenAI（兼容）', hint: '走 /v1/chat/completions，response_format=json_object' },
  { value: 'deepseek', label: 'DeepSeek（ccswitch 中转）', hint: '走 Anthropic Messages 协议 /v1/messages，适合 ccswitch 类中转' },
]

const MODEL_HINTS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'],
}

const IMAGE_MODEL_HINTS: Record<string, string[]> = {
  anthropic: ['当前 provider 不支持生图'],
  openai: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1-mini'],
  deepseek: ['配置多米 API Key 后由多米生图'],
}

export default function Settings() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get() })

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-6 sm:mb-8">
        <h1 className="text-3xl font-bold text-white">设置</h1>
        <p className="mt-2 text-sm text-gray-400">
          配置选题加速 / AI 写作 / 去 AI 味要用的大模型 API。改完保存即生效，不用重启。
        </p>
      </header>

      <section className="glass-card overflow-hidden">
        <div className="flex items-start gap-3 border-b border-white/10 px-4 py-4 sm:items-center sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300">
            <Brain className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">LLM API 接入</h2>
            <p className="mt-1 text-xs text-gray-400">
              支持 Anthropic Messages 协议 / OpenAI Chat Completions 兼容协议
            </p>
          </div>
        </div>

        {settings.isLoading && (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-gray-400 sm:px-6">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中
          </div>
        )}
        {settings.isError && (
          <div className="m-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 sm:m-6">
            加载失败：{(settings.error as Error)?.message}
          </div>
        )}
        {settings.data && (
          <SettingsForm
            initial={settings.data}
            onSaved={(d) => qc.setQueryData(['settings'], d)}
          />
        )}
      </section>

      <section className="glass-inset mt-6 overflow-hidden p-4 text-sm text-gray-400 sm:p-5">
        <div className="flex items-center gap-2 font-medium text-gray-100">
          <ServerCog className="h-4 w-4" /> 部署提示
        </div>
        <ul className="mt-2 list-disc space-y-1 break-words pl-5">
          <li>API Key 仅以掩码方式回显；保存后只能整体覆盖，不能查看明文。</li>
          <li>
            当前服务从 .env 读取初始值并写入数据库；之后所有改动都走数据库，重启后保持新值。
          </li>
          <li>
            <code className="break-all rounded bg-white/5 px-1.5 py-0.5 text-xs text-gray-200 ring-1 ring-white/10">
              base_url
            </code>{' '}
            末尾不要带斜杠也不要带{' '}
            <code className="break-all rounded bg-white/5 px-1.5 py-0.5 text-xs text-gray-200 ring-1 ring-white/10">
              /v1/...
            </code>
            ，框架会自己补。
          </li>
        </ul>
      </section>
    </main>
  )
}

function SettingsForm({
  initial,
  onSaved,
}: {
  initial: SettingsView
  onSaved: (s: SettingsView) => void
}) {
  const [provider, setProvider] = useState(initial.provider)
  const [baseUrl, setBaseUrl] = useState(initial.base_url)
  const [model, setModel] = useState(initial.model)
  const [imageModel, setImageModel] = useState(initial.image_model)
  const [duomiapiKey, setDuomiapiKey] = useState('')
  const [timeoutSecs, setTimeoutSecs] = useState(initial.timeout_secs)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  // 切 provider 时帮用户填一个常见 model（如果当前 model 跟新 provider 不像匹配）
  useEffect(() => {
    if (provider === initial.provider) return
    const hints = MODEL_HINTS[provider] ?? []
    if (!hints.includes(model)) setModel(hints[0] ?? model)
  }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => settingsApi.update(patch),
    onSuccess: (data) => {
      onSaved(data)
      setApiKey('')
    },
  })

  const dirty = useMemo(() => {
    if (provider !== initial.provider) return true
    if (baseUrl !== initial.base_url) return true
    if (model !== initial.model) return true
    if (imageModel !== initial.image_model) return true
    if (timeoutSecs !== initial.timeout_secs) return true
    if (apiKey.length > 0) return true
    if (duomiapiKey.length > 0) return true
    return false
  }, [provider, baseUrl, model, imageModel, timeoutSecs, apiKey, duomiapiKey, initial])

  const handleSave = () => {
    const patch: SettingsPatch = {
      provider: provider !== initial.provider ? provider : undefined,
      base_url: baseUrl !== initial.base_url ? baseUrl : undefined,
      model: model !== initial.model ? model : undefined,
      image_model: imageModel !== initial.image_model ? imageModel : undefined,
      timeout_secs: timeoutSecs !== initial.timeout_secs ? timeoutSecs : undefined,
      api_key: apiKey || undefined,
      duomiapi_key: duomiapiKey || undefined,
    }
    save.mutate(patch)
  }

  return (
    <form
      className="grid min-w-0 gap-5 p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty) handleSave()
      }}
    >
      <Field label="协议" htmlFor="provider">
        <select
          id="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="block min-w-0 w-full max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          {PROVIDERS.find((p) => p.value === provider)?.hint}
        </p>
      </Field>

      <Field label="Base URL" htmlFor="base_url">
        <input
          id="base_url"
          type="url"
          required
          placeholder={
            provider === 'anthropic'
              ? 'https://api.anthropic.com'
              : 'https://api.openai.com'
          }
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="block min-w-0 w-full max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 placeholder:text-white/40 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
        />
      </Field>

      <Field label="API Key" htmlFor="api_key">
        {initial.has_api_key && (
          <div
            id="api_key_masked"
            className="mb-2 inline-flex max-w-full items-center gap-2 break-all rounded-md bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-gray-400 ring-1 ring-white/10"
          >
            <Check className="h-3.5 w-3.5 text-emerald-300" />
            当前：{initial.api_key_masked}
          </div>
        )}
        <div className="relative">
          <input
            id="api_key"
            type={showKey ? 'text' : 'password'}
            placeholder={initial.has_api_key ? '留空 = 不变；粘贴新值覆盖' : '粘贴新 key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="block min-w-0 w-full max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 pr-10 text-sm text-gray-100 placeholder:text-white/40 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
            aria-label={showKey ? '隐藏' : '显示'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">留空 = 保留现有 key 不变。粘贴新值即覆盖。</p>
      </Field>

      <Field label="模型" htmlFor="model">
        <input
          id="model"
          type="text"
          required
          list="model-hints"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="block min-w-0 w-full max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 placeholder:text-white/40 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        <datalist id="model-hints">
          {(MODEL_HINTS[provider] ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      <Field label="图片模型" htmlFor="image_model">
        <input
          id="image_model"
          type="text"
          required
          list="image-model-hints"
          value={imageModel}
          onChange={(e) => setImageModel(e.target.value)}
          className="block min-w-0 w-full max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 placeholder:text-white/40 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        <datalist id="image-model-hints">
          {(IMAGE_MODEL_HINTS[provider] ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="mt-1 text-xs text-gray-500">
          小说配图使用的模型。若配置了多米 API Key，此处填多米支持的模型（如 gpt-image-2、nano-banana）；否则走 OpenAI image 端点，仅在 OpenAI provider 下生效。
        </p>
      </Field>

      <Field label="多米 API Key" htmlFor="duomiapi_key">
        {initial.duomiapi_key_set && (
          <div className="mb-2 inline-flex max-w-full items-center gap-2 break-all rounded-md bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-gray-400 ring-1 ring-white/10">
            <Check className="h-3.5 w-3.5 text-emerald-300" />
            当前：{initial.duomiapi_key_masked}
          </div>
        )}
        <input
          id="duomiapi_key"
          type="password"
          placeholder={initial.duomiapi_key_set ? '留空 = 不变；粘贴新值覆盖' : '粘贴多米 API Key'}
          value={duomiapiKey}
          onChange={(e) => setDuomiapiKey(e.target.value)}
          className="block min-w-0 w-full max-w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 placeholder:text-white/40 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        <p className="mt-1 text-xs text-gray-500">
          配置后生图走<a href="https://duomiapi.com" target="_blank" rel="noopener noreferrer" className="text-blue-300 underline hover:text-blue-200">多米 API</a>，不受 provider 限制。key 仅以掩码方式回显，不能查看明文。
        </p>
      </Field>

      <Field label="超时（秒）" htmlFor="timeout_secs">
        <input
          id="timeout_secs"
          type="number"
          min={5}
          max={600}
          value={timeoutSecs}
          onChange={(e) => setTimeoutSecs(parseInt(e.target.value, 10) || 60)}
          className="block w-full max-w-[8rem] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-100 placeholder:text-white/40 transition-colors focus:border-white/25 focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        <p className="mt-1 text-xs text-gray-500">单次 LLM 请求超时。改了下次新建客户端时生效。</p>
      </Field>

      <div className="flex flex-col items-stretch gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={!dirty || save.isPending}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:bg-white/10 disabled:text-gray-500 sm:w-auto"
        >
          {save.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          保存
        </button>
        {save.isSuccess && !save.isPending && (
          <span className="inline-flex items-center break-words text-sm text-emerald-300">
            <Check className="mr-1 h-4 w-4" /> 已保存并生效
          </span>
        )}
        {save.isError && (
          <span className="inline-flex items-center break-words text-sm text-red-300">
            <TriangleAlert className="mr-1 h-4 w-4" />
            {(save.error as Error).message}
          </span>
        )}
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-200">
        {label}
      </label>
      {children}
    </div>
  )
}
