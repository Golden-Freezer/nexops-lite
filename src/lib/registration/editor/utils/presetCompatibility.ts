import type { LayoutCategory, LayoutOnlySupport, LayoutPreset } from '@/lib/registration/editor/types/layout';

const LAYOUT_ONLY_SUPPORT_BY_CATEGORY: Record<LayoutCategory, LayoutOnlySupport> = {
  minimal: 'safe',
  bold: 'safe',
  image_first: 'safe',
  split: 'safe',
  overlay: 'preview-required',
  gradient: 'preview-required',
  card: 'safe',
  full_bleed: 'preview-required',
  stacked: 'safe',
  dynamic: 'safe',
};

export function getLayoutOnlySupport(preset: LayoutPreset): LayoutOnlySupport {
  return preset.layoutOnlySupport ?? LAYOUT_ONLY_SUPPORT_BY_CATEGORY[preset.category];
}
