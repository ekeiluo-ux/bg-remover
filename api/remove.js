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
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

    // Step 1: 把图片上传到 imgbb 免费图床，获取公网 URL
    const mime = mimeType || 'image/jpeg';
    const imgbbApiKey = process.env.IMGBB_KEY; // 可选，不填则用备用方案

    let imageURL;

    if (imgbbApiKey) {
      // 使用 imgbb 图床
      const form = new URLSearchParams();
      form.append('key', imgbbApiKey);
      form.append('image', imageBase64);
      const uploadResp = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: form,
      });
      const uploadResult = await uploadResp.json();
      if (!uploadResult.success) throw new Error('imgbb upload failed: ' + JSON.stringify(uploadResult));
      imageURL = uploadResult.data.url;
    } else {
      // 备用方案：使用 Vercel 内置的 base64 data URL（阿里云新版支持）
      const ext = mime.includes('png') ? 'png' : 'jpg';
      imageURL = `data:${mime};base64,${imageBase64}`;
    }

    console.log('Image URL type:', imageURL.startsWith('data:') ? 'base64 dataURL' : 'public URL');

    // Step 2: 调用阿里云 SegmentCommodity API（正确版本：2019-12-30）
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const nonce = crypto.randomBytes(16).toString('hex');

    const params = {
      Action: 'SegmentCommodity',
      Version: '2019-12-30',        // ✅ 正确版本号
      Format: 'JSON',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: timestamp,
      ImageURL: imageURL,
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

    console.log('Calling SegmentCommodity v2019-12-30...');

    const response = await fetch('https://imageseg.cn-shanghai.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: formBody.toString(),
    });

    const result = await response.json();
    console.log('Aliyun result:', JSON.stringify(result).slice(0, 500));

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

    // 下载结果图并返回给前端
    const imgResp = await fetch(resultUrl);
    const imgBuf = await imgResp.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(imgBuf));

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
