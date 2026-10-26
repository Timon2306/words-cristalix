import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { AreaCoords } from '../types';

interface UseTauriEventsProps {
  onTriggerCapture?: () => void;
  onPickWordByIndex?: (index: number) => void;
  onAreaSelected?: (coords: AreaCoords) => void;
  onClickthroughChanged?: (active: boolean) => void;
  onCristalixLogLine?: (line: string) => void;
  onLogWatcherStarted?: (path: string) => void;
  onLogWatcherStopped?: () => void;
}

export function useTauriEvents(handlers: UseTauriEventsProps) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let isMounted = true;

    async function setupListeners() {
      try {
        const uCapture = await listen('trigger-capture', () => {
          handlersRef.current.onTriggerCapture?.();
        });
        if (!isMounted) { uCapture(); return; }
        unlisteners.push(uCapture);

        const uPick = await listen<{ index: number }>('trigger-pick-word', (event) => {
          if (event.payload && typeof event.payload.index === 'number') {
            handlersRef.current.onPickWordByIndex?.(event.payload.index);
          }
        });
        if (!isMounted) { uPick(); return; }
        unlisteners.push(uPick);

        const uArea = await listen<AreaCoords>('area-selected', (event) => {
          if (event.payload) {
            handlersRef.current.onAreaSelected?.(event.payload);
          }
        });
        if (!isMounted) { uArea(); return; }
        unlisteners.push(uArea);

        const uClickthrough = await listen<boolean>('hud-clickthrough-changed', (event) => {
          if (typeof event.payload === 'boolean') {
            handlersRef.current.onClickthroughChanged?.(event.payload);
          }
        });
        if (!isMounted) { uClickthrough(); return; }
        unlisteners.push(uClickthrough);

        const uLogLine = await listen<string>('cristalix-log-line', (event) => {
          if (typeof event.payload === 'string') {
            handlersRef.current.onCristalixLogLine?.(event.payload);
          }
        });
        if (!isMounted) { uLogLine(); return; }
        unlisteners.push(uLogLine);

        const uLogStarted = await listen<string>('log-watcher-started', (event) => {
          handlersRef.current.onLogWatcherStarted?.(event.payload);
        });
        if (!isMounted) { uLogStarted(); return; }
        unlisteners.push(uLogStarted);

        const uLogStopped = await listen('log-watcher-stopped', () => {
          handlersRef.current.onLogWatcherStopped?.();
        });
        if (!isMounted) { uLogStopped(); return; }
        unlisteners.push(uLogStopped);
      } catch (err) {
        console.warn('Could not register Tauri event listeners (browser dev mode?):', err);
      }
    }

    setupListeners();

    return () => {
      isMounted = false;
      unlisteners.forEach((u) => u());
    };
  }, []);
}
