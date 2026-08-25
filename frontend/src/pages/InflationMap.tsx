import { useEffect, useMemo, useRef, useState } from 'react'
import { geoOrthographic, geoPath, geoGraticule10 } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'
import { numericToAlpha3 } from 'i18n-iso-countries'
import worldTopo from 'world-atlas/countries-110m.json'
import { useTranslation } from 'react-i18next'
import { getGdpGrowthByCountry, getInflationByCountry, getUnemploymentByCountry, type CountryInflation } from '../api'

type Indicator = 'inflation' | 'gdp' | 'unemployment'

const INDICATORS: Indicator[] = ['inflation', 'gdp', 'unemployment']

const FETCHERS: Record<Indicator, () => Promise<CountryInflation[]>> = {
  inflation: getInflationByCountry,
  gdp: getGdpGrowthByCountry,
  unemployment: getUnemploymentByCountry,
}

// Rough, clearly-labeled bands (not an official classification) so each map reads at a
// glance. Inflation and unemployment both read "lower is better" (green→red as the
// value climbs); GDP growth reads the opposite way (red for a contraction, green/gold
// for healthy-to-strong growth) — so each indicator gets its own band set and color
// direction rather than reusing one generic scale.
const BANDS_BY_INDICATOR: Record<Indicator, { max: number; color: string; labelKey: string }[]> = {
  inflation: [
    { max: 0, color: '#5b9dee', labelKey: 'bandsInflation.deflation' },
    { max: 4, color: '#2fbf76', labelKey: 'bandsInflation.b0to4' },
    { max: 10, color: '#c9a15f', labelKey: 'bandsInflation.b4to10' },
    { max: 25, color: '#e0883f', labelKey: 'bandsInflation.b10to25' },
    { max: Infinity, color: '#ec5f66', labelKey: 'bandsInflation.b25plus' },
  ],
  gdp: [
    { max: 0, color: '#ec5f66', labelKey: 'bandsGdp.negative' },
    { max: 2, color: '#5b9dee', labelKey: 'bandsGdp.b0to2' },
    { max: 4, color: '#2fbf76', labelKey: 'bandsGdp.b2to4' },
    { max: 7, color: '#c9a15f', labelKey: 'bandsGdp.b4to7' },
    { max: Infinity, color: '#e0883f', labelKey: 'bandsGdp.b7plus' },
  ],
  unemployment: [
    { max: 4, color: '#2fbf76', labelKey: 'bandsUnemployment.b0to4' },
    { max: 7, color: '#c9a15f', labelKey: 'bandsUnemployment.b4to7' },
    { max: 12, color: '#e0883f', labelKey: 'bandsUnemployment.b7to12' },
    { max: Infinity, color: '#ec5f66', labelKey: 'bandsUnemployment.b12plus' },
  ],
}
// GDP growth reads "higher is better" (a bigger number is a stronger economy);
// inflation and unemployment read the opposite way — used to color the
// highest/lowest leaderboard cards as good (green) or bad (red) correctly per
// indicator rather than always painting "highest" red and "lowest" green.
const HIGHER_IS_BETTER: Record<Indicator, boolean> = { inflation: false, gdp: true, unemployment: false }
const NO_DATA_COLOR = '#2a3140'
const OCEAN_COLOR = '#0d1420'
const GRATICULE_COLOR = 'rgba(255,255,255,0.08)'

function colorForValue(value: number | undefined, bands: { max: number; color: string }[]): string {
  if (value === undefined) return NO_DATA_COLOR
  const band = bands.find((b) => value < b.max) ?? bands[bands.length - 1]
  return band.color
}

interface TooltipState {
  x: number
  y: number
  name: string
  entry: CountryInflation | undefined
}

const GLOBE_SIZE = 480
const AUTO_ROTATE_DEG_PER_TICK = 0.35
const TICK_MS = 40 // ~25fps — smooth enough to read as "spinning", light enough not to burn CPU redrawing ~180 country paths
const RESUME_DELAY_MS = 1500 // how long after a manual drag before auto-rotate kicks back in

