import { Hono } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

const IMAGEMAP_WIDTHS = new Set(['1040', '700', '460', '300', '240']);
const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'gif'];

function createImageHeaders(object: R2Object, contentType?: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', contentType || object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return headers;
}

function applyRangeHeaders(headers: Headers, object: R2ObjectBody): number {
  const offset = object.range && 'offset' in object.range ? object.range.offset : undefined;
  const length = object.range && 'length' in object.range ? object.range.length : undefined;
  if (typeof offset !== 'number' || typeof length !== 'number') {
    headers.set('Content-Length', String(object.size));
    return 200;
  }

  headers.set('Content-Length', String(length));
  headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
  return 206;
}

async function getStoredImage(env: Env['Bindings'], keyOrId: string) {
  const direct = await env.IMAGES.get(keyOrId);
  if (direct) return direct;

  const basename = keyOrId.replace(/\.(jpe?g|png|webp|gif)$/i, '');
  for (const ext of IMAGE_EXTENSIONS) {
    const object = await env.IMAGES.get(`${basename}.${ext}`);
    if (object) return object;
  }
  return null;
}

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 5 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 5MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const url = `${workerUrl}/images/${key}`;
    const imagemapBaseUrl = `${workerUrl}/images/imagemap/${id}`;

    return c.json({
      success: true,
      data: { id, key, url, imagemapBaseUrl, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /images/imagemap/:id/:size — LINE imagemap message image endpoint
images.get('/images/imagemap/:id/:size', async (c) => {
  const id = c.req.param('id');
  const size = c.req.param('size');
  if (!IMAGEMAP_WIDTHS.has(size)) {
    return c.json({ success: false, error: 'Invalid imagemap size' }, 400);
  }

  const object = await getStoredImage(c.env, id);
  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  // iOS系の画像ローダーはRangeリクエストで画像を取得する場合がある。
  // R2へRangeヘッダーを渡し、部分取得時は206とContent-Rangeを正しく返す。
  const object = await c.env.IMAGES.get(key, { range: c.req.raw.headers });

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const headers = createImageHeaders(object);
  const status = applyRangeHeaders(headers, object);

  return new Response(object.body, { status, headers });
});

// HEAD /images/:key — 本体を返さず、画像取得前の互換性確認に応答する
images.on('HEAD', '/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.IMAGES.head(key);

  if (!object) {
    return new Response(null, { status: 404 });
  }

  const headers = createImageHeaders(object);
  headers.set('Content-Length', String(object.size));

  return new Response(null, { status: 200, headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
