import { useEffect, useRef, useState, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  /** Stagger delay in ms — for a row of cards revealing one after another. */
  delay?: number
  className?: string
}

/** Fades + slides a section into place the first time it scrolls into view
 * (IntersectionObserver, fires once). Reduced-motion users see content in its
 * final state immediately — see the `.reveal` rule in index.css. */
function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={['reveal', visible ? 'is-visible' : '', className].filter(Boolean).join(' ')}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}

export default Reveal
