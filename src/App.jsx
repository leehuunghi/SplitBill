import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PlusCircle,
  QrCode,
  UserPlus,
  CreditCard,
  Users,
  UserCheck,
  X,
  ShieldCheck,
  History,
  Goal,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { getNextMemberId, dropQrCacheEntry, normalizeMemberGroup } from './shared/dataHelpers.js';
import { AppShell, Avatar } from './ui.jsx';
import UserView from './UserView.jsx';

const formatVND = value =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'đ';

const formatNumberInput = value =>
  String(value || '')
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const buildTransferContent = memberName => {
  const normalized = String(memberName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  return normalized.slice(0, 25);
};

const getPaymentAmountLimit = (balance, type) =>
  type === 'pay'
    ? Math.max(0, Math.abs(Math.min(balance, 0)))
    : Math.max(0, Math.max(balance, 0));

// ID thành viên được cố định làm "Người trả" trên trang /phat.
const PHAT_FIXED_PAYER_ID = 14;

const MEMBER_GROUPS = [
  { key: 'boss', label: 'Sếp', section: 'boss', sectionLabel: 'Sếp' },
  { key: 'mobile-android', label: 'Android', section: 'mobile', sectionLabel: 'Mobile' },
  { key: 'mobile-ios', label: 'iOS', section: 'mobile', sectionLabel: 'Mobile' },
  { key: 'backend-common', label: 'Common', section: 'backend', sectionLabel: 'Backend' },
  { key: 'backend-devops', label: 'Dev Ops', section: 'backend', sectionLabel: 'Backend' },
  { key: 'backend-core', label: 'Core', section: 'backend', sectionLabel: 'Backend' },
  { key: 'outside', label: 'Người ngoài', section: 'outside', sectionLabel: 'Người ngoài' },
  { key: 'remove', label: 'Remove', section: 'remove', sectionLabel: 'Remove' },
];

const normalizeLoadedData = rawData => {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const sourceMembers = Array.isArray(data.members) ? data.members : [];
  const usedIds = new Set();
  const idMap = new Map();

  const getNextAvailableId = () => {
    let candidate = 1;
    while (usedIds.has(candidate)) candidate += 1;
    return candidate;
  };

  const members = sourceMembers.map(member => {
    const originalId = Number(member?.id) || 0;
    let nextId = originalId;

    if (!nextId || usedIds.has(nextId)) {
      nextId = getNextAvailableId();
    }

    usedIds.add(nextId);

    if (!idMap.has(originalId)) {
      idMap.set(originalId, []);
    }
    idMap.get(originalId).push(nextId);

    return {
      ...member,
      id: nextId,
    };
  });

  const splitIdCursor = new Map();
  const remapRefId = (oldId, mode = 'first') => {
    const candidates = idMap.get(Number(oldId)) || [];
    if (candidates.length === 0) return Number(oldId) || 0;
    if (mode === 'sequence') {
      const currentIndex = splitIdCursor.get(Number(oldId)) || 0;
      const nextId = candidates[Math.min(currentIndex, candidates.length - 1)];
      splitIdCursor.set(Number(oldId), currentIndex + 1);
      return nextId;
    }
    return candidates[0];
  };

  const expenses = Array.isArray(data.expenses)
    ? data.expenses.map(expense => {
        splitIdCursor.clear();
        return {
          ...expense,
          payerId: remapRefId(expense?.payerId),
          splits: Array.isArray(expense?.splits)
            ? expense.splits.map(split => ({
                ...split,
                memberId: remapRefId(split?.memberId, 'sequence'),
              }))
            : [],
        };
      })
    : [];

  const payments = Array.isArray(data.payments)
    ? data.payments.map(payment => ({
        ...payment,
        memberId: remapRefId(payment?.memberId),
      }))
    : [];

  const qrCache = Object.fromEntries(
    Object.entries(data.qrCache && typeof data.qrCache === 'object' ? data.qrCache : {}).map(
      ([memberId, value]) => [String(remapRefId(memberId)), value]
    )
  );

  const treasurer = sourceMembers.find(member => member?.isTreasurer);
  const normalizedTreasurer = treasurer ? members.find(member => member.isTreasurer)?.id || null : null;

  return {
    ...data,
    members,
    expenses,
    payments,
    qrCache,
    nextMemberId: Math.max(Number(data.nextMemberId) || 0, getNextMemberId(members)),
    treasurerId: normalizedTreasurer,
  };
};

const isSuperAdminPath = () => {
  if (typeof window === 'undefined') return false;
  const normalizedPathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return normalizedPathname === '/superadmin';
};

const isPhatPath = () => {
  if (typeof window === 'undefined') return false;
  const normalizedPathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return normalizedPathname === '/phat';
};

// Gọi 1 mutation atomic ở server (xem api/_dataMutations.js): server luôn
// đọc bản dữ liệu MỚI NHẤT rồi mới áp dụng thay đổi, nên không bao giờ đè
// mất thay đổi của người khác đã lưu trước đó (khác với việc gửi nguyên cả
// state để server ghi đè cả file như cách làm cũ).
const runDataAction = (action, payload, saveMeta) =>
  fetch('/api/data-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload, saveMeta }),
  }).then(async response => {
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.success !== true) {
      throw new Error(json?.error || 'Không thể lưu dữ liệu');
    }
    return json.data;
  });

