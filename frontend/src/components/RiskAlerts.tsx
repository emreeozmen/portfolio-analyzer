export interface RiskAlert {
  tone: 'warn' | 'danger' | 'info'
  text: string
}

function RiskAlerts({ alerts }: { alerts: RiskAlert[] }) {
  if (alerts.length === 0) return null

  return (
    <ul className="risk-alerts">
      {alerts.map((a, i) => (
        <li key={i} className={`risk-alert is-${a.tone}`}>
          {a.text}
        </li>
      ))}
    </ul>
  )
}

export default RiskAlerts
