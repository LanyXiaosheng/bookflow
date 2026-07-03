import ProjectList from '../components/ProjectList'

export default function Ready() {
  return (
    <ProjectList
      status="ready"
      title="待发"
      emptyHint="还没有定稿等待发布的项目。"
    />
  )
}
