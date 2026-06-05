// api/remove.js — 调用阿里云视觉智能开放平台商品分割 API
import crypto from 'crypto';

export const config = { api: { bodyParser: true, sizeLimit: '10mb' } };

function sign(secret, stringToSign) {
  return crypto.createHmac('sha1', secret + '&')
    .update(stringToSign)
    .digest('base64');
}

function encodeRFC3986(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accessKeyId = process.env.ALI_KEY_ID;
  const accessKeySecret = process.env.ALI_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    return res.status(500).json({ error: 'Server missing Aliyun credentials' });
  }

  try {
    // 读取前端传来的 base64 图片数据
    const { imageBase64, imageUrl } = req.body;
    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // 构建阿里云 API 签名参数
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z/, 'Z');
    const nonce = Math.random().toString(36).slice(2) + Date.now();

    const params = {
      Action: 'SegmentCommodity',       // 商品分割接口
      Version: '2019-09-30',
      Format: 'JSON',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: timestamp,
    };

    // 如果是 base64，用 imageBase64 参数；否则用 URL
    if (imageBase64) {
      params.ImageURL = `data:image/jpeg;base64,${imageBase64}`;
    } else {
      params.ImageURL = imageUrl;
    }

    // 构建待签名字符串
    const sortedKeys = Object.keys(params).sort();
    const canonicalQuery = sortedKeys
      .map(k => `${encodeRFC3986(k)}=${encodeRFC3986(params[k])}`)
      .join('&');
    const stringToSign = `POST&${encodeRFC3986('/')}&${encodeRFC3986(canonicalQuery)}`;
    const signature = sign(accessKeySecret, stringToSign);

    // 构建请求体
    const body = new URLSearchParams();
    sortedKeys.forEach(k => body.append(k, params[k]));
    body.append('Signature', signature);

    const endpoint = 'https://imageseg.cn-shanghai.aliyuncs.com/';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const result = await response.json();

    if (result.Code || result.code) {
      const errCode = result.Code || result.code;
      const errMsg = result.Message || result.message || '未知错误';
      return res.status(400).json({ error: `阿里云错误 ${errCode}: ${errMsg}` });
    }

    // 返回前景图 URL（阿里云返回的是 OSS 链接）
    const imageUrlResult = result.Data?.Elements?.[0]?.ImageURL
      || result.Data?.ImageURL
      || result.Data?.elements?.[0]?.imageUrl;

    if (!imageUrlResult) {
      return res.status(500).json({ error: '未获取到分割结果', raw: result });
    }

    // 下载前景图并转发给前端
    const imgResp = await fetch(imageUrlResult);
    const imgBuf = await imgResp.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(imgBuf));

  } catch (err) {
    console.error('Aliyun API error:', err);
    res.status(500).json({ error: err.message });
  }
}
