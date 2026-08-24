import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getToken } from '../auth'

type Handler = (data: unknown) => void

interface LiveDataContextValue {
  /** True while the shared WebSocket is open — components can use this for a small
   * "canlı" indicator, but nothing here gates functionality on it: subscribe() queues
   * subscriptions and (re)sends them the moment the connection is actually open. */
  connected: boolean
  /** Registers `handler` to be called with the payload of every message on `channel`.
   * Returns an unsubscribe function. Multiple components subscribing to the same
   * channel share one underlying server subscription (reference-counted) — the server
   * is only told to subscribe/unsubscribe on the first consumer in / last consumer out. */
  subscribe: (channel: string, handler: Handler) => () => void
}

const LiveDataContext = createContext<LiveDataContextValue | null>(null)

const WS_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/^http/, 'ws')

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000

/** One shared WebSocket connection for the whole app (see backend/routers/ws.py) —
 * every live-updating surface (ticker strip, watchlist, market overview, news,
 * alerts, ...) subscribes to a named channel through this instead of opening its own
 * connection or polling its own REST interval. Auto-reconnects with exponential
 * backoff and re-subscribes to every channel a component still wants once back
 * online. Mounted with `key={token}` in App.tsx so logging in/out forces a fresh
 * connection carrying (or dropping) the auth token — see that file for why a
 * reconnect, not a live token swap, is how that's handled.
 */
export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map())
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const closedByUsRef = useRef(false)

  useEffect(() => {
    closedByUsRef.current = false

    function connect() {
      const token = getToken()
      const url = `${WS_BASE}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`
      const socket = new WebSocket(url)
      socketRef.current = socket

      socket.onopen = () => {
        setConnected(true)
        reconnectAttemptRef.current = 0
        const channels = Array.from(handlersRef.current.keys())
        if (channels.length > 0) {
          socket.send(JSON.stringify({ action: 'subscribe', channels }))
        }
      }

      socket.onmessage = (event) => {
        let message: { channel?: string; data?: unknown }
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (!message.channel) return
        const handlers = handlersRef.current.get(message.channel)
        handlers?.forEach((h) => h(message.data))
      }

      socket.onclose = () => {
        setConnected(false)
        if (closedByUsRef.current) return
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS)
        reconnectTimerRef.current = window.setTimeout(connect, delay)
      }

      socket.onerror = () => {
        socket.close()
      }
    }

    connect()

    return () => {
      closedByUsRef.current = true
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
    }
  }, [])

  function subscribe(channel: string, handler: Handler): () => void {
    let set = handlersRef.current.get(channel)
    const isNewChannel = !set
    if (!set) {
      set = new Set()
      handlersRef.current.set(channel, set)
    }
    set.add(handler)

    if (isNewChannel && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: 'subscribe', channels: [channel] }))
    }

    return () => {
      const current = handlersRef.current.get(channel)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) {
        handlersRef.current.delete(channel)
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ action: 'unsubscribe', channels: [channel] }))
        }
      }
    }
  }

  return <LiveDataContext.Provider value={{ connected, subscribe }}>{children}</LiveDataContext.Provider>
}

export function useLiveData(): LiveDataContextValue {
  const ctx = useContext(LiveDataContext)
  if (!ctx) throw new Error('useLiveData must be used within a LiveDataProvider')
  return ctx
}
