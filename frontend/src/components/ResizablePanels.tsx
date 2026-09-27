import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const defaults = { explorer: 240, terminal: 260 };
type Panel = keyof typeof defaults;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ResizablePanels({ workspaceId, preview, terminalVisible, children }: {
  workspaceId: string; preview: boolean; terminalVisible: boolean; children: ReactNode;
}) {
  const storageKey = `yotram.panels.${workspaceId}`;
  const shell = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      return {
        explorer: typeof saved.explorer === 'number' && Number.isFinite(saved.explorer) ? clamp(saved.explorer, 180, 600) : defaults.explorer,
        terminal: typeof saved.terminal === 'number' && Number.isFinite(saved.terminal) ? clamp(saved.terminal, 120, 1200) : defaults.terminal,
      };
    } catch { return defaults; }
  });
  const [bounds, setBounds] = useState({ width: 1024, height: 768 });
  const [resizing, setResizing] = useState<Panel | null>(null);
  const drag = useRef<{ panel: Panel; start: number; size: number } | null>(null);
  useEffect(() => {
    const element = shell.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBounds({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(sizes)); } catch { /* Storage may be disabled. */ }
  }, [storageKey, sizes]);
  const limits = {
    explorer: { min: 180, max: Math.max(180, Math.min(600, bounds.width - (preview ? 520 : 280))) },
    terminal: { min: Math.min(120, bounds.height / 2), max: Math.max(Math.min(120, bounds.height / 2), bounds.height - 160) },
  };
  const actual = {
    explorer: clamp(sizes.explorer, limits.explorer.min, limits.explorer.max),
    terminal: clamp(sizes.terminal, limits.terminal.min, limits.terminal.max),
  };
  function update(panel: Panel, value: number) {
    setSizes(current => ({ ...current, [panel]: clamp(value, limits[panel].min, limits[panel].max) }));
  }
  function handle(panel: Panel) {
    const vertical = panel === 'explorer';
    const stop = () => { drag.current = null; setResizing(null); };
    return <div role="separator" tabIndex={0} aria-label={`Resize ${panel === 'explorer' ? 'file explorer' : 'terminal'}`}
      aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuemin={Math.round(limits[panel].min)}
      aria-valuemax={Math.round(limits[panel].max)} aria-valuenow={Math.round(actual[panel])}
      className={`panel-resizer panel-resizer-${panel}`} title="Drag to resize. Use arrow keys, or double-click to reset."
      onDoubleClick={() => update(panel, defaults[panel])}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { panel, start: vertical ? event.clientX : event.clientY, size: actual[panel] };
        setResizing(panel);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.panel !== panel) return;
        const delta = (vertical ? event.clientX : event.clientY) - current.start;
        update(panel, current.size + (vertical ? delta : -delta));
      }}
      onPointerUp={event => { stop(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={event => {
        const step = event.shiftKey ? 50 : 10;
        const increase = vertical ? 'ArrowRight' : 'ArrowUp';
        const decrease = vertical ? 'ArrowLeft' : 'ArrowDown';
        if (![increase, decrease, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        update(panel, event.key === 'Home' ? limits[panel].min : event.key === 'End' ? limits[panel].max : actual[panel] + (event.key === increase ? step : -step));
      }} />;
  }
  return <div ref={shell} className={`app-shell${terminalVisible ? '' : ' without-terminal'}${preview ? ' with-preview' : ''}${resizing ? ` resizing-${resizing}` : ''}`}
    style={{ '--explorer-width': `${actual.explorer}px`, '--terminal-height': `${actual.terminal}px` } as CSSProperties}>
    {children}
    {handle('explorer')}
    {terminalVisible && handle('terminal')}
  </div>;
}
