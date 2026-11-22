import type { DisplayMode } from '../types';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface PermissionBannerProps {
  displayMode: DisplayMode;
  isEmbeddedIframe: boolean;
  micInsecure: boolean;
}

export function PermissionBanner({
  displayMode, isEmbeddedIframe, micInsecure,
}: PermissionBannerProps) {
  return (
    <div className="bg-red-500/15 border-b border-red-500/30 px-4 py-3 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start sm:items-center gap-2.5 text-red-800 dark:text-red-200">
        <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5 sm:mt-0" />
        <div>
          {micInsecure ? (
            <>
              <strong>Microphone unavailable on this address:</strong> browsers only allow the
              microphone on <strong>https://</strong> pages (or localhost). Open OverHeard from its
              https link instead of {window.location.origin}.
            </>
          ) : (
            <>
              <strong>Microphone Permission Blocked:</strong> the browser didn&apos;t allow the
              microphone. On a computer, click the tune/lock icon in the address bar and set{' '}
              <strong>Microphone</strong> to <strong>Allow</strong>. On Android, tap the tune/lock
              icon → <strong>Permissions</strong> → <strong>Microphone</strong> → Allow (in the
              installed app: long-press its icon → App info → Permissions). If Chrome itself lacks
              mic access, enable it in Android Settings → Apps → Chrome → Permissions. Then press{' '}
              <strong>{displayMode === 'conversation' ? 'Start conversation' : 'Start Listening'}</strong> again.
            </>
          )}
          {isEmbeddedIframe && (
            <span>
              {' '}
              (Note: Microphones are often blocked inside embedded preview panes — open OverHeard in a full browser tab.)
            </span>
          )}
        </div>
      </div>
      {isEmbeddedIframe && (
        <a
          href={window.location.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] bg-red-600 text-white font-semibold text-xs hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
        >
          <span>Open Full Tab</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}
