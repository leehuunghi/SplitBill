import React from 'react';
import { Trophy, GripVertical, QrCode, X, Star, StarHalf, TrendingUp, TrendingDown } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  BASE_RATING,
  MAX_STARS,
  PLACEMENT_MATCHES,
  PROVISIONAL_MATCHES,
  STAR_HYSTERESIS,
  STAR_OFFSETS,
  STREAK_LENGTH,
  STREAK_MULTIPLIER,
  computePlayerRatings,
  starsOf,
  teamAverageStars,
} from './playerRating.js';

export const DEFAULT_TEAM_META = {
  A: { name: 'Đội A', color: '#059669' },
  B: { name: 'Đội B', color: '#2563eb' },
};

export const teamMetaFromMatch = match => ({
  A: {
    name: match?.teamNames?.A || DEFAULT_TEAM_META.A.name,
    color: match?.teamColors?.A || DEFAULT_TEAM_META.A.color,
  },
  B: {
    name: match?.teamNames?.B || DEFAULT_TEAM_META.B.name,
    color: match?.teamColors?.B || DEFAULT_TEAM_META.B.color,
  },
});

export const GROUP_LABELS = {
  boss: 'Sếp',
  'mobile-android': 'Mobile - Android',
  'mobile-ios': 'Mobile - iOS',
  'backend-common': 'Backend - Common',
  'backend-devops': 'Backend - Dev Ops',
  'backend-core': 'Backend - Core',
  outside: 'Người ngoài',
  remove: 'Remove',
};

export const groupLabel = group => GROUP_LABELS[group] || 'Khác';

export const shuffle = list => {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const splitIntoTeams = ids => {
  const shuffled = shuffle(ids);
  const half = Math.ceil(shuffled.length / 2);
  return { teamA: shuffled.slice(0, half), teamB: shuffled.slice(half) };
};

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const emptyMatchHistory = { members: {}, matches: [] };

export const fetchMembers = () =>
  fetch('/api/load')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => (Array.isArray(data?.members) ? data.members : []));

// Load toàn bộ data.json (members/expenses/payments/thông tin ngân hàng thủ quỹ)
// để tính công nợ và tạo QR trả nợ — giống cách trang chia bill chính làm.
export const fetchBillData = () =>
  fetch('/api/load')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => ({
      members: Array.isArray(data?.members) ? data.members : [],
      expenses: Array.isArray(data?.expenses) ? data.expenses : [],
      payments: Array.isArray(data?.payments) ? data.payments : [],
      treasurerAccount: data?.treasurerAccount || '',
      treasurerBankBin: data?.treasurerBankBin || '',
      treasurerAccountNo: data?.treasurerAccountNo || '',
      treasurerAccountName: data?.treasurerAccountName || '',
    }));

// Công nợ từng thành viên: âm = còn nợ thủ quỹ, dương = thủ quỹ còn nợ lại.
// Logic giống hệt "balances" ở App.jsx (trang chia bill chính).
export const computeBalances = (members, expenses, payments) => {
  const map = new Map();
  (members || []).forEach(m => map.set(Number(m.id), 0));
  const treasurerId = (members || []).find(m => m?.isTreasurer)?.id;

  (expenses || []).forEach(exp => {
    const amount = Number(exp?.amount) || 0;
    const payerId = Number(exp?.payerId);
    map.set(payerId, (map.get(payerId) || 0) + amount);
    (exp?.splits || []).forEach(s => {
      const memberId = Number(s?.memberId);
      map.set(memberId, (map.get(memberId) || 0) - (Number(s?.amount) || 0));
    });
  });

  (payments || []).forEach(p => {
    if (!treasurerId) return;
    const memberId = Number(p?.memberId);
    const amount = Number(p?.amount) || 0;
    const tId = Number(treasurerId);
    if (p?.type === 'pay') {
      map.set(memberId, (map.get(memberId) || 0) + amount);
      map.set(tId, (map.get(tId) || 0) - amount);
    } else {
      map.set(memberId, (map.get(memberId) || 0) - amount);
      map.set(tId, (map.get(tId) || 0) + amount);
    }
  });

  return map;
};

