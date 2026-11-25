import { useEffect, useRef } from 'react'

interface UseLivePollingOptions {
  intervalMs?: number
  enabled?: boolean
}

export function useLivePolling(
  callback: () => void | Promise<void>,
  { intervalMs = 4000, enabled = true }: UseLivePollingOptions = {},
) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return

    const trigger = () => {
      if (document.visibilityState === 'visible') {
        void savedCallback.current()
      }
    }

    const timer = window.setInterval(trigger, intervalMs)
    const onFocus = () => trigger()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        trigger()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
}
