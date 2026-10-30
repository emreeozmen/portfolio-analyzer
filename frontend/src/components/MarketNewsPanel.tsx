import { useTranslation } from 'react-i18next'
import { getMarketNews, type NewsItem } from '../api'
import { useLiveChannel } from '../lib/useLiveChannel'
import { useRemoteData } from '../lib/useRemoteData'
import DataNotice from './DataNotice'

/** Attributed headlines from the backend's public economy feeds and Yahoo fallback
 * — title, summary, publisher, and link are all real,
 * nothing synthesized; a symbol with no news simply contributes nothing. Each card
 * links out to the original article (opens in a new tab) rather than reproducing full
 * article text, the same attribution pattern any news aggregator follows.
 */
function MarketNewsPanel() {
  const { t } = useTranslation('market')
  const live = useLiveChannel<NewsItem[]>('news')
  const request = useRemoteData<NewsItem[]>(getMarketNews, [], live?.length ? live : null)
  const items = request.data

  const timeAgo = (isoDate: string | null): string => {
    if (!isoDate) return ''
    const diffMs = Date.now() - new Date(isoDate).getTime()
    if (!Number.isFinite(diffMs)) return ''
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 1) return t('news.timeAgoJustNow')
    if (minutes < 60) return t('news.timeAgoMinutes', { minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('news.timeAgoHours', { hours })
    const days = Math.floor(hours / 24)
    return t('news.timeAgoDays', { days })
  }

  return (
    <section className="home-section" id="market-news" style={{ scrollMarginTop: 120 }}>
      <h2 className="home-section-title">{t('news.title')}</h2>
      {items.length === 0 && (
        request.loading || request.error ? <DataNotice {...request} /> : (
          <div className="market-overview-card" role="status">
            <p className="muted">{t('news.empty')}</p>
            <button type="button" className="btn-secondary" onClick={request.reload}>{t('news.retry')}</button>
          </div>
        )
      )}
      <div className="news-grid">
        {items.map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="news-card">
            {item.thumbnail_url && (
              <img
                src={item.thumbnail_url}
                alt=""
                className="news-card-thumb"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <div className="news-card-body">
              <h3 className="news-card-title">{item.title}</h3>
              {item.summary && <p className="news-card-summary">{item.summary}</p>}
              <div className="news-card-meta">
                <span>{item.publisher}</span>
                {item.published_at && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{timeAgo(item.published_at)}</span>
                  </>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

export default MarketNewsPanel
