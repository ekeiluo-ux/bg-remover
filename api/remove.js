// api/remove.js — Vercel Serverless Function
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: 'Missing API Key' });

  try {
    // 读取请求体
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const contentType = req.headers['content-type'];

    // 解析原始 FormData，提取图片文件
    const boundary = contentType.split('boundary=')[1];
    const bodyStr = body.toString('binary');
    const parts = bodyStr.split('--' + boundary);
    
    let imageBuffer = null;
    let imageName = 'image.jpg';
    let imageMime = 'image/jpeg';

    for (const part of parts) {
      if (part.includes('Content-Disposition') && part.includes('image_file')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        
        // 提取文件名和 MIME
        const headerStr = part.slice(0, headerEnd);
        const nameMatch = headerStr.match(/filename="([^"]+)"/);
        const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/);
        if (nameMatch) imageName = nameMatch[1];
        if (mimeMatch) imageMime = mimeMatch[1].trim();
        
        // 提取二进制内容（去掉末尾 \r\n）
        const content = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'));
        imageBuffer = Buffer.from(content, 'binary');
        break;
      }
    }

    if (!imageBuffer) {
      return res.status(400).json({ error: 'No image found in request' });
    }

    // 重新构建 FormData 发给 remove.bg，加入 type=product 参数
    const newBoundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const CRLF = '\r\n';

    const buildPart = (name, value) =>
      `--${newBoundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`;

    let formBody = Buffer.from(
      buildPart('size', 'auto') +
      buildPart('type', 'product') +          // ← 指定为产品图，识别更准
      buildPart('type_level', 'latest') +     // ← 使用最新模型
      buildPart('format', 'png') +
      buildPart('channels', 'rgba') +
      `--${newBoundary}${CRLF}` +
      `Content-Disposition: form-data; name="image_file"; filename="${imageName}"${CRLF}` +
      `Content-Type: ${imageMime}${CRLF}${CRLF}`,
      'binary'
    );

    formBody = Buffer.concat([
      formBody,
      imageBuffer,
      Buffer.from(`${CRLF}--${newBoundary}--${CRLF}`, 'binary')
    ]);

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${newBoundary}`,
      },
      body: formBody,
    });

    const resContentType = response.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', resContentType);
    const data = await response.arrayBuffer();
    res.status(response.status).send(Buffer.from(data));

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed: ' + err.message });
  }
}
