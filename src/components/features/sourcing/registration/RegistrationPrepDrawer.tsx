'use client'

/**
 * 쿠팡 실등록 준비 drawer (WS-A) — 소싱 후보를 쿠팡 등록 직전 상태로 임시저장한다.
 * 소싱 데이터(상품명·태그·카테고리·판매가·옵션·바코드)를 프리필하고, 오너가 등록 대상 사업장을
 * 고른 뒤 폼을 다듬어 저장한다. 실제 쿠팡 OpenAPI 등록·ID 회수는 WS-C(승인 게이트) 소관이며,
 * 이 drawer는 쿠팡·운영 테이블을 전혀 건드리지 않는다(sourcing_registration_drafts만).
 */

import { useContext, useEffect, useRef, useState, useCallback } from 'react'
import { Loader2, X } from 'lucide-react'
import { emptyForm, type RegistrationForm } from '@/lib/sourcing/registration/form'
import type { CategoryCandidate } from '@/lib/sourcing/registration/category-resolve'
import { BusinessContext } from '@/hooks/useBusiness'
import { pickRegistrationBusinessId } from '@/lib/registration/default-business'
import {
  GUARDED_MESSAGE_TYPE,
  LEGACY_MESSAGE_TYPE,
  buildWingHandoff,
  evaluateHandoffStart,
  interpretGuardedHandoffResponse,
} from '@/lib/registration/registration-target'
import { RegistrationFormFields } from './RegistrationFormFields'
import { RegistrationCategoryMeta } from './RegistrationCategoryMeta'

interface OwnedBusiness {
  id: string
  name: string
  coupangVendorId: string | null
  isDefault: boolean
}

interface DraftResponse {
  draft: {
    id: string
    businessId: string | null
    keyword: string | null
    sourcingProductId: string | null
    form: RegistrationForm
    status: 'draft' | 'ready'
  } | null
  prefillForm: RegistrationForm
  keyword: string | null
  categoryCandidates: CategoryCandidate[]
  /** 서버 스위치 — 사업장·Wing 계정 대조 가드(AX-CT-18). 옛 서버 응답에는 없다 */
  guards?: { accountGuard?: boolean }
}

