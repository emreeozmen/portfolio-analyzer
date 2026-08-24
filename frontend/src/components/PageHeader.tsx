import type { ComponentType, ReactNode } from 'react'

interface PageHeaderProps {
  icon: ComponentType<{ size?: number }>
  title: ReactNode
  subtitle?: ReactNode
}

function PageHeader({ icon: Icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-icon">
        <Icon size={22} />
      </div>
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
    </div>
  )
}

export default PageHeader
