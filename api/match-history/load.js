import { matchHistoryStore } from '../_utils.js';
import { computeMemberStats, sortMatchesDesc } from '../_matchHistoryUtils.js';

export default async function handler(_req, res) {
  try {
    const data = await matchHistoryStore.read();
    const matches = sortMatchesDesc(Array.isArray(data?.matches) ? data.matches : []);
    const baseline = data?.baseline && typeof data.baseline === 'object' ? data.baseline : {};
    res.status(200).json({ members: computeMemberStats(matches), matches, baseline });
  } catch (_error) {
    res.status(200).json({ members: {}, matches: [], baseline: {} });
  }
}
