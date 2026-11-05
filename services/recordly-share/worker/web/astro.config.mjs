import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: { dedupe: ['react', 'react-dom', '@heroui/react', '@phosphor-icons/react'] },
    define: { __RECORDLY_PUBLIC_DIR__: JSON.stringify(fileURLToPath(new URL('../../../../public/', import.meta.url))) },
  },
  build: {
    format: 'file',
  },
});
