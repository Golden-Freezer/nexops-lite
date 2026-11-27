'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/lib/registration/editor/stores/editorStore';

// ─── EyeDropper 타입 선언 ──────────────────────────────────────────────────────
declare global {
  interface EyeDropper {
    open(): Promise<{ sRGBHex: string }>;
  }
  interface EyeDropperConstructor {
    new (): EyeDropper;
  }
  interface Window {
    EyeDropper?: EyeDropperConstructor;
  }
}

// ─── 색상 유틸리티 ──────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r: isNaN(r) ? 0 : r, g: isNaN(g) ? 0 : g, b: isNaN(b) ? 0 : b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function parseColorString(color: string): { r: number; g: number; b: number; a: number } {
  if (!color || color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  // rgba(r, g, b, a)
  const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // HEX (#RRGGBB or #RGB)
  const hexClean = color.replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(hexClean)) {
    const r = parseInt(hexClean[0] + hexClean[0], 16);
    const g = parseInt(hexClean[1] + hexClean[1], 16);
    const b = parseInt(hexClean[2] + hexClean[2], 16);
    return { r, g, b, a: 1 };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hexClean)) {
    const { r, g, b } = hexToRgb(color);
    return { r, g, b, a: 1 };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

function formatRgba(r: number, g: number, b: number, a: number): string {
  if (a >= 1) return rgbToHex(r, g, b);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 100) / 100})`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const GRID_PALETTE: string[][] = [
  ['#000000', '#444444', '#666666', '#888888', '#AAAAAA', '#CCCCCC', '#FFFFFF'],
  ['#FFD4CC', '#FFF0CC', '#E0FFCC', '#CCFFEE', '#CCE8FF', '#DDCCFF', '#FFCCF5'],
  ['#FF8866', '#FFCC44', '#88DD55', '#55DDAA', '#55BBFF', '#8877EE', '#DD66CC'],
  ['#FF4422', '#FFAA00', '#44BB22', '#22BB88', '#2299FF', '#5544DD', '#CC33AA'],
  ['#DD2200', '#EE8800', '#22AA00', '#009966', '#0066FF', '#3322CC', '#AA0088'],
  ['#CC0000', '#DD6600', '#008800', '#007744', '#0044DD', '#220099', '#880066'],
  ['#FF6633', '#FF8833', '#339933', '#008866', '#0055CC', '#220088', '#660055'],
];

const BASE_COLORS = ['#000000', '#FFFFFF', '#888888', 'transparent'];
const MAX_RECENT = 10;
const LS_KEY_RECENT = 'nexops-editor-recent-colors';
const LS_KEY_FAVORITES = 'nexops-editor-favorite-colors';
const MAX_FAVORITES = 20;

// HSV → HEX 변환
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// HEX → HSV 변환
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, v };
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
  /** true면 position:static (부모가 위치 제어) */
  inline?: boolean;
  /** true면 그라디언트 편집기 표시 (도형 fill, 섹션 배경용) */
  enableGradient?: boolean;
}

// ─── 그라디언트 파싱 ──────────────────────────────────────────────────────────

function isGradientValue(v: string): boolean {
  return v.startsWith('linear-gradient(');
}

function parseGradient(v: string): { angle: number; color1: string; color2: string } | null {
  const match = v.match(/linear-gradient\(\s*(\d+)deg\s*,\s*(.+?)\s*,\s*(.+?)\s*\)/);
  if (!match) return null;
  return { angle: parseInt(match[1]), color1: match[2].trim(), color2: match[3].trim() };
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export default function ColorPicker({ value, onChange, onClose, inline = false, enableGradient = false }: ColorPickerProps) {
  const editorDoc = useEditorStore((s) => s.document);

  // 초기값 파싱
  const initialParsed = parseColorString(isGradientValue(value) ? '#000000' : value);
  const initialHsv = hexToHsv(rgbToHex(initialParsed.r, initialParsed.g, initialParsed.b));

  const [hexInput, setHexInput] = useState(
    value === 'transparent' ? '' : (isGradientValue(value) ? '000000' : value.replace('#', '').slice(0, 6).toUpperCase())
  );
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [favoriteColors, setFavoriteColors] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hue, setHue] = useState(initialHsv.h);
  const [saturation, setSaturation] = useState(initialHsv.s);
  const [brightness, setBrightness] = useState(initialHsv.v);
  const [alpha, setAlpha] = useState(initialParsed.a);
  const [inputMode, setInputMode] = useState<'hex' | 'rgb' | 'hsl'>('hex');
  const [rgbInput, setRgbInput] = useState<{ r: number; g: number; b: number }>({ r: initialParsed.r, g: initialParsed.g, b: initialParsed.b });
  const [hslInput, setHslInput] = useState<{ h: number; s: number; l: number }>(() => rgbToHsl(initialParsed.r, initialParsed.g, initialParsed.b));

  // 그라디언트 상태
  const [gradientMode, setGradientMode] = useState(isGradientValue(value));
  const [gradAngle, setGradAngle] = useState(() => {
    const g = isGradientValue(value) ? parseGradient(value) : null;
    return g?.angle ?? 135;
  });
  const [gradColor1, setGradColor1] = useState(() => {
    const g = isGradientValue(value) ? parseGradient(value) : null;
    return g?.color1 ?? '#FF0000';
  });
  const [gradColor2, setGradColor2] = useState(() => {
    const g = isGradientValue(value) ? parseGradient(value) : null;
    return g?.color2 ?? '#0000FF';
  });
  const [gradEditingStop, setGradEditingStop] = useState<1 | 2>(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueBarRef = useRef<HTMLDivElement>(null);
  const alphaBarRef = useRef<HTMLDivElement>(null);
  const isDraggingSV = useRef(false);
  const isDraggingHue = useRef(false);
  const isDraggingAlpha = useRef(false);

  // 디자인 팔레트 6색
  const designPaletteColors: string[] = editorDoc?.sourceData.designPalette
    ? Object.values(editorDoc.sourceData.designPalette)
    : [];

  // LocalStorage 초기 로드
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY_RECENT);
      if (stored) setRecentColors(JSON.parse(stored));
    } catch { /* SSR safe */ }
    try {
      const stored = localStorage.getItem(LS_KEY_FAVORITES);
      if (stored) setFavoriteColors(JSON.parse(stored));
    } catch { /* SSR safe */ }
  }, []);

  // 색상 선택 핸들러 (단색 모드)
  const handleColorSelect = useCallback((color: string) => {
    onChange(color);
    const parsed = parseColorString(color);
    const hex = rgbToHex(parsed.r, parsed.g, parsed.b);
    setHexInput(color === 'transparent' ? '' : hex.replace('#', ''));
    setRgbInput({ r: parsed.r, g: parsed.g, b: parsed.b });
    setHslInput(rgbToHsl(parsed.r, parsed.g, parsed.b));
    setAlpha(parsed.a);

    // 최근 사용 업데이트
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => normalizeColor(c) !== normalizeColor(color));
      const next = [color, ...filtered].slice(0, MAX_RECENT);
      try { localStorage.setItem(LS_KEY_RECENT, JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, [onChange]);

  // 그라디언트 출력
  const emitGradient = useCallback((angle: number, c1: string, c2: string) => {
    onChange(`linear-gradient(${angle}deg, ${c1}, ${c2})`);
  }, [onChange]);

  // HEX 입력 핸들러
  const handleHexChange = (raw: string) => {
    const clean = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
    setHexInput(clean);
    if (clean.length === 6) {
      const { r, g, b } = hexToRgb(clean);
      setRgbInput({ r, g, b });
      setHslInput(rgbToHsl(r, g, b));
      const hsv = hexToHsv(`#${clean}`);
      setHue(hsv.h); setSaturation(hsv.s); setBrightness(hsv.v);

      if (gradientMode) {
        if (gradEditingStop === 1) { setGradColor1(`#${clean}`); emitGradient(gradAngle, `#${clean}`, gradColor2); }
        else { setGradColor2(`#${clean}`); emitGradient(gradAngle, gradColor1, `#${clean}`); }
      } else {
        handleColorSelect(formatRgba(r, g, b, alpha));
      }
    }
  };

  // RGB 입력 핸들러
  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number) => {
    const clamped = Math.max(0, Math.min(255, isNaN(val) ? 0 : val));
    const next = { ...rgbInput, [channel]: clamped };
    setRgbInput(next);
    setHexInput(rgbToHex(next.r, next.g, next.b).replace('#', ''));
    setHslInput(rgbToHsl(next.r, next.g, next.b));
    const hsv = hexToHsv(rgbToHex(next.r, next.g, next.b));
    setHue(hsv.h); setSaturation(hsv.s); setBrightness(hsv.v);
    handleColorSelect(formatRgba(next.r, next.g, next.b, alpha));
  };

  // HSL 입력 핸들러
  const handleHslChange = (channel: 'h' | 's' | 'l', val: number) => {
    const maxVal = channel === 'h' ? 360 : 100;
    const clamped = Math.max(0, Math.min(maxVal, isNaN(val) ? 0 : val));
    const next = { ...hslInput, [channel]: clamped };
    setHslInput(next);
    const { r, g, b } = hslToRgb(next.h, next.s, next.l);
    setRgbInput({ r, g, b });
    setHexInput(rgbToHex(r, g, b).replace('#', ''));
    const hsv = hexToHsv(rgbToHex(r, g, b));
    setHue(hsv.h); setSaturation(hsv.s); setBrightness(hsv.v);
    handleColorSelect(formatRgba(r, g, b, alpha));
  };

  // Alpha 슬라이더 인터랙션
  const handleAlphaInteraction = useCallback((clientX: number) => {
    const bar = alphaBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setAlpha(x);
    const { r, g, b } = hexToRgb(hsvToHex(hue, saturation, brightness));
    handleColorSelect(formatRgba(r, g, b, x));
  }, [hue, saturation, brightness, handleColorSelect]);

  // EyeDropper
  const handleEyeDropper = async () => {
    if (!window.EyeDropper) return;
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      handleColorSelect(result.sRGBHex);
      const hsv = hexToHsv(result.sRGBHex);
      setHue(hsv.h); setSaturation(hsv.s); setBrightness(hsv.v);
    } catch { /* user cancelled */ }
  };

  // 즐겨찾기 토글
  const toggleFavorite = (color: string) => {
    setFavoriteColors((prev) => {
      const norm = normalizeColor(color);
      const exists = prev.some((c) => normalizeColor(c) === norm);
      const next = exists ? prev.filter((c) => normalizeColor(c) !== norm) : [...prev, color].slice(0, MAX_FAVORITES);
      try { localStorage.setItem(LS_KEY_FAVORITES, JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  };

  const isFavorite = (color: string) => favoriteColors.some((c) => normalizeColor(c) === normalizeColor(color));

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // SV 캔버스 그리기
  useEffect(() => {
    if (!showAdvanced) return;
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const satGrad = ctx.createLinearGradient(0, 0, w, 0);
    satGrad.addColorStop(0, '#FFFFFF');
    satGrad.addColorStop(1, hsvToHex(hue, 1, 1));
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, w, h);
    const valGrad = ctx.createLinearGradient(0, 0, 0, h);
    valGrad.addColorStop(0, 'rgba(0,0,0,0)');
    valGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = valGrad;
    ctx.fillRect(0, 0, w, h);
  }, [showAdvanced, hue]);

  // SV 캔버스 마우스 이벤트
  const handleSVInteraction = useCallback((clientX: number, clientY: number) => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setSaturation(x);
    setBrightness(1 - y);
    const { r, g, b } = hexToRgb(hsvToHex(hue, x, 1 - y));
    setRgbInput({ r, g, b });
    setHslInput(rgbToHsl(r, g, b));
    setHexInput(rgbToHex(r, g, b).replace('#', ''));

    if (gradientMode) {
      const hex = hsvToHex(hue, x, 1 - y);
      if (gradEditingStop === 1) { setGradColor1(hex); emitGradient(gradAngle, hex, gradColor2); }
      else { setGradColor2(hex); emitGradient(gradAngle, gradColor1, hex); }
    } else {
      handleColorSelect(formatRgba(r, g, b, alpha));
    }
  }, [hue, alpha, handleColorSelect, gradientMode, gradEditingStop, gradAngle, gradColor1, gradColor2, emitGradient]);

  // Hue 바 마우스 이벤트
  const handleHueInteraction = useCallback((clientX: number) => {
    const bar = hueBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newHue = x * 360;
    setHue(newHue);
    const { r, g, b } = hexToRgb(hsvToHex(newHue, saturation, brightness));
    setRgbInput({ r, g, b });
    setHslInput(rgbToHsl(r, g, b));
    setHexInput(rgbToHex(r, g, b).replace('#', ''));

    if (gradientMode) {
      const hex = hsvToHex(newHue, saturation, brightness);
      if (gradEditingStop === 1) { setGradColor1(hex); emitGradient(gradAngle, hex, gradColor2); }
      else { setGradColor2(hex); emitGradient(gradAngle, gradColor1, hex); }
    } else {
      handleColorSelect(formatRgba(r, g, b, alpha));
    }
  }, [saturation, brightness, alpha, handleColorSelect, gradientMode, gradEditingStop, gradAngle, gradColor1, gradColor2, emitGradient]);

  // 전역 마우스 이벤트 (드래그 중)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSV.current) handleSVInteraction(e.clientX, e.clientY);
      if (isDraggingHue.current) handleHueInteraction(e.clientX);
      if (isDraggingAlpha.current) handleAlphaInteraction(e.clientX);
    };
    const handleMouseUp = () => {
      isDraggingSV.current = false;
      isDraggingHue.current = false;
      isDraggingAlpha.current = false;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleSVInteraction, handleHueInteraction, handleAlphaInteraction]);

  // 정규화된 색상 비교
  const isCurrent = (color: string) => normalizeColor(color) === normalizeColor(value);

  const currentHex = hsvToHex(hue, saturation, brightness);
  const currentColor = formatRgba(...Object.values(hexToRgb(currentHex)) as [number, number, number], alpha);

  return (
    <div
      ref={containerRef}
      className={`${inline ? '' : 'absolute z-50'} bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-lg shadow-lg p-3 ${showAdvanced ? 'w-[272px]' : 'w-60'}`}
      style={inline ? undefined : { top: 'calc(100% + 4px)', left: 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 그라디언트 / 단색 토글 (enableGradient일 때만) */}
      {enableGradient && (
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => { setGradientMode(false); if (!isGradientValue(value)) return; handleColorSelect(gradColor1); }}
            className={`flex-1 text-[10px] py-1 rounded border ${!gradientMode ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] text-[var(--editor-brand)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'}`}
          >
            단색
          </button>
          <button
            onClick={() => { setGradientMode(true); emitGradient(gradAngle, gradColor1, gradColor2); }}
            className={`flex-1 text-[10px] py-1 rounded border ${gradientMode ? 'border-[var(--editor-brand)] bg-[var(--brand-primary-tint)] text-[var(--editor-brand)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'}`}
          >
            그라디언트
          </button>
        </div>
      )}

      {/* 그라디언트 편집기 */}
      {gradientMode && enableGradient && (
        <div className="mb-2 space-y-2">
          {/* 그라디언트 미리보기 */}
          <div
            className="w-full h-8 rounded border border-[var(--border-default)]"
            style={{ background: `linear-gradient(${gradAngle}deg, ${gradColor1}, ${gradColor2})` }}
          />
          {/* 정지점 선택 */}
          <div className="flex gap-1 items-center">
            <button
              onClick={() => {
                setGradEditingStop(1);
                const hsv = hexToHsv(gradColor1);
                setHue(hsv.h); setSaturation(hsv.s); setBrightness(hsv.v);
                setHexInput(gradColor1.replace('#', ''));
              }}
              className={`w-6 h-6 rounded border-2 ${gradEditingStop === 1 ? 'border-[var(--editor-brand)] ring-1 ring-[var(--editor-brand)]' : 'border-[var(--border-default)]'}`}
              style={{ backgroundColor: gradColor1 }}
              title="정지점 1"
            />
            <span className="text-[10px] text-[var(--text-disabled)] mx-1">→</span>
            <button
              onClick={() => {
                setGradEditingStop(2);
                const hsv = hexToHsv(gradColor2);
                setHue(hsv.h); setSaturation(hsv.s); setBrightness(hsv.v);
                setHexInput(gradColor2.replace('#', ''));
              }}
              className={`w-6 h-6 rounded border-2 ${gradEditingStop === 2 ? 'border-[var(--editor-brand)] ring-1 ring-[var(--editor-brand)]' : 'border-[var(--border-default)]'}`}
              style={{ backgroundColor: gradColor2 }}
              title="정지점 2"
            />
            <div className="flex items-center ml-auto gap-1">
              <label className="text-[10px] text-[var(--text-disabled)]">각도</label>
              <input
                type="number"
                value={gradAngle}
                min={0} max={360}
                onChange={(e) => { const a = parseInt(e.target.value) || 0; setGradAngle(a); emitGradient(a, gradColor1, gradColor2); }}
                className="w-12 h-5 text-[10px] text-center border border-[var(--border-default)] rounded outline-none"
              />
              <span className="text-[10px] text-[var(--text-disabled)]">°</span>
            </div>
          </div>
        </div>
      )}

      {/* 디자인 팔레트 */}
      {designPaletteColors.length > 0 && !gradientMode && (
        <PaletteSection label="디자인 팔레트">
          <div className="flex gap-1 flex-wrap">
            {designPaletteColors.map((color, i) => (
              <Swatch key={i} color={color} selected={isCurrent(color)} onSelect={handleColorSelect} />
            ))}
          </div>
        </PaletteSection>
      )}

      {/* 기본색 */}
      {!gradientMode && (
        <PaletteSection label="기본">
          <div className="flex gap-1">
            {BASE_COLORS.map((color) => (
              <Swatch key={color} color={color} selected={isCurrent(color)} onSelect={handleColorSelect} />
            ))}
          </div>
        </PaletteSection>
      )}

      {/* 즐겨찾기 */}
      {favoriteColors.length > 0 && !gradientMode && (
        <PaletteSection label="즐겨찾기">
          <div className="flex gap-1 flex-wrap">
            {favoriteColors.map((color, i) => (
              <Swatch key={i} color={color} selected={isCurrent(color)} onSelect={handleColorSelect} />
            ))}
          </div>
        </PaletteSection>
      )}

      {/* 최근 사용 */}
      {recentColors.length > 0 && !gradientMode && (
        <PaletteSection label="최근 사용">
          <div className="flex gap-1 flex-wrap">
            {recentColors.map((color, i) => (
              <Swatch key={i} color={color} selected={isCurrent(color)} onSelect={handleColorSelect} />
            ))}
          </div>
        </PaletteSection>
      )}

      {/* 7×7 그리드 */}
      {!gradientMode && (
        <PaletteSection label="색상">
          <div className="flex flex-col gap-0.5">
            {GRID_PALETTE.map((row, ri) => (
              <div key={ri} className="flex gap-0.5">
                {row.map((color) => (
                  <Swatch key={color} color={color} selected={isCurrent(color)} onSelect={handleColorSelect} size="sm" />
                ))}
              </div>
            ))}
          </div>
        </PaletteSection>
      )}

      {/* 커스텀 색상 버튼 */}
      <PaletteSection label="커스텀">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full h-7 rounded border border-dashed border-[var(--border-default)] text-xs text-[var(--text-secondary)] hover:border-[var(--editor-brand)] hover:text-[var(--editor-brand)] transition-colors"
        >
          {showAdvanced ? '닫기' : '자유 색상 선택'}
        </button>
      </PaletteSection>

      {/* 고급 피커 (SV + Hue + Alpha) */}
      {showAdvanced && (
        <div className="space-y-2 mb-2">
          {/* SV 캔버스 */}
          <div className="relative">
            <canvas
              ref={svCanvasRef}
              width={200}
              height={150}
              className="w-full rounded cursor-crosshair border border-[var(--border-default)]"
              onMouseDown={(e) => {
                isDraggingSV.current = true;
                handleSVInteraction(e.clientX, e.clientY);
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full border-2 border-white pointer-events-none"
              style={{
                left: `${saturation * 100}%`,
                top: `${(1 - brightness) * 100}%`,
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
              }}
            />
          </div>

          {/* Hue 슬라이더 */}
          <div
            ref={hueBarRef}
            className="w-full h-3 rounded cursor-pointer"
            style={{
              background: 'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
            }}
            onMouseDown={(e) => {
              isDraggingHue.current = true;
              handleHueInteraction(e.clientX);
            }}
          >
            <div
              className="w-3 h-3 rounded-full border-2 border-white pointer-events-none relative"
              style={{
                left: `${(hue / 360) * 100}%`,
                transform: 'translateX(-50%)',
                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                backgroundColor: hsvToHex(hue, 1, 1),
              }}
            />
          </div>

          {/* Alpha 슬라이더 */}
          {!gradientMode && (
            <div className="flex items-center gap-2">
              <div
                ref={alphaBarRef}
                className="flex-1 h-3 rounded cursor-pointer relative"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, transparent, ${currentHex}),
                    linear-gradient(45deg, #ccc 25%, transparent 25%),
                    linear-gradient(-45deg, #ccc 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #ccc 75%),
                    linear-gradient(-45deg, transparent 75%, #ccc 75%)
                  `,
                  backgroundSize: '100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px',
                  backgroundPosition: '0 0, 0 0, 0 4px, 4px -4px, -4px 0px',
                }}
                onMouseDown={(e) => {
                  isDraggingAlpha.current = true;
                  handleAlphaInteraction(e.clientX);
                }}
              >
                <div
                  className="w-3 h-3 rounded-full border-2 border-white pointer-events-none absolute top-0"
                  style={{
                    left: `${alpha * 100}%`,
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                    backgroundColor: currentHex,
                  }}
                />
              </div>
              <input
                type="number"
                value={Math.round(alpha * 100)}
                min={0} max={100}
                onChange={(e) => {
                  const a = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) / 100;
                  setAlpha(a);
                  const { r, g, b } = hexToRgb(currentHex);
                  handleColorSelect(formatRgba(r, g, b, a));
                }}
                className="w-10 h-5 text-[10px] text-center border border-[var(--border-default)] rounded outline-none"
              />
              <span className="text-[10px] text-[var(--text-disabled)]">%</span>
            </div>
          )}

          {/* 미리보기 + 즐겨찾기 */}
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded border border-[var(--border-default)] flex-shrink-0 relative overflow-hidden"
              style={{
                backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                backgroundSize: '8px 8px',
                backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
              }}
            >
              <div className="absolute inset-0" style={{ backgroundColor: currentColor }} />
            </div>
            <span className="text-[10px] text-[var(--text-secondary)] font-mono">{currentColor}</span>
            {!gradientMode && (
              <button
                onClick={() => toggleFavorite(currentColor)}
                className="ml-auto text-sm hover:scale-110 transition-transform"
                title={isFavorite(currentColor) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              >
                {isFavorite(currentColor) ? '❤️' : '🤍'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 입력 모드 선택 + 입력 필드 */}
      <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
        {/* 모드 탭 */}
        <div className="flex gap-1 mb-2">
          {(['hex', 'rgb', 'hsl'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setInputMode(mode)}
              className={`flex-1 text-[10px] py-0.5 rounded ${inputMode === mode ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-disabled)] hover:text-[var(--text-secondary)]'}`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* 미리보기 스왓치 */}
          <div
            className="w-7 h-7 rounded border border-[var(--border-default)] flex-shrink-0 relative overflow-hidden"
            style={{
              backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
            }}
          >
            <div className="absolute inset-0" style={{ backgroundColor: hexInput.length === 6 ? `#${hexInput}` : '#888888', opacity: alpha }} />
          </div>

          {/* HEX 모드 */}
          {inputMode === 'hex' && (
            <div className="flex items-center border border-[var(--border-default)] rounded px-2 py-1 flex-1">
              <span className="text-[var(--text-disabled)] text-xs">#</span>
              <input
                type="text"
                value={hexInput}
                onChange={(e) => handleHexChange(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="flex-1 text-xs font-mono outline-none ml-1"
              />
            </div>
          )}

          {/* RGB 모드 */}
          {inputMode === 'rgb' && (
            <div className="flex gap-1 flex-1">
              {(['r', 'g', 'b'] as const).map((ch) => (
                <div key={ch} className="flex flex-col items-center flex-1">
                  <input
                    type="number"
                    value={rgbInput[ch]}
                    min={0} max={255}
                    onChange={(e) => handleRgbChange(ch, parseInt(e.target.value))}
                    className="w-full h-6 text-[10px] text-center border border-[var(--border-default)] rounded outline-none font-mono"
                  />
                  <span className="text-[9px] text-[var(--text-disabled)] mt-0.5">{ch.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}

          {/* HSL 모드 */}
          {inputMode === 'hsl' && (
            <div className="flex gap-1 flex-1">
              {(['h', 's', 'l'] as const).map((ch) => (
                <div key={ch} className="flex flex-col items-center flex-1">
                  <input
                    type="number"
                    value={hslInput[ch]}
                    min={0} max={ch === 'h' ? 360 : 100}
                    onChange={(e) => handleHslChange(ch, parseInt(e.target.value))}
                    className="w-full h-6 text-[10px] text-center border border-[var(--border-default)] rounded outline-none font-mono"
                  />
                  <span className="text-[9px] text-[var(--text-disabled)] mt-0.5">{ch === 'h' ? 'H°' : ch === 's' ? 'S%' : 'L%'}</span>
                </div>
              ))}
            </div>
          )}

          {/* EyeDropper 버튼 */}
          {typeof window !== 'undefined' && window.EyeDropper && (
            <button
              onClick={handleEyeDropper}
              className="w-7 h-7 flex items-center justify-center rounded border border-[var(--border-default)] hover:border-[var(--editor-brand)] hover:bg-[var(--brand-primary-tint)] transition-colors flex-shrink-0"
              title="스포이드 (화면에서 색상 추출)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-secondary)]">
                <path d="m2 22 1-1h3l9-9" />
                <path d="M3 21v-3l9-9" />
                <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3L15 6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** 색상을 정규화하여 비교 (hex, rgba, transparent 모두 통합) */
function normalizeColor(color: string): string {
  if (!color || color === 'transparent') return 'transparent';
  if (color.startsWith('linear-gradient')) return color;
  const { r, g, b, a } = parseColorString(color);
  if (a === 0) return 'transparent';
  return `${r},${g},${b},${Math.round(a * 100)}`;
}

// ─── 내부 서브컴포넌트 ────────────────────────────────────────────────────────

interface SwatchProps {
  color: string;
  selected: boolean;
  onSelect: (color: string) => void;
  size?: 'sm' | 'md';
}

function Swatch({ color, selected, onSelect, size = 'md' }: SwatchProps) {
  const dim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const isTransparent = color === 'transparent';
  const parsed = parseColorString(color);
  const hasAlpha = parsed.a < 1 && parsed.a > 0;

  return (
    <button
      title={isTransparent ? '투명' : color}
      onClick={() => onSelect(color)}
      className={[
        dim,
        'rounded-sm border cursor-pointer flex-shrink-0 transition-all relative overflow-hidden',
        selected
          ? 'border-[var(--editor-brand)] ring-1 ring-[var(--editor-brand)]'
          : 'border-[var(--border-default)] hover:border-[var(--text-secondary)]',
      ].join(' ')}
    >
      {/* 체커보드 배경 (투명/반투명) */}
      {(isTransparent || hasAlpha) && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
            backgroundSize: '6px 6px',
            backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
          }}
        />
      )}
      {!isTransparent && (
        <div className="absolute inset-0" style={{ backgroundColor: color }} />
      )}
    </button>
  );
}

interface PaletteSectionProps {
  label: string;
  children: React.ReactNode;
}

function PaletteSection({ label, children }: PaletteSectionProps) {
  return (
    <div className="mb-2">
      <p className="text-xs text-[var(--text-disabled)] mb-1">{label}</p>
      {children}
    </div>
  );
}
