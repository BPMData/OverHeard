import type { ReactNode } from 'react';
import type { DisplayMode } from '../types';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface AppBannersProps {
  displayMode: DisplayMode;
  isEmbeddedIframe: boolean;
  hasSpeechApi: boolean;
  isSupportedBrowser: boolean;
  importError: string;
  pipNotice: string | null;
  permissionBanner: ReactNode;
  setImportError: (text: string) => void;
  setPipNotice: (notice: string | null) => void;
}

export function AppBanners({
  displayMode, isEmbeddedIframe, hasSpeechApi, isSupportedBrowser, importError, pipNotice,
  permissionBanner, setImportError, setPipNotice,
}: AppBannersProps) {
  return (
    <>
      {/* Browser Compatibility Banner */}
      {displayMode !== 'conversation' && (!isSupportedBrowser || !hasSpeechApi) && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 text-xs sm:text-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Browser Compatibility Notice:</strong> OverHeard is designed for{' '}
              <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> using the Web Speech API.
              {!hasSpeechApi &&
                ' SpeechRecognition is not available in this browser — use the Silent Test Bar below or open in Chrome/Edge.'}
            </span>
          </div>
        </div>
      )}

      {displayMode !== 'conversation' && permissionBanner}

      {/* Pip Notice Banner */}
      {pipNotice && (
        <div className="bg-[#5843A5]/15 border-b border-[#5843A5]/30 px-4 py-2 text-xs flex items-center justify-between gap-4 text-[#3F2E80] dark:text-[#DDD6FE]">
          <span>{pipNotice}</span>
          <div className="flex items-center gap-2 shrink-0">
            {isEmbeddedIframe && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="oh-btn-primary inline-flex items-center gap-1 px-2.5 py-1 rounded-[2px] bg-[#5843A5] dark:bg-[#6D56C6] text-white font-semibold"
              >
                <span>Open Full Tab</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              type="button"
              onClick={() => setPipNotice(null)}
              className="underline hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {importError && displayMode !== 'conversation' && (
        <div role="alert" className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs flex items-center justify-between gap-4 text-amber-800 dark:text-amber-200">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError('')} className="underline hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
