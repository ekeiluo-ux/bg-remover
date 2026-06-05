// api/remove.js — Vercel Serverless Function
// 作为代理转发请求到 remove.bg，解决浏览器 CORS 限制

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // CORS headers — 允许所有来源访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: 'Missing API Key' });

  try {
    // 读取请求体（原始二进制）
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    // 获取原始 Content-Type（含 boundary）
    const contentType = req.headers['content-type'];

    // 转发到 remove.bg
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': contentType,
      },
      body,
    });

    // 透传响应头
    const resContentType = response.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', resContentType);

    // 返回结果（图片 PNG 或 JSON 错误）
    const data = await response.arrayBuffer();
    res.status(response.status).send(Buffer.from(data));

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed: ' + err.message });
  }
}
