import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'vendor/mujoco/*',
          dest: 'vendor/mujoco',
        },
      ],
    }),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      external: ['/vendor/mujoco/mujoco_wasm.js'],
    },
  },
  server: {
    fs: {
      allow: ['.', path.resolve(__dirname, 'vendor')],
    },
  },
})
