import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // GitHub Pages 公開時に相対パスでアセットを読み込む設定
});