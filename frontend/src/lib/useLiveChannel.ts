import { useEffect, useRef, useState } from 'react'
import { useLiveData } from './LiveDataContext'

/** Returns the latest payload pushed on `channel` over the shared WebSocket (see
 * LiveDataContext), or `initial` until the first message arrives. Use this for
 * "current snapshot" data (quotes, ticker-strip, news, ...) where each message
 * replaces the last. For a stream of discrete events to react to one at a time
 * (e.g. each newly-triggered alert), subscribe directly via useLiveData() instead. */
export function useLiveChannel<T>(channel: string, initial: T | null = null): T | null {
  const { subscribe } = useLiveData()
  const [data, setData] = useState<T | null>(initial)

  useEffect(() => subscribe(channel, (payload) => setData(payload as T)), [channel, subscribe])

  return data
}

/** Calls `onSignal` every time a message arrives on `channel`, without holding any
 * state itself — for channels that mean "something changed, go re-fetch" rather than
 * carrying the data directly (e.g. "prices-updated", which a portfolio/holdings view
 * uses to refresh its own REST-computed valuation instead of the server pushing that
 * expensive computation to every open tab on every price refresh). */
export function useLiveSignal(channel: string, onSignal: () => void): void {
  const { subscribe } = useLiveData()
  // Keeps the effect (and so the underlying WS subscription) stable across renders
  // even though callers typically pass an inline callback — only `channel`/`subscribe`
  // changing tears down and re-establishes the subscription, not every re-render.
  const onSignalRef = useRef(onSignal)
  useEffect(() => {
    onSignalRef.current = onSignal
  })

  useEffect(() => subscribe(channel, () => onSignalRef.current()), [channel, subscribe])
}
