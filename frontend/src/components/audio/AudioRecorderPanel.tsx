import { useRef } from 'react'
import { Mic, Square, RotateCcw, Upload, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { AudioRecordingResult } from '../../hooks/useAudioRecorder'

interface AudioRecorderPanelProps {
  title: string
  minDurationSeconds: number
  maxDurationSeconds: number
  recommendedSeconds?: number
  isRecording: boolean
  elapsedSeconds: number
  audioLevel: number
  recording: AudioRecordingResult | null
  recorderError: string | null
  onStart: () => void
  onStop: () => void
  onRetake: () => void
  onUploadFile: (file: File) => void
  disabled?: boolean
}

export function AudioRecorderPanel({
  title,
  minDurationSeconds,
  maxDurationSeconds,
  recommendedSeconds,
  isRecording,
  elapsedSeconds,
  audioLevel,
  recording,
  recorderError,
  onStart,
  onStop,
  onRetake,
  onUploadFile,
  disabled = false,
}: AudioRecorderPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const durationValid =
    recording !== null &&
    (recording.durationSeconds === 0 ||
      (recording.durationSeconds >= minDurationSeconds &&
        recording.durationSeconds <= maxDurationSeconds))

  const durationTooShort =
    recording !== null && recording.durationSeconds > 0 && recording.durationSeconds < minDurationSeconds

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
          <p className="text-xs text-zinc-500 vl-nums">
            Required duration: {minDurationSeconds}s–{maxDurationSeconds}s
            {recommendedSeconds ? ` (${recommendedSeconds}s+ recommended)` : ''}
          </p>
        </div>
        <div className="text-[11px] font-mono font-medium text-zinc-700 bg-white border border-zinc-200 rounded-full px-2.5 py-0.5 vl-nums">
          {isRecording
            ? `REC ${elapsedSeconds.toFixed(1)}s`
            : recording
              ? `${recording.durationSeconds > 0 ? `${recording.durationSeconds.toFixed(1)}s` : 'Ready'} (${(
                  recording.file.size / 1024
                ).toFixed(0)} KB)`
              : 'No audio'}
        </div>
      </div>

      {isRecording && (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
            <div
              className="h-full bg-zinc-950 transition-all duration-75"
              style={{ width: `${Math.max(6, audioLevel)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-zinc-600 vl-nums">
            <span>
              {elapsedSeconds < minDurationSeconds
                ? `Keep speaking: ${(minDurationSeconds - elapsedSeconds).toFixed(1)}s remaining...`
                : 'Minimum window reached. Stop when finished.'}
            </span>
            <span>Max {maxDurationSeconds}s</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!isRecording ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{recording ? 'Record Again' : 'Start Microphone Recording'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700 transition-colors"
          >
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Stop Recording</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.mp3,.m4a,.flac,.ogg,.opus,.webm,.aiff,audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUploadFile(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={disabled || isRecording}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Upload Audio File</span>
        </button>

        {recording && !isRecording && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRetake}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retake</span>
          </button>
        )}
      </div>

      {recorderError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{recorderError}</span>
        </div>
      )}

      {recording && (
        <div className="space-y-2 rounded-xl border border-zinc-200/80 bg-white p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-zinc-700 truncate">{recording.file.name}</span>
            {durationTooShort ? (
              <span className="inline-flex items-center gap-1 font-medium text-rose-600">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Too short (&lt; {minDurationSeconds}s)
              </span>
            ) : durationValid ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Ready
              </span>
            ) : null}
          </div>
          <audio controls src={recording.url} className="w-full h-9" />
        </div>
      )}
    </div>
  )
}
