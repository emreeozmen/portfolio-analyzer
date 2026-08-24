import { memo } from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  className?: string
}

function Skeleton({ width = '100%', height = 16, className = '' }: SkeletonProps) {
  return <span className={`skeleton ${className}`} style={{ width, height }} />
}

export default memo(Skeleton)
