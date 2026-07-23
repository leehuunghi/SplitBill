import { readJsonBody, writeAppData } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = (await readJsonBody(req)) || {};
    const { saveMeta, ...payload } = body;
    const result = await writeAppData(payload, saveMeta);

    return res.status(200).json({
      success: true,
      storage: result.storage,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Không thể lưu dữ liệu',
    });
  }
}