// Nội dung chuyển khoản: bỏ dấu, chỉ giữ chữ/số, in hoa, tối đa 25 ký tự
// (giống buildTransferContent ở App.jsx).
export const buildTransferContent = memberName =>
  String(memberName || '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 25);

export const fetchMatchHistory = () =>
  fetch('/api/match-history/load')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => ({
      members: data?.members && typeof data.members === 'object' ? data.members : {},
      matches: Array.isArray(data?.matches) ? data.matches : [],
    }));

export const saveMatchResult = ({
  teamA,
  teamB,
  result,
  date,
  note,
  teamNames,
  teamColors,
  lossAmount,
  courtAmount,
}) =>
  fetch('/api/save-match-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamA, teamB, result, date, note, teamNames, teamColors, lossAmount, courtAmount }),
  }).then(res => res.json());

export const deleteMatchResult = date =>
  fetch(`/api/match-history/${encodeURIComponent(date)}`, { method: 'DELETE' }).then(res => res.json());

export const formatVND = value =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';

// Format khi gõ số tiền: chỉ giữ chữ số, thêm dấu chấm ngăn cách hàng nghìn
// (giống format input tiền ở trang chia bill chính).
export const formatNumberInput = value =>
  String(value || '')
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// Nhận vào cả match (không chỉ result) để hiện đúng tên đội đã đổi
// (vd "Backend thắng" thay vì luôn "Đội B thắng").
export const resultLabel = match => {
  if (!match) return 'Chưa có kết quả';
  if (match.result === 'A') return `${match.teamNames?.A || 'Đội A'} thắng`;
  if (match.result === 'B') return `${match.teamNames?.B || 'Đội B'} thắng`;
  if (match.result === 'draw') return 'Hoà';
  return 'Chưa có kết quả';
};

// Badge kết quả: hoà/chưa có kết quả dùng className cố định, còn thắng thì
// tô theo đúng màu đội thắng (teamColors) thay vì màu xanh emerald cố định.
export const resultBadgeProps = match => {
  if (!match || match.result === 'pending') return { className: 'bg-amber-100 text-amber-700' };
  if (match.result === 'draw') return { className: 'bg-gray-100 text-gray-600' };
  const color = match.result === 'A' ? match.teamColors?.A : match.teamColors?.B;
  return { style: { backgroundColor: color || DEFAULT_TEAM_META.A.color, color: '#fff' } };
};

// Hook tạo QR VietQR để trả nợ — đồng bộ logic với openQrForMember ở trang
// chia bill chính (App.jsx): amount âm (đang nợ) mới tạo QR, addInfo là tên
// đã chuẩn hoá, chuyển tới đúng tài khoản thủ quỹ.
export function useQrModal({ members, treasurerAccount, treasurerBankBin, treasurerAccountNo, treasurerAccountName }) {
  const [qrModal, setQrModal] = React.useState({ open: false, memberId: null, amount: 0 });
  const [qrPayload, setQrPayload] = React.useState('');
  const [qrLoading, setQrLoading] = React.useState(false);
  const [qrError, setQrError] = React.useState('');
  const [qrAddInfo, setQrAddInfo] = React.useState('');

  const openQrForMember = async (memberId, amount) => {
    setQrModal({ open: true, memberId, amount });
    setQrPayload('');
    setQrError('');
    const member = (members || []).find(m => Number(m.id) === Number(memberId));
    const addInfo = buildTransferContent(member?.name);
    setQrAddInfo(addInfo);

    if (!treasurerBankBin || !treasurerAccountNo || !treasurerAccountName) {
      setQrError('Chưa cấu hình tài khoản ngân hàng thủ quỹ ở trang chia bill chính.');
      return;
    }

    setQrLoading(true);
    try {
      const response = await fetch('/api/vietqr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          addInfo,
          acqId: treasurerBankBin,
          accountNo: treasurerAccountNo,
          accountName: treasurerAccountName,
        }),
      });
      const data = await response.json();
      if (!data?.ok || !data?.payload) {
        setQrError(data?.error || 'Không tạo được payload VietQR');
      } else {
        setQrPayload(data.payload);
      }
    } catch (err) {
      setQrError('Không gọi được VietQR API');
    } finally {
      setQrLoading(false);
    }
  };

  const closeQr = () => {
    setQrModal({ open: false, memberId: null, amount: 0 });
    setQrPayload('');
    setQrError('');
    setQrAddInfo('');
    setQrLoading(false);
  };

  const qrMember = (members || []).find(m => Number(m.id) === Number(qrModal.memberId));

  return { qrModal, qrPayload, qrLoading, qrError, qrAddInfo, qrMember, treasurerAccount, openQrForMember, closeQr };
}

