import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();
const PORT = 5174;
const dataPath = path.resolve('src', 'data.json');
const matchHistoryPath = path.resolve('src', 'match-history.json');
const DEFAULT_TEAM_NAMES = { A: 'Đội A', B: 'Đội B' };
const DEFAULT_TEAM_COLORS = { A: '#059669', B: '#2563eb' };

app.use(express.json({ limit: '1mb' }));

app.get('/api/load', async (_req, res) => {
  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(200).json({
      members: [],
      expenses: [],
      payments: [],
      treasurerAccount: '',
      qrCache: {},
      nextMemberId: 1,
    });
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
    await fs.writeFile(dataPath, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({ success: true, storage: 'file' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to save file' });
  }
});

// Ngày là khoá duy nhất: mỗi ngày chỉ có tối đa 1 kết quả trận đấu.
// "members" không được lưu trực tiếp mà luôn tính lại từ "matches" để tránh
// lệch số liệu khi 1 trận bị lưu đè (upsert theo date).
const computeMemberStats = matches => {
  const members = {};
  const bumpStat = (memberId, key) => {
    const id = String(memberId);
    const prev = members[id] || { wins: 0, losses: 0, draws: 0 };
    members[id] = { ...prev, [key]: (prev[key] || 0) + 1 };
  };
  matches.forEach(match => {
    if (match.result === 'pending') return; // chưa có kết quả -> không tính vào thống kê
    const idsA = Array.isArray(match.teamA) ? match.teamA : [];
    const idsB = Array.isArray(match.teamB) ? match.teamB : [];
    idsA.forEach(id => {
      if (match.result === 'A') bumpStat(id, 'wins');
      else if (match.result === 'B') bumpStat(id, 'losses');
      else bumpStat(id, 'draws');
    });
    idsB.forEach(id => {
      if (match.result === 'B') bumpStat(id, 'wins');
      else if (match.result === 'A') bumpStat(id, 'losses');
      else bumpStat(id, 'draws');
    });
  });
  return members;
};

const sortMatchesDesc = matches =>
  [...matches].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const readMatchHistory = async () => {
  try {
    const raw = await fs.readFile(matchHistoryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.matches) ? parsed.matches : [];
  } catch (err) {
    return [];
  }
};

// Tạo/cập nhật khoản chi "tiền thua" gắn với 1 trận đấu, chia đều cho đội thua.
// Dùng match.lossExpenseId để UPDATE đúng khoản chi cũ thay vì tạo trùng mỗi
// lần lưu lại trận. Nếu không còn đội thua (hoà/chưa có kết quả) hoặc
// lossAmount <= 0, khoản chi cũ (nếu có) sẽ bị xoá khỏi data.json.
const upsertLossExpense = async (match, lossAmountRaw) => {
  const lossAmount = Math.round(Number(lossAmountRaw) || 0);
  let data;
  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    return { lossAmount: 0, lossExpenseId: null };
  }

  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const losingIds =
    match.result === 'A' ? match.teamB : match.result === 'B' ? match.teamA : [];

  if (!losingIds.length || lossAmount <= 0) {
    if (match.lossExpenseId) {
      const nextExpenses = expenses.filter(e => e.id !== match.lossExpenseId);
      if (nextExpenses.length !== expenses.length) {
        await fs.writeFile(
          dataPath,
          JSON.stringify({ ...data, expenses: nextExpenses, savedAt: new Date().toISOString() }, null, 2),
          'utf-8'
        );
      }
    }
    return { lossAmount: 0, lossExpenseId: null };
  }

  const members = Array.isArray(data.members) ? data.members : [];
  const treasurer = members.find(m => m?.isTreasurer);
  const payerId = treasurer ? Number(treasurer.id) : Number(members[0]?.id) || null;
  if (!payerId) {
    return { lossAmount: 0, lossExpenseId: null };
  }

  const per = Math.round(lossAmount / losingIds.length);
  const splits = losingIds.map((memberId, idx) => ({
    memberId,
    amount: idx === losingIds.length - 1 ? lossAmount - per * (losingIds.length - 1) : per,
  }));
  const losingTeamName = match.result === 'A' ? match.teamNames?.B : match.teamNames?.A;
  const note = `Tiền thua bóng đá ngày ${match.date}${losingTeamName ? ` - ${losingTeamName} thua` : ''}`;

  const existingIdx = expenses.findIndex(e => e.id === match.lossExpenseId);
  let expense;
  if (existingIdx !== -1) {
    expense = { ...expenses[existingIdx], amount: lossAmount, payerId, splits, note, date: match.date };
    expenses[existingIdx] = expense;
  } else {
    expense = {
      id: Date.now(),
      amount: lossAmount,
      payerId,
      splits,
      note,
      date: match.date,
      createdAt: new Date().toISOString(),
    };
    expenses.unshift(expense);
  }

  await fs.writeFile(
    dataPath,
    JSON.stringify({ ...data, expenses, savedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
  return { lossAmount, lossExpenseId: expense.id };
};

app.get('/api/match-history/load', async (_req, res) => {
  const matches = sortMatchesDesc(await readMatchHistory());
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

    const current = await readMatchHistory();
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

    const lossResult = await upsertLossExpense(match, lossAmount);
    match.lossAmount = lossResult.lossAmount;
    match.lossExpenseId = lossResult.lossExpenseId;

    const matches = sortMatchesDesc([match, ...withoutSameDate]);
    await fs.writeFile(matchHistoryPath, JSON.stringify({ matches }, null, 2), 'utf-8');
    res.json({ success: true, match, members: computeMemberStats(matches) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to save match history' });
  }
});

app.delete('/api/match-history/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const current = await readMatchHistory();
    const target = current.find(m => m.date === date);

    // Xoá trận thì cũng dọn luôn khoản chi tiền thua gắn với trận đó (nếu có),
    // tránh để lại khoản chi mồ côi trong data.json.
    if (target?.lossExpenseId) {
      try {
        const raw = await fs.readFile(dataPath, 'utf-8');
        const data = JSON.parse(raw);
        const expenses = Array.isArray(data.expenses) ? data.expenses : [];
        const nextExpenses = expenses.filter(e => e.id !== target.lossExpenseId);
        if (nextExpenses.length !== expenses.length) {
          await fs.writeFile(
            dataPath,
            JSON.stringify({ ...data, expenses: nextExpenses, savedAt: new Date().toISOString() }, null, 2),
            'utf-8'
          );
        }
      } catch (err) {
        // Không chặn việc xoá trận nếu dọn khoản chi thất bại
      }
    }

    const matches = sortMatchesDesc(current.filter(m => m.date !== date));
    await fs.writeFile(matchHistoryPath, JSON.stringify({ matches }, null, 2), 'utf-8');
    res.json({ success: true, members: computeMemberStats(matches), matches });
  } catch (err) {
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
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'VietQR API error' });
  }
});

app.listen(PORT, () => {
  console.log(`Data server running on http://localhost:${PORT}`);
});
