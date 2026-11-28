'use client'

/**
 * 쿠팡 등록 준비 폼 필드 (프레젠테이션 전용) — RegistrationPrepDrawer가 상태·저장을 쥐고,
 * 이 모듈은 form 값과 갱신 콜백만 받아 쿠팡 등록 화면을 미러한 입력 섹션을 그린다.
 * 쿠팡·서버 접촉 없음. displayCategoryCode·실제 등록은 WS-C 소관이라 여기선 다루지 않는다.
 */

import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { RegistrationForm, RegistrationOption } from '@/lib/sourcing/registration/form'
import type { CategoryCandidate } from '@/lib/sourcing/registration/category-resolve'
import { RegistrationImageGen } from './RegistrationImageGen'
import { BrandPicker } from '@/components/features/naming/BrandPicker'

const num = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
        />
        {suffix && <span className="text-[11px] text-slate-400 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  suffix?: string
}) {
  return (
    <TextField
      label={label}
      value={value == null ? '' : String(value)}
      onChange={(v) => onChange(num(v))}
      suffix={suffix}
    />
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold text-slate-600 mt-1">{children}</h4>
}

export function RegistrationFormFields({
  form,
  onChange,
  categoryCandidates = [],
  businessId = null,
}: {
  form: RegistrationForm
  onChange: (patch: Partial<RegistrationForm>) => void
  /** 등록 대상 사업장 — 브랜드 칩 정렬·다른 사업장 경고·더하기에만 쓴다(form 값은 그대로 문자열). */
  businessId?: string | null
  /** 쿠팡 등록 leaf 카테고리 후보(WS-C category-resolve). 있으면 코드 선택기 노출. */
  categoryCandidates?: CategoryCandidate[]
}) {
  const setOption = (i: number, patch: Partial<RegistrationOption>) => {
    const options = form.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o))
    onChange({ options })
  }
  const addOption = () =>
    onChange({ options: [...form.options, { name: '', value: '', salePrice: null, stock: null, barcode: null }] })
  const removeOption = (i: number) => onChange({ options: form.options.filter((_, idx) => idx !== i) })

  const noticeEntries = Object.entries(form.notice)
  const setNotice = (entries: [string, string][]) => onChange({ notice: Object.fromEntries(entries) })

  return (
    <div className="space-y-4">
      {/* 기본 정보 */}
      <SectionTitle>기본 정보</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <TextField label="상품명" value={form.productName} onChange={(v) => onChange({ productName: v })} placeholder="쿠팡 노출 상품명" />
        </div>
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          브랜드
          <BrandPicker
            value={form.brand}
            onChange={(v) => onChange({ brand: v })}
            businessId={businessId}
            autoRegisterHint={false}
            inputClass="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
          />
        </div>
        <TextField label="바코드" value={form.barcode} onChange={(v) => onChange({ barcode: v })} placeholder="없으면 쿠팡 자동생성" />
        <div className="col-span-2">
          <TextField
            label="카테고리 경로"
            value={form.categoryPath ?? ''}
            onChange={(v) => onChange({ categoryPath: v || null })}
            placeholder="예: 홈>주방>수납"
          />
        </div>
        {/* 쿠팡 등록 leaf 카테고리 코드 — 후보에서 선택(등록 API가 요구하는 displayCategoryCode) */}
        {categoryCandidates.length > 0 && (
          <div className="col-span-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              쿠팡 등록 카테고리 (leaf 코드)
              <select
                value={form.displayCategoryCode ?? ''}
                onChange={(e) => {
                  const code = e.target.value ? Number(e.target.value) : null
                  const picked = categoryCandidates.find((c) => c.code === code)
                  onChange({ displayCategoryCode: code, categoryPath: picked?.fullPath ?? form.categoryPath })
                }}
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
              >
                <option value="">leaf 카테고리 선택… (후보 {categoryCandidates.length}개)</option>
                {categoryCandidates.map((c) => (
                  <option key={c.code} value={c.code}>
                    [{c.code}] {c.fullPath}
                    {c.rate != null ? ` · 수수료 ${(c.rate * 100).toFixed(1)}%` : ''}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400">
                쿠팡 등록은 말단(leaf) 카테고리 코드가 필요합니다. 상품명으로 자동 추정되며, 다르면 직접 고르세요.
              </span>
            </label>
          </div>
        )}
      </div>

      {/* 가격 */}
      <SectionTitle>가격</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="판매가" value={form.salePrice} onChange={(v) => onChange({ salePrice: v })} suffix="원" />
        <NumberField label="정가(할인 전)" value={form.originalPrice} onChange={(v) => onChange({ originalPrice: v })} suffix="원" />
      </div>

      {/* 검색태그 */}
      <SectionTitle>검색태그 ({form.searchTags.length}/20)</SectionTitle>
      <textarea
        value={form.searchTags.join('\n')}
        onChange={(e) =>
          onChange({
            searchTags: e.target.value
              .split(/[\n,]/)
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 20),
          })
        }
        rows={4}
        placeholder="줄바꿈 또는 쉼표로 구분 (최대 20개)"
        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
      />

      {/* 옵션 */}
      <div className="flex items-center justify-between">
        <SectionTitle>옵션</SectionTitle>
        <button onClick={addOption} className="flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700">
          <Plus className="w-3 h-3" /> 옵션 추가
        </button>
      </div>
      {form.options.length === 0 && <div className="text-[11px] text-slate-400">단일 상품이면 옵션 없이 진행 가능합니다.</div>}
      <div className="space-y-2">
        {form.options.map((o, i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
            <input
              value={o.name}
              onChange={(e) => setOption(i, { name: e.target.value })}
              placeholder="옵션명"
              className="col-span-3 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
            />
            <input
              value={o.value}
              onChange={(e) => setOption(i, { value: e.target.value })}
              placeholder="옵션값"
              className="col-span-3 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
            />
            <input
              value={o.salePrice == null ? '' : String(o.salePrice)}
              onChange={(e) => setOption(i, { salePrice: num(e.target.value) })}
              placeholder="가격"
              className="col-span-2 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
            />
            <input
              value={o.stock == null ? '' : String(o.stock)}
              onChange={(e) => setOption(i, { stock: num(e.target.value) })}
              placeholder="재고"
              className="col-span-2 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
            />
            <button onClick={() => removeOption(i)} className="col-span-2 flex justify-center text-slate-300 hover:text-danger-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* 고시정보 */}
      <div className="flex items-center justify-between">
        <SectionTitle>상품정보제공고시</SectionTitle>
        <button
          onClick={() => setNotice([...noticeEntries, ['', '']])}
          className="flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700"
        >
          <Plus className="w-3 h-3" /> 항목 추가
        </button>
      </div>
      <div className="space-y-2">
        {noticeEntries.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
            <input
              value={k}
              onChange={(e) => {
                const next = noticeEntries.map((e2, idx) => (idx === i ? [e.target.value, e2[1]] : e2)) as [string, string][]
                setNotice(next)
              }}
              placeholder="항목명 (예: 품명 및 모델명)"
              className="col-span-5 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
            />
            <input
              value={v}
              onChange={(e) => {
                const next = noticeEntries.map((e2, idx) => (idx === i ? [e2[0], e.target.value] : e2)) as [string, string][]
                setNotice(next)
              }}
              placeholder="값"
              className="col-span-6 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-brand-400"
            />
            <button
              onClick={() => setNotice(noticeEntries.filter((_, idx) => idx !== i))}
              className="col-span-1 flex justify-center text-slate-300 hover:text-danger-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* 배송/반품지 */}
      <SectionTitle>배송 · 반품</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="출고지"
          value={form.shipping.shippingPlaceName ?? ''}
          onChange={(v) => onChange({ shipping: { ...form.shipping, shippingPlaceName: v || null } })}
        />
        <TextField
          label="반품지"
          value={form.shipping.returnPlaceName ?? ''}
          onChange={(v) => onChange({ shipping: { ...form.shipping, returnPlaceName: v || null } })}
        />
        <NumberField
          label="출고 배송비"
          value={form.shipping.outboundShippingFee}
          onChange={(v) => onChange({ shipping: { ...form.shipping, outboundShippingFee: v } })}
          suffix="원"
        />
        <NumberField
          label="반품 배송비"
          value={form.shipping.returnDeliveryFee}
          onChange={(v) => onChange({ shipping: { ...form.shipping, returnDeliveryFee: v } })}
          suffix="원"
        />
      </div>

      {/* 콘텐츠 슬롯 — 대표이미지 AI 생성(WS-B) + 수동 URL */}
      <SectionTitle>콘텐츠</SectionTitle>
      <RegistrationImageGen
        defaultPrompt={form.productName}
        onGenerated={(url) =>
          onChange({ content: { ...form.content, heroImages: [url, ...form.content.heroImages.slice(1)] } })
        }
      />
      <TextField
        label="대표이미지 URL (첫 장)"
        value={form.content.heroImages[0] ?? ''}
        onChange={(v) =>
          onChange({ content: { ...form.content, heroImages: v ? [v, ...form.content.heroImages.slice(1)] : form.content.heroImages.slice(1) } })
        }
        placeholder="생성하거나 직접 붙여넣기 https://…"
      />
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        상세페이지 HTML
        <textarea
          value={form.content.detailHtml ?? ''}
          onChange={(e) => onChange({ content: { ...form.content, detailHtml: e.target.value || null } })}
          rows={3}
          placeholder="WS-B NEXFIT 에디터가 채웁니다. 지금은 직접 붙여넣기 가능."
          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
        />
      </label>

      {/* 메모 */}
      <TextField label="메모" value={form.memo} onChange={(v) => onChange({ memo: v })} placeholder="등록 관련 메모" />
    </div>
  )
}
