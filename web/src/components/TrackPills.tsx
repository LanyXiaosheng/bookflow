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
        className={`inline-flex items-center rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-blue-300 ${
          compact ? 'text-[10px]' : 'text-xs'
        } font-medium`}
      >
        {primary}
      </span>
      {plots.map((plot) => (
        <span
          key={plot}
          className={`inline-flex items-center rounded-full border border-violet-400/20 bg-violet-500/15 px-2.5 py-1 text-violet-300 ${
            compact ? 'text-[10px]' : 'text-xs'
          } font-medium`}
        >
          {plot}
        </span>
      ))}
    </div>
  )
}
