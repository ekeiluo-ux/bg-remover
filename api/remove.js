import crypto from 'crypto';

export const config = { api: { bodyParser: true, sizeLimit: '10mb' } };

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function makeSignature(secret, stringToSign) {
  return crypto.createHmac('sha1', secret + '&')
    .update(stringToSign)
    .digest('base64');
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

    // 将 base64 上传到阿里云 OSS 临时存储，或直接用 base64 URL
    // 阿里云视觉API支持 base64 格式的 data URL
    const imageURL = `data:image/jpeg;base64,${imageBase64}`;

    // 构建请求参数
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
      ImageURL: imageURL,
    };

    // 按 key 排序
    const sortedKeys = Object.keys(params).sort();

    // 构建规范化查询字符串
    const canonicalizedQuery = sortedKeys
      .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');

    // 构建待签名字符串
    const stringToSign = [
      'POST',
      percentEncode('/'),
      percentEncode(canonicalizedQuery),
    ].join('&');

    const signature = makeSignature(accessKeySecret, stringToSign);

    // 构建最终请求体
    const formBody = new URLSearchParams();
    sortedKeys.forEach(k => formBody.append(k, params[k]));
    formBody.append('Signature', signature);

    console.log('Calling Aliyun API, action:', params.Action, 'version:', params.Version);

    const response = await fetch('https://imageseg.cn-shanghai.aliyuncs.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: formBody.toString(),
    });

    const result = await response.json();
    console.log('Aliyun response:', JSON.stringify(result).slice(0, 300));

    // 检查错误
    if (result.Code || (result.code && result.code !== '200')) {
      const code = result.Code || result.code;
      const msg = result.Message || result.message || JSON.stringify(result);
      return res.status(400).json({ error: `阿里云错误 ${code}: ${msg}` });
    }

    // 获取结果图 URL
    const resultUrl =
      result?.Data?.Elements?.[0]?.ImageURL ||
      result?.Data?.ImageURL ||
      result?.data?.elements?.[0]?.imageUrl ||
      result?.data?.imageUrl;

    if (!resultUrl) {
      console.error('No result URL in response:', JSON.stringify(result));
      return res.status(500).json({ error: '未获取到分割结果图', raw: result });
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
