import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import type { AreaCoords } from '../types';
import { closeSelectorWindow } from '../services/tauriBridge';

export const AreaSelector: React.FC = () => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const cancelSelection = useCallback(async () => {
    try {
      await closeSelectorWindow();
    } catch (err) {
      console.error('Failed to close selector window:', err);
    }
  }, []);

  const confirmSelection = useCallback(async () => {
    if (!currentBox || currentBox.width < 10 || currentBox.height < 10) return;

    const coords: AreaCoords = {
      x: Math.round(currentBox.x * window.devicePixelRatio),
      y: Math.round(currentBox.y * window.devicePixelRatio),
      width: Math.round(currentBox.width * window.devicePixelRatio),
      height: Math.round(currentBox.height * window.devicePixelRatio),
      scale_factor: window.devicePixelRatio,
    };

    try {
      const raw = localStorage.getItem('mc_words_assistant_settings_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.captureArea = coords;
        localStorage.setItem('mc_words_assistant_settings_v1', JSON.stringify(parsed));
      }
      await closeSelectorWindow(coords);
    } catch (err) {
      console.error('Failed to close selector window with coords:', err);
    }
  }, [currentBox]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelSelection();
      } else if (e.key === 'Enter' && currentBox && currentBox.width > 10 && currentBox.height > 10) {
        confirmSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentBox, confirmSelection, cancelSelection]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    setStartPos({ x, y });
    setCurrentBox({ x, y, width: 0, height: 0 });
    setIsSelecting(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !startPos) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const x = Math.min(startPos.x, currentX);
    const y = Math.min(startPos.y, currentY);
    const width = Math.abs(currentX - startPos.x);
    const height = Math.abs(currentY - startPos.y);

    setCurrentBox({ x, y, width, height });
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="fixed inset-0 w-screen h-screen cursor-crosshair select-none z-50 bg-black/50 overflow-hidden"
    >
      {/* Верхняя подсказка */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-zinc-700 text-zinc-300 text-xs shadow-xl pointer-events-none">
        <span>Выделите область вопроса.</span>
        <span className="font-mono text-zinc-400">Enter — сохранить, Esc — отмена</span>
      </div>

      {/* Прямоугольник выделения */}
      {currentBox && currentBox.width > 2 && currentBox.height > 2 && (
        <div
          style={{
            left: `${currentBox.x}px`,
            top: `${currentBox.y}px`,
            width: `${currentBox.width}px`,
            height: `${currentBox.height}px`,
          }}
          className="absolute border border-white bg-white/5 pointer-events-none"
        >
          {/* Размеры */}
          <div className="absolute -top-6 left-0 px-1.5 py-0.5 rounded bg-zinc-950/90 border border-zinc-800 text-[10px] font-mono text-zinc-300 whitespace-nowrap">
            {Math.round(currentBox.width)} × {Math.round(currentBox.height)}
          </div>
        </div>
      )}

      {/* Панель подтверждения после выбора */}
      {currentBox && !isSelecting && currentBox.width > 15 && currentBox.height > 15 && (
        <div
          style={{
            left: `${Math.min(window.innerWidth - 180, Math.max(10, currentBox.x + currentBox.width / 2 - 80))}px`,
            top: `${Math.min(window.innerHeight - 50, currentBox.y + currentBox.height + 8)}px`,
          }}
          className="absolute flex items-center gap-1.5 p-1 rounded-lg bg-zinc-950/95 backdrop-blur-md border border-zinc-700 shadow-xl cursor-default"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={confirmSelection}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Сохранить</span>
          </button>
          <button
            onClick={cancelSelection}
            className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Отмена</span>
          </button>
        </div>
      )}
    </div>
  );
};
