import { readJsonBody, dataStore } from './_utils.js';
import { applyDataMutation, DataActionError } from './_dataMutations.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = (await readJsonBody(req)) || {};
    const { action, payload, saveMeta } = body;

    const data = await dataStore.mutate(current => applyDataMutation(current, action, payload), saveMeta);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    const status = error instanceof DataActionError ? error.status : 500;
    return res.status(status).json({
      success: false,
      error: error instanceof Error ? error.message : 'Không thể lưu dữ liệu',
    });
  }
}
