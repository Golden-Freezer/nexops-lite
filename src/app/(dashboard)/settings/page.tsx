import { OwnerApiTokenPanel } from '@/components/features/settings/OwnerApiTokenPanel'

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">설정</h1>
        <p className="mt-1 text-sm text-slate-500">
          AI 장부 업데이트에 쓰는 업로드 키를 만들고 지웁니다.
        </p>
      </div>
      <OwnerApiTokenPanel />
    </div>
  )
}
