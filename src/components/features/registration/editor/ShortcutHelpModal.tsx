'use client';

import { useEffect, useState } from 'react';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUT_MAP } from '@/lib/registration/editor/hooks/useKeyboardShortcuts';

export default function ShortcutHelpModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener('nexops:toggle-shortcut-help', handler);
    return () => window.removeEventListener('nexops:toggle-shortcut-help', handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="단축키 도움말"
    >
      <div
        className="bg-[var(--surface-overlay)] rounded-lg shadow-xl w-[420px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[var(--editor-brand)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">단축키 도움말</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-[var(--hover-overlay)] text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {SHORTCUT_MAP.map(({ keys, description }) => (
              <div key={keys} className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--text-secondary)]">{description}</span>
                <kbd className="ml-2 px-1.5 py-0.5 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded text-[10px] font-mono text-[var(--text-secondary)] whitespace-nowrap">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-2 border-t border-[var(--border-subtle)] text-center">
          <span className="text-[10px] text-[var(--text-disabled)]">? 키를 눌러 열고 닫기</span>
        </div>
      </div>
    </div>
  );
}
