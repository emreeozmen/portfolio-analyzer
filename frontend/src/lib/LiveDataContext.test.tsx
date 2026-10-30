import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { LiveDataProvider } from './LiveDataContext'

const sockets: FakeSocket[] = []
class FakeSocket {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  constructor() { sockets.push(this) }
  close() { this.readyState = 3 }
  send() {}
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  sockets.length = 0
})

it('ignores a disposed StrictMode socket closing after its replacement has connected', () => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  const { unmount } = render(<StrictMode><LiveDataProvider><span>app</span></LiveDataProvider></StrictMode>)
  expect(sockets).toHaveLength(2)
  act(() => sockets[1].onopen?.())
  act(() => sockets[0].onclose?.())
  act(() => vi.advanceTimersByTime(30_000))
  expect(sockets).toHaveLength(2)
  unmount()
  act(() => sockets[1].onclose?.())
  act(() => vi.advanceTimersByTime(30_000))
  expect(sockets).toHaveLength(2)
})
