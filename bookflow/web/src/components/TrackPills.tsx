import { splitTrack } from '../lib/tracks'

export default function TrackPills({
  track,
  compact = false,
}: {
  track: string
  compact?: boolean
}) {
  const { primary, plots } = splitTrack(track)

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? '' : 'mt-1'}`} data-testid="track-pills">
      <span
        className={`inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700 ${
          compact ? 'text-[10px]' : 'text-xs'
        } font-medium`}
      >
        {primary}
      </span>
      {plots.map((plot) => (
        <span
          key={plot}
          className={`inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-700 ${
            compact ? 'text-[10px]' : 'text-xs'
          } font-medium`}
        >
          {plot}
        </span>
      ))}
    </div>
  )
}
