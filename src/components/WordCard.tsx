import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy, Send } from 'lucide-react';
import type { WordSuggestion } from '../types';

interface WordCardProps {
  index: number;
  suggestion: WordSuggestion;
  shortcutLabel: string;
  autoSubmit: boolean;
  onPickWord: (word: string) => void;
}

export const WordCard: React.FC<WordCardProps> = ({
  index,
  suggestion,
  shortcutLabel,
  autoSubmit,
  onPickWord,
}) => {
  const [justClicked, setJustClicked] = useState(false);

  const handleClick = () => {
    onPickWord(suggestion.word);
    setJustClicked(true);
    setTimeout(() => setJustClicked(false), 1000);
  };

  const isFirst = index === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.03 }}
      onClick={handleClick}
      className={`group relative flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer select-none transition-all ${
        isFirst
          ? 'bg-zinc-900 border-zinc-700 hover:border-zinc-600'
          : 'bg-zinc-900/60 hover:bg-zinc-850 border-zinc-800/80 hover:border-zinc-700'
      }`}
    >
      {/* Левая часть: номер и слово */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-xs text-zinc-500 font-semibold w-3 text-center">
          {index + 1}
        </span>

        <div className="flex flex-col min-w-0">
          <span className="font-mono font-bold text-sm tracking-wide truncate uppercase text-zinc-100 group-hover:text-white">
            {suggestion.word}
          </span>
          {suggestion.definition && (
            <span className="text-[10px] text-zinc-500 truncate max-w-[190px]">
              {suggestion.definition}
            </span>
          )}
        </div>
      </div>

      {/* Правая часть: длина и хоткей / статус */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <AnimatePresence mode="wait">
          {justClicked ? (
            <motion.div
              key="sent"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 text-[10px] font-medium"
            >
              <Check className="w-3 h-3" />
              <span>{autoSubmit ? 'В чат' : 'Скопировано'}</span>
            </motion.div>
          ) : (
            <motion.div
              key="default"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1.5"
            >
              {/* Количество букв */}
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800 border border-zinc-750">
                {suggestion.length} б.
              </span>

              {/* Хоткей по наведению */}
              <div className="hidden group-hover:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[9px] font-mono">
                {autoSubmit ? <Send className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                <span>{shortcutLabel}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
