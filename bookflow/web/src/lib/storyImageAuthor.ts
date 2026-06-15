/**
 * 小说配图的作者署名设置（作者名 + 是否署名）本地持久化，按项目区分。
 * 让用户填好作者、生图后离开再回来，输入不丢。
 */
const PREFIX = 'bookflow.story-image-author:'

interface StoredAuthor {
  authorName: string
  showAuthor: boolean
}

function key(projectId: string): string {
  return `${PREFIX}${projectId}`
}

export function readStoryImageAuthor(projectId: string): StoredAuthor | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<StoredAuthor>
    if (typeof v.authorName !== 'string') return null
    return { authorName: v.authorName, showAuthor: !!v.showAuthor }
  } catch {
    return null
  }
}

export function writeStoryImageAuthor(projectId: string, value: StoredAuthor) {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(value))
  } catch {
    // ignore storage write errors
  }
}
