import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { StudentRoom } from './rooms/StudentRoom';
import { normalizeRoomCode } from './rooms/protocol';

const room = new URLSearchParams(window.location.search).get('room');
createRoot(document.getElementById('root')!).render(room !== null
  ? <StudentRoom code={normalizeRoomCode(room)} /> : <App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
