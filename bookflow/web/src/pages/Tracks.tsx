import DocBrowser from '../components/DocBrowser'
import { tracksApi } from '../api/docs'

export default function Tracks() {
  return (
    <DocBrowser
      title="赛道库"
      subtitle="4 个赛道的死局公式、常见反杀、标签体系。立项前先选赛道。"
      list={tracksApi.list}
      read={tracksApi.get}
      cacheKey="tracks"
    />
  )
}
