import React, { useEffect, useMemo, useState } from 'react';
import { Users, Trophy, History, Shirt, Shuffle, Check, Scale } from 'lucide-react';
import {
  fetchBillData,
  fetchMatchHistory,
  emptyMatchHistory,
  teamMetaFromMatch,
  computeBalances,
  useQrModal,
  QrModal,
  TeamBoard,
  Leaderboard,
  MatchList,
  RatingGuide,
  useLeaderboard,
  usePlayerRatings,
  resultLabel,
  resultBadgeProps,
  DEFAULT_TEAM_META,
  splitIntoTeams,
} from './chiaTeamShared.jsx';
import { splitBalancedTeams, teamAverageStars } from './playerRating.js';

const TEAM_FIELD = { A: 'teamA', B: 'teamB' };

// Trang công khai /chiateam: xem đội hình gần nhất + lịch sử, và tab "Thử
// chia đội" để tự chọn người rồi random xem đội hình cân không — thuần
// client-side, KHÔNG lưu kết quả / tiền thắng thua (những thao tác đó chỉ
// có ở /admin/chiateam).
export default function ChiaTeamView() {
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [treasurerAccount, setTreasurerAccount] = useState('');
  const [treasurerBankBin, setTreasurerBankBin] = useState('');
  const [treasurerAccountNo, setTreasurerAccountNo] = useState('');
  const [treasurerAccountName, setTreasurerAccountName] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState('');
  const [tab, setTab] = useState('lichsu'); // 'doihinh' | 'lichsu' | 'chia'
  const [matchHistory, setMatchHistory] = useState(emptyMatchHistory);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [tryTeams, setTryTeams] = useState(null); // { teamA: [ids], teamB: [ids] } — chỉ để thử, không lưu
  const [tryTeamMeta, setTryTeamMeta] = useState(DEFAULT_TEAM_META);
  const [balanceTeams, setBalanceTeams] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchBillData()
      .then(data => {
        if (cancelled) return;
        setMembers(data.members);
        setExpenses(data.expenses);
        setPayments(data.payments);
        setTreasurerAccount(data.treasurerAccount);
        setTreasurerBankBin(data.treasurerBankBin);
        setTreasurerAccountNo(data.treasurerAccountNo);
        setTreasurerAccountName(data.treasurerAccountName);
        if (!data.members.length) setMembersError('Danh sách thành viên trống (data.json không có members).');
      })
      .catch(err => {
        if (!cancelled) {
          setMembers([]);
          setMembersError(`Không tải được danh sách thành viên (${err.message}).`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    fetchMatchHistory()
      .then(data => {
        if (!cancelled) setMatchHistory(data);
      })
      .catch(() => {
        if (!cancelled) setMatchHistory(emptyMatchHistory);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const memberById = useMemo(() => {
    const map = new Map();
    members.forEach(m => map.set(Number(m.id), m));
    return map;
  }, [members]);

  const memberName = id => memberById.get(Number(id))?.name || `#${id}`;
  const playerRatings = usePlayerRatings(matchHistory);
  const leaderboard = useLeaderboard(matchHistory, memberName, playerRatings.byId);
  const latestMatch = matchHistory.matches[0] || null;

  const winRateById = useMemo(() => {
    const map = {};
    leaderboard.forEach(row => {
      map[row.id] = row.winRate;
    });
    return map;
  }, [leaderboard]);

  const balances = useMemo(() => computeBalances(members, expenses, payments), [members, expenses, payments]);
  const qr = useQrModal({ members, treasurerAccount, treasurerBankBin, treasurerAccountNo, treasurerAccountName });

  // Trang public chỉ cho chọn trong số người ĐÃ TỪNG THAM GIA ít nhất 1 trận
  // (không hiện chia theo phòng ban như trang admin — ai lạ hoắc, chưa đá
  // trận nào thì không có trong danh sách để thử chia đội ở đây).
  const participantMembers = useMemo(() => {
    const playedIds = new Set();
    matchHistory.matches.forEach(m => {
      (m?.teamA || []).forEach(id => playedIds.add(Number(id)));
      (m?.teamB || []).forEach(id => playedIds.add(Number(id)));
    });
    return members.filter(m => playedIds.has(Number(m.id))).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [members, matchHistory.matches]);

  const toggleMember = id => {
    setTryTeams(null);
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectAll = () => {
    setTryTeams(null);
    setSelectedIds(participantMembers.map(m => Number(m.id)));
  };

  const clearSelection = () => {
    setTryTeams(null);
    setSelectedIds([]);
  };

  const handleTryRandom = () => {
    if (selectedIds.length < 2) return;
    setTryTeams(balanceTeams ? splitBalancedTeams(selectedIds, playerRatings.byId) : splitIntoTeams(selectedIds));
    setTryTeamMeta(DEFAULT_TEAM_META);
  };

  const handleTryTeamMetaChange = (key, patch) => {
    setTryTeamMeta(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleTryMoveMember = (memberId, fromKey, toKey) => {
    setTryTeams(prev => {
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
  };

  return (
    <div className="p-6 max-w-5xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={24} /> Chia Team Bóng Đá
          </h1>
          <div className="flex rounded-lg border bg-white shadow-sm overflow-hidden w-fit">
            <button
              type="button"
              onClick={() => setTab('lichsu')}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${
                tab === 'lichsu' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <History size={16} /> Lịch sử trận đấu
            </button>
            <button
              type="button"
              onClick={() => setTab('doihinh')}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${
                tab === 'doihinh' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Shirt size={16} /> Đội hình
            </button>
            <button
              type="button"
              onClick={() => setTab('chia')}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 ${
                tab === 'chia' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Shuffle size={16} /> Thử chia đội
            </button>
          </div>
        </header>

        {membersError && <p className="text-red-600 text-sm">{membersError}</p>}

        {tab === 'chia' && (
          <>
            <section className="bg-white rounded-xl shadow p-5">
              <p className="text-xs text-gray-400 mb-4">
                Chỉ để thử xem đội hình chia ra thế nào — không lưu kết quả hay tiền thắng thua. Muốn lưu thật thì
                vào trang quản trị.
              </p>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Chọn người tham gia ({selectedIds.length})</h3>
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
              ) : !participantMembers.length ? (
                <p className="text-gray-500 text-sm">Chưa có ai từng tham gia trận nào để thử chia đội.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {participantMembers.map(m => {
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
              )}

              <div className="mt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTryRandom}
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

            {tryTeams && (
              <section className="bg-white rounded-xl shadow p-5">
                <h3 className="text-lg font-semibold mb-4">Đội hình thử</h3>
                <p className="text-xs text-gray-400 mb-4">
                  Kéo thành viên giữa 2 đội để tự sắp xếp lại. Có thể đổi tên và màu đội ngay trên tiêu đề.
                  {(() => {
                    const gap = Math.abs(
                      teamAverageStars(tryTeams.teamA, playerRatings.byId) -
                        teamAverageStars(tryTeams.teamB, playerRatings.byId)
                    );
                    return ` Chênh lệch sao trung bình giữa 2 đội: ${gap.toFixed(1)}★.`;
                  })()}
                </p>
                <TeamBoard
                  teamA={tryTeams.teamA}
                  teamB={tryTeams.teamB}
                  memberName={memberName}
                  ratingById={playerRatings.byId}
                  teamMeta={tryTeamMeta}
                  editable
                  onTeamMetaChange={handleTryTeamMetaChange}
                  onMoveMember={handleTryMoveMember}
                />
              </section>
            )}
          </>
        )}

        {tab === 'doihinh' && (
          <section className="bg-white rounded-xl shadow p-5">
            {loadingMembers || loadingHistory ? (
              <p className="text-gray-500 text-sm">Đang tải đội hình...</p>
            ) : !latestMatch ? (
              <p className="text-gray-500 text-sm">Chưa có đội hình nào được tạo.</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Đội hình ngày {latestMatch.date}</h3>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      resultBadgeProps(latestMatch).className || ''
                    }`}
                    style={resultBadgeProps(latestMatch).style}
                  >
                    {resultLabel(latestMatch)}
                  </span>
                </div>
                <TeamBoard
                  teamA={latestMatch.teamA}
                  teamB={latestMatch.teamB}
                  memberName={memberName}
                  winRateById={winRateById}
                  ratingById={playerRatings.byId}
                  teamMeta={teamMetaFromMatch(latestMatch)}
                  editable={false}
                />
                {latestMatch.note && (
                  <p className="text-xs text-gray-400 mt-4">Ghi chú: {latestMatch.note}</p>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'lichsu' && (
          <section className="bg-white rounded-xl shadow p-5">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Trophy size={18} /> Bảng thắng thua theo thành viên
            </h3>
            <RatingGuide />
            <Leaderboard
              leaderboard={leaderboard}
              loading={loadingHistory}
              balances={balances}
              onOpenQr={qr.openQrForMember}
            />
            <h3 className="text-lg font-semibold mb-3">Các trận gần đây</h3>
            <MatchList
              matches={matchHistory.matches}
              memberName={memberName}
              ratingEvents={playerRatings.eventsByMatchId}
            />
          </section>
        )}
      </div>
      <QrModal qr={qr} />
    </div>
  );
}
