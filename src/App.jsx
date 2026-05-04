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
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

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

const getNextMemberId = members =>
  members.reduce((maxId, member) => {
    const memberId = Number(member?.id) || 0;
    return memberId > maxId ? memberId : maxId;
  }, 0) + 1;

const getPaymentAmountLimit = (balance, type) =>
  type === 'pay'
    ? Math.max(0, Math.abs(Math.min(balance, 0)))
    : Math.max(0, Math.max(balance, 0));

const dropQrCacheEntry = (cache, memberId) => {
  const nextCache = { ...cache };
  delete nextCache[String(memberId)];
  return nextCache;
};

const MEMBER_GROUPS = [
  { key: 'boss', label: 'Sếp' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'server', label: 'Server' },
  { key: 'outside', label: 'Người ngoài' },
];

const normalizeMemberGroup = value => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (['sep', 'boss', 'leader', 'quan ly', 'manager'].includes(normalized)) return 'boss';
  if (['mobile', 'app', 'ios', 'android'].includes(normalized)) return 'mobile';
  if (['server', 'backend', 'be', 'api'].includes(normalized)) return 'server';
  if (['outside', 'outsider', 'ngoai', 'nguoi ngoai', 'external'].includes(normalized)) {
    return 'outside';
  }
  return 'outside';
};

const isSameMember = (member, target) =>
  Number(member?.id) === Number(target?.id) && String(member?.name || '') === String(target?.name || '');

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

const persistAppState = payload => {
  return fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  });
};

