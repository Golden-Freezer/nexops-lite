'use client'

/**
 * PDP 폼 참조 사진 칸(결정 카드 c12·하네스 J20) — 순서 바꾸기(앞·뒤)·대표 지정(맨 앞으로)·빼기와 첫 장 경고.
 * 순서가 곧 sourceImages 계약이다(첫 장 = 구조 정본·식별 카드·검수 기준). 사진별 역할(원본·옵션·설명 그림·시험 사진·포장)은 showRoles일 때만 보인다
 * (스위치 photoroles·demoshot — 기본 꺼짐, 미리보기 확인은 ?photoroles=1·?demoshot=1). 역할은 잡 기록에 photoroles가 있을 때만 생성에 쓰인다.
 * 시험 사진(demo, J57)은 고를 수 있는 목록에 늘 있고 시연 칸(demoshot 켠 잡)에서만 쓰인다 — 통합 decide 37 ①.
 */

import type { RefObject } from 'react'
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, X } from 'lucide-react'
import { LOW_RESOLUTION_MESSAGE, isLowResolutionImage, type ImageDimensions } from '@/lib/registration/reference-image-quality'
import {
  PHOTO_ROLES,
  PHOTO_ROLE_LABEL,
  firstPhotoWarning,
  generationSourceUrls,
  moveItem,
  moveToFront,
  photoRoleOf,
  rolesForUrls,
  withPhotoRole,
  type PhotoRole,
  type SourcePhotoRole,
} from '@/lib/registration/source-photo-roles'

export const PHOTO_ROLES_HINT =
  '설명 그림(글·도식 패널)은 생성 원천에서 빠지고 역할만 기록됩니다. 옵션 사진은 다른 색·구성으로 알립니다. 시험 사진(직접 시험한 사진)은 시연 칸(켠 잡)에서만 쓰이고 생성 원천에서 빠집니다. 포장 사진을 고르면 포장 컷을 한 장 넣습니다.'

const iconButton =
  'rounded bg-white/90 border border-slate-200 p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed'

export function PdpFormPhotos({
  urls,
  onUrlsChange,
  roles,
  onRolesChange,
  showRoles,
  imageDims,
  onDims,
  maxImages,
  uploading,
  busy,
  fileRef,
  onFiles,
}: {
  urls: string[]
  onUrlsChange: (next: string[]) => void
  roles: SourcePhotoRole[]
  onRolesChange: (next: SourcePhotoRole[]) => void
  showRoles: boolean
  imageDims: Record<string, ImageDimensions>
  onDims: (url: string, width: number, height: number) => void
  maxImages: number
  uploading: boolean
  busy: boolean
  fileRef: RefObject<HTMLInputElement | null>
  onFiles: (files: FileList | null) => void
}) {
  const lowResCount = urls.filter((url) => isLowResolutionImage(imageDims[url])).length
  const firstWarning = firstPhotoWarning(urls, imageDims)
  const excluded = showRoles ? generationSourceUrls(urls, roles).excluded.length : 0

  const remove = (url: string) => {
    const next = urls.filter((u) => u !== url)
    onUrlsChange(next)
    onRolesChange(rolesForUrls(roles, next))
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-700">참조 이미지 (1~{maxImages}장)</div>
      <p className="text-[11px] text-slate-400">첫 장이 대표 사진입니다 — 상품 구조·식별 카드·검수의 기준이 됩니다. 화살표로 순서를 바꾸세요.</p>
      <div className="flex items-start gap-2 flex-wrap" data-photo-list>
        {urls.map((url, index) => {
          const lowRes = isLowResolutionImage(imageDims[url])
          const role = photoRoleOf(roles, url)
          return (
            <div key={url} className="w-20 space-y-1" data-photo-index={index} data-photo-role={role} data-photo-hero={index === 0 ? '' : undefined}>
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`참조 이미지 ${index + 1}`}
                  onLoad={(e) => onDims(url, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                  className={`w-20 h-20 rounded object-cover ${lowRes ? 'border-2 border-amber-600' : 'border border-slate-200'} ${role === 'explain' ? 'opacity-60' : ''}`}
                />
                {index === 0 && (
                  <span className="absolute left-0.5 top-0.5 rounded bg-brand-500 px-1 text-[10px] font-bold leading-[14px] text-white">대표</span>
                )}
                {lowRes && (
                  <span
                    title={LOW_RESOLUTION_MESSAGE}
                    className="absolute left-0.5 bottom-0.5 rounded bg-amber-700 px-1 text-[10px] font-bold leading-[14px] text-white"
                  >
                    저해상도
                  </span>
                )}
                <button
                  onClick={() => remove(url)}
                  disabled={busy}
                  className="absolute -top-1.5 -right-1.5 bg-slate-600 text-white rounded-full p-0.5 hover:bg-slate-800 disabled:opacity-50"
                  aria-label={`이미지 ${index + 1} 제거`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onUrlsChange(moveItem(urls, index, index - 1))}
                  disabled={busy || index === 0}
                  className={iconButton}
                  aria-label={`이미지 ${index + 1} 앞으로`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onUrlsChange(moveToFront(urls, index))}
                  disabled={busy || index === 0}
                  className={iconButton}
                  aria-label={`이미지 ${index + 1} 대표로`}
                  title="대표(맨 앞)로"
                >
                  <Star className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onUrlsChange(moveItem(urls, index, index + 1))}
                  disabled={busy || index === urls.length - 1}
                  className={iconButton}
                  aria-label={`이미지 ${index + 1} 뒤로`}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              {showRoles && (
                <select
                  value={role}
                  onChange={(e) => onRolesChange(withPhotoRole(roles, url, e.target.value as PhotoRole))}
                  disabled={busy}
                  aria-label={`이미지 ${index + 1} 역할`}
                  className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700"
                >
                  {PHOTO_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {PHOTO_ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
        {urls.length < maxImages && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || busy}
            className="w-20 h-20 rounded border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            <span className="text-[10px] mt-1">업로드</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
      {firstWarning && (
        <div role="status" data-photo-warning="first" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {firstWarning}
        </div>
      )}
      {lowResCount > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {LOW_RESOLUTION_MESSAGE}
        </div>
      )}
      {showRoles && (
        <p className="text-[11px] text-slate-400" data-photo-roles-hint>
          {PHOTO_ROLES_HINT}
          {excluded > 0 ? ` 지금 ${excluded}장이 원천에서 빠집니다.` : ''}
        </p>
      )}
    </section>
  )
}
