import { matchHistoryStore, dataStore } from '../_utils.js';
import { computeMemberStats, sortMatchesDesc } from '../_matchHistoryUtils.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { date } = req.query;
    const historyData = await matchHistoryStore.read();
    const current = Array.isArray(historyData?.matches) ? historyData.matches : [];
    const target = current.find(m => m.date === date);

    // Xoá trận thì cũng dọn luôn khoản chi tiền thua gắn với trận đó (nếu có),
    // tránh để lại khoản chi mồ côi trong data.json.
    if (target?.lossExpenseId) {
      try {
        const data = await dataStore.read();
        const expenses = Array.isArray(data.expenses) ? data.expenses : [];
        const nextExpenses = expenses.filter(e => e.id !== target.lossExpenseId);
        if (nextExpenses.length !== expenses.length) {
          await dataStore.write({ ...data, expenses: nextExpenses, savedAt: new Date().toISOString() });
        }
      } catch (_error) {
        // Không chặn việc xoá trận nếu dọn khoản chi thất bại
      }
    }

    const matches = sortMatchesDesc(current.filter(m => m.date !== date));
    await matchHistoryStore.write({ matches });
    res.status(200).json({ success: true, members: computeMemberStats(matches), matches });
  } catch (_error) {
    res.status(500).json({ success: false, error: 'Failed to delete match' });
  }
}
