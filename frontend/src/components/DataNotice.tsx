import { useTranslation } from 'react-i18next'

export default function DataNotice({ loading, error, reload }: { loading: boolean; error: boolean; reload: () => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="market-overview-card" role={error ? 'alert' : 'status'}>
      <p className={error ? 'error' : 'muted'}>{t(loading ? 'dataLoading' : error ? 'connectionError' : 'dataEmpty')}</p>
      {!loading && <button type="button" className="btn-secondary" onClick={reload}>{t('retryData')}</button>}
    </div>
  )
}
