import { matchHistoryStore } from '../_utils.js';
import { computeMemberStats, sortMatchesDesc } from '../_matchHistoryUtils.js';

export default async function handler(_req, res) {
  try {
    const data = await matchHistoryStore.read({ fallbackToBundled: true });
    const matches = sortMatchesDesc(Array.isArray(data?.matches) ? data.matches : []);
    const baseline = data?.baseline && typeof data.baseline === 'object' ? data.baseline : {};
    res.status(200).json({ members: computeMemberStats(matches), matches, baseline });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: `Không tải được lịch sử trận: ${error?.message || 'lỗi không xác định'}`,
    });
  }
}
