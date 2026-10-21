import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { useT } from '../i18n';

interface HudPreviewBarProps {
  hudUrl: string;
  onExit: () => void;
}

/**
 * Floating controls shown only when the HUD is opened from the app's own navigation.
 * The link pasted into OBS never shows them, so the real overlay stays clean.
 */
export const HudPreviewBar: React.FC<HudPreviewBarProps> = ({ hudUrl, onExit }) => {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExit]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(hudUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t('hudPreview.promptTitle'), hudUrl);
    }
  };

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs text-zinc-200 shadow-xl">
      <button
        onClick={onExit}
        className="flex items-center gap-1.5 rounded-sm bg-indigo-600 px-2.5 py-1 font-semibold text-white hover:bg-indigo-500 transition"
        title={t('hudPreview.backTitle')}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('common.back')}
      </button>
      <span className="text-zinc-400">{t('hudPreview.label')}</span>
      <button
        onClick={copyLink}
        className="flex items-center gap-1 rounded-sm border border-zinc-700 bg-zinc-800 px-2 py-1 hover:bg-zinc-700 transition"
        title={t('hudPreview.copyTitle')}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('common.copied') : t('hudPreview.copy')}
      </button>
    </div>
  );
};
