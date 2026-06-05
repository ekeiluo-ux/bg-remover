// api/account.js — 验证阿里云 AccessKey 是否配置正确
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyId = process.env.ALI_KEY_ID;
  const keySecret = process.env.ALI_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(400).json({ error: 'Aliyun credentials not configured in Vercel env vars' });
  }

  // 只检查环境变量是否存在，不实际调用 API 消耗额度
  return res.status(200).json({
    valid: true,
    keyId: keyId.slice(0, 4) + '****' + keyId.slice(-4),
    message: '阿里云凭证已配置'
  });
}
