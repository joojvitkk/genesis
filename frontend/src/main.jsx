import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { MotionConfig } from 'framer-motion'
import { I18nProvider } from './lib/i18n.jsx'
import { purgeApiCaches } from './lib/auth'

purgeApiCaches() // o app é só online: apaga o cache de API que versões antigas do service worker deixaram

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      {/* prefers-reduced-motion: sem deslocamento/escala, só opacidade */}
      <MotionConfig reducedMotion="user"><App /></MotionConfig>
    </I18nProvider>
  </StrictMode>,
)
