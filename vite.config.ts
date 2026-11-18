import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'canonical-localhost-origin',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.headers.host?.split(':')[0] === 'localhost') {
            response.statusCode = 308;
            response.setHeader('Location', `http://127.0.0.1:5180${request.url ?? '/'}`);
            response.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
});
