import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { AppRuntimeProvider } from './components/app-runtime-provider'


import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(duration);
dayjs.extend(relativeTime);

// Chrome refuses to construct fetch Requests on a document whose URL embeds
// basic-auth credentials (https://user:pass@host/...): every relative API call
// throws "Request cannot be constructed from a URL that includes credentials",
// which reads like a global sign-out. Gated test deployments are opened via
// such credentialed links (e.g. the Open Design export jump); that first
// navigation already primed the browser's HTTP auth cache, so replacing with
// the credential-free same-origin URL keeps access, keeps the fragment
// (#od-task= included), and unbreaks fetch. Must be absolute — a relative
// replace would resolve against the credentialed base and keep the userinfo.
function stripUrlCredentials(): boolean {
  try {
    const base = new URL(document.baseURI)
    if (!base.username && !base.password) return false
    window.location.replace(
      window.location.origin + window.location.pathname + window.location.search + window.location.hash,
    )
    return true
  } catch {
    return false
  }
}

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRuntimeProvider>
        <App />
      </AppRuntimeProvider>
    </StrictMode>,
  )
}

if (!stripUrlCredentials()) {
  void initI18n().then(renderApp)
}
