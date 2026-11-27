'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { ProductForm } from '@/components/features/products/ProductForm'
import type { ProductFormData } from '@/types/product'
import { apiFetch } from '@/lib/api-client'

export default function NewProductPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (data: ProductFormData) => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, purpose: 'product' }),
      })
      const json = await res.json()

      if (res.ok && json.data) {
        router.push(`/products/${json.data.id}`)
      }
    } catch {
      // 에러 처리
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Header title="상품 등록" />
      <div className="max-w-2xl mx-auto px-4 lg:px-6 py-6">
        <ProductForm onSubmit={handleSubmit} loading={loading} />
      </div>
    </>
  )
}
