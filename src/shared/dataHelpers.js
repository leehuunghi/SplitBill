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
  if (['android', 'mobile android'].includes(normalized)) return 'mobile-android';
  if (['ios', 'mobile ios'].includes(normalized)) return 'mobile-ios';
  if (['mobile', 'app'].includes(normalized)) return 'mobile-android';
  if (['common', 'backend common'].includes(normalized)) return 'backend-common';
  if (['dev ops', 'devops', 'backend dev ops', 'backend devops'].includes(normalized)) {
    return 'backend-devops';
  }
  if (['core', 'backend core'].includes(normalized)) return 'backend-core';
  if (['server', 'backend', 'be', 'api'].includes(normalized)) return 'backend-common';
  if (['remove', 'removed', 'xoa', 'an', 'hidden', 'archive', 'archived'].includes(normalized)) {
    return 'remove';
  }
  if (['outside', 'outsider', 'ngoai', 'nguoi ngoai', 'external'].includes(normalized)) {
    return 'outside';
  }
  return 'outside';
};
