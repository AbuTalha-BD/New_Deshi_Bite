import type { Request, Response } from 'express';
import { createExpressApp } from '../server.ts';

// Mark Vercel runtime environment
process.env.VERCEL = '1';

let cachedApp: any = null;

export default async function handler(req: Request, res: Response) {
  try {
    if (!cachedApp) {
      cachedApp = await createExpressApp();
    }

    // Restore the real requested URL from Vercel headers or query parameters
    const forwardedUri = (req.headers && req.headers['x-forwarded-uri']) as string;
    const originalPath = (req.headers && req.headers['x-vercel-original-path']) as string;
    const queryPath = req.query && typeof req.query.path === 'string' ? req.query.path : null;

    if (forwardedUri && forwardedUri.startsWith('/api')) {
      req.url = forwardedUri;
    } else if (originalPath && originalPath.startsWith('/api')) {
      req.url = originalPath;
    } else if (queryPath) {
      req.url = `/api/${queryPath}`;
    } else if (req.url && !req.url.startsWith('/api') && req.url !== '/') {
      req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
    }

    return cachedApp(req, res);
  } catch (error: any) {
    console.error('[Vercel Handler Fatal]:', error);
    return res.status(500).json({
      error: 'Vercel Serverless Function encountered an error',
      message: error?.message || String(error),
    });
  }
}
