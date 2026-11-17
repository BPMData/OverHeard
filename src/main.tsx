import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { StudentRoom } from './rooms/StudentRoom';
import { roomCodeFromLocation } from './rooms/roomLink';

const room = roomCodeFromLocation(window.location);
createRoot(document.getElementById('root')!).render(room !== null
  ? <StudentRoom code={room} /> : <App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