function InflationMapPage() {
  const { t } = useTranslation('inflation')
  const [indicator, setIndicator] = useState<Indicator>('inflation')
  const [rows, setRows] = useState<CountryInflation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [rotation, setRotation] = useState<[number, number]>([-20, -18])
  const bands = BANDS_BY_INDICATOR[indicator]

  const hoveredRef = useRef(false)
  const draggingRef = useRef(false)
  const rotationRef = useRef(rotation)
  const dragStartRef = useRef<{ x: number; y: number; rotation: [number, number] } | null>(null)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setTooltip(null)
    FETCHERS[indicator]()
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [indicator])

  // Auto-rotate loop — paused while hovering a country (so the tooltip target
  // doesn't slide out from under the cursor) or while the user is dragging.
  useEffect(() => {
    const id = setInterval(() => {
      if (hoveredRef.current || draggingRef.current) return
      const next: [number, number] = [rotationRef.current[0] + AUTO_ROTATE_DEG_PER_TICK, rotationRef.current[1]]
      rotationRef.current = next
      setRotation(next)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  const countries = useMemo(() => {
    const topo = worldTopo as unknown as Topology
    return (feature(topo, topo.objects.countries) as unknown as { features: Feature<Geometry>[] }).features
  }, [])

  const byCode = useMemo(() => {
    const map = new Map<string, CountryInflation>()
    for (const row of rows) map.set(row.country_code, row)
    return map
  }, [rows])

  const ranked = useMemo(() => [...rows].sort((a, b) => b.value - a.value), [rows])
  const highest = ranked.slice(0, 10)
  const lowest = ranked.slice(-10).reverse()

  const projection = useMemo(
    () =>
      geoOrthographic()
        .rotate([rotation[0], rotation[1]])
        .scale(GLOBE_SIZE / 2.15)
        .translate([GLOBE_SIZE / 2, GLOBE_SIZE / 2])
        .clipAngle(90),
    [rotation],
  )
  const path = useMemo(() => geoPath(projection), [projection])

  // Precomputes everything about each country that does NOT depend on the current
  // rotation (its color, display name, and matched data row) once per data/indicator
  // change, instead of on every ~25fps auto-rotate tick — the render loop below then
  // only has to call path(feature) per tick, the one thing that actually needs the
  // current projection. Without this, numericToAlpha3/byCode.get/colorForValue ran for
  // all ~180 countries on every single tick even while nothing about the data changed.
  const countryVisuals = useMemo(
    () =>
      countries.map((c) => {
        const alpha3 = numericToAlpha3(c.id as string)
        const entry = alpha3 ? byCode.get(alpha3) : undefined
        const name = (c.properties?.name as string) ?? alpha3 ?? '—'
        return { feature: c, entry, name, color: colorForValue(entry?.value, bands) }
      }),
    [countries, byCode, bands],
  )
  const spherePath = useMemo(() => path({ type: 'Sphere' }) ?? '', [path])
  const graticulePath = useMemo(() => path(geoGraticule10()) ?? '', [path])

  const stopAutoRotateThenResume = () => {
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(() => {
      draggingRef.current = false
    }, RESUME_DELAY_MS)
  }

  const handlePointerDown = (clientX: number, clientY: number) => {
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    draggingRef.current = true
    dragStartRef.current = { x: clientX, y: clientY, rotation: rotationRef.current }
  }

  const handlePointerMove = (clientX: number, clientY: number) => {
    if (!draggingRef.current || !dragStartRef.current) return
    const { x, y, rotation: startRotation } = dragStartRef.current
    const dx = clientX - x
    const dy = clientY - y
    const next: [number, number] = [
      startRotation[0] + dx * 0.4,
      Math.max(-85, Math.min(85, startRotation[1] - dy * 0.4)),
    ]
    rotationRef.current = next
    setRotation(next)
  }

  const handlePointerUp = () => {
    dragStartRef.current = null
    stopAutoRotateThenResume()
  }

  return (
    <div>
      <h1>{t('title')}</h1>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t(`intros.${indicator}`)}
      </p>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t('dragHint')}
      </p>

      <nav className="detail-tabs" style={{ marginBottom: 16 }}>
        {INDICATORS.map((key) => (
          <button
            key={key}
            type="button"
            className={indicator === key ? 'detail-tab is-active' : 'detail-tab'}
            onClick={() => setIndicator(key)}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('loading')}</p>}

      {!loading && !error && (
        <>
          <div className="panel inflation-map-panel">
            <div className="inflation-legend">
              {bands.map((b) => (
                <span key={b.labelKey} className="inflation-legend-item">
                  <span className="inflation-legend-swatch" style={{ background: b.color }} />
                  {t(b.labelKey)}
                </span>
              ))}
              <span className="inflation-legend-item">
                <span className="inflation-legend-swatch" style={{ background: NO_DATA_COLOR }} />
                {t('noData')}
              </span>
            </div>

            <div className="inflation-globe-wrap">
              {
                // A drag-to-rotate SVG globe: role="img" + aria-label describes it to
                // screen readers (there's no real <img> src — it's drawn geo paths), and
                // the drag/mouse handlers are what make rotation work at all. Real
                // keyboard-operable rotation is out of scope for a lint-driven pass; the
                // underlying per-country data is also available via the legend and the
                // highest/lowest cards above, not only through the globe itself.
              }
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <svg
                viewBox={`0 0 ${GLOBE_SIZE} ${GLOBE_SIZE}`}
                className="inflation-globe-svg"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                role="img"
                aria-label={t('dragHint')}
                onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY)}
                onMouseMove={(e) => {
                  handlePointerMove(e.clientX, e.clientY)
                  setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev))
                }}
                onMouseUp={handlePointerUp}
                onMouseLeave={() => {
                  if (draggingRef.current) handlePointerUp()
                }}
                onTouchStart={(e) => handlePointerDown(e.touches[0].clientX, e.touches[0].clientY)}
                onTouchMove={(e) => handlePointerMove(e.touches[0].clientX, e.touches[0].clientY)}
                onTouchEnd={handlePointerUp}
              >
                <defs>
                  <radialGradient id="globe-shading" cx="35%" cy="32%" r="75%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
                    <stop offset="60%" stopColor="rgba(255,255,255,0)" />
                    <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
                  </radialGradient>
                </defs>

                <path d={spherePath} fill={OCEAN_COLOR} />
                <path d={graticulePath} fill="none" stroke={GRATICULE_COLOR} strokeWidth={0.6} />

                {countryVisuals.map((cv, i) => {
                  const d = path(cv.feature)
                  if (!d) return null
                  return (
                    <path
                      // world-atlas' 110m topology has a handful of features sharing
                      // the same (or a missing) numeric id — index disambiguates.
                      key={`${cv.feature.id ?? 'none'}-${i}`}
                      d={d}
                      fill={cv.color}
                      stroke="rgba(10,14,20,0.55)"
                      strokeWidth={0.5}
                      onMouseEnter={(evt) => {
                        hoveredRef.current = true
                        setTooltip({ x: evt.clientX, y: evt.clientY, name: cv.entry?.country_name ?? cv.name, entry: cv.entry })
                      }}
                      onMouseLeave={() => {
                        hoveredRef.current = false
                        setTooltip(null)
                      }}
                      style={{ cursor: 'grab' }}
                    />
                  )
                })}

                {/* Sphere-shaped shading on top for a subtle 3D lit-globe feel */}
                <path d={spherePath} fill="url(#globe-shading)" style={{ pointerEvents: 'none' }} />
              </svg>

              {tooltip && (
                <div className="inflation-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
                  <div className="inflation-tooltip-name">{tooltip.name}</div>
                  {tooltip.entry ? (
                    <div className="inflation-tooltip-value">
                      %{tooltip.entry.value.toFixed(1)} <span className="muted">({tooltip.entry.year})</span>
                    </div>
                  ) : (
                    <div className="inflation-tooltip-value muted">{t('noData')}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="leaderboard-grid" style={{ marginTop: 20 }}>
            <div className="panel leaderboard-panel">
              <div className="panel-header-row">
                <h2>{t(`highest.${indicator}`)}</h2>
              </div>
              <ul className="leaderboard-list">
                {highest.map((r, i) => (
                  <li key={r.country_code} className="leaderboard-row inflation-row">
                    <span className="leaderboard-rank">{i + 1}</span>
                    <span className="leaderboard-name">
                      <span className="leaderboard-symbol">{r.country_name}</span>
                      <span className="leaderboard-fullname">{r.year}</span>
                    </span>
                    <span className={`leaderboard-change mono ${HIGHER_IS_BETTER[indicator] ? 'text-up' : 'text-down'}`}>
                      %{r.value.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel leaderboard-panel">
              <div className="panel-header-row">
                <h2>{t(`lowest.${indicator}`)}</h2>
              </div>
              <ul className="leaderboard-list">
                {lowest.map((r, i) => (
                  <li key={r.country_code} className="leaderboard-row inflation-row">
                    <span className="leaderboard-rank">{i + 1}</span>
                    <span className="leaderboard-name">
                      <span className="leaderboard-symbol">{r.country_name}</span>
                      <span className="leaderboard-fullname">{r.year}</span>
                    </span>
                    <span
                      className={`leaderboard-change mono ${
                        HIGHER_IS_BETTER[indicator] ? 'text-down' : r.value < 0 ? 'text-down' : 'text-up'
                      }`}
                    >
                      %{r.value.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default InflationMapPage
