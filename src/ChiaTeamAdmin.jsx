import React, { useEffect, useMemo, useState } from 'react';
import {
  Shuffle,
  Users,
  Trophy,
  History,
  Check,
  CalendarDays,
  Scale,
  ListOrdered,
  Save,
  RotateCcw,
} from 'lucide-react';
import {
  GROUP_LABELS,
  groupLabel,
  splitIntoTeams,
  todayStr,
  emptyMatchHistory,
  fetchMembers,
  fetchMatchHistory,
  saveMatchResult,
  deleteMatchResult,
  saveBaseline,
  formatNumberInput,
  resultLabel,
  resultBadgeProps,
  DEFAULT_TEAM_META,
  teamMetaFromMatch,
  TeamBoard,
  Leaderboard,
  MatchList,
  RatingGuide,
  StarRating,
  useLeaderboard,
  usePlayerRatings,
} from './chiaTeamShared.jsx';
import { splitBalancedTeams, teamAverageStars, computePlayerRatings, STAR_LEVELS } from './playerRating.js';

// Tab "Level ban đầu": admin kéo-thả từng người vào 1 mức sao để làm điểm
// XUẤT PHÁT cho hệ xếp hạng, thay vì mặc định 3★ cho tất cả. Mục đích: vài
// trận đầu (mẫu nhỏ) không đủ để phân biệt trình độ thật — nếu chỉ dựa vào
// đó thì bảng xếp hạng dễ trở nên "cảm tính" (nhiễu số liệu chứ không phải
// đánh giá thật). Admin biết ai giỏi/yếu từ trước thì xếp thẳng vào đúng
// mức, các trận sau đó vẫn cộng/trừ điểm bình thường từ mốc này.
function BaselineBoard({ members, matchHistory, draft, onMove, onSave, onReset, saving, message }) {
  // Gợi ý tham khảo: level suy ra THUẦN từ dữ liệu trận đấu (không tính
  // baseline) — giúp admin đối chiếu trước khi quyết định xếp thủ công.
  const dataOnlyRatings = useMemo(() => computePlayerRatings(matchHistory.matches, {}), [matchHistory]);

  const groups = useMemo(() => {
    const byTier = { unassigned: [] };
    STAR_LEVELS.forEach(level => (byTier[level] = []));
    members.forEach(m => {
      const id = Number(m.id);
      const tier = draft[id];
      if (tier !== undefined && byTier[tier]) byTier[tier].push(id);
      else byTier.unassigned.push(id);
    });
    // Trong nhóm "chưa xếp": người đã từng đá lên trước (có dữ liệu tham
    // khảo), nhiều trận hơn lên trước nữa — dễ xử lý những người quen trước.
    byTier.unassigned.sort((a, b) => (dataOnlyRatings.byId[b]?.played || 0) - (dataOnlyRatings.byId[a]?.played || 0));
    return byTier;
  }, [members, draft, dataOnlyRatings]);

  const memberById = useMemo(() => {
    const map = new Map();
    members.forEach(m => map.set(Number(m.id), m));
    return map;
  }, [members]);

  const handleDragStart = id => e => {
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = tier => e => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isNaN(id)) onMove(id, tier);
  };

  const renderChip = id => {
    const m = memberById.get(id);
    const ref = dataOnlyRatings.byId[id];
    const hint = ref?.played
      ? `gợi ý ${ref.stars}★ (${ref.played} trận)`
      : 'chưa từng đá';
    return (
      <span
        key={id}
        draggable
        onDragStart={handleDragStart(id)}
        title="Kéo sang mức sao khác để xếp lại"
        className="cursor-move px-2.5 py-1.5 rounded-lg border bg-white text-sm flex items-center gap-1.5 hover:border-emerald-400 hover:shadow-sm"
      >
        {m?.name || `#${id}`}
        <span className="text-[10px] text-gray-400 whitespace-nowrap">{hint}</span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Kéo từng người vào đúng mức sao mà bạn cho là trình độ thật của họ. Đây sẽ là điểm xuất phát của hệ xếp
        hạng thay vì mặc định 3★ — các trận sau đó vẫn cộng/trừ điểm bình thường từ mốc này. Nhãn nhỏ dưới mỗi tên
        là gợi ý tính thuần từ dữ liệu trận đấu (nếu có) để bạn đối chiếu.
      </p>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop('unassigned')}
        className="border border-dashed rounded-xl p-3 bg-gray-50 min-h-[56px]"
      >
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
          Chưa xếp hạng thủ công ({groups.unassigned.length}) — dùng level tự tính hoặc 3★ mặc định
        </p>
        <div className="flex flex-wrap gap-2">
          {groups.unassigned.length === 0 ? (
            <span className="text-xs text-gray-400 italic px-1">Đã xếp hết mọi người.</span>
          ) : (
            groups.unassigned.map(renderChip)
          )}
        </div>
      </div>

      {STAR_LEVELS.map(level => (
        <div
          key={level}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop(level)}
          className="border rounded-xl p-3 bg-white min-h-[56px]"
        >
          <div className="flex items-center gap-2 mb-2">
            <StarRating stars={level} size={14} />
            <span className="text-xs text-gray-400">{level.toFixed(1)} sao</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {groups[level].length === 0 ? (
              <span className="text-xs text-gray-300 italic px-1">Kéo người vào đây</span>
            ) : (
              groups[level].map(renderChip)
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 border-t pt-4">
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-40"
        >
          <Save size={16} /> Lưu bảng xếp hạng ban đầu
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 hover:bg-gray-50"
        >
          <RotateCcw size={16} /> Khôi phục
        </button>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
      </div>
    </div>
  );
}

const TEAM_FIELD = { A: 'teamA', B: 'teamB' };

// Trang quản trị /admin/chiateam: chọn thành viên, random chia đội, chọn
// ngày và lưu kết quả. Mỗi ngày chỉ có 1 kết quả — lưu lại sẽ ghi đè trận
// đã có của ngày đó (upsert theo date ở server).
export default function ChiaTeamAdmin() {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [teams, setTeams] = useState(null); // { teamA: [ids], teamB: [ids] }
  const [tab, setTab] = useState('chia'); // 'chia' | 'lichsu'
  const [matchHistory, setMatchHistory] = useState(emptyMatchHistory);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [matchNote, setMatchNote] = useState('');
  const [matchDate, setMatchDate] = useState(todayStr());
  const [existingMatchForDate, setExistingMatchForDate] = useState(null);
  const [teamMeta, setTeamMeta] = useState(DEFAULT_TEAM_META); // { A: {name,color}, B: {name,color} }
  const [lossAmount, setLossAmount] = useState(''); // chuỗi số đã format dấu chấm, vd "100.000"
  const [courtAmount, setCourtAmount] = useState(''); // tiền sân, chia đều cho tất cả người tham gia
  const [balanceTeams, setBalanceTeams] = useState(true); // chia đội cân theo level (sao) thay vì random thuần
  const [baselineDraft, setBaselineDraft] = useState({}); // { memberId: sốSao } đang chỉnh ở tab "Level ban đầu"
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [baselineMessage, setBaselineMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then(list => {
        if (cancelled) return;
        setMembers(list);
        if (!list.length) setMembersError('Danh sách thành viên trống (data.json không có members).');
      })
      .catch(err => {
        if (!cancelled) {
          setMembers([]);
          setMembersError(
            `Không tải được danh sách thành viên (${err.message}). Kiểm tra đã chạy "npm run dev:all" chưa.`
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadHistory = () => {
    setLoadingHistory(true);
    fetchMatchHistory()
      .then(data => setMatchHistory(data))
      .catch(() => setMatchHistory(emptyMatchHistory))
      .finally(() => setLoadingHistory(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (tab === 'lichsu') loadHistory();
  }, [tab]);

  // Vào tab "Level ban đầu" thì nạp lại đúng bảng đã lưu — tránh việc chỉnh
  // dở ở lần vào trước còn sót lại làm sai lệch với dữ liệu thật.
  useEffect(() => {
    if (tab === 'baseline') {
      setBaselineDraft(matchHistory.baseline || {});
      setBaselineMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleMoveBaseline = (memberId, tier) => {
    setBaselineDraft(prev => {
      const next = { ...prev };
      if (tier === 'unassigned') delete next[memberId];
      else next[memberId] = tier;
      return next;
    });
    setBaselineMessage('');
  };

  const handleSaveBaseline = async () => {
    setSavingBaseline(true);
    setBaselineMessage('');
    try {
      const json = await saveBaseline(baselineDraft);
      if (json.success) {
        setMatchHistory(prev => ({ ...prev, baseline: json.baseline || {} }));
        setBaselineDraft(json.baseline || {});
        setBaselineMessage('Đã lưu bảng xếp hạng ban đầu!');
      } else {
        setBaselineMessage('Lưu thất bại: ' + (json.error || 'Lỗi không xác định'));
      }
    } catch (err) {
      setBaselineMessage('Lỗi kết nối khi lưu.');
    } finally {
      setSavingBaseline(false);
    }
  };

  const handleResetBaseline = () => {
    setBaselineDraft(matchHistory.baseline || {});
    setBaselineMessage('');
  };

  // Khi đổi ngày: nếu ngày đó đã có trận lưu rồi, load lại lên để xem/sửa.
  useEffect(() => {
    const existing = matchHistory.matches.find(m => m.date === matchDate) || null;
    setExistingMatchForDate(existing);
    if (existing) {
      setSelectedIds([...existing.teamA, ...existing.teamB]);
      setTeams({ teamA: existing.teamA, teamB: existing.teamB });
      setMatchNote(existing.note || '');
      setTeamMeta(teamMetaFromMatch(existing));
      setLossAmount(existing.lossAmount > 0 ? formatNumberInput(String(existing.lossAmount)) : '');
      setCourtAmount(existing.courtAmount > 0 ? formatNumberInput(String(existing.courtAmount)) : '');
    } else {
      setTeams(null);
      setMatchNote('');
      setTeamMeta(DEFAULT_TEAM_META);
      setLossAmount('');
      setCourtAmount('');
    }
    setSaveMessage('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchDate, matchHistory.matches]);

  const memberById = useMemo(() => {
    const map = new Map();
    members.forEach(m => map.set(Number(m.id), m));
    return map;
  }, [members]);

  const memberName = id => memberById.get(Number(id))?.name || `#${id}`;

  const toggleMember = id => {
    setTeams(null);
    setSaveMessage('');
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectAll = () => {
    setTeams(null);
    setSaveMessage('');
    setSelectedIds(members.map(m => Number(m.id)));
  };

  const clearSelection = () => {
    setTeams(null);
    setSaveMessage('');
    setSelectedIds([]);
  };

  const handleRandom = () => {
    if (selectedIds.length < 2) return;
    // Cân theo level: vẫn ngẫu nhiên, nhưng chỉ bốc trong nhóm các cách chia
    // có sao trung bình 2 đội sát nhau nhất.
    setTeams(balanceTeams ? splitBalancedTeams(selectedIds, playerRatings.byId) : splitIntoTeams(selectedIds));
    setSaveMessage('');
  };

  const handleTeamMetaChange = (key, patch) => {
    setTeamMeta(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleMoveMember = (memberId, fromKey, toKey) => {
    setTeams(prev => {
      if (!prev) return prev;
      const fromField = TEAM_FIELD[fromKey];
      const toField = TEAM_FIELD[toKey];
      if (!prev[fromField]?.includes(memberId)) return prev;
      return {
        ...prev,
        [fromField]: prev[fromField].filter(id => id !== memberId),
        [toField]: [...prev[toField], memberId],
      };
    });
    setSaveMessage('');
  };

  const handleSaveResult = async result => {
    if (!teams) return;
    setSaving(true);
    setSaveMessage('');
    try {
      const lossValue = Number(String(lossAmount).replace(/\D/g, '') || 0);
      const courtValue = Number(String(courtAmount).replace(/\D/g, '') || 0);
      const json = await saveMatchResult({
        teamA: teams.teamA,
        teamB: teams.teamB,
        result,
        date: matchDate,
        note: matchNote,
        teamNames: { A: teamMeta.A.name, B: teamMeta.B.name },
        teamColors: { A: teamMeta.A.color, B: teamMeta.B.color },
        lossAmount: lossValue,
        courtAmount: courtValue,
      });
      if (json.success) {
        setMatchHistory(prev => ({
          ...prev,
          members: json.members || prev.members,
          matches: [json.match, ...prev.matches.filter(m => m.date !== matchDate)],
        }));

        let message = `Đã lưu kết quả cho ngày ${matchDate}!`;
        if (json.match.lossExpenseId) {
          // Tiền sân + tiền thua nằm chung 1 khoản chi: nêu rõ từng phần chia
          // cho ai để dễ đối chiếu với khoản chi vừa tạo.
          const details = [];
          if (json.match.courtAmount > 0) {
            const playerCount = teams.teamA.length + teams.teamB.length;
            const perCourt = playerCount ? Math.round(json.match.courtAmount / playerCount) : 0;
            details.push(
              `tiền sân ${json.match.courtAmount.toLocaleString('vi-VN')}đ chia đều cho ${playerCount} người (~${perCourt.toLocaleString('vi-VN')}đ/người)`
            );
          }
          if (json.match.lossAmount > 0) {
            const losingIds = result === 'A' ? teams.teamB : result === 'B' ? teams.teamA : [];
            const perLoss = losingIds.length ? Math.round(json.match.lossAmount / losingIds.length) : 0;
            details.push(
              `tiền thua ${json.match.lossAmount.toLocaleString('vi-VN')}đ chia cho ${losingIds.length} người đội thua (~${perLoss.toLocaleString('vi-VN')}đ/người)`
            );
          }
          if (details.length) {
            message += ` Đã tạo 1 khoản chi ${(json.match.courtAmount + json.match.lossAmount).toLocaleString('vi-VN')}đ: ${details.join(', ')}.`;
          }
        }
        if (lossValue > 0 && result !== 'A' && result !== 'B') {
          message += ' Tiền thua chỉ áp dụng khi chọn đội thắng nên chưa được tính vào khoản chi.';
        }
        setSaveMessage(message);
      } else {
        setSaveMessage('Lưu thất bại: ' + (json.error || 'Lỗi không xác định'));
      }
    } catch (err) {
      setSaveMessage('Lỗi kết nối khi lưu kết quả.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMatch = async date => {
    if (!window.confirm(`Xoá kết quả trận ngày ${date}?`)) return;
    setSaveMessage('');
    try {
      const json = await deleteMatchResult(date);
      if (json.success) {
        setMatchHistory(prev => ({ ...prev, members: json.members || {}, matches: json.matches || [] }));
        if (date === matchDate) {
          setExistingMatchForDate(null);
          setTeams(null);
          setLossAmount('');
          setCourtAmount('');
        }
      } else {
        setSaveMessage('Xoá thất bại: ' + (json.error || 'Lỗi không xác định'));
      }
    } catch (err) {
      setSaveMessage('Lỗi kết nối khi xoá kết quả.');
    }
  };

  // Chọn 1 trận trong lịch sử để sửa: nhảy sang tab "Chia đội" và chọn đúng
  // ngày đó — useEffect ở trên sẽ tự load lại đội hình/tên/màu/tiền thua.
  const handleEditMatch = date => {
    setMatchDate(date);
    setTab('chia');
  };

  const playerRatings = usePlayerRatings(matchHistory);
  const leaderboard = useLeaderboard(matchHistory, memberName, playerRatings.byId);

  const groupedMembers = useMemo(() => {
    const groups = {};
    members.forEach(m => {
      const key = m.group || 'outside';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    return groups;
  }, [members]);

  return (
    <div className="p-6 max-w-5xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={24} /> Chia Team Bóng Đá — Admin
          </h1>
          <div className="flex rounded-lg border bg-white shadow-sm overflow-hidden w-fit">
            <button
              type="button"
              onClick={() => setTab('chia')}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${
                tab === 'chia' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Shuffle size={16} /> Chia đội
            </button>
            <button
              type="button"
              onClick={() => setTab('lichsu')}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${
                tab === 'lichsu' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <History size={16} /> Lịch sử thắng thua
            </button>
            <button
              type="button"
              onClick={() => setTab('baseline')}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${
                tab === 'baseline' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <ListOrdered size={16} /> Level ban đầu
            </button>
          </div>
        </header>

        {tab === 'chia' && (
          <>
            <section className="bg-white rounded-xl shadow p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <CalendarDays size={18} className="text-gray-500" />
                  <label className="text-sm text-gray-600" htmlFor="chiateam-date">
                    Ngày thi đấu:
                  </label>
                  <input
                    id="chiateam-date"
                    type="date"
                    value={matchDate}
                    onChange={e => setMatchDate(e.target.value)}
                    className="border rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                {existingMatchForDate && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full w-fit ${
                        resultBadgeProps(existingMatchForDate).className || ''
                      }`}
                      style={resultBadgeProps(existingMatchForDate).style}
                    >
                      Ngày này đã có kết quả: {resultLabel(existingMatchForDate)} — đang chỉnh sửa.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteMatch(matchDate)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Xoá kết quả ngày này
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Chọn thành viên tham gia ({selectedIds.length})</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                  >
                    Bỏ chọn
                  </button>
                </div>
              </div>

              {loadingMembers ? (
                <p className="text-gray-500 text-sm">Đang tải danh sách thành viên...</p>
              ) : membersError ? (
                <p className="text-red-600 text-sm">{membersError}</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {Object.keys(GROUP_LABELS)
                    .concat(Object.keys(groupedMembers).filter(k => !GROUP_LABELS[k]))
                    .filter(key => groupedMembers[key]?.length)
                    .map(groupKey => (
                      <div key={groupKey}>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                          {groupLabel(groupKey)}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {groupedMembers[groupKey].map(m => {
                            const id = Number(m.id);
                            const active = selectedIds.includes(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => toggleMember(id)}
                                className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${
                                  active
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                }`}
                              >
                                {active ? <Check size={14} /> : null}
                                {m.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleRandom}
                    disabled={selectedIds.length < 2}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700"
                  >
                    <Shuffle size={18} /> Random chia đội hình
                  </button>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={balanceTeams}
                      onChange={e => setBalanceTeams(e.target.checked)}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    <Scale size={15} className="text-gray-500" />
                    Cân bằng theo level (sao)
                  </label>
                </div>
                {selectedIds.length > 0 && selectedIds.length < 2 && (
                  <p className="text-xs text-gray-500 mt-2">Cần chọn ít nhất 2 người để chia đội.</p>
                )}
              </div>
            </section>

            {teams && (
              <section className="bg-white rounded-xl shadow p-5">
                <h3 className="text-lg font-semibold mb-4">Đội hình ngày {matchDate}</h3>
                <p className="text-xs text-gray-400 mb-4">
                  Kéo thành viên giữa 2 đội để tự sắp xếp lại. Có thể đổi tên và màu đội ngay trên tiêu đề.
                  {(() => {
                    const gap = Math.abs(
                      teamAverageStars(teams.teamA, playerRatings.byId) -
                        teamAverageStars(teams.teamB, playerRatings.byId)
                    );
                    return ` Chênh lệch sao trung bình giữa 2 đội: ${gap.toFixed(1)}★.`;
                  })()}
                </p>

                <TeamBoard
                  teamA={teams.teamA}
                  teamB={teams.teamB}
                  memberName={memberName}
                  ratingById={playerRatings.byId}
                  teamMeta={teamMeta}
                  editable
                  onTeamMetaChange={handleTeamMetaChange}
                  onMoveMember={handleMoveMember}
                />

                <div className="border-t pt-4 mt-5">
                  <p className="text-sm font-semibold mb-2">Lưu kết quả trận đấu</p>
                  {existingMatchForDate && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveResult(existingMatchForDate.result)}
                      className="w-full sm:w-auto mb-3 px-4 py-2 rounded-lg border-2 border-emerald-600 text-emerald-700 text-sm font-semibold disabled:opacity-40 hover:bg-emerald-50"
                    >
                      Lưu thay đổi (giữ kết quả: {resultLabel(existingMatchForDate)})
                    </button>
                  )}
                  <input
                    type="text"
                    value={matchNote}
                    onChange={e => setMatchNote(e.target.value)}
                    placeholder="Ghi chú (tuỳ chọn, vd: sân ABC)"
                    className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
                  />
                  <div className="flex flex-col sm:flex-row gap-3 mb-3">
                    <div className="w-full sm:w-64">
                      <label className="text-xs text-gray-500 mb-1 block" htmlFor="chiateam-court-amount">
                        Tiền sân (chia đều cho tất cả người tham gia)
                      </label>
                      <div className="relative">
                        <input
                          id="chiateam-court-amount"
                          type="text"
                          inputMode="numeric"
                          value={courtAmount}
                          onChange={e => setCourtAmount(formatNumberInput(e.target.value))}
                          placeholder="0"
                          className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">đ</span>
                      </div>
                    </div>
                    <div className="w-full sm:w-64">
                      <label className="text-xs text-gray-500 mb-1 block" htmlFor="chiateam-loss-amount">
                        Tiền thua (chỉ chia cho đội thua)
                      </label>
                      <div className="relative">
                        <input
                          id="chiateam-loss-amount"
                          type="text"
                          inputMode="numeric"
                          value={lossAmount}
                          onChange={e => setLossAmount(formatNumberInput(e.target.value))}
                          placeholder="0"
                          className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">đ</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    Cả 2 khoản gộp vào cùng 1 giao dịch khi bấm nút kết quả bên dưới: người thua trả tiền sân +
                    tiền thua, người thắng chỉ trả tiền sân.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveResult('A')}
                      style={{ backgroundColor: teamMeta.A.color }}
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                    >
                      {teamMeta.A.name} thắng
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveResult('B')}
                      style={{ backgroundColor: teamMeta.B.color }}
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                    >
                      {teamMeta.B.name} thắng
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveResult('draw')}
                      className="px-4 py-2 rounded-lg bg-gray-500 text-white text-sm font-medium disabled:opacity-40"
                    >
                      Hoà
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveResult('pending')}
                      className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium disabled:opacity-40"
                    >
                      Chưa có kết quả
                    </button>
                  </div>
                  {saveMessage && <p className="text-sm mt-3 text-emerald-700">{saveMessage}</p>}
                </div>
              </section>
            )}
          </>
        )}

        {tab === 'lichsu' && (
          <section className="bg-white rounded-xl shadow p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Trophy size={18} /> Bảng thắng thua theo thành viên
              </h3>
              <button
                type="button"
                onClick={loadHistory}
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
              >
                Tải lại
              </button>
            </div>
            <RatingGuide />
            <Leaderboard leaderboard={leaderboard} loading={loadingHistory} />
            <h3 className="text-lg font-semibold mb-3">Các trận gần đây</h3>
            <MatchList
              matches={matchHistory.matches}
              memberName={memberName}
              ratingEvents={playerRatings.eventsByMatchId}
              onEdit={handleEditMatch}
              onDelete={handleDeleteMatch}
            />
          </section>
        )}

        {tab === 'baseline' && (
          <section className="bg-white rounded-xl shadow p-5">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-1">
              <ListOrdered size={18} /> Xếp hạng ban đầu (baseline)
            </h3>
            {loadingMembers ? (
              <p className="text-gray-500 text-sm">Đang tải danh sách thành viên...</p>
            ) : (
              <BaselineBoard
                members={members}
                matchHistory={matchHistory}
                draft={baselineDraft}
                onMove={handleMoveBaseline}
                onSave={handleSaveBaseline}
                onReset={handleResetBaseline}
                saving={savingBaseline}
                message={baselineMessage}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