export function RegistrationPrepDrawer({
  sourcingProductId,
  keyword,
  onClose,
  onSaved,
}: {
  sourcingProductId: string
  keyword: string
  onClose: () => void
  /** 저장 성공 시 상위에 알림(상태 뱃지/목록 갱신용) */
  onSaved?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const [businesses, setBusinesses] = useState<OwnedBusiness[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  // 계정 대조 가드(AX-CT-18) — 켜져 있으면 저장된 초안 사업장만 등록 대상이 된다(기본 사업장으로 채우지 않음)
  const [accountGuard, setAccountGuard] = useState(false)
  const [savedBusinessId, setSavedBusinessId] = useState<string | null>(null)
  // 대표이미지 스튜디오 딥링크용 — 로드된/저장된 draft id 보관 (저장 응답을 버리지 않는다)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [form, setForm] = useState<RegistrationForm>(emptyForm())
  const [prefill, setPrefill] = useState<RegistrationForm>(emptyForm())
  const [categoryCandidates, setCategoryCandidates] = useState<CategoryCandidate[]>([])
  // 화면에서 선택 중인 사업장 — 새 초안의 등록 대상 기본값. 공급자 밖에서 렌더돼도 깨지지 않게 컨텍스트를 직접 읽는다.
  const selectedBusinessId = useContext(BusinessContext)?.currentBusiness?.id ?? null
  const selectedBusinessRef = useRef(selectedBusinessId)
  selectedBusinessRef.current = selectedBusinessId

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [draftRes, bizRes] = await Promise.all([
          fetch(`/api/sourcing/registration-drafts?sourcingProductId=${encodeURIComponent(sourcingProductId)}`),
          fetch('/api/sourcing/businesses'),
        ])
        const draftJson = await draftRes.json()
        const bizJson = await bizRes.json()
        if (!draftRes.ok) throw new Error(draftJson.error || '등록 준비 데이터를 불러오지 못했습니다.')
        if (!bizRes.ok) throw new Error(bizJson.error || '사업장 목록을 불러오지 못했습니다.')
        if (!alive) return

        const data = draftJson.data as DraftResponse
        const bizList = (bizJson.data.businesses as OwnedBusiness[]) ?? []
        setBusinesses(bizList)
        setPrefill(data.prefillForm)
        setCategoryCandidates(data.categoryCandidates ?? [])
        setForm(data.draft?.form ?? data.prefillForm)
        setDraftId(data.draft?.id ?? null)
        const guardOn = data.guards?.accountGuard === true
        setAccountGuard(guardOn)
        setSavedBusinessId(data.draft?.businessId ?? null)
        setBusinessId(
          guardOn
            ? (data.draft?.businessId ?? null)
            : pickRegistrationBusinessId(data.draft?.businessId, selectedBusinessRef.current, bizList)
        )
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : '불러오기 실패')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [sourcingProductId])

  const [predicting, setPredicting] = useState(false)
  const [predictMsg, setPredictMsg] = useState<string | null>(null)

  const update = useCallback((patch: Partial<RegistrationForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setSavedMsg(null)
  }, [])

  // 쿠팡 메타의 고시정보 항목명을 폼 고시정보 키로 병합(기존 값 보존, 새 항목은 빈 값).
  const applyNotice = useCallback((itemNames: string[]) => {
    setForm((f) => {
      const notice = { ...f.notice }
      for (const name of itemNames) if (name && !(name in notice)) notice[name] = ''
      return { ...f, notice }
    })
    setSavedMsg(null)
  }, [])

  // 쿠팡 카테고리 자동 추천 — 선택 사업장 크레덴셜로 예측 API 호출(쓰기 아님). 결과 코드를
  // displayCategoryCode·경로에 반영하고, 후보에 없으면 목록에 주입해 선택기에 노출한다.
  async function handlePredict() {
    if (!businessId) {
      setPredictMsg('사업장을 먼저 선택하세요.')
      return
    }
    if (!form.productName.trim()) {
      setPredictMsg('상품명을 입력하세요.')
      return
    }
    setPredicting(true)
    setPredictMsg(null)
    try {
      const res = await fetch('/api/sourcing/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, productName: form.productName, brand: form.brand || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '추천 실패')
      const d = json.data as {
        resultType: string | null
        predictedCategoryId: number | null
        predictedCategoryName: string | null
        fullPath: string | null
        rate: number | null
      }
      if (d.resultType !== 'SUCCESS' || d.predictedCategoryId == null) {
        setPredictMsg(
          d.resultType === 'INSUFFICIENT_INFORMATION'
            ? '정보가 부족해 추천하지 못했습니다. 상품명을 더 구체적으로.'
            : '쿠팡이 카테고리를 추천하지 못했습니다.'
        )
        return
      }
      const code = d.predictedCategoryId
      const path = d.fullPath ?? d.predictedCategoryName ?? form.categoryPath
      setForm((f) => ({ ...f, displayCategoryCode: code, categoryPath: path }))
      setCategoryCandidates((prev) =>
        prev.some((c) => c.code === code)
          ? prev
          : [{ code, fullPath: d.fullPath ?? d.predictedCategoryName ?? `#${code}`, rate: d.rate }, ...prev]
      )
      setPredictMsg(`쿠팡 추천: [${code}] ${d.predictedCategoryName ?? ''}`)
      setSavedMsg(null)
    } catch (err) {
      setPredictMsg(err instanceof Error ? err.message : '추천 실패')
    } finally {
      setPredicting(false)
    }
  }

  async function save(status: 'draft' | 'ready'): Promise<string | null> {
    if (status === 'ready') {
      if (!businessId) {
        setError('등록 대상 사업장을 선택하세요.')
        return null
      }
      if (!form.productName.trim()) {
        setError('상품명을 입력하세요.')
        return null
      }
      if (!(form.salePrice && form.salePrice > 0)) {
        setError('판매가를 입력하세요.')
        return null
      }
    }
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/sourcing/registration-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcingProductId, keyword, businessId, form, status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '저장 실패')
      const saved = (json.data as { draft?: { id?: string; businessId?: string | null; form?: RegistrationForm } } | undefined)?.draft
      const savedId = saved?.id ?? null
      if (savedId) setDraftId(savedId)
      setSavedBusinessId(saved?.businessId ?? businessId)
      // 서버가 정가 규칙(AX-CT-15)으로 채운 정가를 폼에 반영 — 지금 정가 칸이 비어 있을 때만(오너 입력은 덮지 않는다)
      const savedOriginal = saved?.form?.originalPrice
      if (typeof savedOriginal === 'number' && savedOriginal > 0) {
        setForm((f) => (f.originalPrice && f.originalPrice > 0 ? f : { ...f, originalPrice: savedOriginal }))
      }
      setSavedMsg(status === 'ready' ? '등록 준비 완료로 저장했습니다. (실제 쿠팡 등록은 WS-C)' : '임시저장했습니다.')
      // draft 저장은 소싱 stage(원가·상품명·콘텐츠 산출)를 바꾸지 않으므로 부모를 여기서 리로드하지
      // 않는다. 부모 갱신은 드로어를 닫을 때 1회만(handleClose) — 저장 중 언마운트로 메시지가 사라지는
      // 것을 막는다.
      return savedId
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
      return null
    } finally {
      setBusy(false)
    }
  }

  // 대표이미지 스튜디오 딥링크 — draft가 아직 없으면 임시저장으로 id를 만든 뒤 새 탭으로 연다.
  async function openThumbnailStudio() {
    const id = draftId ?? (await save('draft'))
    if (!id) return
    window.open(`/registration/thumbnail?draftId=${id}`, '_blank', 'noopener')
  }

  // 상세페이지 생성기 딥링크 — 대표이미지와 동일 패턴(draft 없으면 임시저장 후 새 탭).
  async function openDetailPageGenerator() {
    const id = draftId ?? (await save('draft'))
    if (!id) return
    window.open(`/registration/detail-page?draftId=${id}`, '_blank', 'noopener')
  }

  // WING 상품등록 폼 자동입력 준비 — 등록 draft를 크롬 확장에 전달한다. 이후 오너가 WING 상품등록
  // 페이지를 열면 확장의 "NexOps 자동입력" 패널이 이 값으로 폼을 채운다(제출은 사람이 함).
  const [wingMsg, setWingMsg] = useState<string | null>(null)
  function sendDraftToExtension() {
    // env 값에 개행/공백이 섞이면 runtime.sendMessage가 Invalid extension id로 실패한다 → trim.
    const extensionId = process.env.NEXT_PUBLIC_NEXOPS_EXTENSION_ID?.trim()
    const runtime = (
      window as {
        chrome?: {
          runtime?: {
            sendMessage?: (id: string, msg: unknown, cb: (res?: { ok?: boolean }) => void) => void
            lastError?: { message?: string }
          }
        }
      }
    ).chrome?.runtime
    if (!extensionId || !runtime?.sendMessage) {
      setWingMsg('크롬 확장을 찾지 못했습니다(미설치/미리로드). 확장 설치 후 다시 시도하세요.')
      return
    }
    // 가드가 켜져 있으면: 저장된 초안의 사업장으로 대상을 확정하고, 계정 대조를 아는 새 메시지로만 보낸다.
    if (accountGuard) {
      const start = evaluateHandoffStart({ draftId, savedBusinessId, currentBusinessId: businessId, owned: businesses })
      if (!start.ok) {
        setWingMsg(start.message)
        return
      }
      runtime.sendMessage(extensionId, { type: GUARDED_MESSAGE_TYPE, draft: buildWingHandoff(form, start.target) }, (res) => {
        void runtime.lastError
        const verdict = interpretGuardedHandoffResponse(res)
        setWingMsg(
          verdict.ok
            ? `좌우 분할 창을 열었습니다 — 오른쪽 쿠팡윙 창이 ${start.target.businessName} 계정인지 확인한 뒤 자동입력이 진행됩니다(다르면 입력을 멈춥니다).`
            : verdict.message
        )
      })
      return
    }
    const categoryName = form.categoryPath ? form.categoryPath.split('>').pop()?.trim() ?? null : null
    const draft = {
      // 카테고리 자동 선택용
      categoryName,
      displayCategoryCode: form.displayCategoryCode,
      // AI 폼 매핑용 상품 정보 전체
      product: {
        productName: form.productName,
        brand: form.brand,
        salePrice: form.salePrice,
        originalPrice: form.originalPrice,
        categoryPath: form.categoryPath,
        displayCategoryCode: form.displayCategoryCode,
        searchTags: form.searchTags,
        barcode: form.barcode,
        heroImageUrl: form.content.heroImages[0] ?? null,
        detailHtml: form.content.detailHtml,
        notice: form.notice,
        options: form.options,
        memo: form.memo,
      },
    }
    // 좌우 분할: 이 NexOps 창을 왼쪽 절반으로, 쿠팡윙 상품등록을 오른쪽 절반 새 창으로 열고 자동입력.
    runtime.sendMessage(extensionId, { type: LEGACY_MESSAGE_TYPE, draft }, (res) => {
      void runtime.lastError
      setWingMsg(
        res?.ok
          ? '좌우 분할 창을 열었습니다 — 오른쪽 쿠팡윙 창에서 카테고리 선택부터 자동입력이 진행됩니다. 이 창은 왼쪽에 배치됩니다.'
          : '확장에 전달하지 못했습니다. 확장을 리로드한 뒤 다시 시도하세요.'
      )
    })
  }

  // 닫을 때만 부모를 1회 갱신(저장 중 언마운트 방지). onSaved는 stage 배지 등 외부 상태 갱신용.
  const handleClose = () => {
    onSaved?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={handleClose}>
      <div
        className="w-full max-w-lg bg-white rounded-lg shadow-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">쿠팡 등록 준비</h3>
            <div className="text-[11px] text-slate-400">{keyword}</div>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* 사업자 선택 (등록 핸드오프) */}
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              등록 대상 사업장
              <select
                value={businessId ?? ''}
                onChange={(e) => {
                  setBusinessId(e.target.value || null)
                  setSavedMsg(null)
                }}
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
              >
                <option value="">{accountGuard ? '사업장을 고르세요' : '사업장 선택…'}</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.coupangVendorId ? ` (${b.coupangVendorId})` : ' (벤더코드 미설정)'}
                  </option>
                ))}
              </select>
              {accountGuard && !businessId && businesses.length > 0 && (
                <span className="text-[11px] text-danger-500">사업장을 고르세요.</span>
              )}
              {businesses.length === 0 && (
                <span className="text-[11px] text-danger-500">등록된 사업장이 없습니다.</span>
              )}
            </label>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">소싱 데이터가 프리필됐습니다. 필요한 값을 다듬으세요.</span>
              <button
                onClick={() => {
                  setForm(prefill)
                  setSavedMsg(null)
                }}
                className="text-[11px] text-slate-400 hover:text-slate-600 underline"
              >
                프리필로 초기화
              </button>
            </div>

            {/* 쿠팡 카테고리 자동 추천 (예측 API, 쓰기 아님) */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handlePredict}
                disabled={predicting}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-brand-200 text-brand-600 hover:bg-brand-50 disabled:opacity-50"
              >
                {predicting && <Loader2 className="w-3 h-3 animate-spin" />}
                쿠팡 카테고리 자동 추천
              </button>
              {predictMsg && <span className="text-[11px] text-slate-500">{predictMsg}</span>}
            </div>

            <RegistrationCategoryMeta
              businessId={businessId}
              displayCategoryCode={form.displayCategoryCode}
              onApplyNotice={applyNotice}
            />

            <RegistrationFormFields
              form={form}
              onChange={update}
              categoryCandidates={categoryCandidates}
              businessId={businessId}
            />

            {error && <div className="text-xs text-danger-600">{error}</div>}
            {savedMsg && <div className="text-xs text-brand-600">{savedMsg}</div>}

            {/* 대표이미지·상세페이지 생성 딥링크 — 에셋 생성은 상품등록 탭이 담당(로직 중복 금지) */}
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <button
                onClick={openThumbnailStudio}
                disabled={busy}
                className="w-full text-xs px-3 py-2 rounded-full border border-brand-200 text-brand-600 hover:bg-brand-50 disabled:opacity-50"
              >
                대표이미지 생성 (3컷 스튜디오) &nbsp;→
              </button>
              <button
                onClick={openDetailPageGenerator}
                disabled={busy}
                className="w-full text-xs px-3 py-2 rounded-full border border-brand-200 text-brand-600 hover:bg-brand-50 disabled:opacity-50"
              >
                상세페이지 생성 (Premium/Pro 파이프라인) &nbsp;→
              </button>
            </div>

            {/* WING 상품등록 폼 자동입력 준비 (확장 경유) */}
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <button
                onClick={sendDraftToExtension}
                className="w-full text-xs px-3 py-2 rounded-full border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                쿠팡윙 등록 시작 &nbsp;·&nbsp; 좌우 분할 자동입력 &nbsp;→
              </button>
              {wingMsg && (
                <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 leading-relaxed">
                  {wingMsg}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => save('draft')}
                disabled={busy}
                className="flex-1 text-xs px-3 py-2 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                임시저장
              </button>
              <button
                onClick={() => save('ready')}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1 text-xs px-3 py-2 rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                등록 준비 완료
              </button>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              여기서는 쿠팡에 실제 등록하지 않습니다. 사업장 계정으로의 실등록·상품ID 회수는 WS-C(승인 게이트)에서 진행됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
