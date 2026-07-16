import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BarChart3, CheckCircle2, Download, Loader2, Save, XCircle, Zap } from 'lucide-react'
import { projectsApi, type Project } from '../api/projects'
import { reviewsApi, type FanqieFetchAllResult, type FanqieFetchFromCurlResult, type QuickBatchItemResult } from '../api/reviews'

// --- Fanqie JSON types ---

interface FanqieCategory {
  name: string
}

interface FanqieItem {
  book_id: string
  multi_title: string[]
  read_count: string
  word_number: number
  is_data_show: number
  category: FanqieCategory[]
  sign_status: number
  sign_status_text: string
}

interface FanqiePayload {
  item_list: FanqieItem[]
}

// --- Parsed item used throughout analysis ---

interface ParsedItem {
  title: string
  reads: number
  words: number
  dataShown: boolean
  categories: string[]
  signed: boolean
}

interface AnalysisResult {
  items: ParsedItem[]
  totalWords: number
  avgWords: number
  totalReads: number
  avgReads: number
  dataShownCount: number
  dataHiddenCount: number
  avgReadsShown: number
  avgReadsHidden: number
  top5: ParsedItem[]
  bottom5: ParsedItem[]
  categoryFreq: Array<{ name: string; count: number }>
  wordBuckets: Array<{ range: string; count: number; pct: number }>
  hits: ParsedItem[]
  misses: ParsedItem[]
  formulaResults: Array<{ title: string; reads: number; formulas: string[] }>
}

// --- Parsing ---

function parseFanqieJson(raw: string): ParsedItem[] {
  // Try FanqieFetchAllResult format first
  try {
    const d = JSON.parse(raw) as FanqieFetchAllResult
    if (d.items && Array.isArray(d.items) && d.items.length > 0 && typeof d.items[0].book_id === 'string') {
      return d.items.map((item) => ({
        title: item.title,
        reads: item.read_count,
        words: item.word_number,
        dataShown: true,
        categories: item.categories,
        signed: true,
      }))
    }
  } catch { /* fall through */ }

  let data: FanqiePayload
  try {
    data = JSON.parse(raw)
  } catch {
    // if pasted as raw array or progressive, try wrapping
    throw new Error('JSON 格式错误，请粘贴完整的番茄 API 返回数据（含 item_list 字段）')
  }
  if (!data.item_list || !Array.isArray(data.item_list)) {
    throw new Error('数据格式不正确：缺少 item_list 数组')
  }
  return data.item_list.map((item) => ({
    title: item.multi_title?.[0] ?? '(无标题)',
    reads: parseInt(item.read_count, 10) || 0,
    words: item.word_number || 0,
    dataShown: item.is_data_show === 1,
    categories: (item.category || []).map((c) => c.name),
    signed: item.sign_status === 5,
  }))
}

// --- Analysis ---

function detectFormulas(title: string): string[] {
  const formulas: string[] = []
  if (/那天|这夜|第一天|这天|当天|那夜|这天，|那天，/.test(title)) formulas.push('时间锚点')
  if (/白月光/.test(title)) formulas.push('白月光')
  if (/我先|我转身|我把|我靠|我当众|我群发/.test(title)) formulas.push('反杀动作')
  if (/才知道|才知道，|才知道他|才知道她/.test(title)) formulas.push('真相揭示')
  if (/当众|群发|热搜|全网|全公司/.test(title)) formulas.push('公开处刑')
  if (/离婚|离婚协议|离婚申请/.test(title)) formulas.push('离婚')
  if (/出狱|替.*坐牢|坐牢/.test(title)) formulas.push('监狱')
  return formulas
}

