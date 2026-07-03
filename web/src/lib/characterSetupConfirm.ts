/**
 * 角色设定「已确认版本」的本地存储。一键全流程会自动确认，
 * 让流程跑完后 UI 不再显示「待确认」。手动流程仍由用户点确认。
 */
const PREFIX = 'bookflow.character-setup-confirmed:'

function key(projectId: string): string {
  return `${PREFIX}${projectId}`
}

export function readConfirmedCharacterSetupVersion(projectId: string): number | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    if (!raw) return null
    const v = Number.parseInt(raw, 10)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export function writeConfirmedCharacterSetupVersion(
  projectId: string,
  version: number | null,
) {
  try {
    if (version === null) {
      localStorage.removeItem(key(projectId))
      return
    }
    localStorage.setItem(key(projectId), String(version))
  } catch {
    // ignore storage write errors
  }
}
