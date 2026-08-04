import { matchHistoryStore } from '../_utils.js';
import { computeMemberStats, sortMatchesDesc } from '../_matchHistoryUtils.js';

export default async function handler(_req, res) {
  try {
    const data = await matchHistoryStore.read();
    const matches = sortMatchesDesc(Array.isArray(data?.matches) ? data.matches : []);
    res.status(200).json({ members: computeMemberStats(matches), matches });
  } catch (_error) {
    res.status(200).json({ members: {}, matches: [] });
  }
}
