import { useCallback, useEffect, useRef, useState } from 'react'

/** Initial REST snapshot plus a live stream, with visible recovery controls.
 * Late requests cannot overwrite a newer request or an unmounted component. */
export function useRemoteData<T>(loader: () => Promise<T>, initial: T, live: T | null = null) {
  const [state, setState] = useState({ data: initial, loading: true, error: false })
  const version = useRef(0)
  const reload = useCallback(() => {
    const id = ++version.current
    setState((previous) => ({ ...previous, loading: true, error: false }))
    loader().then(
      (data) => {
        if (id === version.current) setState({ data, loading: false, error: false })
      },
      () => {
        if (id === version.current) setState((previous) => ({ ...previous, loading: false, error: true }))
      },
    )
  }, [loader])

  useEffect(() => {
    reload()
    return () => { version.current++ }
  }, [reload])

  useEffect(() => {
    if (!state.error || live !== null) return
    window.addEventListener('online', reload)
    window.addEventListener('focus', reload)
    return () => {
      window.removeEventListener('online', reload)
      window.removeEventListener('focus', reload)
    }
  }, [state.error, live, reload])

  return { data: live ?? state.data, loading: live === null && state.loading, error: live === null && state.error, reload }
}
