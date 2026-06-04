import ProjectList from '../components/ProjectList'

export default function Published() {
  return (
    <ProjectList
      status="published"
      title="已发布"
      emptyHint="暂无已发布作品。"
    />
  )
}
