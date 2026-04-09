import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'sarasa-mono-web/index.css'
import './index.css'
import App from './App.tsx'


import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.locale('zh-cn');
dayjs.extend(duration);
dayjs.extend(relativeTime);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
