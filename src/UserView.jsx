import React, { useMemo, useState } from 'react';
import { Goal, History, QrCode, Repeat, Search, ShieldCheck, User, Users } from 'lucide-react';
import { normalizeMemberGroup } from './shared/dataHelpers.js';
import { Avatar } from './ui.jsx';

const EPS = 0.5;
const PROFILE_KEY = 'splitbill:profileId';
const LAST_PROFILE_KEY = 'splitbill:lastProfileId';

const readId = key => {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (_error) {
    return null;
  }
};

const writeId = (key, id) => {
  try {
    if (id) window.localStorage.setItem(key, String(id));
    else window.localStorage.removeItem(key);
  } catch (_error) {
    /* trình duyệt chặn storage: vẫn dùng được trong phiên hiện tại */
  }
};

const normalizeText = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

const dayOf = iso => String(iso || '').slice(0, 10);
const shortDate = iso => {
  const [, month, day] = dayOf(iso).split('-');
  return month && day ? `${day}/${month}` : '';
};
const monthLabelOf = iso => {
  const [year, month] = dayOf(iso).split('-');
  return month ? `Tháng ${month}/${year}` : 'Chưa có ngày';
};

const balanceLabel = (balance, formatVND) =>
  balance < -EPS
    ? { text: `nợ ${formatVND(-balance)}`, className: 'text-debt' }
    : balance > EPS
      ? { text: `dư ${formatVND(balance)}`, className: 'text-pine' }
      : { text: 'sạch nợ', className: 'text-ink-soft' };

const TABS = [
  { key: 'me', label: 'Của tôi', Icon: User },
  { key: 'group', label: 'Cả nhóm', Icon: Users },
  { key: 'history', label: 'Lịch sử', Icon: History },
];

function FootballLink() {
  return (
    <a href="/chiateam" className="chunk-btn h-10 bg-white px-3.5 text-[13px]">
      <Goal size={15} /> Football
    </a>
  );
}

function Brand() {
  return (
    <div className="anim-pop flex items-center gap-2.5">
      <div className="flex h-10 w-10 -rotate-6 items-center justify-center rounded-[13px] bg-brand font-display text-[23px] font-extrabold text-white shadow-[0_4px_0_rgba(30,27,58,.2)]">
        N
      </div>
      <span className="font-display text-2xl font-extrabold">NBill</span>
    </div>
  );
}

