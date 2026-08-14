import 'dotenv/config';
import express from 'express';
import { dataStore, matchHistoryStore, defaultData } from './api/_utils.js';
import {
  computeMemberStats,
  sortMatchesDesc,
  upsertLossExpense,
  DEFAULT_TEAM_NAMES,
  DEFAULT_TEAM_COLORS,
} from './api/_matchHistoryUtils.js';
import { applyDataMutation, DataActionError } from './api/_dataMutations.js';

const app = express();
const PORT = 5174;

app.use(express.json({ limit: '1mb' }));

app.get('/api/load', async (_req, res) => {
  try {
    res.json(await dataStore.read());
  } catch (_err) {
    res.status(200).json(defaultData);
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const { saveMeta, ...payload } = req.body || {};
    if (saveMeta) {
      console.log(
        `[save] route=${saveMeta.route || 'unknown'} action=${saveMeta.action || 'unknown'} at=${saveMeta.at || ''}`
      );
    }
    const result = await dataStore.write(payload, saveMeta);
    res.json({ success: true, storage: result.storage });
  } catch (_err) {
    res.status(500).json({ success: false, error: 'Failed to save file' });
  }
});

// Đọc bản mới nhất trước khi áp dụng action, tránh đè lên thay đổi của
// người khác vừa lưu xen giữa (xem api/data-action.js / api/_dataMutations.js).
app.post('/api/data-action', async (req, res) => {
  try {
    const { action, payload, saveMeta } = req.body || {};
    const data = await dataStore.mutate(current => applyDataMutation(current, action, payload), saveMeta);
    res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err instanceof DataActionError ? err.status : 500;
    res.status(status).json({ success: false, error: err?.message || 'Không thể lưu dữ liệu' });
  }
});

app.get('/api/match-history/load', async (_req, res) => {
  const historyData = await matchHistoryStore.read();
  const matches = sortMatchesDesc(Array.isArray(historyData?.matches) ? historyData.matches : []);
  res.json({ members: computeMemberStats(matches), matches });
});

app.post('/api/save-match-history', async (req, res) => {
  try {
    const { teamA, teamB, result, date, note, teamNames, teamColors, lossAmount } = req.body || {};
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

    const saveMeta = { route: '/chiateam', action: `Lưu kết quả trận đấu ngày ${matchDate}` };

    const lossResult = await upsertLossExpense(match, lossAmount, dataStore, saveMeta);
    match.lossAmount = lossResult.lossAmount;
    match.lossExpenseId = lossResult.lossExpenseId;

    const matches = sortMatchesDesc([match, ...withoutSameDate]);
    await matchHistoryStore.write({ matches }, saveMeta);
    res.json({ success: true, match, members: computeMemberStats(matches) });
  } catch (_err) {
    res.status(500).json({ success: false, error: 'Failed to save match history' });
  }
});

app.delete('/api/match-history/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const historyData = await matchHistoryStore.read();
    const current = Array.isArray(historyData?.matches) ? historyData.matches : [];
    const target = current.find(m => m.date === date);
    const saveMeta = { route: '/chiateam', action: `Xoá trận đấu ngày ${date}` };

    // Xoá trận thì cũng dọn luôn khoản chi tiền thua gắn với trận đó (nếu có),
    // tránh để lại khoản chi mồ côi trong data.json.
    if (target?.lossExpenseId) {
      try {
        await dataStore.mutate(currentData => {
          const expenses = Array.isArray(currentData.expenses) ? currentData.expenses : [];
          const nextExpenses = expenses.filter(e => e.id !== target.lossExpenseId);
          if (nextExpenses.length === expenses.length) return currentData;
          return { ...currentData, expenses: nextExpenses, savedAt: new Date().toISOString() };
        }, saveMeta);
      } catch (_error) {
        // Không chặn việc xoá trận nếu dọn khoản chi thất bại
      }
    }

    const matches = sortMatchesDesc(current.filter(m => m.date !== date));
    await matchHistoryStore.write({ matches }, saveMeta);
    res.json({ success: true, members: computeMemberStats(matches), matches });
  } catch (_err) {
    res.status(500).json({ success: false, error: 'Failed to delete match' });
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
  } catch (_err) {
    return res.status(500).json({ ok: false, error: 'VietQR API error' });
  }
});

app.listen(PORT, () => {
  console.log(`Data server running on http://localhost:${PORT}`);
});
