import type { ComponentType, ReactNode } from 'react'

interface EmptyStateProps {
  icon: ComponentType<{ size?: number }>
  children: ReactNode
}

/** A small icon + message block for an empty list/table — used instead of a bare
 * muted paragraph so "nothing here yet" reads as a designed state, not a bug. */
function EmptyState({ icon: Icon, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={28} />
      </div>
      <p className="muted">{children}</p>
    </div>
  )
}

export default EmptyState
