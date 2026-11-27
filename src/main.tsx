import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { StudentRoom } from './rooms/StudentRoom';
import { roomCodeFromLocation } from './rooms/roomLink';
import { ProblemReportHost } from './report/ProblemReportModal';

const room = roomCodeFromLocation(window.location);
createRoot(document.getElementById('root')!).render(
  <>
    {room !== null ? <StudentRoom code={room} /> : <App />}
    <ProblemReportHost />
  </>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    // Ask the browser not to clear saved voices and the offline copy when space runs low.
    // Chrome grants this quietly (no prompt) for installed or often-used sites.
    void navigator.storage?.persist?.().catch(() => false);
  });
}
