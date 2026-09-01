import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    define: { 'process.env.API_TOKEN': JSON.stringify(process.env.API_TOKEN) },
  },
});
