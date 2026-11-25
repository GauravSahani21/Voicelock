import { useCallback, useEffect, useRef, useState } from 'react'

export interface AudioRecordingResult {
  file: File
  url: string
  durationSeconds: number
}

function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

async function convertBlobToMonoWav(blob: Blob): Promise<{ wavFile: File; duration: number }> {
  const arrayBuf = await blob.arrayBuffer()
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf)
    const length = decoded.length
    const channels = decoded.numberOfChannels
    const mono = new Float32Array(length)
    for (let ch = 0; ch < channels; ch++) {
      const data = decoded.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / channels
      }
    }
    const wavBlob = encodeWavFromFloat32(mono, decoded.sampleRate)
    const wavFile = new File([wavBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' })
    return { wavFile, duration: Number(decoded.duration.toFixed(2)) }
  } finally {
    await ctx.close()
  }
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)
  const [recording, setRecording] = useState<AudioRecordingResult | null>(null)
  const [recorderError, setRecorderError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const stopTracksAndTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
    setAudioLevel(0)
  }, [])

  useEffect(() => {
    return () => {
      stopTracksAndTimers()
      if (recording?.url) {
        URL.revokeObjectURL(recording.url)
      }
    }
  }, [recording?.url, stopTracksAndTimers])

  const clearRecording = useCallback(() => {
    if (recording?.url) {
      URL.revokeObjectURL(recording.url)
    }
    setRecording(null)
    setElapsedSeconds(0)
    setRecorderError(null)
  }, [recording])

  const startRecording = useCallback(async () => {
    setRecorderError(null)
    if (recording?.url) {
      URL.revokeObjectURL(recording.url)
      setRecording(null)
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecorderError('Microphone recording is not supported in this browser context. Please upload an audio file instead.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      // Real-time input level meter
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtx()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const tickLevel = () => {
        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
        const avg = sum / dataArray.length
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)))
        rafRef.current = window.requestAnimationFrame(tickLevel)
      }
      tickLevel()

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ]
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data)
      }

      recorder.onstop = async () => {
        const rawDuration = (Date.now() - startTimeRef.current) / 1000
        stopTracksAndTimers()
        setIsRecording(false)
        const rawBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        try {
          // Convert browser WebM/Opus capture into clean WAV so duration headers and Detectif/Whisper compatibility are rock solid
          const { wavFile, duration } = await convertBlobToMonoWav(rawBlob)
          const url = URL.createObjectURL(wavFile)
          setRecording({ file: wavFile, url, durationSeconds: duration || Number(rawDuration.toFixed(1)) })
        } catch {
          const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm'
          const fallbackFile = new File([rawBlob], `recording-${Date.now()}.${ext}`, {
            type: recorder.mimeType || 'audio/webm',
          })
          const url = URL.createObjectURL(fallbackFile)
          setRecording({
            file: fallbackFile,
            url,
            durationSeconds: Number(rawDuration.toFixed(1)),
          })
        }
      }

      mediaRecorderRef.current = recorder
      startTimeRef.current = Date.now()
      setElapsedSeconds(0)
      setIsRecording(true)
      recorder.start(250)

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)))
      }, 100)
    } catch (err: unknown) {
      stopTracksAndTimers()
      setIsRecording(false)
      setRecorderError(
        err instanceof Error
          ? `Microphone access failed: ${err.message}`
          : 'Microphone permission denied. You can upload an audio file instead.',
      )
    }
  }, [recording, stopTracksAndTimers])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const setUploadedFile = useCallback(
    async (file: File) => {
      setRecorderError(null)
      if (recording?.url) {
        URL.revokeObjectURL(recording.url)
      }
      const url = URL.createObjectURL(file)
      let duration = 0
      try {
        const audio = new Audio(url)
        duration = await new Promise<number>((resolve) => {
          audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(2)) : 0)
          audio.onerror = () => resolve(0)
        })
      } catch {
        duration = 0
      }
      setRecording({ file, url, durationSeconds: duration })
    },
    [recording],
  )

  return {
    isRecording,
    elapsedSeconds,
    audioLevel,
    recording,
    recorderError,
    startRecording,
    stopRecording,
    clearRecording,
    setUploadedFile,
  }
}
