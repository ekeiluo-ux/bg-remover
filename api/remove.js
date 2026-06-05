import crypto from 'crypto';

export const config = { api: { bodyParser: true, sizeLimit: '10mb' } };

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accessKeyId = process.env.ALI_KEY_ID;
  const accessKeySecret = process.env.ALI_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    return res.status(500).json({ error: 'Aliyun credentials not configured in Vercel env vars' });
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

    // 构建参数 — 使用 base64 编码内容直接传输（非 data URL）
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const nonce = crypto.randomBytes(16).toString('hex');

    const params = {
      Action: 'SegmentCommodity',
      Version: '2019-09-30',
      Format: 'JSON',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: timestamp,
      // 直接传 base64 字符串（不含 data:image 前缀）
      PicContent: imageBase64,
    };

    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQuery = sortedKeys
      .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');

    const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalizedQuery)}`;

    const signature = crypto
      .createHmac('sha1', accessKeySecret + '&')
      .update(stringToSign)
      .digest('base64');

    const formBody = new URLSearchParams();
    sortedKeys.forEach(k => formBody.append(k, params[k]));
    formBody.append('Signature', signature);

    console.log('Calling SegmentCommodity with PicContent, length:', imageBase64.length);

    const response = await fetch('https://imageseg.cn-shanghai.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: formBody.toString(),
    });

    const result = await response.json();
    console.log('Aliyun result keys:', Object.keys(result));
    console.log('Aliyun result:', JSON.stringify(result).slice(0, 500));

    // 错误处理
    if (result.Code) {
      return res.status(400).json({ error: `阿里云错误 ${result.Code}: ${result.Message}` });
    }

    // 获取结果图 URL
    const resultUrl =
      result?.Data?.Elements?.[0]?.ImageURL ||
      result?.Data?.ImageURL ||
      result?.data?.elements?.[0]?.imageUrl ||
      result?.data?.imageUrl;

    if (!resultUrl) {
      return res.status(500).json({ error: '未获取到分割结果', raw: result });
    }

    // 下载结果图并转发给前端
    const imgResp = await fetch(resultUrl);
    const imgBuf = await imgResp.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(imgBuf));

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
