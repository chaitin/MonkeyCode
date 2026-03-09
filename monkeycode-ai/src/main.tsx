import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'


import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import { preloadFonts } from './utils/fontLoader.ts';

dayjs.locale('zh-cn');
dayjs.extend(duration);
dayjs.extend(relativeTime);

window.CAP_CUSTOM_WASM_URL = window.location.origin + "/captcha/cap_wasm.js";

// 预加载字体
preloadFonts().then(() => {}).catch((error) => {
  console.warn('字体预加载失败:', error);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
