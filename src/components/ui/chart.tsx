'use client'

import * as React from 'react'
import { Tooltip as RechartsTooltip } from 'recharts'
import { cn } from '@/lib/utils'

// ── Chart Config ──
export type ChartConfig = Record<
  string,
  {
    label?: string
    icon?: React.ComponentType
    color?: string
    theme?: { light: string; dark: string }
  }
>

// ── Chart Container ──
type ChartContextProps = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextProps | null>(null)

export function useChart() {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be used within a <ChartContainer />')
  return ctx
}

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig
  children: React.ReactElement
}

export const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ config, children, className, ...props }, ref) => {
    const cssVars = Object.entries(config).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value.color) acc[`--color-${key}`] = value.color
      return acc
    }, {})

    return (
      <ChartContext.Provider value={{ config }}>
        <div
          ref={ref}
          className={cn('[&_.recharts-cartesian-grid_line]:stroke-slate-200 [&_.recharts-cartesian-axis_tick_text]:fill-slate-500 [&_.recharts-cartesian-axis_tick_text]:text-[10px]', className)}
          style={cssVars as React.CSSProperties}
          {...props}
        >
          {children}
        </div>
      </ChartContext.Provider>
    )
  }
)
ChartContainer.displayName = 'ChartContainer'

// ── Chart Tooltip ──
interface ChartTooltipContentProps {
  active?: boolean
  payload?: Array<{
    name?: string
    value?: number
    dataKey?: string
    color?: string
    payload?: Record<string, unknown>
  }>
  label?: string
  labelKey?: string
  nameKey?: string
  formatter?: (value: number, name: string) => React.ReactNode
  labelFormatter?: (label: string) => React.ReactNode
  hideLabel?: boolean
  hideIndicator?: boolean
  indicator?: 'dot' | 'line' | 'dashed'
  className?: string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  hideLabel = false,
  hideIndicator = false,
  indicator = 'dot',
  className,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null

  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md', className)}>
      {!hideLabel && (
        <p className="mb-1 font-medium text-slate-600">
          {labelFormatter ? labelFormatter(String(label)) : label}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((item, i) => {
          const value = formatter
            ? formatter(item.value ?? 0, item.name ?? '')
            : (item.value ?? 0).toLocaleString('ko-KR')
          return (
            <div key={i} className="flex items-center gap-2">
              {!hideIndicator && (
                <span
                  className={cn(
                    'shrink-0',
                    indicator === 'dot' && 'w-2 h-2 rounded-full',
                    indicator === 'line' && 'w-3 h-0.5 rounded-full',
                    indicator === 'dashed' && 'w-3 h-0.5 rounded-full border-b border-dashed'
                  )}
                  style={{ backgroundColor: item.color }}
                />
              )}
              <span className="text-slate-500">{item.name}</span>
              <span className="ml-auto font-mono font-medium text-slate-800">{value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Re-export recharts Tooltip with custom defaults
export const ChartTooltip = RechartsTooltip
