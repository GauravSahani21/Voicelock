import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Upload, AlertCircle, ShieldCheck } from 'lucide-react'
import type { AudioRecordingResult } from '../../hooks/useAudioRecorder'
import { AudioPlayback } from './AudioPlayback'

interface VoiceRecorderProps {
  minDurationSeconds: number
  maxDurationSeconds: number
  isRecording: boolean
  elapsedSeconds: number
  audioLevel: number
  recording: AudioRecordingResult | null
  recorderError: string | null
  onStart: () => void
  onStop: () => void
  onRetake: () => void
  onUploadFile: (file: File) => void
  onSubmit: () => void
  submitting?: boolean
  disabled?: boolean
}

export function VoiceRecorder({
  minDurationSeconds,
  maxDurationSeconds,
  isRecording,
  elapsedSeconds,
  audioLevel,
  recording,
  recorderError,
  onStart,
  onStop,
  onRetake,
  onUploadFile,
  onSubmit,
  submitting = false,
  disabled = false,
}: VoiceRecorderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt' | 'unavailable'>('prompt')

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unavailable')
      return
    }
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((res) => {
          setMicPermission(res.state as 'granted' | 'denied' | 'prompt')
          res.onchange = () => {
            setMicPermission(res.state as 'granted' | 'denied' | 'prompt')
          }
        })
        .catch(() => {})
    }
  }, [])

  const tooShort =
    recording !== null && recording.durationSeconds > 0 && recording.durationSeconds < minDurationSeconds

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isRecording ? 'bg-rose-600 animate-pulse' : micPermission === 'denied' ? 'bg-rose-500' : 'bg-emerald-500'
            }`}
          />
          <span className="text-xs font-medium text-zinc-700">
            {isRecording
              ? 'Listening to microphone...'
              : micPermission === 'denied'
                ? 'Microphone blocked — allow access or upload an audio clip'
                : micPermission === 'unavailable'
                  ? 'Microphone unavailable — upload an audio file instead'
                  : micPermission === 'granted'
                    ? 'Microphone ready'
                    : 'Microphone ready (browser will prompt for permission)'}
          </span>
        </div>

        <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-mono font-medium text-zinc-700 vl-nums">
          {isRecording
            ? `${elapsedSeconds.toFixed(1)}s`
            : recording
              ? `${recording.durationSeconds > 0 ? `${recording.durationSeconds.toFixed(1)}s` : 'Clip ready'}`
              : `Min ${minDurationSeconds}s`}
        </span>
      </div>

      {isRecording && (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
            <div
              className="h-full bg-zinc-950 transition-all duration-75"
              style={{ width: `${Math.max(8, audioLevel)}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-600 vl-nums">
            {elapsedSeconds < minDurationSeconds
              ? `Keep speaking clearly for ${(minDurationSeconds - elapsedSeconds).toFixed(1)}s more...`
              : `Minimum window reached (max ${maxDurationSeconds}s). Stop when finished.`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        {!isRecording ? (
          <button
            type="button"
            disabled={disabled || submitting}
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{recording ? 'Record Again' : 'Start Recording'}</span>
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
            const file = e.target.files?.[0]
            if (file) onUploadFile(file)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={disabled || isRecording || submitting}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Upload Audio Clip</span>
        </button>
      </div>

      {recorderError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{recorderError}</span>
        </div>
      )}

      {recording && !isRecording && (
        <>
          <AudioPlayback
            recording={recording}
            minDurationSeconds={minDurationSeconds}
            onRetake={onRetake}
            disabled={submitting || disabled}
          />

          <button
            type="button"
            disabled={tooShort || submitting || disabled}
            onClick={onSubmit}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4 text-zinc-300" aria-hidden="true" />
            <span>{submitting ? 'Verifying Voice...' : 'Submit Recording'}</span>
          </button>
        </>
      )}
    </div>
  )
}
