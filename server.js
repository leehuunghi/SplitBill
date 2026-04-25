import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();
const PORT = 5174;
const dataPath = path.resolve('src', 'data.json');

app.use(express.json({ limit: '1mb' }));

app.get('/api/load', async (_req, res) => {
  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(200).json({
      members: [],
      expenses: [],
      payments: [],
      treasurerAccount: '',
      qrCache: {},
      nextMemberId: 1,
    });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const payload = req.body || {};
    await fs.writeFile(dataPath, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to save file' });
  }
});

app.post('/api/vietqr', async (req, res) => {
  try {
    const { amount, addInfo, acqId, accountNo, accountName } = req.body || {};
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
      return res.status(502).json({ ok: false, error: 'Failed to generate payload', raw: data });
    }
    return res.json({ ok: true, payload: qrData });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'VietQR API error' });
  }
});

app.listen(PORT, () => {
  console.log(`Data server running on http://localhost:${PORT}`);
});
