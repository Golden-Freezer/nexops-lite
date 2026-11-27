interface SparklineProps {
  points: number[]
  width?: number
  height?: number
  color?: string
}

/** 순수 SVG 스파크라인 — recharts 미사용 (테이블 행 다수 렌더 성능) */
export function Sparkline({ points, width = 80, height = 20, color = 'var(--chart-profit)' }: SparklineProps) {
  if (points.length === 0) return null

  const min = Math.min(...points)
  const max = Math.max(...points)
  const pad = 1 // 선이 상하단에 잘리지 않도록 여백

  // 2개 미만이거나 전부 동일값이면 수평선
  const flat = points.length < 2 || min === max
  const coords = flat
    ? [`0,${height / 2}`, `${width},${height / 2}`]
    : points.map((v, i) => {
        const x = (i / (points.length - 1)) * width
        const y = height - pad - ((v - min) / (max - min)) * (height - pad * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
