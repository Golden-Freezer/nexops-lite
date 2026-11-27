'use client'

import { ReactNode } from 'react'
import { BusinessContext, useBusinessProvider } from '@/hooks/useBusiness'

export function BusinessProvider({ children }: { children: ReactNode }) {
  const value = useBusinessProvider()
  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  )
}
