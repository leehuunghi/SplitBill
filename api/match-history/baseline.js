import { readJsonBody, matchHistoryStore } from '../_utils.js';
import { STAR_LEVELS } from '../../src/playerRating.js';

// Lưu "level ban đầu" (baseline) admin xếp thủ công ở tab riêng trong
// /admin/chiateam — { memberId: sốSao }. Chỉ ghi đè field baseline, giữ
// nguyên toàn bộ matches hiện có.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = (await readJsonBody(req)) || {};
    const baselineInput = body.baseline;
    if (!baselineInput || typeof baselineInput !== 'object' || Array.isArray(baselineInput)) {
      return res.status(400).json({ success: false, error: 'baseline phải là object { memberId: sốSao }' });
    }
    const baseline = {};
    Object.entries(baselineInput).forEach(([id, stars]) => {
      const numId = Number(id);
      const numStars = Number(stars);
      if (Number.isFinite(numId) && STAR_LEVELS.includes(numStars)) baseline[numId] = numStars;
    });

    const saveMeta = { route: '/admin/chiateam', action: 'Cập nhật level ban đầu (baseline)' };
    const historyData = await matchHistoryStore.read();
    const matches = Array.isArray(historyData?.matches) ? historyData.matches : [];
    await matchHistoryStore.write({ matches, baseline }, saveMeta);
    res.status(200).json({ success: true, baseline });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save baseline',
    });
  }
}
