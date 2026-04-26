import fs from 'node:fs/promises';
import path from 'node:path';
import { get, list, put } from '@vercel/blob';

const dataPath = path.join(process.cwd(), 'src', 'data.json');
const blobPathname = 'splitbill/data.json';
export const blobAccess =
  process.env.BLOB_STORE_ACCESS === 'private' ? 'private' : 'public';
export const isVercelRuntime = () => Boolean(process.env.VERCEL);

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

export const canUseBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const readBlobData = async () => {
  const { blobs } = await list({ prefix: blobPathname, limit: 1 });
  const blob = blobs.find(item => item.pathname === blobPathname);

  if (!blob) {
    return null;
  }

  const result = await get(blob.url, { access: blobAccess });

  if (!result || result.statusCode !== 200) {
    return null;
  }

  const raw = await new Response(result.stream).text();
  return JSON.parse(raw);
};

const writeBlobData = async data => {
  await put(blobPathname, JSON.stringify(data, null, 2), {
    access: blobAccess,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8',
  });
};

export const readAppData = async () => {
  if (canUseBlob()) {
    try {
      const blobData = await readBlobData();
      if (blobData) {
        return blobData;
      }
    } catch (_error) {
      return defaultData;
    }
  }

  return readDataFile();
};

export const writeAppData = async data => {
  if (canUseBlob()) {
    await writeBlobData(data);
    return { storage: 'blob' };
  }

  if (isVercelRuntime()) {
    throw new Error('Chưa cấu hình Vercel Blob cho môi trường deploy');
  }

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  return { storage: 'file' };
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
