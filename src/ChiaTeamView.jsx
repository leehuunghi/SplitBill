import React, { useEffect, useMemo, useState } from 'react';
import { Users, Trophy, History, Shirt } from 'lucide-react';
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
  useLeaderboard,
  resultLabel,
  resultBadgeProps,
} from './chiaTeamShared.jsx';

// Trang công khai /chiateam: chỉ xem đội hình gần nhất + lịch sử, không có
// quyền chọn thành viên / random / lưu kết quả (những thao tác đó nằm ở /admin/chiateam).
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
  const [tab, setTab] = useState('lichsu'); // 'doihinh' | 'lichsu'
  const [matchHistory, setMatchHistory] = useState(emptyMatchHistory);
  const [loadingHistory, setLoadingHistory] = useState(true);

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
  const leaderboard = useLeaderboard(matchHistory, memberName);
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
          </div>
        </header>

        {membersError && <p className="text-red-600 text-sm">{membersError}</p>}

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
            <Leaderboard
              leaderboard={leaderboard}
              loading={loadingHistory}
              balances={balances}
              onOpenQr={qr.openQrForMember}
            />
            <h3 className="text-lg font-semibold mb-3">Các trận gần đây</h3>
            <MatchList matches={matchHistory.matches} memberName={memberName} />
          </section>
        )}
      </div>
      <QrModal qr={qr} />
    </div>
  );
}
