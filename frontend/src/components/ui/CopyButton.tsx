import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

let lastCopiedMessage = ''

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [announcement, setAnnouncement] = useState('')
  const timerRef = useRef<number | null>(null)

  const handleCopy = async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      ok = false
    }
    let msg = ok ? 'Copied' : 'Copy failed'
    if (msg === lastCopiedMessage) {
      msg += '\u00A0'
    }
    lastCopiedMessage = msg
    setStatus(ok ? 'copied' : 'failed')
    setAnnouncement('')
    window.requestAnimationFrame(() => setAnnouncement(msg))
    timerRef.current = window.setTimeout(() => {
      setStatus('idle')
      setAnnouncement('')
    }, 2000)
  }

  return (
    <span className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={label}
        className="inline-flex min-h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        {status === 'copied' ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
        )}
        <span>{status === 'copied' ? 'Copied' : status === 'failed' ? 'Failed' : 'Copy'}</span>
      </button>
      <span role="status" className="visually-hidden">
        {announcement}
      </span>
    </span>
  )
}
