import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative asset paths: the built site works at a domain root AND at a
  // GitHub Pages project subpath (https://<user>.github.io/<repo>/)
  // without hardcoding the repo name.
  base: './',
  plugins: [react(), tailwindcss()],
});
