import DocBrowser from '../components/DocBrowser'
import { playbookApi } from '../api/docs'

export default function Playbook() {
  return (
    <DocBrowser
      title="Playbook 写作手册"
      subtitle="去 AI 味 / 代入感 / 钩子 / 反转 / 精修 / 禁用词表 共 11 篇。写作时一键打开。"
      list={playbookApi.list}
      read={playbookApi.get}
      cacheKey="playbook"
    />
  )
}
