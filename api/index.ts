import type { Request, Response } from 'express';
import { createExpressApp } from '../server.ts';

// Mark Vercel runtime environment
process.env.VERCEL = '1';

let cachedApp: any = null;

export default async function handler(req: Request, res: Response) {
  if (!cachedApp) {
    cachedApp = await createExpressApp();
  }

  // Handle URL rewrites from Vercel:
  // If request was rewritten from /api/(.*), restore or normalize original url
  const matchedPath = (req.headers && req.headers['x-matched-path']) as string;
  if (matchedPath && matchedPath.startsWith('/api')) {
    req.url = matchedPath;
  } else if (req.query && (req.query as any)[0]) {
    const sub = (req.query as any)[0];
    const subpath = Array.isArray(sub) ? sub.join('/') : sub;
    req.url = `/api/${subpath}`;
  }

  return cachedApp(req, res);
}