const SplitWiseTool = () => {
  const isSuperAdmin = isSuperAdminPath();
  const [isAdminView, setIsAdminView] = useState(isSuperAdmin);
  const [activeAdminPanel, setActiveAdminPanel] = useState(null);
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
  const [toast, setToast] = useState(null);
  const latestPayloadRef = useRef(null);
  const toastTimerRef = useRef(null);

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
          setExpenseForm(prev => ({
            ...prev,
            payerId:
              normalizedData.members.find(m => m.isTreasurer)?.id ||
              normalizedData.members[0].id,
            participants: normalizedData.members.filter(m => !m.isTreasurer).map(m => m.id),
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

  const payload = useMemo(
    () => ({
      members,
      expenses,
      payments,
      treasurerAccount,
      treasurerBankBin,
      treasurerAccountNo,
      treasurerAccountName,
      qrCache,
      nextMemberId,
      savedAt: new Date().toISOString(),
    }),
    [
      members,
      expenses,
      payments,
      treasurerAccount,
      treasurerBankBin,
      treasurerAccountNo,
      treasurerAccountName,
      qrCache,
      nextMemberId,
    ]
  );

  useEffect(() => {
    if (!isHydrated) return;
    latestPayloadRef.current = payload;
    const timer = setTimeout(() => {
      persistAppState(payload)
        .then(async response => {
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.success !== true) {
            throw new Error(data?.error || 'Không thể lưu dữ liệu');
          }

          if (!isAdminView) return;
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast({
            type: 'success',
            message: 'Đã lưu thành công',
          });
          toastTimerRef.current = setTimeout(() => {
            setToast(null);
          }, 2200);
        })
        .catch(error => {
          if (!isAdminView) return;
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast({
            type: 'error',
            message: error?.message || 'Lưu thất bại',
          });
          toastTimerRef.current = setTimeout(() => {
            setToast(null);
          }, 2600);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [payload, isHydrated, isAdminView]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    const flushPendingChanges = () => {
      const latestPayload = latestPayloadRef.current;
      if (!latestPayload || typeof navigator === 'undefined' || !navigator.sendBeacon) {
        return;
      }

      const body = new Blob([JSON.stringify(latestPayload)], {
        type: 'application/json',
      });
      navigator.sendBeacon('/api/save', body);
    };

    window.addEventListener('pagehide', flushPendingChanges);
    return () => {
      window.removeEventListener('pagehide', flushPendingChanges);
    };
  }, [isHydrated]);

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
  const participantList = eligibleParticipants.filter(m => expenseForm.participants.includes(m.id));
  const participantGroups = useMemo(
    () =>
      MEMBER_GROUPS.map(group => ({
        ...group,
        members: eligibleParticipants.filter(
          member => normalizeMemberGroup(member.group) === group.key
        ),
      })),
    [eligibleParticipants]
  );
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
    const defaultPayerId = members.find(m => m.isTreasurer)?.id || members[0]?.id || '';
    setExpenseForm({
      amount: '',
      payerId: defaultPayerId,
      participants: eligibleParticipants.map(m => m.id),
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
    if (!splitValid) return;
    const amount = Number(expenseForm.amount);
    const existingExpense =
      editingTransaction?.type === 'expense'
        ? expenses.find(expense => expense.id === editingTransaction.id) || null
        : null;
    const nextExpense = {
      id: existingExpense?.id || Date.now(),
      amount,
      payerId: Number(expenseForm.payerId),
      splits: computedSplits,
      note: expenseForm.note.trim(),
      date: expenseForm.date,
      createdAt: existingExpense?.createdAt || new Date().toISOString(),
    };
    setExpenses(prev =>
      existingExpense
        ? prev.map(expense => (expense.id === existingExpense.id ? nextExpense : expense))
        : [nextExpense, ...prev]
    );
    setEditingTransaction(null);
    resetExpenseForm();
    setActiveAdminPanel(null);
  };

  const addPayment = () => {
    if (!treasurerId) return;
    const amount = Math.min(Number(paymentForm.amount || 0), paymentAmountLimit);
    if (!amount) return;
    const memberId = Number(paymentForm.memberId);
    const existingPayment =
      editingTransaction?.type === 'payment'
        ? payments.find(payment => payment.id === editingTransaction.id) || null
        : null;
    const nextPayment = {
      id: existingPayment?.id || Date.now(),
      memberId,
      amount,
      type: paymentForm.type,
      note: paymentForm.note.trim(),
      createdAt: existingPayment?.createdAt || new Date().toISOString(),
    };
    setPayments(prev =>
      existingPayment
        ? prev.map(payment => (payment.id === existingPayment.id ? nextPayment : payment))
        : [nextPayment, ...prev]
    );
    setQrCache(prev => {
      let nextCache = dropQrCacheEntry(prev, memberId);
      if (existingPayment && existingPayment.memberId !== memberId) {
        nextCache = dropQrCacheEntry(nextCache, existingPayment.memberId);
      }
      return nextCache;
    });
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
  };

  const deleteExpense = expenseId => {
    setExpenses(prev => prev.filter(exp => exp.id !== expenseId));
  };

  const startEditingTransaction = tx => {
    if (!isAdminView) return;
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
    const name = newMemberName.trim();
    if (!name) return;
    const memberId = getNextMemberId(members);
    const newMember = { id: memberId, name, isTreasurer: false };
    setMembers(prev => [...prev, newMember]);
    setNextMemberId(memberId + 1);
    setNewMemberName('');
    setActiveAdminPanel(null);
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
    setMembers(prev => prev.map(m => ({ ...m, isTreasurer: m.id === id })));
    setExpenseForm(prev => ({
      ...prev,
      participants: prev.participants.filter(pid => pid !== id),
      splits: { ...prev.splits, [id]: undefined },
    }));
  };

  const moveMemberToGroup = (targetMember, groupKey) => {
    const normalizedGroup = normalizeMemberGroup(groupKey);
    setMembers(prev =>
      prev.map(member =>
        isSameMember(member, targetMember)
          ? { ...member, group: normalizedGroup }
          : member
      )
    );
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
        setQrCache(prev => ({
          ...prev,
          [cacheKey]: {
            checksum: amount,
            payload: data.payload,
            addInfo,
            updatedAt: new Date().toISOString(),
          },
        }));
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
    const expenseTx = expenses.map(exp => ({
      id: `exp-${exp.id}`,
      type: 'expense',
      amount: exp.amount,
      note: exp.note || 'Khoản chi',
      date: exp.date || exp.createdAt?.slice(0, 10),
      createdAt: exp.createdAt,
      payerId: exp.payerId,
      splits: exp.splits,
    }));
    const paymentTx = payments.map(p => ({
      id: `pay-${p.id}`,
      type: 'payment',
      amount: p.amount,
      note: p.note || (p.type === 'pay' ? 'Thanh toán nợ' : 'Nhận tiền'),
      date: p.createdAt?.slice(0, 10),
      createdAt: p.createdAt,
      memberId: p.memberId,
      paymentType: p.type,
    }));
    return [...expenseTx, ...paymentTx].sort((a, b) => {
      const aTime = new Date(a.createdAt || a.date || 0).getTime();
      const bTime = new Date(b.createdAt || b.date || 0).getTime();
      return bTime - aTime;
    });
  }, [expenses, payments]);

  const filteredTransactions = useMemo(() => {
    if (!monthFilter) return transactions;
    return transactions.filter(tx => (tx.date || '').slice(0, 7) === monthFilter);
  }, [transactions, monthFilter]);

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
    return Array.from(months).sort((a, b) => (a < b ? 1 : -1));
  }, [transactions]);

  useEffect(() => {
    if (monthFilter) return;
    if (availableMonths.length > 0) {
      setMonthFilter(availableMonths[0]);
    }
  }, [availableMonths, monthFilter]);

  return (
    <div className="p-6 max-w-5xl mx-auto bg-gray-50 min-h-screen">
      {isAdminView && toast && (
        <div className="fixed top-4 right-4 z-50">
          <div
            className={`rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-white ${
              toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-500'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Tool Chia Tiền Nhóm</h1>
          </div>
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck size={16} className="text-gray-500" />
                  <span className="text-gray-600">Chế độ:</span>
                </div>
                <div className="flex rounded-lg border bg-white shadow-sm overflow-hidden">
                  <button
                    className={`px-3 py-2 text-sm ${
                      !isAdminView ? 'bg-gray-900 text-white' : 'text-gray-600'
                    }`}
                    onClick={() => setIsAdminView(false)}
                  >
                    Người dùng
                  </button>
                  <button
                    className={`px-3 py-2 text-sm ${
                      isAdminView ? 'bg-gray-900 text-white' : 'text-gray-600'
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

        {isAdminView && (
          <div className="flex flex-wrap gap-2">
                        <button
              className={`px-3 py-2 rounded-lg border shadow-sm flex items-center gap-2 ${
                activeAdminPanel === 'expense' ? 'bg-gray-900 text-white' : 'bg-white'
              }`}
              onClick={() =>
                setActiveAdminPanel(prev => (prev === 'expense' ? null : 'expense'))
              }
            >
              <PlusCircle size={18} />
              Thêm khoản chi
            </button>
            <button
              className={`px-3 py-2 rounded-lg border shadow-sm flex items-center gap-2 ${
                activeAdminPanel === 'member' ? 'bg-gray-900 text-white' : 'bg-white'
              }`}
              onClick={() =>
                setActiveAdminPanel(prev => (prev === 'member' ? null : 'member'))
              }
            >
              <UserPlus size={18} />
              Thêm thành viên
            </button>
            <button
              className={`px-3 py-2 rounded-lg border shadow-sm flex items-center gap-2 ${
                activeAdminPanel === 'payment' ? 'bg-gray-900 text-white' : 'bg-white'
              }`}
              onClick={() =>
                setActiveAdminPanel(prev => (prev === 'payment' ? null : 'payment'))
              }
            >
              <CreditCard size={18} />
              Thêm thanh toán
            </button>
          </div>
        )}

        {isAdminView && activeAdminPanel === 'member' && (
          <section className="bg-white rounded-xl shadow p-5">
            <h3 className="text-lg font-semibold mb-4">Thêm thành viên mới</h3>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                className="flex-1 border rounded-lg px-3 py-2"
                placeholder="Tên thành viên"
                value={newMemberName}
                onChange={e => setNewMemberName(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  className="px-4 py-2 rounded-lg bg-gray-900 text-white"
                  onClick={addMember}
                >
                  Lưu
                </button>
                <button
                  className="px-4 py-2 rounded-lg border"
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

        <section className="bg-white rounded-xl shadow p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-gray-500" />
              <h2 className="text-lg font-semibold">Danh sách thành viên</h2>
            </div>
            {isAdminView && (
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-500">Chọn thủ quỹ</label>
                <select
                  className="border rounded-lg px-3 py-2 text-sm"
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
                  const balance = balances.get(m.id) || 0;
                  return (
                    <div
                      key={m.id}
                      className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 grid grid-cols-[1fr_auto_auto] items-center gap-3"
                    >
                      <div>
                        <span className="font-semibold">{m.name}</span>
                        <span className="ml-2 text-xs bg-yellow-200 px-2 py-1 rounded">Thủ quỹ</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Tổng của các thành viên</div>
                        <div
                          className={`font-mono font-bold ${
                            nonTreasurerTotal < 0 ? 'text-red-500' : 'text-green-600'
                          }`}
                        >
                          {nonTreasurerTotal > 0 ? '+' : ''}
                          {formatVND(nonTreasurerTotal)}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {members.filter(m => !m.isTreasurer).map(m => {
              const balance = balances.get(m.id) || 0;
              return (
                <div key={m.id} className="bg-gray-50 p-4 rounded-lg border grid grid-cols-[1fr_auto_auto] items-center gap-3">
                  <div>
                    <span className="font-semibold">{m.name}</span>
                  </div>
                  <div
                    className={`font-mono font-bold text-right ${balance < 0 ? 'text-red-500' : 'text-green-600'}`}
                  >
                    {balance > 0 ? '+' : ''}
                    {formatVND(balance)}
                  </div>
                  {balance < 0 && treasurerId && (
                    <button
                      onClick={() => openQrForMember(m.id, Math.abs(balance))}
                      className="ml-4 p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200"
                      title="Tạo QR thanh toán"
                    >
                      <QrCode size={18} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-xl shadow p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h3 className="text-lg font-semibold">Danh sách thu chi</h3>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Lọc theo tháng</span>
              <select
                className="border rounded-lg px-3 py-2 text-sm"
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
            </div>
          </div>
          <div className="mt-4 border rounded-lg divide-y max-h-80 overflow-y-auto">
            {filteredTransactions.length === 0 && (
              <div className="p-4 text-sm text-gray-500">Không có giao dịch trong tháng này.</div>
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
                      isAdminView ? 'cursor-pointer hover:bg-gray-50' : ''
                    }`}
                    onClick={() => startEditingTransaction(tx)}
                  >
                    <div>
                      <div className="font-medium">{tx.note}</div>
                      <div className="text-xs text-gray-500">
                        {dateLabel} • Người trả: {payer}
                      </div>
                      <div className="text-xs text-gray-500">
                        Tham gia: {participantNames || 'Chưa có'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Chi</div>
                      <div className="font-semibold text-red-500">{formatVND(tx.amount)}</div>
                    </div>
                    {isAdminView && (
                      <button
                        className="px-3 py-2 rounded-lg border text-sm hover:bg-red-50"
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
              return (
                <div
                  key={tx.id}
                  className={`p-4 flex items-center justify-between gap-4 ${
                    isAdminView ? 'cursor-pointer hover:bg-gray-50' : ''
                  }`}
                  onClick={() => startEditingTransaction(tx)}
                >
                  <div>
                    <div className="font-medium">{tx.note}</div>
                    <div className="text-xs text-gray-500">
                      {dateLabel} • {memberName}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">Thanh toán</div>
                    <div className="font-semibold text-green-600">{formatVND(tx.amount)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {isAdminView && (
          <section className="bg-white rounded-xl shadow p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Lịch sử nhận tiền</h3>
              <span className="text-sm text-gray-500">
                {filteredReceivedPayments.length} giao dịch
              </span>
            </div>
            <div className="mt-4 border rounded-lg divide-y max-h-80 overflow-y-auto">
              {filteredReceivedPayments.length === 0 && (
                <div className="p-4 text-sm text-gray-500">
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
                  payment.type === 'pay' ? 'text-blue-600' : 'text-emerald-600';

                return (
                  <div
                    key={`received-${payment.id}`}
                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-gray-50"
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
                      <div className="text-xs text-gray-500">
                        {dateLabel} • {memberName} • {paymentLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">{paymentBadge}</div>
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
          <section className="bg-white rounded-xl shadow p-5">
            <h3 className="text-lg font-semibold mb-4">
              {editingTransaction?.type === 'expense' ? 'Sửa khoản chi' : 'Thêm khoản chi'}
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <label className="text-sm">
                Số tiền
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
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
              <label className="text-sm">
                Ngày
                <input
                  type="date"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={expenseForm.date}
                  onChange={e =>
                    setExpenseForm(prev => ({ ...prev, date: e.target.value }))
                  }
                />
              </label>
              <label className="text-sm">
                Người trả
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={expenseForm.payerId}
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
                  <span className="text-xs text-gray-500">
                    Đã chọn {participantList.length}/{eligibleParticipants.length} người
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = eligibleParticipants.map(m => m.id);
                      const isAll = allIds.every(id => expenseForm.participants.includes(id));
                      setExpenseForm(prev => ({
                        ...prev,
                        participants: isAll ? [] : allIds,
                      }));
                    }}
                    className="px-3 py-2 rounded-lg border text-sm bg-white"
                  >
                    Chọn tất cả
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {participantGroups.map(group => (
                    <div
                      key={group.key}
                      onDragOver={handleGroupDragOver(group.key)}
                      onDrop={handleGroupDrop(group.key)}
                      onDragLeave={handleGroupDragLeave(group.key)}
                      className={`rounded-xl border p-3 transition-colors ${
                        dragOverGroup === group.key
                          ? 'border-gray-900 bg-gray-100'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="font-medium">{group.label}</span>
                        <span className="text-xs text-gray-500">
                          {group.members.filter(m => expenseForm.participants.includes(m.id)).length}/
                          {group.members.length}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.members.length === 0 && (
                          <div className="text-xs text-gray-400">Chưa có thành viên</div>
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
                              className={`px-3 py-2 rounded-lg border text-sm text-left ${
                                active ? 'bg-gray-900 text-white' : 'bg-white'
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
              <div className="text-sm">
                Cách chia
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpenseForm(prev => ({ ...prev, splitMode: 'equal' }))
                    }
                    className={`px-3 py-2 rounded-lg border ${
                      expenseForm.splitMode === 'equal'
                        ? 'bg-gray-900 text-white'
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
                    className={`px-3 py-2 rounded-lg border ${
                      expenseForm.splitMode === 'custom'
                        ? 'bg-gray-900 text-white'
                        : 'bg-white'
                    }`}
                  >
                    Tuỳ chỉnh
                  </button>
                </div>
              </div>

              {expenseForm.splitMode === 'custom' && (
                <div className="bg-gray-50 rounded-lg p-3">
                  {participantList.length === 0 ? (
                    <p className="text-sm text-gray-500">Chọn ít nhất 1 người tham gia.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {participantList.map(m => (
                        <label key={m.id} className="text-sm">
                          {m.name}
                          <input
                            type="number"
                            className="mt-1 w-full border rounded-lg px-3 py-2"
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

              <label className="text-sm">
                Ghi chú
                <input
                  type="text"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={expenseForm.note}
                  onChange={e =>
                    setExpenseForm(prev => ({ ...prev, note: e.target.value }))
                  }
                  placeholder="VD: Tiền ăn tối"
                />
              </label>

              <div className="flex items-center justify-between text-sm">
                <span className={splitValid ? 'text-green-600' : 'text-red-500'}>
                  Tổng chia: {formatVND(splitSum)} / {formatVND(expenseForm.amount)}
                </span>
                <div className="flex items-center gap-2">
                  {editingTransaction?.type === 'expense' && (
                    <button
                      type="button"
                      onClick={cancelEditingTransaction}
                      className="px-4 py-2 rounded-lg border"
                    >
                      Hủy sửa
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addExpense}
                    disabled={!splitValid}
                    className={`px-4 py-2 rounded-lg text-white ${
                      splitValid ? 'bg-gray-900' : 'bg-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {editingTransaction?.type === 'expense' ? 'Cập nhật khoản chi' : 'Ghi nhận khoản chi'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {isAdminView && activeAdminPanel === 'payment' && (
          <section className="bg-white rounded-xl shadow p-5">
            <h3 className="text-lg font-semibold mb-4">
              {editingTransaction?.type === 'payment'
                ? 'Sửa thanh toán / đã nhận'
                : 'Thanh toán / Đã nhận'}
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <label className="text-sm">
                Người thanh toán
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
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
              <label className="text-sm">
                Số tiền
                <input
                  type="number"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={paymentForm.amount}
                  onChange={e =>
                    setPaymentForm(prev => ({
                      ...prev,
                      amount: String(
                        Math.min(Number(e.target.value || 0), paymentAmountLimit) || ''
                      ),
                    }))
                  }
                  onFocus={() =>
                    setPaymentForm(prev => ({
                      ...prev,
                      amount: paymentAmountLimit ? String(paymentAmountLimit) : '',
                    }))
                  }
                  max={paymentAmountLimit || undefined}
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
                    className={`px-3 py-2 rounded-lg border ${
                      paymentForm.type === 'pay'
                        ? 'bg-gray-900 text-white'
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
                    className={`px-3 py-2 rounded-lg border ${
                      paymentForm.type === 'receive'
                        ? 'bg-gray-900 text-white'
                        : 'bg-white'
                    }`}
                  >
                    Nhận tiền
                  </button>
                </div>
              </div>
              <label className="text-sm">
                Ghi chú
                <input
                  type="text"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
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
                    className="px-4 py-2 rounded-lg border"
                  >
                    Hủy sửa
                  </button>
                )}
                <button
                  type="button"
                  onClick={addPayment}
                  disabled={!treasurerId}
                  className={`px-4 py-2 rounded-lg text-white ${
                    treasurerId ? 'bg-gray-900' : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  {editingTransaction?.type === 'payment'
                    ? 'Cập nhật thanh toán'
                    : 'Ghi nhận thanh toán'}
                </button>
              </div>
              {!treasurerId && (
                <p className="text-sm text-red-500">
                  Cần chọn thủ quỹ để ghi nhận thanh toán.
                </p>
              )}
            </div>
          </section>
        )}

        {isAdminView && (
          <section className="bg-white rounded-xl shadow p-5">
            <h3 className="text-lg font-semibold mb-4">Cấu hình thủ quỹ</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-sm">
                Tài khoản nhận (hiển thị trên QR)
                <input
                  type="text"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={treasurerAccount}
                  onChange={e => setTreasurerAccount(e.target.value)}
                  placeholder="VD: VCB - 0123456789"
                />
              </label>
              <label className="text-sm">
                BIN ngân hàng (acqId)
                <input
                  type="text"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={treasurerBankBin}
                  onChange={e => setTreasurerBankBin(e.target.value)}
                  placeholder="VD: 970415"
                />
              </label>
              <label className="text-sm">
                Số tài khoản
                <input
                  type="text"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={treasurerAccountNo}
                  onChange={e => setTreasurerAccountNo(e.target.value)}
                  placeholder="VD: 0123456789"
                />
              </label>
              <label className="text-sm">
                Tên tài khoản (không dấu, viết hoa)
                <input
                  type="text"
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={treasurerAccountName}
                  onChange={e => setTreasurerAccountName(e.target.value)}
                  placeholder="VD: THU QUY"
                />
              </label>
              <div className="text-sm text-gray-500 flex items-end">
                Mã QR hiện tại dùng chuỗi nội dung cơ bản. Có thể thay bằng payload VietQR thực tế khi kết nối ngân hàng.
              </div>
            </div>
          </section>
        )}
      </div>

      {qrModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm relative">
            <button
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-700"
              onClick={closeQr}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <h4 className="text-lg font-semibold mb-2">QR Thanh toán</h4>
            <p className="text-sm text-gray-500 mb-4">
              Chuyển đến thủ quỹ: {treasurerAccount}
            </p>
            <div className="flex items-center justify-center mb-4">
              {qrLoading && (
                <div className="w-[232px] h-[232px] rounded-xl border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-500">
                  <div className="w-8 h-8 rounded-full border-4 border-gray-300 border-t-gray-700 animate-spin mb-3" />
                  <div className="text-sm font-medium">Đang tạo VietQR...</div>
                  <div className="text-xs">Vui lòng chờ trong giây lát</div>
                </div>
              )}
              {!qrLoading && qrContent && (
                <QRCodeCanvas value={qrContent} size={200} includeMargin />
              )}
              {!qrLoading && !qrContent && !qrError && (
                <div className="w-[232px] h-[232px] rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-sm text-gray-500 text-center px-6">
                  Chưa có mã QR để hiển thị.
                </div>
              )}
            </div>
            <div className="text-sm">
              {qrError && (
                <div className="text-xs text-red-500 mb-2">{qrError}</div>
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
                <div className="text-xs text-gray-500 mb-2">Khoản đã tham gia</div>
                <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                  {qrMemberExpenses.length === 0 && (
                    <div className="p-3 text-xs text-gray-500">Chưa có khoản tham gia.</div>
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
                          <div className="text-gray-500">{when}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatVND(share)}</div>
                          <div className="text-gray-500">Tổng: {formatVND(exp.amount)}</div>
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
    </div>
  );
};

export default SplitWiseTool;
