import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { AppRuntimeProvider } from './components/app-runtime-provider'
import { getSiteRedirectUrl } from './site-redirect'


import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(duration);
dayjs.extend(relativeTime);

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRuntimeProvider>
        <App />
      </AppRuntimeProvider>
    </StrictMode>,
  )
}

const siteRedirectUrl = getSiteRedirectUrl()

if (siteRedirectUrl) {
  window.location.replace(siteRedirectUrl)
} else {
  void initI18n().then(renderApp)
}
