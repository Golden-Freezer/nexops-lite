import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { LayoutPreset, LayoutCategory } from '@/lib/registration/editor/types/layout';
import type { ProSectionType } from '@/lib/registration/editor/types/section';

// ─────────────────────────────────────────────
// 스토어 상태 타입
// ─────────────────────────────────────────────
interface LayoutStoreState {
  // sectionType → LayoutPreset[] (240개 = 24섹션 × 10개)
  presets: Record<string, LayoutPreset[]>;

  // 현재 선택된 프리셋 ID (섹션별)
  selectedPresetId: Record<string, string>; // sectionId → presetId

  // 로딩 상태
  isLoading: boolean;
  loadedSections: Record<string, boolean>;  // 이미 로드된 sectionType 목록

  // 필터
  activeCategory: LayoutCategory | null;
}

// ─────────────────────────────────────────────
// 스토어 액션 타입
// ─────────────────────────────────────────────
interface LayoutStoreActions {
  // 프리셋 로드 (API 또는 로컬 JSON)
  loadPresets: (sectionType: ProSectionType, presets: LayoutPreset[]) => void;

  // 프리셋 선택
  selectPreset: (sectionId: string, presetId: string) => void;

  // 프리셋 적용 (선택 + 콜백 트리거용)
  applyPreset: (sectionId: string, presetId: string) => void;

  // 카테고리 필터
  filterByCategory: (category: LayoutCategory | null) => void;

  // 로딩 상태
  setLoading: (isLoading: boolean) => void;

  // 초기화
  clearPresets: () => void;
}

type LayoutStore = LayoutStoreState & LayoutStoreActions;

// ─────────────────────────────────────────────
// 스토어 생성 (Zustand + immer)
// Map/Set 대신 Record 사용 — Immer draft proxy 호환성 보장
// ─────────────────────────────────────────────
export const useLayoutStore = create<LayoutStore>()(
  immer((set) => ({
    presets: {},
    selectedPresetId: {},
    isLoading: false,
    loadedSections: {},
    activeCategory: null,

    loadPresets: (sectionType, presets) =>
      set((state) => {
        const key = sectionType as string;
        // JSON dynamic import 결과는 모듈 캐시의 frozen 객체이므로 deep clone 후 저장
        state.presets[key] = JSON.parse(JSON.stringify(presets));
        state.loadedSections[key] = true;
        state.isLoading = false;
      }),

    selectPreset: (sectionId, presetId) =>
      set((state) => {
        state.selectedPresetId[sectionId] = presetId;
      }),

    applyPreset: (sectionId, presetId) =>
      set((state) => {
        state.selectedPresetId[sectionId] = presetId;
      }),

    filterByCategory: (category) =>
      set((state) => {
        state.activeCategory = category;
      }),

    setLoading: (isLoading) =>
      set((state) => {
        state.isLoading = isLoading;
      }),

    clearPresets: () =>
      set((state) => {
        state.presets = {};
        state.selectedPresetId = {};
        state.loadedSections = {};
        state.activeCategory = null;
        state.isLoading = false;
      }),
  }))
);

// ─────────────────────────────────────────────
// 셀렉터
// ─────────────────────────────────────────────
export const selectPresetsForSection = (sectionType: string) => (s: LayoutStore) =>
  s.presets[sectionType] ?? [];

export const selectFilteredPresets = (sectionType: string) => (s: LayoutStore) => {
  const all = s.presets[sectionType] ?? [];
  if (!s.activeCategory) return all;
  return all.filter((p) => p.category === s.activeCategory);
};

export const selectSelectedPresetId = (sectionId: string) => (s: LayoutStore) =>
  s.selectedPresetId[sectionId] ?? null;

export const selectIsPresetLoaded = (sectionType: string) => (s: LayoutStore) =>
  !!s.loadedSections[sectionType];

export const selectActiveCategory = (s: LayoutStore) => s.activeCategory;
export const selectIsLoading = (s: LayoutStore) => s.isLoading;
