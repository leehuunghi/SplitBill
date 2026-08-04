import { readJsonBody, matchHistoryStore, dataStore } from './_utils.js';
import {
  computeMemberStats,
  sortMatchesDesc,
  upsertLossExpense,
  DEFAULT_TEAM_NAMES,
  DEFAULT_TEAM_COLORS,
} from './_matchHistoryUtils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = (await readJsonBody(req)) || {};
    const { teamA, teamB, result, date, note, teamNames, teamColors, lossAmount } = body;
    const idsA = Array.isArray(teamA) ? teamA.map(Number).filter(Boolean) : [];
    const idsB = Array.isArray(teamB) ? teamB.map(Number).filter(Boolean) : [];
    const matchDate = date || new Date().toISOString().slice(0, 10);
    const safeTeamNames = {
      A: (teamNames && teamNames.A) || DEFAULT_TEAM_NAMES.A,
      B: (teamNames && teamNames.B) || DEFAULT_TEAM_NAMES.B,
    };
    const safeTeamColors = {
      A: (teamColors && teamColors.A) || DEFAULT_TEAM_COLORS.A,
      B: (teamColors && teamColors.B) || DEFAULT_TEAM_COLORS.B,
    };

    if (!idsA.length || !idsB.length) {
      return res.status(400).json({ success: false, error: 'Missing teamA/teamB' });
    }
    if (!['A', 'B', 'draw', 'pending'].includes(result)) {
      return res.status(400).json({ success: false, error: 'result must be "A", "B", "draw" or "pending"' });
    }

    const historyData = await matchHistoryStore.read();
    const current = Array.isArray(historyData?.matches) ? historyData.matches : [];
    // Upsert theo date: mỗi ngày chỉ giữ 1 trận, lưu đè nếu đã có.
    const withoutSameDate = current.filter(m => m.date !== matchDate);
    const existing = current.find(m => m.date === matchDate);

    const match = {
      id: existing ? existing.id : Date.now(),
      date: matchDate,
      teamA: idsA,
      teamB: idsB,
      teamNames: safeTeamNames,
      teamColors: safeTeamColors,
      result,
      note: note || '',
      lossExpenseId: existing?.lossExpenseId || null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const lossResult = await upsertLossExpense(match, lossAmount, dataStore);
    match.lossAmount = lossResult.lossAmount;
    match.lossExpenseId = lossResult.lossExpenseId;

    const matches = sortMatchesDesc([match, ...withoutSameDate]);
    await matchHistoryStore.write({ matches });
    res.status(200).json({ success: true, match, members: computeMemberStats(matches) });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save match history',
    });
  }
}
