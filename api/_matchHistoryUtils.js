export const DEFAULT_TEAM_NAMES = { A: 'Đội A', B: 'Đội B' };
export const DEFAULT_TEAM_COLORS = { A: '#059669', B: '#2563eb' };

// Ngày là khoá duy nhất: mỗi ngày chỉ có tối đa 1 kết quả trận đấu.
// "members" không được lưu trực tiếp mà luôn tính lại từ "matches" để tránh
// lệch số liệu khi 1 trận bị lưu đè (upsert theo date).
export const computeMemberStats = matches => {
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

export const sortMatchesDesc = matches =>
  [...matches].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

// Tạo/cập nhật khoản chi "tiền thua" gắn với 1 trận đấu, chia đều cho đội thua.
// Dùng match.lossExpenseId để UPDATE đúng khoản chi cũ thay vì tạo trùng mỗi
// lần lưu lại trận. Nếu không còn đội thua (hoà/chưa có kết quả) hoặc
// lossAmount <= 0, khoản chi cũ (nếu có) sẽ bị xoá khỏi data.json.
// `dataStore` phải có `mutate(applyFn, saveMeta)` (vd. dataStore từ
// ./_utils.js): đọc bản data.json MỚI NHẤT rồi mới áp dụng thay đổi, tránh
// đè lên các thay đổi khác (vd. từ /api/data-action) xảy ra xen giữa.
export const upsertLossExpense = async (match, lossAmountRaw, dataStore, saveMeta) => {
  const lossAmount = Math.round(Number(lossAmountRaw) || 0);
  const losingIds = match.result === 'A' ? match.teamB : match.result === 'B' ? match.teamA : [];

  // Không còn đội thua hoặc số tiền <= 0: chỉ cần dọn khoản chi cũ (nếu có).
  if (!losingIds.length || lossAmount <= 0) {
    if (!match.lossExpenseId) return { lossAmount: 0, lossExpenseId: null };
    try {
      await dataStore.mutate(current => {
        const expenses = Array.isArray(current.expenses) ? current.expenses : [];
        const nextExpenses = expenses.filter(e => e.id !== match.lossExpenseId);
        if (nextExpenses.length === expenses.length) return current;
        return { ...current, expenses: nextExpenses, savedAt: new Date().toISOString() };
      }, saveMeta);
    } catch (_error) {
      // Không chặn luồng lưu trận đấu nếu dọn khoản chi thất bại
    }
    return { lossAmount: 0, lossExpenseId: null };
  }

  let resultLossExpenseId = null;
  let noPayer = false;

  try {
    await dataStore.mutate(current => {
      const members = Array.isArray(current.members) ? current.members : [];
      const treasurer = members.find(m => m?.isTreasurer);
      const payerId = treasurer ? Number(treasurer.id) : Number(members[0]?.id) || null;
      if (!payerId) {
        noPayer = true;
        return current;
      }

      const expenses = Array.isArray(current.expenses) ? current.expenses : [];
      const per = Math.round(lossAmount / losingIds.length);
      const splits = losingIds.map((memberId, idx) => ({
        memberId,
        amount: idx === losingIds.length - 1 ? lossAmount - per * (losingIds.length - 1) : per,
      }));
      const losingTeamName = match.result === 'A' ? match.teamNames?.B : match.teamNames?.A;
      const note = `Tiền thua bóng đá ngày ${match.date}${losingTeamName ? ` - ${losingTeamName} thua` : ''}`;

      const existingIdx = expenses.findIndex(e => e.id === match.lossExpenseId);
      let expense;
      let nextExpenses;
      if (existingIdx !== -1) {
        expense = { ...expenses[existingIdx], amount: lossAmount, payerId, splits, note, date: match.date };
        nextExpenses = expenses.map((e, idx) => (idx === existingIdx ? expense : e));
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
        nextExpenses = [expense, ...expenses];
      }

      resultLossExpenseId = expense.id;
      return { ...current, expenses: nextExpenses, savedAt: new Date().toISOString() };
    }, saveMeta);
  } catch (_error) {
    return { lossAmount: 0, lossExpenseId: null };
  }

  if (noPayer) return { lossAmount: 0, lossExpenseId: null };
  return { lossAmount, lossExpenseId: resultLossExpenseId };
};
