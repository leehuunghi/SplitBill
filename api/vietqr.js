import 'dotenv/config';
import { readJsonBody } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { amount, addInfo, acqId, accountNo, accountName } = await readJsonBody(req);

    if (!amount || !acqId || !accountNo || !accountName) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    if (!process.env.VIETQR_CLIENT_ID || !process.env.VIETQR_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Missing VietQR API credentials' });
    }

    const payload = {
      accountNo,
      accountName,
      acqId: Number(acqId),
      amount: Number(amount),
      addInfo: addInfo || '',
      format: 'text',
      template: 'compact',
    };

    const response = await fetch('https://api.vietqr.io/v2/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.VIETQR_CLIENT_ID,
        'x-api-key': process.env.VIETQR_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    const qrData = data?.data?.qrData || data?.data?.qrCode;

    if (!qrData) {
      return res
        .status(502)
        .json({ ok: false, error: 'Failed to generate payload', raw: data });
    }

    return res.status(200).json({ ok: true, payload: qrData });
  } catch (_error) {
    return res.status(500).json({ ok: false, error: 'VietQR API error' });
  }
}
