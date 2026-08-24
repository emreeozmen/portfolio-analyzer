import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { searchAssets, trackAsset, type SymbolSearchResult } from '../api'
import { getToken } from '../auth'
import TickerAvatar from './TickerAvatar'

function SymbolSearch() {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SymbolSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const timeoutId = setTimeout(() => {
      searchAssets(trimmed)
        .then((data) => setResults(data))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
      if (e.key === 'Escape') {
        setIsOpen(false)
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const goToSymbol = (ticker: string) => {
    setIsOpen(false)
    setQuery('')
    navigate(`/assets/${ticker}`)
  }

  const handleAdd = async (result: SymbolSearchResult) => {
    if (!getToken()) {
      setIsOpen(false)
      setQuery('')
      navigate('/portfolio', { state: { addAfterLogin: result } })
      return
    }
    setAddingSymbol(result.yahoo_symbol)
    setError(null)
    try {
      const asset = await trackAsset(result)
      goToSymbol(asset.ticker)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingSymbol(null)
    }
  }

  return (
    <div className="symbol-search" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder={t('symbolSearch.placeholder')}
        aria-label={t('symbolSearch.aria')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsOpen(true)}
        className="symbol-search-input"
      />

      {isOpen && (query.trim().length >= 2 || error) && (
        <div className="symbol-search-dropdown">
          {loading && <div className="symbol-search-status">{t('symbolSearch.searching')}</div>}
          {!loading && error && <div className="symbol-search-status is-error">{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div className="symbol-search-status">{t('symbolSearch.noResults')}</div>
          )}
          {!loading &&
            !error &&
            results.map((r) => (
              <div className="symbol-search-row" key={r.yahoo_symbol}>
                <button
                  type="button"
                  className="symbol-search-row-main"
                  onClick={() => (r.already_tracked ? goToSymbol(r.ticker) : handleAdd(r))}
                >
                  <TickerAvatar ticker={r.ticker} size={30} />
                  <span className="symbol-search-row-text">
                    <span className="symbol-search-ticker">
                      {r.ticker} <span className="symbol-search-exchange">{r.exchange}</span>
                    </span>
                    <span className="symbol-search-name">{r.name}</span>
                  </span>
                </button>
                {r.already_tracked ? (
                  <span className="symbol-search-badge">{t('symbolSearch.tracked')}</span>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary symbol-search-add-btn"
                    onClick={() => handleAdd(r)}
                    disabled={addingSymbol === r.yahoo_symbol}
                  >
                    {addingSymbol === r.yahoo_symbol ? t('symbolSearch.adding') : t('symbolSearch.add')}
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export default SymbolSearch
