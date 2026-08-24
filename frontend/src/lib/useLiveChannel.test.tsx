import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLiveChannel, useLiveSignal } from './useLiveChannel'

type Handler = (payload: unknown) => void

const handlers = new Map<string, Set<Handler>>()
const unsubscribeCalls: string[] = []

vi.mock('./LiveDataContext', () => ({
  useLiveData: () => ({
    connected: true,
    subscribe: (channel: string, handler: Handler) => {
      let set = handlers.get(channel)
      if (!set) {
        set = new Set()
        handlers.set(channel, set)
      }
      set.add(handler)
      return () => {
        set?.delete(handler)
        unsubscribeCalls.push(channel)
      }
    },
  }),
}))

function emit(channel: string, payload: unknown) {
  handlers.get(channel)?.forEach((h) => h(payload))
}

afterEach(() => {
  handlers.clear()
  unsubscribeCalls.length = 0
  cleanup()
})

function ChannelProbe({ channel }: { channel: string }) {
  const data = useLiveChannel<{ price: number }>(channel)
  return <div>{data ? `price:${data.price}` : 'no-data'}</div>
}

describe('useLiveChannel', () => {
  it('starts null until a message arrives on the channel', () => {
    render(<ChannelProbe channel="quotes" />)
    expect(screen.getByText('no-data')).toBeInTheDocument()
  })

  it('updates when a message is pushed on the subscribed channel', () => {
    render(<ChannelProbe channel="quotes" />)
    act(() => emit('quotes', { price: 42 }))
    expect(screen.getByText('price:42')).toBeInTheDocument()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ChannelProbe channel="quotes" />)
    unmount()
    expect(unsubscribeCalls).toContain('quotes')
  })

  it('delivers the same message to every subscriber of a shared channel', () => {
    render(
      <>
        <ChannelProbe channel="quotes" />
        <ChannelProbe channel="quotes" />
      </>,
    )
    act(() => emit('quotes', { price: 7 }))
    expect(screen.getAllByText('price:7')).toHaveLength(2)
  })
})

function SignalProbe({ channel, onSignal }: { channel: string; onSignal: () => void }) {
  useLiveSignal(channel, onSignal)
  return null
}

describe('useLiveSignal', () => {
  it('calls onSignal once per message without holding any payload state', () => {
    const onSignal = vi.fn()
    render(<SignalProbe channel="prices-updated" onSignal={onSignal} />)
    act(() => emit('prices-updated', undefined))
    act(() => emit('prices-updated', undefined))
    expect(onSignal).toHaveBeenCalledTimes(2)
  })

  it('always invokes the latest onSignal callback without resubscribing on every render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<SignalProbe channel="prices-updated" onSignal={first} />)
    rerender(<SignalProbe channel="prices-updated" onSignal={second} />)

    act(() => emit('prices-updated', undefined))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
