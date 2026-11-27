import type { CanvasSection } from '@/lib/registration/editor/types/canvas';
import type { InitialBaseline } from '@/lib/registration/editor/types/editor';
import { EDITOR_SCHEMA_VERSION, migrateSectionsData } from '@/lib/registration/editor/utils/sectionsMigration';

export const BASELINE_ASSIGNMENT_KEY = '__initial_baseline__';

// baseline은 빌드 후 불변 — 자동저장마다 재직렬화 방지
const serializedBaselineCache = new WeakMap<InitialBaseline, string>();

export function captureInitialBaseline(sections: CanvasSection[]): InitialBaseline {
  const copiedSections = JSON.parse(JSON.stringify(sections)) as CanvasSection[];

  return {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    sections: copiedSections,
  };
}

export function serializeBaseline(baseline: InitialBaseline): string {
  const cached = serializedBaselineCache.get(baseline);
  if (cached !== undefined) return cached;

  const serialized = JSON.stringify(baseline);
  serializedBaselineCache.set(baseline, serialized);
  return serialized;
}

export function parseBaseline(raw: unknown): InitialBaseline | null {
  if (typeof raw !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('schemaVersion' in parsed) ||
      typeof parsed.schemaVersion !== 'number' ||
      !('capturedAt' in parsed) ||
      typeof parsed.capturedAt !== 'string' ||
      !('sections' in parsed) ||
      !Array.isArray(parsed.sections)
    ) {
      return null;
    }

    return {
      schemaVersion: parsed.schemaVersion,
      capturedAt: parsed.capturedAt,
      sections: migrateSectionsData(parsed.sections as CanvasSection[]),
    };
  } catch {
    return null;
  }
}
