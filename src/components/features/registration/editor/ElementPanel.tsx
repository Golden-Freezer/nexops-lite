'use client';

import {
  Square,
  RectangleHorizontal,
  Circle,
  Minus,
  Triangle,
  Star,
  ArrowRight,
  MessageCircle,
  Diamond,
  Hexagon,
  Type,
  Image as ImageIcon,
  Upload,
} from 'lucide-react';
import type { ShapeType } from '@/lib/registration/editor/types/canvas';

export type ElementKind =
  | { kind: 'shape'; shapeType: ShapeType }
  | { kind: 'line'; variant: 'solid' | 'dashed' | 'arrow' }
  | { kind: 'badge'; preset: 'NEW' | 'SALE' | 'HOT' }
  | { kind: 'framed-image'; frameShape: 'rect' | 'circle' | 'roundedRect' }
  | { kind: 'svg' }
  | { kind: 'text'; preset: 'heading' | 'body' };

interface ElementPanelProps {
  onInsert: (kind: ElementKind) => void;
}

export default function ElementPanel({ onInsert }: ElementPanelProps) {
  return (
    <div className="absolute top-full left-0 mt-1 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-lg shadow-xl py-3 px-3 z-50 w-[340px] max-h-[520px] overflow-y-auto">
      {/* ── 도형 ─────────────────────────────────────── */}
      <Section title="도형">
        <Grid>
          <Item label="사각형" onClick={() => onInsert({ kind: 'shape', shapeType: 'rect' })}>
            <Square size={20} />
          </Item>
          <Item label="둥근 사각형" onClick={() => onInsert({ kind: 'shape', shapeType: 'roundedRect' })}>
            <RectangleHorizontal size={20} />
          </Item>
          <Item label="원" onClick={() => onInsert({ kind: 'shape', shapeType: 'circle' })}>
            <Circle size={20} />
          </Item>
          <Item label="타원" onClick={() => onInsert({ kind: 'shape', shapeType: 'ellipse' })}>
            <svg width="24" height="18" viewBox="0 0 24 18">
              <ellipse cx="12" cy="9" rx="11" ry="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </Item>
          <Item label="삼각형" onClick={() => onInsert({ kind: 'shape', shapeType: 'triangle' })}>
            <Triangle size={20} />
          </Item>
          <Item label="별" onClick={() => onInsert({ kind: 'shape', shapeType: 'star' })}>
            <Star size={20} />
          </Item>
          <Item label="마름모" onClick={() => onInsert({ kind: 'shape', shapeType: 'diamond' })}>
            <Diamond size={20} />
          </Item>
          <Item label="화살표" onClick={() => onInsert({ kind: 'shape', shapeType: 'arrow' })}>
            <ArrowRight size={20} />
          </Item>
          <Item label="말풍선" onClick={() => onInsert({ kind: 'shape', shapeType: 'speechBubble' })}>
            <MessageCircle size={20} />
          </Item>
          <Item label="다각형" onClick={() => onInsert({ kind: 'shape', shapeType: 'diamond' })}>
            <Hexagon size={20} />
          </Item>
        </Grid>
      </Section>

      {/* ── 선 ─────────────────────────────────────── */}
      <Section title="선">
        <Grid>
          <Item label="실선" onClick={() => onInsert({ kind: 'line', variant: 'solid' })}>
            <Minus size={24} />
          </Item>
          <Item label="점선" onClick={() => onInsert({ kind: 'line', variant: 'dashed' })}>
            <svg width="28" height="4" viewBox="0 0 28 4">
              <line x1="0" y1="2" x2="28" y2="2" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" />
            </svg>
          </Item>
          <Item label="화살표 선" onClick={() => onInsert({ kind: 'line', variant: 'arrow' })}>
            <ArrowRight size={22} />
          </Item>
        </Grid>
      </Section>

      {/* ── 뱃지 ─────────────────────────────────────── */}
      <Section title="뱃지">
        <Grid>
          <Item label="NEW" onClick={() => onInsert({ kind: 'badge', preset: 'NEW' })}>
            <BadgePreview text="NEW" bg="#2563eb" />
          </Item>
          <Item label="SALE" onClick={() => onInsert({ kind: 'badge', preset: 'SALE' })}>
            <BadgePreview text="SALE" bg="#dc2626" />
          </Item>
          <Item label="HOT" onClick={() => onInsert({ kind: 'badge', preset: 'HOT' })}>
            <BadgePreview text="HOT" bg="#f59e0b" />
          </Item>
        </Grid>
      </Section>

      {/* ── 프레임 이미지 ─────────────────────────────── */}
      <Section title="프레임 이미지">
        <Grid>
          <Item label="사각" onClick={() => onInsert({ kind: 'framed-image', frameShape: 'rect' })}>
            <div className="w-6 h-6 bg-[var(--text-disabled)] flex items-center justify-center">
              <ImageIcon size={12} className="text-[var(--text-secondary)]" />
            </div>
          </Item>
          <Item label="둥근" onClick={() => onInsert({ kind: 'framed-image', frameShape: 'roundedRect' })}>
            <div className="w-6 h-6 bg-[var(--text-disabled)] rounded-md flex items-center justify-center">
              <ImageIcon size={12} className="text-[var(--text-secondary)]" />
            </div>
          </Item>
          <Item label="원형" onClick={() => onInsert({ kind: 'framed-image', frameShape: 'circle' })}>
            <div className="w-6 h-6 bg-[var(--text-disabled)] rounded-full flex items-center justify-center">
              <ImageIcon size={12} className="text-[var(--text-secondary)]" />
            </div>
          </Item>
        </Grid>
      </Section>

      {/* ── 아이콘 (SVG 업로드) ─────────────────────── */}
      <Section title="아이콘">
        <Grid>
          <Item label="SVG 업로드" onClick={() => onInsert({ kind: 'svg' })}>
            <Upload size={20} />
          </Item>
        </Grid>
      </Section>

      {/* ── 텍스트 ─────────────────────────────────── */}
      <Section title="텍스트">
        <Grid>
          <Item label="제목" onClick={() => onInsert({ kind: 'text', preset: 'heading' })}>
            <Type size={20} />
          </Item>
          <Item label="본문" onClick={() => onInsert({ kind: 'text', preset: 'body' })}>
            <Type size={16} />
          </Item>
        </Grid>
      </Section>
    </div>
  );
}

// ── 내부 UI ─────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5 px-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-5 gap-1">{children}</div>;
}

function Item({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--brand-primary-tint)] hover:border-[var(--editor-brand)] hover:text-[var(--editor-brand)] text-[var(--text-secondary)] transition-colors cursor-pointer"
    >
      <span className="flex items-center justify-center h-6">{children}</span>
      <span className="text-[9px] leading-none">{label}</span>
    </button>
  );
}

function BadgePreview({ text, bg }: { text: string; bg: string }) {
  return (
    <span
      className="text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: bg }}
    >
      {text}
    </span>
  );
}
