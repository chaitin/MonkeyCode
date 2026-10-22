import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL;
const base = process.env.PUBLIC_BASE_PATH ?? '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  integrations: [
    {
      name: 'isolated-vite-cache',
      hooks: {
        'astro:config:setup': ({ command, updateConfig }) => {
          // Type checks and builds must not overwrite the running dev server's optimized dependencies.
          updateConfig({ vite: { cacheDir: fileURLToPath(new URL(`./node_modules/.vite/astro-${command}`, import.meta.url)) } });
        },
      },
    },
    react(),
    icon({
      include: {
        hugeicons: [
          'arrow-down-01',
          'arrow-right-02',
          'arrow-up-02',
          'arrow-up-right-01',
          'brain',
          'bubble-chat',
          'cancel-01',
          'chart-line',
          'checkmark-square-02',
          'code',
          'coins-01',
          'command',
          'comment-01',
          'computer',
          'database-01',
          'file-02',
          'flash',
          'github-01',
          'global',
          'invoice-01',
          'kanban',
          'message-multiple-01',
          'more-horizontal',
          'plug-01',
          'ppt-01',
          'robot-01',
          'security-check',
          'share-01',
          'settings-01',
          'sidebar-right',
          'server-stack-01',
          'tick-02',
          'user',
          'user-group',
          'xls-01',
        ],
      },
    }),
  ],
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [tailwindcss()],
  },
});
