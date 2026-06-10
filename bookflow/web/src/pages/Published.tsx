import ProjectList from '../components/ProjectList'

export default function Published() {
  return (
    <ProjectList
      status="published"
      includeStatuses={['published', 'archived']}
      title="已发"
      emptyHint="暂无已发布作品。"
    />
  )
}
