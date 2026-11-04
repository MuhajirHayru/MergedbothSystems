import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8000';

const backendProxy = {
  target: BACKEND,
  changeOrigin: true,
  secure: false,
  cookieDomainRewrite: '',
};

// Development: serve Vite in middleware mode for hot-reload.
// Production: serve the compiled SPA.
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createServer({
      server: {
        middlewareMode: true,
        proxy: {
          '/api': backendProxy,
          '/media': backendProxy,
          // NOTE: '/admin' is intentionally NOT proxied — the SPA owns that
          // route (User Administrator Console). Django's own admin remains
          // reachable directly on the backend port (http://127.0.0.1:8000/admin/).
          '/static': backendProxy,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`GreenPath Farm to Market AI server running on port ${PORT} (API proxy → ${BACKEND})`);
  });
}

startServer();