function analyze(items: ParsedItem[]): AnalysisResult {
  const sortedByReads = [...items].sort((a, b) => b.reads - a.reads)
  const totalWords = items.reduce((s, i) => s + i.words, 0)
  const totalReads = items.reduce((s, i) => s + i.reads, 0)
  const shown = items.filter((i) => i.dataShown)
  const hidden = items.filter((i) => !i.dataShown)
  const avgReadsShown = shown.length > 0 ? shown.reduce((s, i) => s + i.reads, 0) / shown.length : 0
  const avgReadsHidden = hidden.length > 0 ? hidden.reduce((s, i) => s + i.reads, 0) / hidden.length : 0

  // Category frequency
  const catMap = new Map<string, number>()
  for (const item of items) {
    for (const c of item.categories) {
      catMap.set(c, (catMap.get(c) || 0) + 1)
    }
  }
  const categoryFreq = [...catMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Word count buckets
  const buckets: Record<string, number> = { '<8k': 0, '8k-12k': 0, '12k-16k': 0, '16k-20k': 0, '>20k': 0 }
  for (const item of items) {
    if (item.words < 8000) buckets['<8k']++
    else if (item.words < 12000) buckets['8k-12k']++
    else if (item.words < 16000) buckets['12k-16k']++
    else if (item.words < 20000) buckets['16k-20k']++
    else buckets['>20k']++
  }
  const wordBuckets = Object.entries(buckets).map(([range, count]) => ({
    range,
    count,
    pct: items.length > 0 ? (count / items.length) * 100 : 0,
  }))

  const hits = sortedByReads.filter((i) => i.reads > 100)
  const misses = sortedByReads.filter((i) => i.reads < 10)

  const formulaResults = sortedByReads.slice(0, 8).map((i) => ({
    title: i.title,
    reads: i.reads,
    formulas: detectFormulas(i.title),
  }))

  return {
    items,
    totalWords,
    avgWords: items.length > 0 ? totalWords / items.length : 0,
    totalReads,
    avgReads: items.length > 0 ? totalReads / items.length : 0,
    dataShownCount: shown.length,
    dataHiddenCount: hidden.length,
    avgReadsShown,
    avgReadsHidden,
    top5: sortedByReads.slice(0, 5),
    bottom5: sortedByReads.slice(-5).reverse(),
    categoryFreq,
    wordBuckets,
    hits,
    misses,
    formulaResults,
  }
}

function generateFindings(result: AnalysisResult): string[] {
  const findings: string[] = []

  // Top formula patterns
  const formulasWithHits = result.formulaResults.filter((f) => f.formulas.length > 0 && f.reads > 50)
  if (formulasWithHits.length > 0) {
    const topFormulas = new Map<string, number>()
    for (const f of formulasWithHits) {
      for (const formula of f.formulas) {
        topFormulas.set(formula, (topFormulas.get(formula) || 0) + 1)
      }
    }
    const sorted = [...topFormulas.entries()].sort((a, b) => b[1] - a[1])
    const top3 = sorted.slice(0, 3).map(([n]) => n).join(' + ')
    findings.push(`爆款公式：「${top3}」组合效果最好，TOP 作品中高频出现`)
  }

  // Data show gap
  if (result.avgReadsShown > result.avgReadsHidden * 3 && result.dataHiddenCount > 0) {
    findings.push(
      `数据开关差距：is_data_show=1 平均 ${result.avgReadsShown.toFixed(0)} 读 vs =0 平均 ${result.avgReadsHidden.toFixed(0)} 读，建议打开未显示的作品数据开关`
    )
  }

  // Word count
  const tooShort = result.items.filter((i) => i.words < 7000)
  if (tooShort.length > 0) {
    findings.push(`${tooShort.length} 篇低于 7000 字，字数过少可能影响推荐，建议补足`)
  }

  // Misses pattern
  const missCategories = new Map<string, number>()
  for (const m of result.misses) {
    for (const c of m.categories.slice(0, 3)) {
      missCategories.set(c, (missCategories.get(c) || 0) + 1)
    }
  }
  const topMissCat = [...missCategories.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topMissCat && topMissCat[1] >= 2) {
    findings.push(`低效赛道：「${topMissCat[0]}」方向多篇低阅读，建议暂停或调整`)
  }

  // Category concentration
  const topCat = result.categoryFreq[0]
  if (topCat && topCat.count > result.items.length * 0.5) {
    findings.push(`标签高度集中：「${topCat.name}」覆盖 ${((topCat.count / result.items.length) * 100).toFixed(0)}% 作品，缺少标签多样性`)
  }

  if (findings.length === 0) {
    findings.push('数据量不足，暂无明确发现。建议积累更多作品数据后再复盘。')
  }

  return findings
}

function generateActions(result: AnalysisResult): string[] {
  const actions: string[] = []

  if (result.dataHiddenCount > 3) {
    actions.push(`打开 ${result.dataHiddenCount} 篇未显示作品的数据开关，观察 48h 数据变化`)
  }

  const topFormulas = result.formulaResults.filter((f) => f.formulas.length > 0 && f.reads > 100)
  if (topFormulas.length > 0) {
    const f = topFormulas[0]
    actions.push(`批量复制「${f.formulas.join(' + ')}」标题结构，该公式验证有效`)
  }

  const under8k = result.items.filter((i) => i.words < 8000).length
  if (under8k > 0) {
    actions.push(`${under8k} 篇低于 8000 字需立即补字，低于阈值影响推荐权重`)
  }

  // Check for sci-fi / tech categories with low reads
  const sciFiMisses = result.items.filter(
    (i) =>
      i.reads < 30 &&
      i.categories.some((c) => ['科幻', '男频脑洞', '末世求生'].includes(c))
  )
  if (sciFiMisses.length > 0) {
    actions.push('科幻/技术/末世类题材在女频持续低效，建议砍掉此方向')
  }

  // Ancient vs modern
  const ancientHits = result.hits.filter((i) =>
    i.categories.some((c) => ['古代', '宫斗宅斗', '古风世情'].includes(c))
  )
  if (ancientHits.length === 0 && result.misses.some((i) => i.categories.some((c) => ['古代', '宫斗宅斗', '古风世情'].includes(c)))) {
    actions.push('古代题材整体偏冷，集中产能到现言婚恋/职场赛道')
  }

  if (actions.length === 0) {
    actions.push('继续按当前公式稳定产出，下一个复盘周期对比变化')
  }

  return actions
}

// --- Component ---

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs font-medium text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

function MiniTable({
  title,
  headers,
  rows,
}: {
  title: string
  headers: string[]
  rows: React.ReactNode[][]
}) {
  return (
    <div className="glass-card">
      <div className="border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02]">
              {headers.map((h) => (
                <th key={h} className="px-4 py-2 text-xs font-medium text-gray-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.06] last:border-0 hover:bg-white/5">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function QuickRetro() {
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [batchResults, setBatchResults] = useState<Map<string, QuickBatchItemResult>>(new Map())
  const [cookiesInput, setCookiesInput] = useState('')
  const [curlInput, setCurlInput] = useState('')

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const saveBatch = useMutation({
    mutationFn: (items: Array<{ title: string; read_count: number; word_number: number; categories: string[] }>) =>
      reviewsApi.quickBatch(items),
    onSuccess: (data) => {
      const map = new Map<string, QuickBatchItemResult>()
      for (const r of data) {
        map.set(r.title, r)
      }
      setBatchResults(map)
      qc.invalidateQueries({ queryKey: ['reviews', 'pending'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Invalidate each matched project's review cache too
      for (const r of data) {
        if (r.project_id) {
          qc.invalidateQueries({ queryKey: ['reviews', 'project', r.project_id] })
        }
      }
    },
  })

  const fanqieFetch = useMutation({
    mutationFn: (cookies: string) => reviewsApi.fanqieFetchAll(cookies),
    onSuccess: (data: FanqieFetchAllResult) => {
      // Convert Fanqie items to ParsedItem[] and run analysis
      const parsed: ParsedItem[] = data.items.map((item) => ({
        title: item.title,
        reads: item.read_count,
        words: item.word_number,
        dataShown: true,
        categories: item.categories,
        signed: true,
      }))
      setResult(analyze(parsed))
      setRaw(JSON.stringify(data))
      // 自动落库
      saveBatch.mutate(
        data.items.map((item) => ({
          title: item.title,
          read_count: item.read_count,
          word_number: item.word_number,
          categories: item.categories,
          show_count: item.show_count,
          comment_count: item.comment_count,
          like_count: item.like_count,
          library_count: item.library_count,
          completion_rate: item.completion_rate,
        })),
      )
    },
  })

  const fanqieFetchFromCurl = useMutation({
    mutationFn: (curl: string) => reviewsApi.fanqieFetchFromCurl(curl, '7d'),
    onSuccess: (data: FanqieFetchFromCurlResult) => {
      const parsed: ParsedItem[] = data.items.map((item) => ({
        title: item.title,
        reads: item.read_count,
        words: item.word_number,
        dataShown: true,
        categories: item.categories,
        signed: true,
      }))
      setResult(analyze(parsed))
      setRaw(JSON.stringify(data))
      const map = new Map<string, QuickBatchItemResult>()
      for (const r of data.batch_results) map.set(r.title, r)
      setBatchResults(map)
      qc.invalidateQueries({ queryKey: ['reviews', 'pending'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      for (const r of data.batch_results) {
        if (r.project_id) {
          qc.invalidateQueries({ queryKey: ['reviews', 'project', r.project_id] })
        }
      }
    },
  })

  const handleParse = () => {
    setError('')
    setResult(null)
    if (!raw.trim()) {
      setError('请粘贴 JSON 数据')
      return
    }
    setParsing(true)
    // brief delay so spinner renders before heavy parse
    setTimeout(() => {
      try {
        const items = parseFanqieJson(raw.trim())
        if (items.length === 0) {
          setError('解析到 0 条作品，请检查数据')
        } else {
          setResult(analyze(items))
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '解析失败')
      }
      setParsing(false)
    }, 50)
  }

  // Build project title -> id map for fuzzy matching
  const projectIndex = useMemo(() => {
    if (!projects.data) return new Map<string, Project>()
    const map = new Map<string, Project>()
    for (const p of projects.data) {
      map.set(p.title, p)
    }
    return map
  }, [projects.data])

  const matchProject = (title: string): Project | undefined => {
    // exact match first
    const exact = projectIndex.get(title)
    if (exact) return exact
    // substring match (project title contains parsed title or vice versa)
    for (const [pt, p] of projectIndex) {
      if (pt.includes(title) || title.includes(pt)) return p
    }
    return undefined
  }

  const fmt = (n: number): string => n.toLocaleString('zh-CN')

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/review"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
          >
            <ArrowLeft className="h-4 w-4" />
            返回复盘
          </Link>
          <h1 className="text-2xl font-semibold text-white">快捷复盘</h1>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
            一键抓取 + 自动落库
          </span>
        </div>
        {result && (
          <button
            type="button"
            onClick={() =>
              saveBatch.mutate(
              result.items.map((i) => ({
                title: i.title,
                read_count: i.reads,
                word_number: i.words,
                categories: i.categories,
                completion_rate: null,
                show_count: null,
                comment_count: null,
                like_count: null,
                library_count: null,
              })),
            )
          }
            disabled={saveBatch.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            data-testid="quick-retro-save-btn"
          >
            {saveBatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            落库
          </button>
        )}
      </div>

      {/* Input */}
      <div className="glass-card p-5">
        <label htmlFor="quick-retro-curl" className="block text-sm font-medium text-gray-200 mb-2">
          方式零：粘贴作品列表 curl（推荐，自动提取 book_id 批量抓详情并补录到 7d）
        </label>
        <textarea
          id="quick-retro-curl"
          rows={6}
          value={curlInput}
          onChange={(e) => setCurlInput(e.target.value)}
          placeholder={`curl 'https://fanqienovel.com/api/author/short_article/list/v0/?aid=2503&...' \\\n  -H 'accept: application/json, text/plain, */*' \\\n  -b 'sessionid=...'`}
          className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-mono text-gray-100 outline-none transition-colors placeholder:text-white/40 focus:border-white/25 resize-y"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (curlInput.trim()) fanqieFetchFromCurl.mutate(curlInput.trim())
            }}
            disabled={fanqieFetchFromCurl.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {fanqieFetchFromCurl.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            解析 curl 并补录 7d
          </button>
          {curlInput && (
            <button
              type="button"
              onClick={() => setCurlInput('')}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              清空 curl
            </button>
          )}
        </div>
        {fanqieFetchFromCurl.isError && (
          <div className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {fanqieFetchFromCurl.error instanceof Error ? fanqieFetchFromCurl.error.message : 'curl 解析/抓取失败'}
          </div>
        )}
        {fanqieFetchFromCurl.isSuccess && (
          <div className="mt-3 text-sm text-emerald-600">
            curl 抓取完成：{fanqieFetchFromCurl.data.total_count} 本，明细成功 {fanqieFetchFromCurl.data.detail_success}，失败 {fanqieFetchFromCurl.data.detail_failed}，已按标题精确匹配补录到 {fanqieFetchFromCurl.data.stage}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-white/[0.06]">
        <label htmlFor="quick-retro-json" className="block text-sm font-medium text-gray-200 mb-2">
          方式一：粘贴 Cookies 一键抓取（先打开番茄后台确认已登录，再粘贴 Cookie 字符串）
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={cookiesInput}
            onChange={(e) => setCookiesInput(e.target.value)}
            placeholder="bd_sso_hi3jfd=...; csrf_session_id=...; sessionid=...; passport_csrf_token=..."
            className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-mono text-gray-100 outline-none transition-colors placeholder:text-white/40 focus:border-white/25"
          />
          <button
            type="button"
            onClick={() => {
              if (cookiesInput.trim()) fanqieFetch.mutate(cookiesInput.trim())
            }}
            disabled={fanqieFetch.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {fanqieFetch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            一键抓取
          </button>
        </div>
        {fanqieFetch.isError && (
          <div className="mt-2 text-sm text-rose-600">
            {fanqieFetch.error instanceof Error ? fanqieFetch.error.message : '抓取失败，请检查 Cookie 是否有效'}
          </div>
        )}
        {fanqieFetch.isSuccess && (
          <div className="mt-2 text-sm text-emerald-600">
            抓取完成：{fanqieFetch.data.total_count} 本，明细成功 {fanqieFetch.data.detail_success}，失败 {fanqieFetch.data.detail_failed}
            {fanqieFetch.data.errors.length > 0 && (
              <span className="text-amber-600 ml-2">
                ({fanqieFetch.data.errors.slice(0, 3).join('; ')})
              </span>
            )}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-white/10">
        <label htmlFor="quick-retro-json" className="block text-sm font-medium text-gray-200 mb-2">
          方式二：直接粘贴 JSON 数据
        </label>
        <textarea
          id="quick-retro-json"
          data-testid="quick-retro-json"
          rows={8}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`{"item_list": [{"multi_title": ["标题"], "read_count": "123", ...}]}`}
          className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-mono text-gray-100 outline-none transition-colors placeholder:text-white/40 focus:border-white/25 resize-y"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleParse}
            disabled={parsing}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            data-testid="quick-retro-parse-btn"
          >
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            解析
          </button>
          {raw && (
            <button
              type="button"
              onClick={() => { setRaw(''); setResult(null); setError('') }}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              清空
            </button>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300" data-testid="quick-retro-error">
            {error}
          </div>
        )}
        {saveBatch.isError && (
          <div className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {saveBatch.error instanceof Error ? saveBatch.error.message : '落库失败'}
          </div>
        )}
        {saveBatch.isSuccess && (
          <div className="mt-3 text-sm text-emerald-600">
            落库完成：{saveBatch.data.filter((r) => r.updated).length} 条写入，
            {saveBatch.data.filter((r) => !r.updated).length} 条跳过
          </div>
        )}
      </div>
      </div>
    </div>

    {/* Results */}
      {result && (
        <div className="mt-6 space-y-6">
          {/* Overview cards */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-400" />
              概览
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <StatCard label="作品数" value={String(result.items.length)} />
              <StatCard label="总字数" value={fmt(result.totalWords)} />
              <StatCard label="平均字数/篇" value={fmt(Math.round(result.avgWords))} />
              <StatCard label="总阅读量" value={fmt(result.totalReads)} />
              <StatCard
                label="数据显示(ON)"
                value={`${result.dataShownCount}`}
                sub={`均读 ${fmt(Math.round(result.avgReadsShown))}`}
                color={result.avgReadsShown > 100 ? 'text-emerald-300' : 'text-white'}
              />
              <StatCard
                label="数据隐藏(OFF)"
                value={`${result.dataHiddenCount}`}
                sub={`均读 ${fmt(Math.round(result.avgReadsHidden))}`}
                color={result.dataHiddenCount > result.dataShownCount ? 'text-amber-300' : 'text-white'}
              />
            </div>
          </div>

          {/* TOP / BOTTOM tables */}
          <div className="grid gap-6 lg:grid-cols-2">
            <MiniTable
              title="TOP 5 阅读量"
              headers={['#', '标题', '阅读', '字数', '公式', '落库']}
              rows={result.top5.map((item, i) => {
                const br = batchResults.get(item.title)
                return [
                <span key="r" className="font-medium text-gray-100">{i + 1}</span>,
                <span key="t" className="text-gray-100 max-w-[200px] truncate block">
                  {matchProject(item.title) ? (
                    <Link
                      to={`/projects/${matchProject(item.title)!.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </span>,
                <span key="rc" className={item.reads > 100 ? 'font-semibold text-emerald-300' : 'text-gray-400'}>
                  {fmt(item.reads)}
                </span>,
                <span key="wc" className="text-gray-400">{fmt(item.words)}</span>,
                <span key="fm" className="text-xs text-gray-400">
                  {detectFormulas(item.title).join(' · ') || '-'}
                </span>,
                <span key="st">
                  {br ? (
                    br.updated ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />已写入
                      </span>
                    ) : br.skip_reason === 'title_not_found' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <XCircle className="h-3 w-3" />未匹配
                      </span>
                    ) : br.skip_reason === 'not_published' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500">
                        <XCircle className="h-3 w-3" />未发布
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-400">-</span>
                    )
                  ) : (
                    <span className="text-xs text-gray-300">-</span>
                  )}
                </span>,
              ]})}
            />

            <MiniTable
              title="BOTTOM 5 阅读量"
              headers={['#', '标题', '阅读', '字数', '分类']}
              rows={result.bottom5.map((item) => [
                <span key="r" className="font-medium text-gray-400">
                  {result.items.length - result.bottom5.indexOf(item)}
                </span>,
                <span key="t" className="text-gray-300 max-w-[200px] truncate block">
                  {matchProject(item.title) ? (
                    <Link
                      to={`/projects/${matchProject(item.title)!.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </span>,
                <span key="rc" className="text-red-500">{item.reads}</span>,
                <span key="wc" className="text-gray-400">{fmt(item.words)}</span>,
                <span key="ca" className="text-xs text-gray-400">
                  {item.categories.slice(0, 3).join(' / ')}
                </span>,
              ])}
            />
          </div>

          {/* Category frequency */}
          <MiniTable
            title="分类标签频次 TOP 10"
            headers={['标签', '出现次数', '覆盖率']}
            rows={result.categoryFreq.map((c) => [
              <span key="n" className="text-gray-100">{c.name}</span>,
              <span key="ct" className="font-medium text-gray-200">{c.count}</span>,
              <span key="p" className="text-xs text-gray-400">
                {((c.count / result.items.length) * 100).toFixed(0)}%
              </span>,
            ])}
          />

          {/* Word count distribution */}
          <MiniTable
            title="字数分布"
            headers={['区间', '篇数', '占比']}
            rows={result.wordBuckets.map((b) => [
              <span key="r" className="text-gray-100">{b.range}</span>,
              <span key="c" className="font-medium text-gray-200">{b.count}</span>,
              <span key="p" className="text-gray-400">
                <span className="inline-block w-16 align-middle mr-2 rounded-full bg-white/10">
                  <span
                    className="block h-1.5 rounded-full bg-blue-500"
                    style={{ width: `${Math.max(b.pct, 2)}%` }}
                  />
                </span>
                {b.pct.toFixed(0)}%
              </span>,
            ])}
          />

          {/* Title formula breakdown */}
          <MiniTable
            title="标题公式检测（TOP 8 阅读量）"
            headers={['阅读', '标题', '检测到的公式']}
            rows={result.formulaResults.map((f) => [
              <span key="r" className={f.reads > 100 ? 'font-semibold text-emerald-300' : 'text-gray-300'}>
                {fmt(f.reads)}
              </span>,
              <span key="t" className="text-gray-100 max-w-[280px] truncate block">{f.title}</span>,
              <span key="fm" className="text-xs">
                {f.formulas.length > 0
                  ? f.formulas.map((tag) => (
                      <span
                        key={tag}
                        className="mr-1 inline-block rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300"
                      >
                        {tag}
                      </span>
                    ))
                  : <span className="text-gray-400">-</span>}
              </span>,
            ])}
          />

          {/* Key findings */}
          <div className="glass-card">
            <div className="border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">核心发现</h3>
            </div>
            <div className="px-4 py-3">
              <ul className="space-y-2">
                {generateFindings(result).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                    <span className="mt-0.5 shrink-0 text-blue-400">•</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Action items */}
          <div className="glass-card border-emerald-400/20 bg-emerald-500/[0.07]">
            <div className="border-b border-emerald-400/20 px-4 py-3">
              <h3 className="text-sm font-semibold text-emerald-300">行动建议</h3>
            </div>
            <div className="px-4 py-3">
              <ul className="space-y-2">
                {generateActions(result).map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-emerald-200">
                    <span className="mt-0.5 shrink-0 font-bold">{i + 1}.</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !error && (
        <div className="mt-6 rounded-lg border border-dashed border-white/10 px-4 py-12 text-center text-sm text-gray-500">
          粘贴番茄作品列表 JSON 数据，点击"解析"查看快捷复盘报告
        </div>
      )}
    </main>
  )
}