const SplitWiseTool = () => {
  const isSuperAdmin = isSuperAdminPath();
  const isPhatAdmin = isPhatPath();
  // Chế độ "phat": giao diện giống admin nhưng chỉ được phép thêm khoản chi.
  const isRestrictedAdmin = isPhatAdmin && !isSuperAdmin;
  const [isAdminView, setIsAdminView] = useState(isSuperAdmin || isPhatAdmin);
  const showFullAdminControls = isAdminView && !isRestrictedAdmin;
  const [activeAdminPanel, setActiveAdminPanel] = useState(isRestrictedAdmin ? 'expense' : null);
  const [newMemberName, setNewMemberName] = useState('');
  const [isHydrated, setIsHydrated] = useState(false);

  const [members, setMembers] = useState([]);

  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);

  const [treasurerAccount, setTreasurerAccount] = useState('');
  const [treasurerBankBin, setTreasurerBankBin] = useState('');
  const [treasurerAccountNo, setTreasurerAccountNo] = useState('');
  const [treasurerAccountName, setTreasurerAccountName] = useState('');

  const treasurerId = useMemo(
    () => members.find(m => m.isTreasurer)?.id || null,
    [members]
  );

  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    payerId: '',
    participants: [],
    splitMode: 'equal',
    splits: {},
    note: '',
    date: new Date().toISOString().slice(0, 10),
  });

  const [paymentForm, setPaymentForm] = useState({
    memberId: '',
    amount: '',
    type: 'pay', // pay: thanh toán nợ, receive: nhận tiền
    note: '',
  });

  const [qrModal, setQrModal] = useState({
    open: false,
    memberId: null,
    amount: 0,
  });
  const [historyModal, setHistoryModal] = useState({ open: false, memberId: null });
  const [qrPayload, setQrPayload] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const [qrAddInfo, setQrAddInfo] = useState('');
  const [qrCache, setQrCache] = useState({});
  const [draggedMember, setDraggedMember] = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState('');
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [nextMemberId, setNextMemberId] = useState(1);
  const [monthFilter, setMonthFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [toast, setToast] = useState(null);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [lastQrMemberId, setLastQrMemberId] = useState(() => {
    if (typeof window === 'undefined') return null;
    const storedValue = window.localStorage.getItem('splitbill:lastQrMemberId');
    const parsedValue = Number(storedValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  });
  const toastTimerRef = useRef(null);
  const saveRouteLabel = isSuperAdmin ? '/superadmin' : isRestrictedAdmin ? '/phat' : '/';

  const showAdminToast = (type, message) => {
    if (!isAdminView) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, type === 'success' ? 2200 : 2600);
  };

  // Đồng bộ state theo đúng bản dữ liệu server trả về sau mỗi action (server
  // luôn là nguồn dữ liệu đúng, đã merge thay đổi mới nhất từ mọi người).
  const applyServerData = data => {
    if (!data) return;
    if (Array.isArray(data.members)) setMembers(data.members);
    if (Array.isArray(data.expenses)) setExpenses(data.expenses);
    if (Array.isArray(data.payments)) setPayments(data.payments);
    if (typeof data.treasurerAccount === 'string') setTreasurerAccount(data.treasurerAccount);
    if (typeof data.treasurerBankBin === 'string') setTreasurerBankBin(data.treasurerBankBin);
    if (typeof data.treasurerAccountNo === 'string') setTreasurerAccountNo(data.treasurerAccountNo);
    if (typeof data.treasurerAccountName === 'string') setTreasurerAccountName(data.treasurerAccountName);
    if (data.qrCache && typeof data.qrCache === 'object') setQrCache(data.qrCache);
    if (typeof data.nextMemberId === 'number') setNextMemberId(data.nextMemberId);
  };

  // Gọi 1 action lưu ngay lập tức (không debounce/gộp batch vì mỗi action
  // đã là 1 mutation atomic riêng ở server). Thành công thì đồng bộ toàn bộ
  // state theo đúng bản server trả về (bản đã merge thay đổi mới nhất, kể cả
  // của người khác), để không bao giờ hiện dữ liệu cũ/mất đồng bộ.
  const performDataAction = (
    action,
    actionPayload,
    actionLabel,
    successMessage = 'Đã lưu thành công'
  ) => {
    const saveMeta = { route: saveRouteLabel, action: actionLabel, at: new Date().toISOString() };
    return runDataAction(action, actionPayload, saveMeta)
      .then(data => {
        applyServerData(data);
        showAdminToast('success', successMessage);
        return data;
      })
      .catch(error => {
        showAdminToast('error', error?.message || 'Lưu thất bại');
        throw error;
      });
  };

  useEffect(() => {
    let active = true;
    fetch('/api/load')
      .then(res => res.json())
      .then(data => {
        if (!active) return;
        const normalizedData = normalizeLoadedData(data);
        if (Array.isArray(normalizedData.members)) {
          setMembers(normalizedData.members);
          const computedNextId = getNextMemberId(normalizedData.members);
          if (typeof normalizedData.nextMemberId === 'number') {
            setNextMemberId(Math.max(normalizedData.nextMemberId, computedNextId));
          } else {
            setNextMemberId(computedNextId);
          }
        }
        if (Array.isArray(normalizedData.expenses)) setExpenses(normalizedData.expenses);
        if (Array.isArray(normalizedData.payments)) setPayments(normalizedData.payments);
        if (typeof normalizedData.treasurerAccount === 'string') setTreasurerAccount(normalizedData.treasurerAccount);
        if (typeof normalizedData.treasurerBankBin === 'string') setTreasurerBankBin(normalizedData.treasurerBankBin);
        if (typeof normalizedData.treasurerAccountNo === 'string') setTreasurerAccountNo(normalizedData.treasurerAccountNo);
        if (typeof normalizedData.treasurerAccountName === 'string') setTreasurerAccountName(normalizedData.treasurerAccountName);
        if (normalizedData.qrCache && typeof normalizedData.qrCache === 'object') setQrCache(normalizedData.qrCache);
        if (Array.isArray(normalizedData.members) && normalizedData.members.length > 0) {
          const fixedPayer = isRestrictedAdmin
            ? normalizedData.members.find(m => Number(m.id) === PHAT_FIXED_PAYER_ID)
            : null;
          setExpenseForm(prev => ({
            ...prev,
            payerId:
              fixedPayer?.id ||
              normalizedData.members.find(m => m.isTreasurer)?.id ||
              normalizedData.members[0].id,
            participants: normalizedData.members
              .filter(m => !m.isTreasurer && normalizeMemberGroup(m.group) !== 'remove')
              .map(m => m.id),
          }));
          const firstNonTreasurer = normalizedData.members.find(m => !m.isTreasurer);
          setPaymentForm(prev => ({
            ...prev,
            memberId: firstNonTreasurer ? firstNonTreasurer.id : '',
          }));
        }
        setIsHydrated(true);
      })
      .catch(() => {
        setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (lastQrMemberId) {
      window.localStorage.setItem('splitbill:lastQrMemberId', String(lastQrMemberId));
      return;
    }
    window.localStorage.removeItem('splitbill:lastQrMemberId');
  }, [lastQrMemberId]);

  useEffect(() => {
    if (isAdminView) return;
    setToast(null);
  }, [isAdminView]);

  const balances = useMemo(() => {
    const map = new Map();
    members.forEach(m => map.set(m.id, 0));

    expenses.forEach(exp => {
      const { amount, payerId, splits } = exp;
      map.set(payerId, (map.get(payerId) || 0) + amount);
      splits.forEach(s => {
        map.set(s.memberId, (map.get(s.memberId) || 0) - s.amount);
      });
    });

    payments.forEach(p => {
      if (!treasurerId) return;
      if (p.type === 'pay') {
        map.set(p.memberId, (map.get(p.memberId) || 0) + p.amount);
        map.set(treasurerId, (map.get(treasurerId) || 0) - p.amount);
      } else {
        map.set(p.memberId, (map.get(p.memberId) || 0) - p.amount);
        map.set(treasurerId, (map.get(treasurerId) || 0) + p.amount);
      }
    });

    return map;
  }, [members, expenses, payments, treasurerId]);

  const nonTreasurerTotal = useMemo(() => {
    return members
      .filter(m => !m.isTreasurer)
      .reduce((sum, m) => sum + (balances.get(m.id) || 0), 0);
  }, [members, balances]);

  const eligibleParticipants = members.filter(m => !m.isTreasurer);
  // Nhóm "remove" bị ẩn: không chọn sẵn, và chỉ hiện trong danh sách chọn khi đang ở chế độ admin
  // đầy đủ (để kéo thả) hoặc khi người đó đã nằm trong khoản chi đang sửa.
  const selectableParticipants = eligibleParticipants.filter(
    m => normalizeMemberGroup(m.group) !== 'remove'
  );
  const participantList = eligibleParticipants.filter(m => expenseForm.participants.includes(m.id));
  const participantGroups = useMemo(
    () =>
      MEMBER_GROUPS.map(group => ({
        ...group,
        members: eligibleParticipants.filter(
          member =>
            normalizeMemberGroup(member.group) === group.key &&
            (group.key !== 'remove' ||
              showFullAdminControls ||
              expenseForm.participants.includes(member.id))
        ),
      })),
    [eligibleParticipants]
  );
  const participantSections = useMemo(() => {
    const sections = [];
    participantGroups.forEach(group => {
      let section = sections.find(s => s.section === group.section);
      if (!section) {
        section = { section: group.section, sectionLabel: group.sectionLabel, groups: [] };
        sections.push(section);
      }
      section.groups.push(group);
    });
    return sections;
  }, [participantGroups]);
  const editingPayment =
    editingTransaction?.type === 'payment'
      ? payments.find(payment => payment.id === editingTransaction.id) || null
      : null;
  const selectedPaymentMemberId = Number(paymentForm.memberId) || 0;
  const selectedPaymentBalance = (() => {
    let balance = balances.get(selectedPaymentMemberId) || 0;
    if (editingPayment && editingPayment.memberId === selectedPaymentMemberId) {
      balance += editingPayment.type === 'pay' ? -editingPayment.amount : editingPayment.amount;
    }
    return balance;
  })();
  const paymentAmountLimit = getPaymentAmountLimit(
    selectedPaymentBalance,
    paymentForm.type
  );

  const resetExpenseForm = () => {
    const fixedPayerId = isRestrictedAdmin
      ? members.find(m => Number(m.id) === PHAT_FIXED_PAYER_ID)?.id
      : null;
    const defaultPayerId =
      fixedPayerId || members.find(m => m.isTreasurer)?.id || members[0]?.id || '';
    setExpenseForm({
      amount: '',
      payerId: defaultPayerId,
      participants: selectableParticipants.map(m => m.id),
      splitMode: 'equal',
      splits: {},
      note: '',
      date: new Date().toISOString().slice(0, 10),
    });
  };

  const resetPaymentForm = () => {
    const firstNonTreasurer = members.find(m => !m.isTreasurer);
    setPaymentForm({
      memberId: firstNonTreasurer ? firstNonTreasurer.id : '',
      amount: '',
      type: 'pay',
      note: '',
    });
  };

  const computedSplits = useMemo(() => {
    const amount = Number(expenseForm.amount || 0);
    if (!amount || participantList.length === 0) return [];

    if (expenseForm.splitMode === 'equal') {
      const per = Math.round(amount / participantList.length);
      const result = participantList.map((m, idx) => {
        const isLast = idx === participantList.length - 1;
        const adjAmount = isLast
          ? amount - per * (participantList.length - 1)
          : per;
        return { memberId: m.id, amount: adjAmount };
      });
      return result;
    }

    return participantList.map(m => ({
      memberId: m.id,
      amount: Number(expenseForm.splits[m.id] || 0),
    }));
  }, [expenseForm, participantList]);

  const splitSum = computedSplits.reduce((sum, s) => sum + s.amount, 0);
  const splitValid =
    Number(expenseForm.amount || 0) > 0 && splitSum === Number(expenseForm.amount || 0);

  const addExpense = () => {
    if (!splitValid || isSavingExpense) return;
    const amount = Number(expenseForm.amount);
    const existingExpense =
      editingTransaction?.type === 'expense'
        ? expenses.find(expense => expense.id === editingTransaction.id) || null
        : null;
    const wasEditing = Boolean(existingExpense);
    setIsSavingExpense(true);
    performDataAction(
      'expense.upsert',
      {
        expense: {
          id: existingExpense?.id,
          amount,
          payerId: Number(expenseForm.payerId),
          splits: computedSplits,
          note: expenseForm.note.trim(),
          date: expenseForm.date,
        },
      },
      wasEditing ? 'Sửa khoản chi' : 'Thêm khoản chi'
    )
      .then(() => {
        setEditingTransaction(null);
        resetExpenseForm();
        setActiveAdminPanel(null);
      })
      .catch(() => {})
      .finally(() => setIsSavingExpense(false));
  };

  const addPayment = () => {
    if (isRestrictedAdmin) return;
    if (!treasurerId) return;
    if (isSavingPayment) return;
    const amount = Number(paymentForm.amount || 0);
    if (!amount) return;
    const memberId = Number(paymentForm.memberId);
    const existingPayment =
      editingTransaction?.type === 'payment'
        ? payments.find(payment => payment.id === editingTransaction.id) || null
        : null;
    const wasEditingPayment = Boolean(existingPayment);
    setIsSavingPayment(true);
    performDataAction(
      'payment.upsert',
      {
        payment: {
          id: existingPayment?.id,
          memberId,
          amount,
          type: paymentForm.type,
          note: paymentForm.note.trim(),
        },
      },
      wasEditingPayment ? 'Sửa thanh toán' : 'Thêm thanh toán'
    )
      .then(() => {
        if (qrModal.memberId === memberId || qrModal.memberId === existingPayment?.memberId) {
          setQrModal({ open: false, memberId: null, amount: 0 });
          setQrPayload('');
          setQrError('');
          setQrAddInfo('');
          setQrLoading(false);
        }
        setEditingTransaction(null);
        resetPaymentForm();
        setActiveAdminPanel(null);
      })
      .catch(() => {})
      .finally(() => setIsSavingPayment(false));
  };

  const deleteExpense = expenseId => {
    performDataAction('expense.delete', { expenseId }, 'Xóa khoản chi');
  };

  const deleteMember = memberId => {
    if (isRestrictedAdmin) return;
    const targetMember = members.find(member => member.id === memberId);
    if (!targetMember) return;

    performDataAction(
      'member.delete',
      { memberId },
      `Xóa thành viên: ${targetMember.name}`,
      `Đã xóa thành viên ${targetMember.name}`
    )
      .then(() => {
        setExpenseForm(prev => ({
          ...prev,
          participants: prev.participants.filter(id => id !== memberId),
          splits: Object.fromEntries(
            Object.entries(prev.splits).filter(([id]) => Number(id) !== memberId)
          ),
          payerId: Number(prev.payerId) === memberId ? '' : prev.payerId,
        }));
        setPaymentForm(prev => ({
          ...prev,
          memberId: Number(prev.memberId) === memberId ? '' : prev.memberId,
        }));
        if (qrModal.memberId === memberId) {
          closeQr();
        }
      })
      .catch(() => {});
  };

  const completeMemberPayment = memberId => {
    if (!isAdminView || isRestrictedAdmin) return;
    if (!treasurerId) return;

    const member = members.find(item => item.id === memberId);
    const balance = balances.get(memberId) || 0;
    const amount = Math.abs(Math.min(balance, 0));

    if (!member || !amount) return;

    const isConfirmed = window.confirm(
      `Xác nhận hoàn tất thanh toán cho ${member.name} số tiền ${formatVND(amount)}?`
    );

    if (!isConfirmed) return;

    performDataAction(
      'payment.upsert',
      { payment: { memberId, amount, type: 'pay', note: 'Complete thanh toán' } },
      `Complete thanh toán: ${member.name}`,
      `Đã complete thanh toán cho ${member.name}`
    )
      .then(() => {
        if (qrModal.memberId === memberId) {
          closeQr();
        }
      })
      .catch(() => {});
  };

  const startEditingTransaction = tx => {
    if (!isAdminView || isRestrictedAdmin) return;
    if (tx.type === 'expense') {
      setEditingTransaction({ type: 'expense', id: Number(tx.id.replace('exp-', '')) });
      setExpenseForm({
        amount: String(tx.amount || ''),
        payerId: String(tx.payerId || ''),
        participants: (tx.splits || []).map(split => split.memberId),
        splitMode: 'custom',
        splits: Object.fromEntries(
          (tx.splits || []).map(split => [split.memberId, String(split.amount || '')])
        ),
        note: tx.note || '',
        date: tx.date || new Date().toISOString().slice(0, 10),
      });
      setActiveAdminPanel('expense');
      return;
    }

    setEditingTransaction({ type: 'payment', id: Number(tx.id.replace('pay-', '')) });
    setPaymentForm({
      memberId: String(tx.memberId || ''),
      amount: String(tx.amount || ''),
      type: tx.paymentType || 'pay',
      note: tx.note || '',
    });
    setActiveAdminPanel('payment');
  };

  const cancelEditingTransaction = () => {
    setEditingTransaction(null);
    resetExpenseForm();
    resetPaymentForm();
  };

  const addMember = () => {
    if (isRestrictedAdmin) return;
    const name = newMemberName.trim();
    if (!name) return;
    performDataAction('member.add', { name }, `Thêm thành viên: ${name}`)
      .then(() => {
        setNewMemberName('');
        setActiveAdminPanel(null);
      })
      .catch(() => {});
  };

  const toggleParticipant = id => {
    setExpenseForm(prev => {
      const exists = prev.participants.includes(id);
      const next = exists
        ? prev.participants.filter(p => p !== id)
        : [...prev.participants, id];
      return { ...prev, participants: next };
    });
  };

  const selectTreasurer = id => {
    if (isRestrictedAdmin) return;
    const treasurerMember = members.find(m => m.id === id);
    performDataAction(
      'member.setTreasurer',
      { memberId: id },
      `Chọn thủ quỹ: ${treasurerMember?.name || id}`
    )
      .then(() => {
        setExpenseForm(prev => ({
          ...prev,
          participants: prev.participants.filter(pid => pid !== id),
          splits: { ...prev.splits, [id]: undefined },
        }));
      })
      .catch(() => {});
  };

  const moveMemberToGroup = (targetMember, groupKey) => {
    const normalizedGroup = normalizeMemberGroup(groupKey);
    performDataAction(
      'member.setGroup',
      { memberId: targetMember?.id, group: normalizedGroup },
      `Đổi nhóm: ${targetMember?.name || ''} -> ${normalizedGroup}`
    ).catch(() => {});
  };

  const handleMemberDragStart = (member, groupKey) => event => {
    setDraggedMember({ id: member.id, name: member.name, fromGroup: groupKey });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ id: member.id, name: member.name, fromGroup: groupKey })
    );
  };

  const handleGroupDragOver = groupKey => event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverGroup(groupKey);
  };

  const handleGroupDrop = groupKey => event => {
    event.preventDefault();
    let droppedMember = draggedMember;
    const rawData = event.dataTransfer.getData('text/plain');
    if (!droppedMember && rawData) {
      try {
        droppedMember = JSON.parse(rawData);
      } catch (_error) {
        droppedMember = null;
      }
    }
    if (droppedMember) {
      moveMemberToGroup(droppedMember, groupKey);
    }
    setDraggedMember(null);
    setDragOverGroup('');
  };

  const handleGroupDragLeave = groupKey => event => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setDragOverGroup(current => (current === groupKey ? '' : current));
    }
  };

  const handleMemberDragEnd = () => {
    setDraggedMember(null);
    setDragOverGroup('');
  };

  const openQrForMember = async (memberId, amount) => {
    if (!isAdminView) {
      setLastQrMemberId(memberId);
    }
    setQrModal({ open: true, memberId, amount });
    setQrPayload('');
    setQrError('');
    const member = members.find(m => m.id === memberId);
    const addInfo = buildTransferContent(member?.name);
    setQrAddInfo(addInfo);
    const cacheKey = String(memberId);
    const cachedQr = qrCache[cacheKey];
    if (cachedQr?.checksum === amount && cachedQr?.payload) {
      setQrPayload(cachedQr.payload);
      setQrLoading(false);
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
        const entry = {
          checksum: amount,
          payload: data.payload,
          addInfo,
          updatedAt: new Date().toISOString(),
        };
        setQrCache(prev => ({ ...prev, [cacheKey]: entry }));
        // Cache QR chỉ để tránh gọi lại VietQR API, không quan trọng bằng dữ
        // liệu chính -> lưu ngầm, lỗi thì bỏ qua, không cần toast.
        runDataAction(
          'qrCache.upsert',
          { memberId, entry },
          { route: saveRouteLabel, action: 'Cache QR', at: new Date().toISOString() }
        ).catch(() => {});
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

  const qrMember = members.find(m => m.id === qrModal.memberId);
  const qrMemberExpenses = useMemo(() => {
    if (!qrModal.memberId) return [];
    return expenses.filter(exp =>
      exp.splits.some(s => s.memberId === qrModal.memberId)
    );
  }, [expenses, qrModal.memberId]);
  const qrContent = qrPayload;

  const transactions = useMemo(() => {
    return expenses
      .map(exp => ({
      id: `exp-${exp.id}`,
      type: 'expense',
      amount: exp.amount,
      note: exp.note || 'Khoản chi',
      date: exp.date || exp.createdAt?.slice(0, 10),
      createdAt: exp.createdAt,
      payerId: exp.payerId,
      splits: exp.splits,
    }))
      .sort((a, b) => {
      const aTime = new Date(a.createdAt || a.date || 0).getTime();
      const bTime = new Date(b.createdAt || b.date || 0).getTime();
      return bTime - aTime;
    });
  }, [expenses]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (monthFilter && (tx.date || '').slice(0, 7) !== monthFilter) return false;
      if (personFilter) {
        const personId = Number(personFilter);
        const isPayer = tx.payerId === personId;
        const isParticipant = (tx.splits || []).some(s => s.memberId === personId);
        if (!isPayer && !isParticipant) return false;
      }
      return true;
    });
  }, [transactions, monthFilter, personFilter]);

  const receivedPayments = useMemo(() => {
    return [...payments].sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }, [payments]);

  const filteredReceivedPayments = useMemo(() => {
    if (!monthFilter) return receivedPayments;
    return receivedPayments.filter(payment =>
      (payment.createdAt?.slice(0, 7) || '') === monthFilter
    );
  }, [receivedPayments, monthFilter]);

  const availableMonths = useMemo(() => {
    const months = new Set();
    transactions.forEach(tx => {
      const key = (tx.date || '').slice(0, 7);
      if (key) months.add(key);
    });
    receivedPayments.forEach(payment => {
      const key = (payment.createdAt || '').slice(0, 7);
      if (key) months.add(key);
    });
    return Array.from(months).sort((a, b) => (a < b ? 1 : -1));
  }, [transactions, receivedPayments]);

  useEffect(() => {
    if (monthFilter) return;
    if (availableMonths.length > 0) {
      setMonthFilter(availableMonths[0]);
    }
  }, [availableMonths, monthFilter]);

  const availablePeople = useMemo(() => {
    const ids = new Set();
    transactions.forEach(tx => {
      if (tx.payerId) ids.add(tx.payerId);
      (tx.splits || []).forEach(s => ids.add(s.memberId));
    });
    return members
      .filter(m => ids.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions, members]);

  const openHistoryForMember = memberId => {
    setHistoryModal({ open: true, memberId });
  };

  const closeHistory = () => {
    setHistoryModal({ open: false, memberId: null });
  };

  const historyMember = members.find(m => m.id === historyModal.memberId);

  const historyPaidExpenses = useMemo(() => {
    if (!historyModal.memberId) return [];
    return expenses
      .filter(exp => exp.payerId === historyModal.memberId)
      .filter(exp => {
        if (!monthFilter) return true;
        const key = (exp.date || exp.createdAt || '').slice(0, 7);
        return key === monthFilter;
      })
      .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
  }, [expenses, historyModal.memberId, monthFilter]);

  const historyOwedExpenses = useMemo(() => {
    if (!historyModal.memberId) return [];
    return expenses
      .filter(exp => exp.splits.some(s => s.memberId === historyModal.memberId))
      .filter(exp => {
        if (!monthFilter) return true;
        const key = (exp.date || exp.createdAt || '').slice(0, 7);
        return key === monthFilter;
      })
      .map(exp => ({
        ...exp,
        shareAmount: exp.splits.find(s => s.memberId === historyModal.memberId)?.amount || 0,
      }))
      .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
  }, [expenses, historyModal.memberId, monthFilter]);

  const historyTotalPaid = useMemo(
    () => historyPaidExpenses.reduce((sum, exp) => sum + exp.amount, 0),
    [historyPaidExpenses]
  );

  const historyTotalOwed = useMemo(
    () => historyOwedExpenses.reduce((sum, exp) => sum + exp.shareAmount, 0),
    [historyOwedExpenses]
  );

  const historySentPayments = useMemo(() => {
    if (!historyModal.memberId) return [];
    return payments
      .filter(p => p.memberId === historyModal.memberId && p.type === 'pay')
      .filter(p => {
        if (!monthFilter) return true;
        return (p.createdAt || '').slice(0, 7) === monthFilter;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [payments, historyModal.memberId, monthFilter]);

  const historyReceivedPayments = useMemo(() => {
    if (!historyModal.memberId) return [];
    return payments
      .filter(p => p.memberId === historyModal.memberId && p.type === 'receive')
      .filter(p => {
        if (!monthFilter) return true;
        return (p.createdAt || '').slice(0, 7) === monthFilter;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [payments, historyModal.memberId, monthFilter]);

  return (
    <AppShell>
      {isAdminView && toast && (
        <div className="fixed top-4 right-4 z-50">
          <div
            className={`anim-pop rounded-full px-5 py-3 text-sm font-extrabold text-white shadow-[0_8px_0_rgba(0,0,0,.15)] ${
              toast.type === 'success' ? 'bg-ink' : 'bg-debt'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
      {isAdminView && (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="anim-pop flex items-center gap-3">
            <div className="flex h-12 w-12 -rotate-6 items-center justify-center rounded-2xl bg-brand font-display text-[28px] font-extrabold text-white shadow-[0_5px_0_rgba(30,27,58,.2)]">
              N
            </div>
            <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight md:text-3xl">
              NBill
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/chiateam"
              className="chunk-btn h-11 bg-white px-4 text-sm"
            >
              <Goal size={16} /> Football
            </a>
            {isSuperAdmin && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck size={16} className="text-ink-soft" />
                  <span className="text-ink-soft">Chế độ:</span>
                </div>
                <div className="flex gap-1 rounded-full bg-white p-1 shadow-chunk">
                  <button
                    className={`h-10 rounded-full px-4 text-sm font-extrabold transition-colors ${
                      !isAdminView ? 'bg-ink text-white' : 'text-ink-soft'
                    }`}
                    onClick={() => setIsAdminView(false)}
                  >
                    Người dùng
                  </button>
                  <button
                    className={`h-10 rounded-full px-4 text-sm font-extrabold transition-colors ${
                      isAdminView ? 'bg-ink text-white' : 'text-ink-soft'
                    }`}
                    onClick={() => setIsAdminView(true)}
                  >
                    Admin
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {showFullAdminControls && (
          <div className="flex flex-wrap gap-2">
                        <button
              className={`chunk-btn h-11 px-4 text-sm ${
                activeAdminPanel === 'expense' ? 'bg-ink text-white' : 'bg-white'
              }`}
              onClick={() =>
                setActiveAdminPanel(prev => (prev === 'expense' ? null : 'expense'))
              }
            >
              <PlusCircle size={18} />
              Thêm khoản chi
            </button>
            {showFullAdminControls && (
              <>
                <button
                  className={`chunk-btn h-11 px-4 text-sm ${
                    activeAdminPanel === 'member' ? 'bg-ink text-white' : 'bg-white'
                  }`}
                  onClick={() =>
                    setActiveAdminPanel(prev => (prev === 'member' ? null : 'member'))
                  }
                >
                  <UserPlus size={18} />
                  Thêm thành viên
                </button>
                <button
                  className={`chunk-btn h-11 px-4 text-sm ${
                    activeAdminPanel === 'payment' ? 'bg-ink text-white' : 'bg-white'
                  }`}
                  onClick={() =>
                    setActiveAdminPanel(prev => (prev === 'payment' ? null : 'payment'))
                  }
                >
                  <CreditCard size={18} />
                  Thêm thanh toán
                </button>
              </>
            )}
          </div>
        )}

        {showFullAdminControls && activeAdminPanel === 'member' && (
          <section className="card-surface anim-up p-5 md:p-6">
            <h3 className="section-title mb-4">Thêm thành viên mới</h3>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="Tên thành viên"
                value={newMemberName}
                onChange={e => setNewMemberName(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  className="chunk-btn bg-ink px-5 py-2.5 text-white"
                  onClick={addMember}
                >
                  Lưu
                </button>
                <button
                  className="chunk-btn bg-white px-5 py-2.5"
                  onClick={() => {
                    setActiveAdminPanel(null);
                    setNewMemberName('');
                  }}
                >
                  Hủy
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="card-surface anim-up p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-ink-soft" />
              <h2 className="section-title">Danh sách thành viên</h2>
            </div>
            {showFullAdminControls && (
              <div className="flex items-center gap-3">
                <label className="label-text">Chọn thủ quỹ</label>
                <select
                  className="rounded-full border-2 border-[#E4DDFB] bg-white px-4 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
                  value={treasurerId || ''}
                  onChange={e => selectTreasurer(Number(e.target.value))}
                >
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {treasurerId && (
            <div className="mt-4">
              {members
                .filter(m => m.isTreasurer)
                .map(m => {
                  const totalDebtAmount = Math.abs(Math.min(nonTreasurerTotal, 0));
                  return (
                    <div
                      key={m.id}
                      style={{ backgroundImage: 'linear-gradient(120deg,#5B3FE0,#B93FD9,#F0568C)' }}
                      className={`hero-gradient rounded-[28px] p-5 text-white shadow-[0_10px_0_-2px_rgba(91,63,224,.28)] ${
                        isAdminView
                          ? 'grid grid-cols-[1fr_auto_auto] items-center gap-3'
                          : 'flex flex-col items-center justify-center text-center gap-2'
                      }`}
                    >
                      {isAdminView ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{m.name}</span>
                          <span className="rounded-full bg-sun px-2.5 py-1 text-xs font-extrabold text-ink">Thủ quỹ</span>
                        </div>
                      ) : (
                        <div
                          className="font-display text-4xl font-extrabold text-white md:text-5xl"
                        >
                          Tổng nợ: {formatVND(totalDebtAmount)}
                        </div>
                      )}
                      {isAdminView && (
                        <div className="text-right">
                          <div className="text-xs font-extrabold text-white/80">Tổng của các thành viên</div>
                          <div
                            className="font-display text-xl font-extrabold text-white"
                          >
                            {nonTreasurerTotal > 0 ? '+' : ''}
                            {formatVND(nonTreasurerTotal)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {members
              .filter(m => !m.isTreasurer && normalizeMemberGroup(m.group) !== 'remove')
              .slice()
              .sort((a, b) => {
                if (isAdminView || !lastQrMemberId) return 0;
                if (a.id === lastQrMemberId) return -1;
                if (b.id === lastQrMemberId) return 1;
                return 0;
              })
              .map((m, rowIndex) => {
              const balance = balances.get(m.id) || 0;
              return (
                <div
                  key={m.id}
                  style={{ animationDelay: `${Math.min(rowIndex, 12) * 0.04}s` }}
                  className="anim-up grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 rounded-[24px] bg-[#FAF8FF] p-3.5 transition-transform hover:-translate-y-0.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar member={m} size={40} />
                    <span className="truncate font-extrabold">{m.name}</span>
                  </div>
                  <div
                    className={`text-right font-display text-lg font-extrabold ${balance < 0 ? 'text-debt' : 'text-pine'}`}
                  >
                    {balance > 0 ? '+' : ''}
                    {formatVND(balance)}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2 empty:hidden sm:col-span-1 sm:ml-2 sm:min-w-[40px] sm:empty:flex">
                    {balance < 0 && treasurerId && (
                      <>
                        {!isRestrictedAdmin && (
                          <button
                            onClick={() => openQrForMember(m.id, Math.abs(balance))}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFEAFF] text-brand transition-transform hover:scale-110"
                            title="Tạo QR thanh toán"
                          >
                            <QrCode size={18} />
                          </button>
                        )}
                        {showFullAdminControls && (
                          <button
                            onClick={() => completeMemberPayment(m.id)}
                            className="chunk-btn h-10 bg-pine px-4 text-sm text-white"
                            title="Complete thanh toán"
                          >
                            Complete
                          </button>
                        )}
                      </>
                    )}
                    {showFullAdminControls && (
                      <button
                        onClick={() => deleteMember(m.id)}
                        className="chunk-btn h-10 bg-[#FFD6DC] px-4 text-sm text-[#9B1C3A]"
                        title="Xóa thành viên"
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card-surface anim-up p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h3 className="section-title">Danh sách thu chi</h3>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-soft">Lọc theo tháng</span>
              <select
                className="rounded-full border-2 border-[#E4DDFB] bg-white px-4 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
                disabled={availableMonths.length === 0}
              >
                {availableMonths.length === 0 && (
                  <option value="">Chưa có dữ liệu</option>
                )}
                {availableMonths.map(month => {
                  const [year, mm] = month.split('-');
                  return (
                    <option key={month} value={month}>
                      {mm}/{year}
                    </option>
                  );
                })}
              </select>
              <span className="text-ink-soft">Lọc theo người</span>
              <select
                className="rounded-full border-2 border-[#E4DDFB] bg-white px-4 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
                value={personFilter}
                onChange={e => setPersonFilter(e.target.value)}
                disabled={availablePeople.length === 0}
              >
                <option value="">Tất cả</option>
                {availablePeople.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              {personFilter && (
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFEAFF] text-brand transition-transform hover:scale-110"
                  onClick={() => openHistoryForMember(Number(personFilter))}
                  title="Xem lịch sử"
                >
                  <History size={18} />
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white max-h-80 overflow-y-auto">
            {filteredTransactions.length === 0 && (
              <div className="p-4 text-sm text-ink-soft">Không có giao dịch phù hợp.</div>
            )}
            {filteredTransactions.map(tx => {
              const dateLabel = tx.date
                ? new Date(tx.date).toLocaleDateString('vi-VN')
                : 'Chưa có ngày';
              if (tx.type === 'expense') {
                const payer = members.find(m => m.id === tx.payerId)?.name || 'Không rõ';
                const participantNames = (tx.splits || [])
                  .map(s => members.find(m => m.id === s.memberId)?.name)
                  .filter(Boolean)
                  .join(', ');
                return (
                  <div
                    key={tx.id}
                    className={`p-4 flex items-center justify-between gap-4 ${
                      showFullAdminControls ? 'cursor-pointer hover:bg-[#FAF8FF]' : ''
                    }`}
                    onClick={() => startEditingTransaction(tx)}
                  >
                    <div>
                      <div className="font-medium">{tx.note}</div>
                      <div className="text-xs text-ink-soft">
                        {dateLabel} • Người trả: {payer}
                      </div>
                      <div className="text-xs text-ink-soft">
                        Tham gia: {participantNames || 'Chưa có'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-ink-soft">Chi</div>
                      <div className="font-semibold text-debt">{formatVND(tx.amount)}</div>
                    </div>
                    {showFullAdminControls && (
                      <button
                        className="chunk-btn h-10 bg-[#FFD6DC] px-4 text-sm text-[#9B1C3A]"
                        onClick={event => {
                          event.stopPropagation();
                          deleteExpense(Number(tx.id.replace('exp-', '')));
                        }}
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                );
              }
              const memberName = members.find(m => m.id === tx.memberId)?.name || 'Không rõ';
              const paymentLabel =
                tx.paymentType === 'pay' ? 'Thanh toán nợ' : 'Nhận tiền';
              const paymentAmountClass =
                tx.paymentType === 'pay' ? 'text-brand' : 'text-pine';
              return (
                <div
                  key={tx.id}
                  className={`p-4 flex items-center justify-between gap-4 ${
                    showFullAdminControls ? 'cursor-pointer hover:bg-[#FAF8FF]' : ''
                  }`}
                  onClick={() => startEditingTransaction(tx)}
                >
                  <div>
                    <div className="font-medium">{tx.note}</div>
                    <div className="text-xs text-ink-soft">
                      {dateLabel} • {memberName} • {paymentLabel}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-ink-soft">{paymentLabel}</div>
                    <div className={`font-semibold ${paymentAmountClass}`}>
                      {formatVND(tx.amount)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {showFullAdminControls && (
          <section className="card-surface anim-up p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="section-title">Lịch sử nhận tiền</h3>
              <span className="text-sm text-ink-soft">
                {filteredReceivedPayments.length} giao dịch
              </span>
            </div>
            <div className="mt-4 divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white max-h-80 overflow-y-auto">
              {filteredReceivedPayments.length === 0 && (
                <div className="p-4 text-sm text-ink-soft">
                  Chưa có giao dịch nhận tiền trong tháng này.
                </div>
              )}
              {filteredReceivedPayments.map(payment => {
                const memberName =
                  members.find(member => member.id === payment.memberId)?.name || 'Không rõ';
                const dateLabel = payment.createdAt
                  ? new Date(payment.createdAt).toLocaleDateString('vi-VN')
                  : 'Chưa có ngày';
                const paymentLabel =
                  payment.type === 'pay' ? 'Thanh toán nợ' : 'Nhận tiền';
                const paymentBadge =
                  payment.type === 'pay' ? 'Đã thanh toán' : 'Đã nhận';
                const paymentAmountClass =
                  payment.type === 'pay' ? 'text-brand' : 'text-pine';

                return (
                  <div
                    key={`received-${payment.id}`}
                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-[#FAF8FF]"
                    onClick={() =>
                      startEditingTransaction({
                        id: `pay-${payment.id}`,
                        type: 'payment',
                        amount: payment.amount,
                        note: payment.note || 'Nhận tiền',
                        date: payment.createdAt?.slice(0, 10),
                        createdAt: payment.createdAt,
                        memberId: payment.memberId,
                        paymentType: payment.type,
                      })
                    }
                  >
                    <div>
                      <div className="font-medium">{payment.note || paymentLabel}</div>
                      <div className="text-xs text-ink-soft">
                        {dateLabel} • {memberName} • {paymentLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-ink-soft">{paymentBadge}</div>
                      <div className={`font-semibold ${paymentAmountClass}`}>
                        {formatVND(payment.amount)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isAdminView && activeAdminPanel === 'expense' && (
          <section className="card-surface anim-up p-5 md:p-6">
            <h3 className="section-title mb-4">
              {editingTransaction?.type === 'expense' ? 'Sửa khoản chi' : 'Thêm khoản chi'}
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <label className="label-text block">
                Số tiền
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-field mt-1.5"
                  value={formatNumberInput(expenseForm.amount)}
                  onChange={e =>
                    setExpenseForm(prev => ({
                      ...prev,
                      amount: e.target.value.replace(/\D/g, ''),
                    }))
                  }
                  placeholder="VD: 250000"
                />
              </label>
              <label className="label-text block">
                Ngày
                <input
                  type="date"
                  className="input-field mt-1.5"
                  value={expenseForm.date}
                  onChange={e =>
                    setExpenseForm(prev => ({ ...prev, date: e.target.value }))
                  }
                />
              </label>
              <label className="label-text block">
                Người trả
                <select
                  className={`input-field mt-1.5 ${
                    isRestrictedAdmin ? 'bg-gray-100 text-ink-soft cursor-not-allowed' : ''
                  }`}
                  value={expenseForm.payerId}
                  disabled={isRestrictedAdmin}
                  onChange={e =>
                    setExpenseForm(prev => ({ ...prev, payerId: e.target.value }))
                  }
                >
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>Người tham gia</span>
                  <span className="text-xs text-ink-soft">
                    Đã chọn {participantList.length}/{selectableParticipants.length} người
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = selectableParticipants.map(m => m.id);
                      const isAll = allIds.every(id => expenseForm.participants.includes(id));
                      setExpenseForm(prev => ({
                        ...prev,
                        participants: isAll ? [] : allIds,
                      }));
                    }}
                    className="chunk-btn h-10 bg-white px-4 text-sm"
                  >
                    Chọn tất cả
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {participantSections.map(section => {
                    const sectionMemberCount = section.groups.reduce(
                      (sum, group) => sum + group.members.length,
                      0
                    );
                    const sectionActiveCount = section.groups.reduce(
                      (sum, group) =>
                        sum + group.members.filter(m => expenseForm.participants.includes(m.id)).length,
                      0
                    );
                    if (section.section === 'remove' && sectionMemberCount === 0) return null;
                    const nested = section.groups.length > 1;
                    return (
                      <div key={section.section} className="rounded-[22px] bg-[#FAF8FF] p-3">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="font-medium">{section.sectionLabel}</span>
                          <span className="text-xs text-ink-soft">
                            {sectionActiveCount}/{sectionMemberCount}
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {section.groups.map(group => (
                            <div
                              key={group.key}
                              onDragOver={handleGroupDragOver(group.key)}
                              onDrop={handleGroupDrop(group.key)}
                              onDragLeave={handleGroupDragLeave(group.key)}
                              className={`rounded-lg transition-colors ${
                                nested ? 'border p-2' : ''
                              } ${
                                dragOverGroup === group.key
                                  ? 'border-brand bg-[#EFEAFF]'
                                  : nested
                                  ? 'border-[#E4DDFB] bg-white'
                                  : ''
                              }`}
                            >
                              {nested && (
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <span className="text-xs font-medium text-ink-soft">{group.label}</span>
                                  <span className="text-xs text-[#9a95b8]">
                                    {group.members.filter(m => expenseForm.participants.includes(m.id)).length}/
                                    {group.members.length}
                                  </span>
                                </div>
                              )}
                              <div className="flex flex-col gap-2">
                                {group.members.length === 0 && (
                                  <div className="text-xs text-[#9a95b8]">Chưa có thành viên</div>
                                )}
                                {group.members.map(m => {
                                  const active = expenseForm.participants.includes(m.id);
                                  return (
                                    <button
                                      key={`${m.id}-${m.name}`}
                                      type="button"
                                      draggable
                                      onClick={() => toggleParticipant(m.id)}
                                      onDragStart={handleMemberDragStart(m, group.key)}
                                      onDragEnd={handleMemberDragEnd}
                                      className={`rounded-full border-2 px-3.5 py-2 text-left text-sm font-extrabold transition-all ${
                                        active
                                          ? 'bg-ink border-ink text-white'
                                          : 'bg-white border-[#E4DDFB] text-ink hover:border-brand'
                                      }`}
                                    >
                                      {active && <UserCheck size={14} className="inline mr-1" />}
                                      {m.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="text-sm">
                Cách chia
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpenseForm(prev => ({ ...prev, splitMode: 'equal' }))
                    }
                    className={`h-11 rounded-full px-4 text-sm font-extrabold transition-colors ${
                      expenseForm.splitMode === 'equal'
                        ? 'bg-ink text-white'
                        : 'bg-white'
                    }`}
                  >
                    Chia đều
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExpenseForm(prev => ({ ...prev, splitMode: 'custom' }))
                    }
                    className={`h-11 rounded-full px-4 text-sm font-extrabold transition-colors ${
                      expenseForm.splitMode === 'custom'
                        ? 'bg-ink text-white'
                        : 'bg-white'
                    }`}
                  >
                    Tuỳ chỉnh
                  </button>
                </div>
              </div>

              {expenseForm.splitMode === 'custom' && (
                <div className="rounded-[22px] bg-[#FAF8FF] p-3">
                  {participantList.length === 0 ? (
                    <p className="text-sm text-ink-soft">Chọn ít nhất 1 người tham gia.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {participantList.map(m => (
                        <label key={m.id} className="text-sm">
                          {m.name}
                          <input
                            type="number"
                            className="input-field mt-1.5"
                            value={expenseForm.splits[m.id] || ''}
                            onChange={e =>
                              setExpenseForm(prev => ({
                                ...prev,
                                splits: {
                                  ...prev.splits,
                                  [m.id]: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <label className="label-text block">
                Ghi chú
                <input
                  type="text"
                  className="input-field mt-1.5"
                  value={expenseForm.note}
                  onChange={e =>
                    setExpenseForm(prev => ({ ...prev, note: e.target.value }))
                  }
                  placeholder="VD: Tiền ăn tối"
                />
              </label>

              <div className="flex items-center justify-between text-sm">
                <span className={splitValid ? 'text-pine' : 'text-debt'}>
                  Tổng chia: {formatVND(splitSum)} / {formatVND(expenseForm.amount)}
                </span>
                <div className="flex items-center gap-2">
                  {editingTransaction?.type === 'expense' && (
                    <button
                      type="button"
                      onClick={cancelEditingTransaction}
                      className="chunk-btn bg-white px-5 py-2.5"
                    >
                      Hủy sửa
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addExpense}
                    disabled={!splitValid || isSavingExpense}
                    className={`chunk-btn px-5 py-2.5 text-white ${
                      splitValid && !isSavingExpense ? 'bg-brand' : 'bg-[#B9B4D4]'
                    }`}
                  >
                    {isSavingExpense
                      ? 'Đang lưu...'
                      : editingTransaction?.type === 'expense'
                        ? 'Cập nhật khoản chi'
                        : 'Ghi nhận khoản chi'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {showFullAdminControls && activeAdminPanel === 'payment' && (
          <section className="card-surface anim-up p-5 md:p-6">
            <h3 className="section-title mb-4">
              {editingTransaction?.type === 'payment'
                ? 'Sửa thanh toán / đã nhận'
                : 'Thanh toán / Đã nhận'}
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <label className="label-text block">
                Người thanh toán
                <select
                  className="input-field mt-1.5"
                  value={paymentForm.memberId}
                  onChange={e =>
                    setPaymentForm(prev => {
                      const memberId = e.target.value;
                      const balance = balances.get(Number(memberId)) || 0;
                      const amountLimit = getPaymentAmountLimit(balance, prev.type);
                      return {
                        ...prev,
                        memberId,
                        amount: amountLimit ? String(amountLimit) : '',
                      };
                    })
                  }
                >
                  {members
                    .filter(m => !m.isTreasurer)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="label-text block">
                Số tiền
                <input
                  type="number"
                  className="input-field mt-1.5"
                  value={paymentForm.amount}
                  onChange={e =>
                    setPaymentForm(prev => ({
                      ...prev,
                      amount: e.target.value,
                    }))
                  }
                  onFocus={() =>
                    setPaymentForm(prev => ({
                      ...prev,
                      amount: paymentAmountLimit ? String(paymentAmountLimit) : '',
                    }))
                  }
                  placeholder="VD: 100000"
                />
              </label>
              <div className="text-sm">
                Loại giao dịch
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPaymentForm(prev => ({
                        ...prev,
                        type: 'pay',
                        amount:
                          selectedPaymentBalance < 0
                            ? String(Math.abs(selectedPaymentBalance))
                            : '',
                      }))
                    }
                    className={`h-11 rounded-full px-4 text-sm font-extrabold transition-colors ${
                      paymentForm.type === 'pay'
                        ? 'bg-ink text-white'
                        : 'bg-white'
                    }`}
                  >
                    Thanh toán nợ
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPaymentForm(prev => ({
                        ...prev,
                        type: 'receive',
                        amount:
                          selectedPaymentBalance > 0
                            ? String(selectedPaymentBalance)
                            : '',
                      }))
                    }
                    className={`h-11 rounded-full px-4 text-sm font-extrabold transition-colors ${
                      paymentForm.type === 'receive'
                        ? 'bg-ink text-white'
                        : 'bg-white'
                    }`}
                  >
                    Nhận tiền
                  </button>
                </div>
              </div>
              <label className="label-text block">
                Ghi chú
                <input
                  type="text"
                  className="input-field mt-1.5"
                  value={paymentForm.note}
                  onChange={e =>
                    setPaymentForm(prev => ({ ...prev, note: e.target.value }))
                  }
                  placeholder="VD: An thanh toán tháng 3"
                />
              </label>
              <div className="flex items-center gap-2">
                {editingTransaction?.type === 'payment' && (
                  <button
                    type="button"
                    onClick={cancelEditingTransaction}
                    className="chunk-btn bg-white px-5 py-2.5"
                  >
                    Hủy sửa
                  </button>
                )}
                <button
                  type="button"
                  onClick={addPayment}
                  disabled={!treasurerId || isSavingPayment}
                  className={`chunk-btn px-5 py-2.5 text-white ${
                    treasurerId && !isSavingPayment ? 'bg-brand' : 'bg-[#B9B4D4]'
                  }`}
                >
                  {isSavingPayment
                    ? 'Đang lưu...'
                    : editingTransaction?.type === 'payment'
                      ? 'Cập nhật thanh toán'
                      : 'Ghi nhận thanh toán'}
                </button>
              </div>
              {!treasurerId && (
                <p className="text-sm text-debt">
                  Cần chọn thủ quỹ để ghi nhận thanh toán.
                </p>
              )}
            </div>
          </section>
        )}

        {showFullAdminControls && (
          <section className="card-surface anim-up p-5 md:p-6">
            <h3 className="section-title mb-4">Cấu hình thủ quỹ</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="label-text block">
                Tài khoản nhận (hiển thị trên QR)
                <input
                  type="text"
                  className="input-field mt-1.5"
                  value={treasurerAccount}
                  onChange={e => setTreasurerAccount(e.target.value)}
                  placeholder="VD: VCB - 0123456789"
                />
              </label>
              <label className="label-text block">
                BIN ngân hàng (acqId)
                <input
                  type="text"
                  className="input-field mt-1.5"
                  value={treasurerBankBin}
                  onChange={e => setTreasurerBankBin(e.target.value)}
                  placeholder="VD: 970415"
                />
              </label>
              <label className="label-text block">
                Số tài khoản
                <input
                  type="text"
                  className="input-field mt-1.5"
                  value={treasurerAccountNo}
                  onChange={e => setTreasurerAccountNo(e.target.value)}
                  placeholder="VD: 0123456789"
                />
              </label>
              <label className="label-text block">
                Tên tài khoản (không dấu, viết hoa)
                <input
                  type="text"
                  className="input-field mt-1.5"
                  value={treasurerAccountName}
                  onChange={e => setTreasurerAccountName(e.target.value)}
                  placeholder="VD: THU QUY"
                />
              </label>
              <div className="text-sm text-ink-soft flex items-end">
                Mã QR hiện tại dùng chuỗi nội dung cơ bản. Có thể thay bằng payload VietQR thực tế khi kết nối ngân hàng.
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  performDataAction(
                    'treasurerConfig.update',
                    { treasurerAccount, treasurerBankBin, treasurerAccountNo, treasurerAccountName },
                    'Lưu cấu hình thủ quỹ',
                    'Đã lưu cấu hình thủ quỹ'
                  ).catch(() => {});
                }}
                className="chunk-btn bg-ink px-5 py-2.5 text-white"
              >
                Lưu cấu hình
              </button>
            </div>
          </section>
        )}
      </div>
      )}

      {!isAdminView && (
        <UserView
          members={members}
          balances={balances}
          treasurer={members.find(m => m.isTreasurer) || null}
          expenses={expenses}
          payments={payments}
          isHydrated={isHydrated}
          formatVND={formatVND}
          onOpenQr={openQrForMember}
          monthFilter={monthFilter}
          setMonthFilter={setMonthFilter}
          availableMonths={availableMonths}
          transactions={filteredTransactions}
          isSuperAdmin={isSuperAdmin}
          onSwitchAdmin={() => setIsAdminView(true)}
        />
      )}

      {qrModal.open && (
        <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/55 sm:items-center sm:p-4">
          <div className="anim-pop relative max-h-[94vh] w-full max-w-sm overflow-y-auto rounded-t-[36px] bg-canvas p-5 pb-8 sm:rounded-[36px] sm:p-6">
            <button
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink shadow-chunk transition-transform hover:scale-105"
              onClick={closeQr}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <h4 className="section-title mb-1">QR Thanh toán</h4>
            <p className="text-sm text-ink-soft mb-4">
              Chuyển đến thủ quỹ: {treasurerAccount}
            </p>
            <div className="flex items-center justify-center mb-4">
              {qrLoading && (
                <div className="w-[232px] h-[232px] rounded-[24px] border-2 border-dashed border-[#C9BEF2] bg-white flex flex-col items-center justify-center text-ink-soft">
                  <div className="w-8 h-8 rounded-full border-4 border-[#E4DDFB] border-t-brand animate-spin mb-3" />
                  <div className="text-sm font-medium">Đang tạo VietQR...</div>
                  <div className="text-xs">Vui lòng chờ trong giây lát</div>
                </div>
              )}
              {!qrLoading && qrContent && (
                <div className="anim-pop rounded-[28px] bg-sun p-3 shadow-[0_8px_0_rgba(30,27,58,.14)]">
                  <div className="rounded-2xl bg-white p-1">
                    <QRCodeCanvas value={qrContent} size={200} includeMargin />
                  </div>
                </div>
              )}
              {!qrLoading && !qrContent && !qrError && (
                <div className="w-[232px] h-[232px] rounded-[24px] border-2 border-dashed border-[#C9BEF2] bg-white flex items-center justify-center text-sm text-ink-soft text-center px-6">
                  Chưa có mã QR để hiển thị.
                </div>
              )}
            </div>
            <div className="text-sm">
              {qrError && (
                <div className="text-xs text-debt mb-2">{qrError}</div>
              )}
              <div className="flex items-center justify-between">
                <span>Số tiền</span>
                <span className="font-semibold">{formatVND(qrModal.amount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Nội dung</span>
                <span className="font-semibold">{qrAddInfo || qrMember?.name}</span>
              </div>
              <div className="mt-3">
                <div className="text-xs text-ink-soft mb-2">Khoản đã tham gia</div>
                <div className="max-h-40 overflow-y-auto divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white">
                  {qrMemberExpenses.length === 0 && (
                    <div className="p-3 text-xs text-ink-soft">Chưa có khoản tham gia.</div>
                  )}
                  {qrMemberExpenses.map(exp => {
                    const share = exp.splits.find(s => s.memberId === qrModal.memberId)?.amount || 0;
                    const when = exp.date
                      ? new Date(exp.date).toLocaleDateString('vi-VN')
                      : new Date(exp.createdAt).toLocaleDateString('vi-VN');
                    return (
                      <div key={exp.id} className="p-3 text-xs flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{exp.note || 'Khoản chi'}</div>
                          <div className="text-ink-soft">{when}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatVND(share)}</div>
                          <div className="text-ink-soft">Tổng: {formatVND(exp.amount)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {historyModal.open && (
        <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/55 sm:items-center sm:p-4">
          <div className="anim-pop relative max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-[36px] bg-canvas p-5 pb-8 sm:rounded-[36px] sm:p-6">
            <button
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink shadow-chunk transition-transform hover:scale-105"
              onClick={closeHistory}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <h4 className="section-title mb-1">
              Lịch sử: {historyMember?.name || 'Không rõ'}
            </h4>
            <p className="text-xs text-ink-soft mb-4">
              {monthFilter
                ? `Tháng ${monthFilter.split('-')[1]}/${monthFilter.split('-')[0]}`
                : 'Tất cả các tháng'}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-[20px] bg-white p-3">
                <div className="text-xs text-ink-soft">Tổng đã trả</div>
                <div className="font-semibold text-pine">{formatVND(historyTotalPaid)}</div>
              </div>
              <div className="rounded-[20px] bg-white p-3">
                <div className="text-xs text-ink-soft">Tổng cần trả</div>
                <div className="font-semibold text-debt">{formatVND(historyTotalOwed)}</div>
              </div>
            </div>
            <div className="text-sm">
              <div className="mb-4">
                <div className="text-xs text-ink-soft mb-2">Các khoản đã đứng ra chi</div>
                <div className="max-h-40 overflow-y-auto divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white">
                  {historyPaidExpenses.length === 0 && (
                    <div className="p-3 text-xs text-ink-soft">Chưa chi khoản nào.</div>
                  )}
                  {historyPaidExpenses.map(exp => {
                    const when = exp.date
                      ? new Date(exp.date).toLocaleDateString('vi-VN')
                      : new Date(exp.createdAt).toLocaleDateString('vi-VN');
                    return (
                      <div key={exp.id} className="p-3 text-xs flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{exp.note || 'Khoản chi'}</div>
                          <div className="text-ink-soft">{when}</div>
                        </div>
                        <div className="font-semibold text-pine">{formatVND(exp.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-xs text-ink-soft mb-2">Các khoản cần trả (phần chia)</div>
                <div className="max-h-40 overflow-y-auto divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white">
                  {historyOwedExpenses.length === 0 && (
                    <div className="p-3 text-xs text-ink-soft">Chưa tham gia khoản nào.</div>
                  )}
                  {historyOwedExpenses.map(exp => {
                    const when = exp.date
                      ? new Date(exp.date).toLocaleDateString('vi-VN')
                      : new Date(exp.createdAt).toLocaleDateString('vi-VN');
                    return (
                      <div key={exp.id} className="p-3 text-xs flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{exp.note || 'Khoản chi'}</div>
                          <div className="text-ink-soft">{when}</div>
                        </div>
                        <div className="font-semibold text-debt">{formatVND(exp.shareAmount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mb-4">
                <div className="text-xs text-ink-soft mb-2">Tiền đã gửi</div>
                <div className="max-h-40 overflow-y-auto divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white">
                  {historySentPayments.length === 0 && (
                    <div className="p-3 text-xs text-ink-soft">Chưa có khoản nào.</div>
                  )}
                  {historySentPayments.map(payment => {
                    const when = payment.createdAt
                      ? new Date(payment.createdAt).toLocaleDateString('vi-VN')
                      : 'Chưa có ngày';
                    return (
                      <div key={payment.id} className="p-3 text-xs flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{payment.note || 'Thanh toán nợ'}</div>
                          <div className="text-ink-soft">{when}</div>
                        </div>
                        <div className="font-semibold text-brand">{formatVND(payment.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-xs text-ink-soft mb-2">Tiền đã nhận</div>
                <div className="max-h-40 overflow-y-auto divide-y divide-[#F0ECFB] overflow-hidden rounded-[20px] border-2 border-[#F0ECFB] bg-white">
                  {historyReceivedPayments.length === 0 && (
                    <div className="p-3 text-xs text-ink-soft">Chưa có khoản nào.</div>
                  )}
                  {historyReceivedPayments.map(payment => {
                    const when = payment.createdAt
                      ? new Date(payment.createdAt).toLocaleDateString('vi-VN')
                      : 'Chưa có ngày';
                    return (
                      <div key={payment.id} className="p-3 text-xs flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{payment.note || 'Nhận tiền'}</div>
                          <div className="text-ink-soft">{when}</div>
                        </div>
                        <div className="font-semibold text-pine">{formatVND(payment.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default SplitWiseTool;