export function QrModal({ qr }) {
  if (!qr.qrModal.open) return null;
  const { qrModal, qrPayload, qrLoading, qrError, qrAddInfo, qrMember, treasurerAccount, closeQr } = qr;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm relative">
        <button
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-700"
          onClick={closeQr}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h4 className="text-lg font-semibold mb-2">QR Thanh toán</h4>
        <p className="text-sm text-gray-500 mb-4">Chuyển đến thủ quỹ: {treasurerAccount || 'chưa cấu hình'}</p>
        <div className="flex items-center justify-center mb-4">
          {qrLoading && (
            <div className="w-[232px] h-[232px] rounded-xl border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-500">
              <div className="w-8 h-8 rounded-full border-4 border-gray-300 border-t-gray-700 animate-spin mb-3" />
              <div className="text-sm font-medium">Đang tạo VietQR...</div>
              <div className="text-xs">Vui lòng chờ trong giây lát</div>
            </div>
          )}
          {!qrLoading && qrPayload && <QRCodeCanvas value={qrPayload} size={200} includeMargin />}
          {!qrLoading && !qrPayload && !qrError && (
            <div className="w-[232px] h-[232px] rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-sm text-gray-500 text-center px-6">
              Chưa có mã QR để hiển thị.
            </div>
          )}
        </div>
        <div className="text-sm">
          {qrError && <div className="text-xs text-red-500 mb-2">{qrError}</div>}
          <div className="flex items-center justify-between">
            <span>Số tiền</span>
            <span className="font-semibold">{formatVND(qrModal.amount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Nội dung</span>
            <span className="font-semibold">{qrAddInfo || qrMember?.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Người chưa đá trận nào: hiện 3 sao mờ — đúng bằng mức mà thuật toán chia
// đội đang tạm coi họ, để nhìn bảng là biết vì sao họ được xếp vào đội đó.
export const UNRATED_PLAYER = { stars: 3, provisional: true };

// Hiển thị level dạng sao (1 -> 5, có nửa sao). `provisional` = mới đá dưới
// 3 trận, số sao chỉ là tạm tính nên làm mờ đi cho khỏi hiểu nhầm.
export function StarRating({ stars, size = 13, showNumber = false, provisional = false }) {
  const value = Number(stars) || 0;
  const full = Math.floor(value);
  const hasHalf = value - full >= 0.5;
  const tone = provisional ? 'text-amber-300' : 'text-amber-400';
  return (
    <span
      className="inline-flex items-center gap-px whitespace-nowrap align-middle"
      title={`${value.toFixed(1)} sao${provisional ? ' (tạm tính, chưa đủ 3 trận)' : ''}`}
    >
      {Array.from({ length: MAX_STARS }).map((_, i) => {
        if (i < full) return <Star key={i} size={size} className={`${tone} fill-current`} />;
        if (i === full && hasHalf) return <StarHalf key={i} size={size} className={`${tone} fill-current`} />;
        return <Star key={i} size={size} className="text-gray-200" />;
      })}
      {showNumber && (
        <span className={`text-xs ml-1 ${provisional ? 'text-gray-400 italic' : 'text-gray-500'}`}>
          {value.toFixed(1)}
          {provisional && ' (tạm)'}
        </span>
      )}
    </span>
  );
}

// Tính level của toàn bộ cầu thủ từ lịch sử trận đấu. Bọc trong useMemo vì
// phải phát lại toàn bộ matches (rẻ, nhưng không cần chạy lại mỗi lần render).
export function usePlayerRatings(matchHistory) {
  return React.useMemo(() => computePlayerRatings(matchHistory?.matches || []), [matchHistory]);
}

function TeamHeader({ meta, editable, count, avgStars, onNameChange, onColorChange }) {
  // Sao trung bình của đội — nhìn vào là biết 2 đội đã cân chưa.
  const strength =
    avgStars > 0 ? (
      <span className="text-white/90 text-xs whitespace-nowrap" title="Sao trung bình của đội">
        TB {avgStars.toFixed(1)}★
      </span>
    ) : null;

  if (!editable) {
    return (
      <div
        className="rounded-lg px-3 py-2 mb-3 flex items-center justify-between gap-2"
        style={{ backgroundColor: meta.color }}
      >
        <span className="text-white font-semibold">{meta.name}</span>
        <span className="flex items-center gap-2">
          {strength}
          <span className="text-white/80 text-xs">{count} người</span>
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-lg px-3 py-2 mb-3 flex items-center gap-2" style={{ backgroundColor: meta.color }}>
      <input
        type="color"
        value={meta.color}
        onChange={e => onColorChange(e.target.value)}
        className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent shrink-0"
        title="Đổi màu đội"
      />
      <input
        type="text"
        value={meta.name}
        onChange={e => onNameChange(e.target.value)}
        className="flex-1 min-w-0 bg-white/90 rounded px-2 py-1 text-sm font-medium"
      />
      {strength}
      <span className="text-white/80 text-xs whitespace-nowrap">{count} người</span>
    </div>
  );
}

function MemberRow({ name, winRate, rating, editable, onDragStart }) {
  return (
    <li
      draggable={editable}
      onDragStart={editable ? onDragStart : undefined}
      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-sm bg-white ${
        editable ? 'cursor-move hover:bg-gray-50' : ''
      }`}
    >
      <span className="flex items-center gap-1.5">
        {editable && <GripVertical size={14} className="text-gray-400 shrink-0" />}
        {name}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {rating && <StarRating stars={rating.stars} provisional={rating.provisional} />}
        {winRate !== undefined && <span className="text-xs text-gray-400 whitespace-nowrap">{winRate}% thắng</span>}
      </span>
    </li>
  );
}

// Bảng 2 đội: header tên + màu (chỉnh được khi editable), danh sách thành viên
// (kéo-thả đổi đội khi editable). Dùng chung cho cả trang xem (public, đọc-only)
// và trang admin (được sửa tên/màu/đội hình bằng drag & drop).
export function TeamBoard({
  teamA,
  teamB,
  memberName,
  winRateById,
  ratingById,
  teamMeta,
  editable,
  onTeamMetaChange,
  onMoveMember,
}) {
  const handleDragStart = (id, from) => e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id, from }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = targetKey => e => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const { id, from } = JSON.parse(raw);
      if (from !== targetKey) onMoveMember(Number(id), from, targetKey);
    } catch (err) {
      // ignore malformed drag payload
    }
  };

  const renderTeam = (key, ids) => (
    <div
      key={key}
      className="flex-1 min-w-[220px] bg-gray-50 rounded-xl p-3 border"
      onDragOver={editable ? e => e.preventDefault() : undefined}
      onDrop={editable ? handleDrop(key) : undefined}
    >
      <TeamHeader
        meta={teamMeta[key]}
        editable={editable}
        count={ids.length}
        avgStars={ratingById ? teamAverageStars(ids, ratingById) : 0}
        onNameChange={name => onTeamMetaChange(key, { name })}
        onColorChange={color => onTeamMetaChange(key, { color })}
      />
      <ul className="flex flex-col gap-1.5 min-h-[44px]">
        {ids.map(id => (
          <MemberRow
            key={id}
            name={memberName(id)}
            winRate={winRateById ? winRateById[id] : undefined}
            rating={ratingById ? ratingById[Number(id)] || UNRATED_PLAYER : undefined}
            editable={editable}
            onDragStart={handleDragStart(id, key)}
          />
        ))}
        {editable && ids.length === 0 && (
          <li className="text-xs text-gray-400 italic px-2 py-3 text-center border border-dashed rounded-lg">
            Kéo thành viên vào đây
          </li>
        )}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {renderTeam('A', teamA)}
      {renderTeam('B', teamB)}
    </div>
  );
}

// balances (Map memberId->số dư) + onOpenQr là optional: có thì hiện thêm
// cột QR ở cuối bảng để trả nợ nhanh, đồng bộ với nút QR ở trang chia bill
// chính (âm = còn nợ thủ quỹ, mới hiện nút QR).
// Bảng giải thích tiêu chuẩn xếp hạng. Các mốc được đọc thẳng từ hằng số
// trong playerRating.js nên chỉnh công thức là phần mô tả tự khớp theo.
const MIN_STARS_VALUE = 1;

export function RatingGuide() {
  const bands = [
    ...STAR_OFFSETS.map(({ offset, stars }) => ({ stars, text: `từ ${BASE_RATING + offset} điểm trở lên` })),
    { stars: 3, text: `quanh mốc ${BASE_RATING} điểm (khởi điểm của mọi người)` },
    ...[...STAR_OFFSETS].reverse().map(({ offset, stars }) => ({
      stars: MAX_STARS + MIN_STARS_VALUE - stars,
      text: `từ ${BASE_RATING - offset} điểm trở xuống`,
    })),
  ];

  return (
    <details className="border rounded-lg bg-gray-50 text-sm mb-4">
      <summary className="cursor-pointer px-3 py-2 font-medium text-gray-700 select-none">
        Cách tính level (sao) và cơ chế thăng / giảm hạng
      </summary>
      <div className="px-3 pb-3 pt-1 flex flex-col gap-3 text-gray-600">
        <p>
          Mỗi người có 1 điểm ẩn, khởi điểm {BASE_RATING}. Sau mỗi trận điểm được cộng/trừ theo kết quả, rồi quy
          ra số sao. Điểm luôn được tính lại từ đầu theo toàn bộ lịch sử — sửa hay xoá 1 trận cũ là cả bảng tự
          khớp lại.
        </p>
        <div>
          <p className="font-medium text-gray-700 mb-1">Thang quy đổi</p>
          <ul className="flex flex-col gap-1">
            {bands.map(band => (
              <li key={band.stars} className="flex items-center gap-2">
                <StarRating stars={band.stars} size={12} />
                <span className="text-xs">{band.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-gray-700 mb-1">Được / mất bao nhiêu điểm</p>
          <ul className="list-disc pl-5 text-xs flex flex-col gap-1">
            <li>
              Tính theo sao trung bình 2 đội: thắng đội mạnh hơn ăn nhiều điểm, thắng đội yếu hơn ăn ít; thua đội
              yếu hơn mất nhiều, thua đội mạnh hơn mất ít.
            </li>
            <li>
              {PLACEMENT_MATCHES} trận đầu là giai đoạn định hạng, điểm nhảy mạnh gấp đôi để nhanh về đúng trình.
              Dưới {PROVISIONAL_MATCHES} trận thì sao chỉ là <em>tạm tính</em> (hiện mờ).
            </li>
            <li>
              Thắng (hoặc thua) {STREAK_LENGTH} trận liên tiếp trở lên thì điểm ăn/mất được nhân{' '}
              {STREAK_MULTIPLIER} — đang lên phong độ thì thăng hạng nhanh hơn.
            </li>
            <li>Trận hoà vẫn tính điểm (đội yếu hơn hoà đội mạnh vẫn được cộng), trận chưa có kết quả thì bỏ qua.</li>
            <li>
              Có vùng đệm {STAR_HYSTERESIS} điểm quanh mỗi mốc: đứng sát mốc thì 1 trận sát nút chưa đổi hạng
              ngay, tránh tuần nào cũng nhảy lên nhảy xuống.
            </li>
          </ul>
        </div>
        <p className="text-xs">
          Khi bấm <strong>Random chia đội hình</strong> với tuỳ chọn cân bằng, hệ thống bốc nhiều cách chia ngẫu
          nhiên rồi chỉ giữ lại những cách có sao trung bình 2 đội sát nhau nhất — vẫn ngẫu nhiên nhưng không còn
          cảnh một đội toàn người mạnh.
        </p>
      </div>
    </details>
  );
}

export function Leaderboard({ leaderboard, loading, balances, onOpenQr }) {
  if (loading) return <p className="text-gray-500 text-sm">Đang tải lịch sử...</p>;
  if (!leaderboard.length) {
    return <p className="text-gray-500 text-sm">Chưa có trận đấu nào được ghi nhận.</p>;
  }
  const showQr = Boolean(balances && onOpenQr);
  return (
    <div className="overflow-x-auto mb-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="py-2 pr-4">Thành viên</th>
            <th className="py-2 pr-4">Level</th>
            <th className="py-2 pr-4">Số trận tham gia</th>
            <th className="py-2 pr-4">Thắng</th>
            <th className="py-2 pr-4">Thua</th>
            <th className="py-2 pr-4">Hoà</th>
            <th className="py-2 pr-4">Tỉ lệ thắng</th>
            {showQr && <th className="py-2 pr-4">QR trả nợ</th>}
          </tr>
        </thead>
        <tbody>
          {leaderboard.map(row => {
            const balance = showQr ? balances.get(Number(row.id)) || 0 : 0;
            return (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{row.name}</td>
                <td className="py-2 pr-4">
                  <StarRating stars={row.stars} provisional={row.provisional} showNumber />
                </td>
                <td className="py-2 pr-4 text-gray-700">{row.total}</td>
                <td className="py-2 pr-4 text-emerald-700">{row.wins}</td>
                <td className="py-2 pr-4 text-red-600">{row.losses}</td>
                <td className="py-2 pr-4 text-gray-500">{row.draws}</td>
                <td className="py-2 pr-4">{row.winRate}%</td>
                {showQr && (
                  <td className="py-2 pr-4">
                    {balance < 0 ? (
                      <button
                        type="button"
                        onClick={() => onOpenQr(row.id, Math.abs(balance))}
                        className="p-1.5 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200"
                        title={`Trả nợ ${formatVND(Math.abs(balance))}`}
                      >
                        <QrCode size={16} />
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ratingEvents (eventsByMatchId từ usePlayerRatings) là tuỳ chọn: có thì mỗi
// trận hiện thêm ai vừa thăng/giảm hạng sau trận đó.
export function MatchList({ matches, memberName, onDelete, onEdit, ratingEvents }) {
  if (!matches.length) return <p className="text-gray-500 text-sm">Chưa có trận nào.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {matches.map(match => {
        const badge = resultBadgeProps(match);
        return (
        <li key={match.id} className="border rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="font-medium">{match.date}</span>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.className || ''}`}
                style={badge.style}
              >
                {resultLabel(match)}
              </span>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(match.date)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Sửa
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(match.date)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Xoá
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-gray-600">
            <div>
              <p className="text-xs text-gray-400 mb-1">{match.teamNames?.A || 'Đội A'}</p>
              {match.teamA.map(id => memberName(id)).join(', ')}
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">{match.teamNames?.B || 'Đội B'}</p>
              {match.teamB.map(id => memberName(id)).join(', ')}
            </div>
          </div>
          {match.note && <p className="text-xs text-gray-400 mt-1">Ghi chú: {match.note}</p>}
          {(() => {
            const events = ratingEvents?.[match.id];
            if (!events) return null;
            const { promotions = [], demotions = [] } = events;
            if (!promotions.length && !demotions.length) return null;
            const names = list => list.map(e => `${memberName(e.id)} (${e.stars}★)`).join(', ');
            return (
              <div className="flex flex-col gap-0.5 mt-1">
                {promotions.length > 0 && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1">
                    <TrendingUp size={12} /> Thăng hạng: {names(promotions)}
                  </p>
                )}
                {demotions.length > 0 && (
                  <p className="text-xs text-rose-500 flex items-center gap-1">
                    <TrendingDown size={12} /> Giảm hạng: {names(demotions)}
                  </p>
                )}
              </div>
            );
          })()}
          {match.courtAmount > 0 &&
            (() => {
              const playerCount = new Set([...(match.teamA || []), ...(match.teamB || [])]).size;
              const per = playerCount ? Math.round(match.courtAmount / playerCount) : 0;
              return (
                <p className="text-xs text-sky-600 mt-1">
                  Tiền sân: {formatVND(match.courtAmount)}
                  {playerCount > 0 && ` (cả ${playerCount} người chia đều, ~${formatVND(per)}/người)`}
                </p>
              );
            })()}
          {match.lossAmount > 0 &&
            (() => {
              const losingIds = match.result === 'A' ? match.teamB : match.result === 'B' ? match.teamA : [];
              const losingTeamName = match.result === 'A' ? match.teamNames?.B : match.teamNames?.A;
              const per = losingIds.length ? Math.round(match.lossAmount / losingIds.length) : 0;
              return (
                <p className="text-xs text-amber-600 mt-1">
                  Tiền thua: {formatVND(match.lossAmount)}
                  {losingIds.length > 0 &&
                    ` (${losingTeamName || 'đội thua'} chia đều, ~${formatVND(per)}/người)`}
                </p>
              );
            })()}
        </li>
        );
      })}
    </ul>
  );
}

