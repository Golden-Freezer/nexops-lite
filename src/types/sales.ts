// 일일 판매 거래 타입

export interface SalesTransaction {
  id: string
  userId: string
  productId: string | null
  productName?: string
  optionId: string | null
  orderNumber: string | null
  orderDate: string
  orderQuantity: number
  sellingPrice: number
  totalAmount: number
  unitCost: number | null
  shippingFee: number
  commissionAmount: number | null
  exchangeRate: number | null
  status: 'confirmed' | 'cancelled' | 'returned'
  source: 'manual' | 'coupang_import' | 'coupang_api'
  importBatchId: string | null
  notes: string | null
  createdAt: string
}

export interface SalesTransactionForm {
  productId: string
  optionId?: string
  orderNumber?: string
  orderDate: string
  orderQuantity: number
  sellingPrice: number
  totalAmount: number
  unitCost?: number
  shippingFee?: number
  commissionAmount?: number
  status?: 'confirmed' | 'cancelled' | 'returned'
  notes?: string
}

export interface DailySalesSummary {
  date: string
  totalOrders: number
  totalQuantity: number
  totalRevenue: number
  totalCost: number
  cancelledCount: number
  returnedCount: number
}
