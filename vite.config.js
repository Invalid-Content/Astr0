import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Relative paths in the built site, so it works from a subfolder such as
  // https://invalid-content.github.io/Astr0/ as well as from a domain root.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
}))
