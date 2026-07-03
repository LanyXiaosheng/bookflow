export function extractErrorMessage(err: unknown): string {
  if (!err) return '未知错误'
  const anyErr = err as {
    response?: { data?: { detail?: string; error?: string } }
    message?: string
  }
  const data = anyErr.response?.data
  if (data?.detail) return data.detail
  if (data?.error) return data.error
  return anyErr.message ?? String(err)
}