// ratingById (từ usePlayerRatings) là tuỳ chọn: có thì bảng xếp theo level
// (rating) thay vì theo số trận thắng — người thắng nhiều nhưng toàn gặp đội
// yếu sẽ không còn đứng trên người ít trận mà toàn thắng đội mạnh.
export function useLeaderboard(matchHistory, memberName, ratingById) {
  return React.useMemo(() => {
    return Object.entries(matchHistory.members)
      .map(([id, stat]) => {
        const wins = stat.wins || 0;
        const losses = stat.losses || 0;
        const draws = stat.draws || 0;
        const total = wins + losses + draws;
        const rating = ratingById ? ratingById[Number(id)] : undefined;
        return {
          id,
          name: memberName(id),
          wins,
          losses,
          draws,
          total,
          winRate: total ? Math.round((wins / total) * 100) : 0,
          stars: rating ? rating.stars : starsOf(ratingById, id),
          rating: rating ? rating.rating : undefined,
          provisional: rating ? rating.provisional : true,
          streak: rating ? rating.streak : 0,
        };
      })
      .sort((a, b) =>
        ratingById
          ? (b.rating || 0) - (a.rating || 0) || b.winRate - a.winRate
          : b.wins - a.wins || b.winRate - a.winRate
      );
  }, [matchHistory, memberName, ratingById]);
}

export function LichSuTabHeader() {
  return (
    <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
      <Trophy size={18} /> Bảng thắng thua theo thành viên
    </h3>
  );
}
