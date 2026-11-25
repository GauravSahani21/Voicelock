import { RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react'
import type { AudioRecordingResult } from '../../hooks/useAudioRecorder'

interface AudioPlaybackProps {
  recording: AudioRecordingResult
  minDurationSeconds: number
  onRetake: () => void
  disabled?: boolean
}

export function AudioPlayback({
  recording,
  minDurationSeconds,
  onRetake,
  disabled = false,
}: AudioPlaybackProps) {
  const tooShort = recording.durationSeconds > 0 && recording.durationSeconds < minDurationSeconds

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-700 truncate">
          <span className="font-mono text-zinc-950">{recording.file.name}</span>
          {recording.durationSeconds > 0 && (
            <span className="ml-2 text-zinc-500 vl-nums">({recording.durationSeconds.toFixed(1)}s)</span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {tooShort ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Too short (min {minDurationSeconds}s)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Ready
            </span>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={onRetake}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Record Again</span>
          </button>
        </div>
      </div>

      <audio controls src={recording.url} className="w-full h-9" />
    </div>
  )
}
