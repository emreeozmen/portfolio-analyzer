import { cn } from '@/lib/utils'

interface BackgroundPlusProps {
  className?: string
  plusColor?: string
  plusSize?: number
  fade?: boolean
}

export function BackgroundPlus({ className, plusColor = '#6b7280', plusSize = 40, fade = false }: BackgroundPlusProps) {
  // Sanitized for use as an SVG element id/url() reference — plusColor may be a
  // hex literal or a `var(--token)` string, and only the latter needs stripping
  // of characters (spaces, parens, dashes) that aren't valid in an id.
  const patternId = `bg-plus-${plusColor.replace(/[^a-zA-Z0-9]/g, '')}-${plusSize}`

  return (
    <div className={cn('pointer-events-none', className)} aria-hidden="true">
      <svg className="h-full w-full">
        <defs>
          <pattern id={patternId} width={plusSize} height={plusSize} patternUnits="userSpaceOnUse">
            <path
              d={`M ${plusSize / 2} ${plusSize / 2 - 4} v 8 M ${plusSize / 2 - 4} ${plusSize / 2} h 8`}
              stroke={plusColor}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </pattern>
          {fade && (
            <radialGradient id={`${patternId}-fade`} cx="50%" cy="50%" r="75%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          )}
          {fade && (
            <mask id={`${patternId}-mask`}>
              <rect width="100%" height="100%" fill={`url(#${patternId}-fade)`} />
            </mask>
          )}
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} mask={fade ? `url(#${patternId}-mask)` : undefined} />
      </svg>
    </div>
  )
}

export default BackgroundPlus
