import ProjectList from '../components/ProjectList'

export default function Projects() {
  return (
    <ProjectList
      status="writing"
      title="写作中的项目"
      emptyHint="还没有项目。先去「选题」立项一个标题。"
    />
  )
}
