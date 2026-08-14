// Pure helpers dùng chung giữa client (App.jsx) và server (api/_dataMutations.js).
// Không được import React/DOM hay bất cứ thứ gì chỉ chạy ở 1 phía.

export const getNextMemberId = members =>
  members.reduce((maxId, member) => {
    const memberId = Number(member?.id) || 0;
    return memberId > maxId ? memberId : maxId;
  }, 0) + 1;

export const dropQrCacheEntry = (cache, memberId) => {
  const nextCache = { ...cache };
  delete nextCache[String(memberId)];
  return nextCache;
};

const DIACRITICS_REGEX = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g'
);

export const normalizeMemberGroup = value => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
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
