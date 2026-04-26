import { readJsonBody, writeAppData } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const payload = await readJsonBody(req);
    const result = await writeAppData(payload || {});

    return res.status(200).json({
      ok: true,
      storage: result.storage,
    });
  } catch (_error) {
    return res.status(500).json({
      ok: false,
      error: 'Không thể lưu dữ liệu',
    });
  }
}
