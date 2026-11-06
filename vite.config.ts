import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  // Supabase is loaded lazily; pre-bundle it at startup so Vite doesn't re-optimize mid-session
  // (that reload can leave two React copies running and blank the page).
  optimizeDeps: { include: ['@supabase/supabase-js'] },
})