function Picker({ people, balances, lastId, formatVND, onChoose }) {
  const [query, setQuery] = useState('');
  const q = normalizeText(query.trim());
  const filtered = people.filter(m => !q || normalizeText(m.name).includes(q));
  const lastMember = !q ? people.find(m => m.id === lastId) : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Brand />
        <FootballLink />
      </div>
      <h1 className="anim-up mt-5 font-display text-[40px] font-extrabold leading-none tracking-tight">Tìm tên bạn</h1>
      <p className="anim-up mt-1.5 text-sm font-bold text-ink-soft" style={{ animationDelay: '.06s' }}>
        Chọn một lần, lần sau vào thẳng thẻ của bạn.
      </p>

      <div className="anim-up relative mt-4" style={{ animationDelay: '.1s' }}>
        <label htmlFor="member-search" className="sr-only">
          Tìm thành viên
        </label>
        <Search size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-soft" />
        <input
          id="member-search"
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Gõ tên để tìm..."
          className="h-[54px] w-full rounded-full border-2 border-[#E4DDFB] bg-white pl-12 pr-5 text-base font-bold outline-none focus:border-brand"
        />
      </div>

      {lastMember && (
        <button
          type="button"
          onClick={() => onChoose(lastMember.id)}
          className="anim-pop mt-3.5 flex w-full items-center gap-3 rounded-3xl bg-sun px-4 py-3 text-left shadow-[0_5px_0_rgba(30,27,58,.14)] transition-transform hover:scale-[1.02]"
          style={{ animationDelay: '.14s' }}
        >
          <Avatar member={lastMember} size={46} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold text-ink-soft">Lần trước</div>
            <div className="break-words font-display text-[22px] font-extrabold leading-tight">{lastMember.name}</div>
          </div>
          <span className={`font-display text-[15px] font-extrabold ${balanceLabel(balances.get(lastMember.id) || 0, formatVND).className}`}>
            {balanceLabel(balances.get(lastMember.id) || 0, formatVND).text}
          </span>
        </button>
      )}

      <h2 className="mt-4 font-display text-xl font-extrabold">Cả nhóm</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {filtered.map((m, index) => {
          const label = balanceLabel(balances.get(m.id) || 0, formatVND);
          return (
            <li key={m.id} className="anim-up" style={{ animationDelay: `${0.16 + Math.min(index, 8) * 0.04}s` }}>
              <button
                type="button"
                onClick={() => onChoose(m.id)}
                className="flex w-full items-center gap-3 rounded-[22px] bg-white py-2.5 pl-2.5 pr-4 text-left shadow-chunk transition-transform hover:-translate-y-0.5"
              >
                <Avatar member={m} size={42} />
                <span className="min-w-0 flex-1 break-words text-base font-extrabold leading-tight">{m.name}</span>
                <span className={`flex-none font-display text-[15px] font-extrabold ${label.className}`}>{label.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && (
        <p className="anim-pop mt-4 rounded-3xl bg-white p-5 text-center font-extrabold text-ink-soft">
          Không thấy ai tên "{query}".
        </p>
      )}
    </div>
  );
}

function Hero({ balance, treasurerName, formatVND, onPay }) {
  const debt = balance < -EPS;
  const surplus = balance > EPS;
  return (
    <section
      className="hero-gradient anim-pop relative mt-4 overflow-hidden rounded-[32px] p-[22px] text-white shadow-[0_10px_0_-2px_rgba(91,63,224,.28)]"
      style={{
        backgroundImage: surplus
          ? 'linear-gradient(120deg,#087F63,#0FA37F,#2BB673)'
          : 'linear-gradient(120deg,#5B3FE0,#B93FD9,#F0568C)',
      }}
    >
      <div aria-hidden="true" className="absolute -right-8 -top-8 h-32 w-32 rounded-[38%] bg-white/15" />
      <div className="relative">
        {debt && (
          <>
            <div className="text-sm font-extrabold opacity-90">Bạn đang nợ</div>
            <div className="font-display text-[46px] font-extrabold leading-[1.1]">{formatVND(-balance)}</div>
            <div className="text-[13px] font-bold opacity-90">cho {treasurerName}</div>
            {onPay && (
              <button
                type="button"
                onClick={onPay}
                className="mt-3.5 inline-flex h-[50px] items-center gap-2 rounded-full bg-sun px-5 text-base font-extrabold text-ink shadow-[0_5px_0_rgba(30,27,58,.25)] transition-transform hover:scale-105 active:translate-y-0.5"
              >
                <QrCode size={20} strokeWidth={2.4} /> Trả nợ bằng QR
              </button>
            )}
          </>
        )}
        {surplus && (
          <>
            <div className="text-sm font-extrabold opacity-95">Bạn đang dư</div>
            <div className="font-display text-[46px] font-extrabold leading-[1.1]">{formatVND(balance)}</div>
            <div className="text-[13px] font-bold opacity-95">{treasurerName} đang giữ tiền của bạn</div>
          </>
        )}
        {!debt && !surplus && (
          <>
            <div className="font-display text-[40px] font-extrabold leading-[1.1]">Sạch nợ!</div>
            <div className="text-sm font-bold opacity-95">Bạn không nợ ai đồng nào. Quá đỉnh.</div>
          </>
        )}
      </div>
    </section>
  );
}

const sortNewest = (a, b) => String(b.date).localeCompare(String(a.date));

export default function UserView({
  members,
  balances,
  treasurer,
  expenses,
  payments,
  isHydrated,
  formatVND,
  onOpenQr,
  monthFilter,
  setMonthFilter,
  availableMonths,
  transactions,
  isSuperAdmin,
  onSwitchAdmin,
}) {
  const people = useMemo(
    () => members.filter(m => !m.isTreasurer && normalizeMemberGroup(m.group) !== 'remove'),
    [members]
  );
  const [profileId, setProfileId] = useState(() => readId(PROFILE_KEY));
  const [lastId, setLastId] = useState(() => readId(LAST_PROFILE_KEY));
  const [tab, setTab] = useState('me');

  const me = people.find(m => m.id === profileId) || null;
  const treasurerName = treasurer?.name || 'thủ quỹ';

  const choose = id => {
    writeId(PROFILE_KEY, id);
    writeId(LAST_PROFILE_KEY, id);
    setProfileId(id);
    setLastId(id);
    setTab('me');
  };
  const clearProfile = () => {
    writeId(PROFILE_KEY, null);
    setProfileId(null);
  };

  const mine = useMemo(
    () =>
      me
        ? expenses
            .filter(e => (e.splits || []).some(s => s.memberId === me.id))
            .map(e => ({
              id: e.id,
              title: e.note || 'Khoản chi',
              date: e.date || String(e.createdAt || '').slice(0, 10),
              total: e.amount,
              share: e.splits.find(s => s.memberId === me.id)?.amount || 0,
            }))
            .sort(sortNewest)
        : [],
    [expenses, me]
  );

  const timeline = useMemo(() => {
    if (!me) return [];
    const items = [
      ...mine.map(e => ({
        key: `s-${e.id}`,
        date: e.date,
        title: e.title,
        amount: e.share,
        tag: 'Phần chia',
        tagClass: 'bg-[#E3D8FF]',
        amountClass: 'text-ink',
      })),
      ...expenses
        .filter(e => e.payerId === me.id)
        .map(e => ({
          key: `c-${e.id}`,
          date: e.date || String(e.createdAt || '').slice(0, 10),
          title: e.note || 'Khoản chi',
          amount: e.amount,
          tag: 'Đã chi',
          tagClass: 'bg-[#D8F5E6]',
          amountClass: 'text-pine',
        })),
      ...payments
        .filter(p => p.memberId === me.id)
        .map(p => ({
          key: `p-${p.id}`,
          date: dayOf(p.createdAt),
          title: p.note || (p.type === 'pay' ? 'Thanh toán nợ' : 'Nhận tiền'),
          amount: p.amount,
          tag: p.type === 'pay' ? 'Đã gửi' : 'Đã nhận',
          tagClass: p.type === 'pay' ? 'bg-[#D8F5E6]' : 'bg-[#CFE8FF]',
          amountClass: p.type === 'pay' ? 'text-pine' : 'text-brand',
        })),
    ];
    return items.sort(sortNewest);
  }, [me, mine, expenses, payments]);

  if (!isHydrated) {
    return (
      <p className="mt-24 text-center font-extrabold text-ink-soft" role="status">
        Đang tải dữ liệu...
      </p>
    );
  }

  const switchAdmin = isSuperAdmin && (
    <button
      type="button"
      onClick={onSwitchAdmin}
      className="chunk-btn fixed right-3 top-3 z-40 h-10 bg-ink px-4 text-[13px] text-white"
    >
      <ShieldCheck size={15} /> Admin
    </button>
  );

  if (!me) {
    return (
      <div className="mx-auto max-w-xl pb-10 pt-2">
        {switchAdmin}
        <Picker people={people} balances={balances} lastId={lastId} formatVND={formatVND} onChoose={choose} />
      </div>
    );
  }

  const myBalance = balances.get(me.id) || 0;
  const paidTotal = payments.filter(p => p.memberId === me.id && p.type === 'pay').reduce((sum, p) => sum + p.amount, 0);

  const debtors = people
    .map(m => ({ member: m, balance: balances.get(m.id) || 0 }))
    .filter(x => x.balance < -EPS)
    .sort((a, b) => a.balance - b.balance);
  const surplusList = people
    .map(m => ({ member: m, balance: balances.get(m.id) || 0 }))
    .filter(x => x.balance > EPS)
    .sort((a, b) => b.balance - a.balance);
  const groupDebt = debtors.reduce((sum, x) => sum - x.balance, 0);
  const maxDebt = Math.max(1, ...debtors.map(x => -x.balance));

  return (
    <div className="mx-auto max-w-xl pb-28 pt-2">
      {switchAdmin}

      {tab === 'me' && (
        <div>
          <div className="anim-up flex items-center gap-3">
            <Avatar member={me} size={52} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-extrabold text-ink-soft">Chào bạn</div>
              <div className="break-words font-display text-[26px] font-extrabold leading-tight">{me.name}</div>
            </div>
            <FootballLink />
            <button
              type="button"
              onClick={clearProfile}
              aria-label="Đổi người dùng"
              className="chunk-btn h-10 bg-white px-3.5 text-[13px]"
            >
              <Repeat size={14} strokeWidth={2.6} /> Đổi
            </button>
          </div>

          <Hero
            balance={myBalance}
            treasurerName={treasurerName}
            formatVND={formatVND}
            onPay={treasurer ? () => onOpenQr(me.id, Math.abs(myBalance)) : null}
          />

          <div className="anim-up mt-3.5 grid grid-cols-2 gap-3" style={{ animationDelay: '.12s' }}>
            <div className="rounded-3xl bg-white px-4 py-3.5">
              <div className="text-xs font-extrabold text-ink-soft">Đã tham gia</div>
              <div className="font-display text-2xl font-extrabold leading-tight">{mine.length} khoản</div>
            </div>
            <div className="rounded-3xl bg-white px-4 py-3.5">
              <div className="text-xs font-extrabold text-ink-soft">Đã gửi</div>
              <div className="font-display text-2xl font-extrabold leading-tight text-pine">{formatVND(paidTotal)}</div>
            </div>
          </div>

          <div className="mt-5 flex items-baseline justify-between">
            <h2 className="font-display text-[22px] font-extrabold">Khoản của tôi</h2>
            <button type="button" onClick={() => setTab('history')} className="py-2 text-[13px] font-extrabold text-brand">
              Lịch sử của tôi
            </button>
          </div>
          <ul className="mt-1.5 flex flex-col gap-2.5">
            {mine.slice(0, 3).map((e, index) => (
              <li
                key={e.id}
                className="anim-up flex items-center gap-2.5 rounded-3xl bg-white px-4 py-3.5 shadow-chunk"
                style={{ animationDelay: `${0.16 + index * 0.06}s` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xl font-extrabold leading-tight">{e.title}</div>
                  <div className="text-xs font-bold text-ink-soft">
                    {shortDate(e.date)} · Tổng {formatVND(e.total)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-extrabold text-ink-soft">Phần của bạn</div>
                  <div className="font-display text-xl font-extrabold text-brand">{formatVND(e.share)}</div>
                </div>
              </li>
            ))}
          </ul>
          {mine.length === 0 && (
            <p className="mt-2 rounded-3xl bg-white/70 p-5 text-center text-sm font-extrabold text-ink-soft">
              Bạn chưa tham gia khoản nào.
            </p>
          )}
        </div>
      )}

      {tab === 'group' && (
        <div>
          <h1 className="anim-up font-display text-[34px] font-extrabold leading-none">Cả nhóm</h1>
          <section
            className="hero-gradient anim-pop relative mt-3.5 overflow-hidden rounded-[32px] p-[22px] text-white shadow-[0_10px_0_-2px_rgba(91,63,224,.28)]"
            style={{ backgroundImage: 'linear-gradient(120deg,#5B3FE0,#B93FD9,#F0568C)' }}
          >
            <div className="text-sm font-extrabold opacity-90">Tổng nợ cả nhóm</div>
            <div className="font-display text-[44px] font-extrabold leading-[1.1]">{formatVND(groupDebt)}</div>
            <div className="text-[13px] font-bold opacity-90">{debtors.length} người đang nợ</div>
          </section>

          <section className="anim-up mt-4 rounded-[28px] bg-white p-[18px] shadow-chunk" style={{ animationDelay: '.1s' }}>
            <h2 className="font-display text-xl font-extrabold">Ai đang nợ nhiều nhất</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {debtors.slice(0, 6).map(({ member, balance }, index) => (
                <li key={member.id} className="flex items-center gap-2.5">
                  <Avatar member={member} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-[13px] font-extrabold">
                      <span className="break-words">
                        {member.name}
                        {member.id === me.id ? ' (bạn)' : ''}
                      </span>
                      <span className="text-debt">{formatVND(-balance)}</span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#FDE3EC]">
                      <div
                        className="anim-grow h-full rounded-full bg-rose"
                        style={{
                          width: `${Math.max(6, (-balance / maxDebt) * 100)}%`,
                          animationDelay: `${0.1 + index * 0.05}s`,
                        }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {debtors.length === 0 && <p className="mt-2 text-sm font-extrabold text-ink-soft">Cả nhóm đã sạch nợ!</p>}
          </section>

          {surplusList.length > 0 && (
            <section className="anim-up mt-3.5 rounded-[28px] bg-[#D8F5E6] p-[18px]" style={{ animationDelay: '.16s' }}>
              <h2 className="font-display text-xl font-extrabold">Đang dư tiền</h2>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {surplusList.map(({ member, balance }) => (
                  <span
                    key={member.id}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-white pl-1.5 pr-3.5 text-[13px] font-extrabold"
                  >
                    <Avatar member={member} size={28} />
                    {member.name} · <span className="text-pine">{formatVND(balance)}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-extrabold">Tất cả khoản chi</h2>
            <select
              className="rounded-full border-2 border-[#E4DDFB] bg-white px-4 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              disabled={availableMonths.length === 0}
              aria-label="Lọc theo tháng"
            >
              {availableMonths.length === 0 && <option value="">Chưa có dữ liệu</option>}
              {availableMonths.map(month => {
                const [year, mm] = month.split('-');
                return (
                  <option key={month} value={month}>
                    {mm}/{year}
                  </option>
                );
              })}
            </select>
          </div>
          <ul className="mt-2.5 flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
            {transactions.map(tx => {
              const payer = members.find(m => m.id === tx.payerId)?.name || 'Không rõ';
              const joined = (tx.splits || []).some(s => s.memberId === me.id);
              return (
                <li
                  key={tx.id}
                  className={`flex items-center gap-3 rounded-[20px] px-4 py-3 ${joined ? 'bg-[#FFF3B8]' : 'bg-white'}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-extrabold">{tx.note}</div>
                    <div className="text-xs font-bold text-ink-soft">
                      {shortDate(tx.date)} · {payer} trả · {(tx.splits || []).length} người
                    </div>
                  </div>
                  <div className="font-display text-lg font-extrabold">{formatVND(tx.amount)}</div>
                </li>
              );
            })}
            {transactions.length === 0 && (
              <li className="rounded-[20px] bg-white p-4 text-center text-sm font-extrabold text-ink-soft">
                Không có giao dịch phù hợp.
              </li>
            )}
          </ul>
        </div>
      )}

      {tab === 'history' && (
        <div>
          <h1 className="anim-up font-display text-[34px] font-extrabold leading-none">Lịch sử của tôi</h1>
          <p className="anim-up mt-1 text-sm font-bold text-ink-soft" style={{ animationDelay: '.06s' }}>
            Mọi khoản bạn đã tham gia và đã gửi, mới nhất trước.
          </p>
          <ul className="mt-3.5 flex flex-col gap-2.5">
            {timeline.map((item, index) => (
              <li key={item.key}>
                {(index === 0 || monthLabelOf(timeline[index - 1].date) !== monthLabelOf(item.date)) && (
                  <div className="mb-2 mt-1.5 font-display text-[17px] font-extrabold text-ink-soft">
                    {monthLabelOf(item.date)}
                  </div>
                )}
                <div
                  className="anim-up flex items-center gap-2.5 rounded-[22px] bg-white px-3.5 py-3 shadow-chunk"
                  style={{ animationDelay: `${Math.min(index, 10) * 0.03}s` }}
                >
                  <span className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-extrabold ${item.tagClass}`}>
                    {item.tag}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-extrabold leading-tight">{item.title}</div>
                    <div className="text-xs font-bold text-ink-soft">{shortDate(item.date)}</div>
                  </div>
                  <div className={`font-display text-lg font-extrabold ${item.amountClass}`}>{formatVND(item.amount)}</div>
                </div>
              </li>
            ))}
          </ul>
          {timeline.length === 0 && (
            <p className="mt-4 rounded-3xl bg-white p-5 text-center font-extrabold text-ink-soft">Chưa có giao dịch nào.</p>
          )}
        </div>
      )}

      <nav
        aria-label="Điều hướng"
        className="fixed inset-x-3.5 bottom-3.5 z-30 mx-auto flex h-[68px] max-w-xl items-center gap-1 rounded-full bg-white p-1.5 shadow-[0_6px_0_rgba(30,27,58,.12)]"
      >
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${
              tab === key ? 'bg-ink text-white' : 'text-ink-soft'
            }`}
          >
            <Icon size={21} strokeWidth={2.5} />
            <span className="text-[11px] font-extrabold">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
