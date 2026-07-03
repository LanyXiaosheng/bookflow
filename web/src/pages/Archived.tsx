import ProjectList from '../components/ProjectList'

export default function Archived() {
  return (
    <ProjectList
      status="archived"
      title="归档"
      emptyHint="还没有归档项目。"
    />
  )
}
