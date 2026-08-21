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

// Tạo/cập nhật khoản chi của 1 trận đấu: gộp "tiền sân" + "tiền thua" vào
// CÙNG 1 khoản chi.
//   - Tiền sân: chia đều cho TẤT CẢ người tham gia (cả 2 đội).
//   - Tiền thua: chỉ chia đều cho đội thua.
// Nên người thua trả (tiền sân/người + tiền thua/người), người thắng chỉ trả
// tiền sân/người.
// Dùng match.lossExpenseId để UPDATE đúng khoản chi cũ thay vì tạo trùng mỗi
// lần lưu lại trận. Nếu tổng tiền <= 0 (hoặc không có ai tham gia), khoản chi
// cũ (nếu có) sẽ bị xoá khỏi data.json.
// `dataStore` phải có `mutate(applyFn, saveMeta)` (vd. dataStore từ
// ./_utils.js): đọc bản data.json MỚI NHẤT rồi mới áp dụng thay đổi, tránh
// đè lên các thay đổi khác (vd. từ /api/data-action) xảy ra xen giữa.

// Chia đều `total` cho `ids`, phần dư dồn vào người cuối cùng để tổng các
// phần luôn khớp đúng `total` (không lệch do làm tròn).
const addEvenShares = (bucket, ids, total) => {
  if (!ids.length || total <= 0) return;
  const per = Math.round(total / ids.length);
  ids.forEach((memberId, idx) => {
    const share = idx === ids.length - 1 ? total - per * (ids.length - 1) : per;
    const key = Number(memberId);
    bucket.set(key, (bucket.get(key) || 0) + share);
  });
};

export const upsertMatchExpense = async (match, lossAmountRaw, courtAmountRaw, dataStore, saveMeta) => {
  const lossAmountInput = Math.max(0, Math.round(Number(lossAmountRaw) || 0));
  const courtAmountInput = Math.max(0, Math.round(Number(courtAmountRaw) || 0));

  const idsA = Array.isArray(match.teamA) ? match.teamA.map(Number) : [];
  const idsB = Array.isArray(match.teamB) ? match.teamB.map(Number) : [];
  const participantIds = [...new Set([...idsA, ...idsB])];
  const losingIds = match.result === 'A' ? idsB : match.result === 'B' ? idsA : [];

  // Hoà / chưa có kết quả thì không có đội thua -> chỉ tính tiền sân.
  const lossAmount = losingIds.length ? lossAmountInput : 0;
  const courtAmount = participantIds.length ? courtAmountInput : 0;
  const totalAmount = lossAmount + courtAmount;
  const emptyResult = { lossAmount: 0, courtAmount: 0, lossExpenseId: null };

  // Không có tiền để chia: chỉ cần dọn khoản chi cũ (nếu có).
  if (totalAmount <= 0) {
    if (!match.lossExpenseId) return emptyResult;
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
    return emptyResult;
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

      // Gộp 2 phần chia vào cùng 1 danh sách splits: người thua sẽ có
      // (tiền sân/người + tiền thua/người), người thắng chỉ có tiền sân/người.
      const bucket = new Map();
      addEvenShares(bucket, participantIds, courtAmount);
      addEvenShares(bucket, losingIds, lossAmount);
      const splits = participantIds
        .map(memberId => ({ memberId, amount: bucket.get(memberId) || 0 }))
        .filter(s => s.amount > 0);

      const losingTeamName = match.result === 'A' ? match.teamNames?.B : match.teamNames?.A;
      const parts = [];
      if (courtAmount > 0) parts.push('Tiền sân');
      if (lossAmount > 0) parts.push(`tiền thua${losingTeamName ? ` (${losingTeamName} thua)` : ''}`);
      const note = `${parts.join(' + ')} bóng đá ngày ${match.date}`;

      const existingIdx = expenses.findIndex(e => e.id === match.lossExpenseId);
      let expense;
      let nextExpenses;
      if (existingIdx !== -1) {
        expense = { ...expenses[existingIdx], amount: totalAmount, payerId, splits, note, date: match.date };
        nextExpenses = expenses.map((e, idx) => (idx === existingIdx ? expense : e));
      } else {
        expense = {
          id: Date.now(),
          amount: totalAmount,
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
    return emptyResult;
  }

  if (noPayer) return emptyResult;
  return { lossAmount, courtAmount, lossExpenseId: resultLossExpenseId };
};
