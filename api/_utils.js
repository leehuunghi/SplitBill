import fs from 'node:fs/promises';
import path from 'node:path';

const dataPath = path.join(process.cwd(), 'src', 'data.json');

export const defaultData = {
  members: [],
  expenses: [],
  payments: [],
  treasurerAccount: '',
  treasurerBankBin: '',
  treasurerAccountNo: '',
  treasurerAccountName: '',
  qrCache: {},
  nextMemberId: 1,
};

export const readDataFile = async () => {
  try {
    const raw = await fs.readFile(dataPath, 'utf-8');
    return JSON.parse(raw);
  } catch (_error) {
    return defaultData;
  }
};

export const readJsonBody = async req => {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf-8');

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    return {};
  }
};
