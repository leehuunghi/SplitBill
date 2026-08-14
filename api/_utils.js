import fs from 'node:fs/promises';
import path from 'node:path';

const githubApiBase = 'https://api.github.com';

const githubConfig = () => ({
  owner: process.env.GITHUB_REPO_OWNER || 'leehuunghi',
  repo: process.env.GITHUB_REPO_NAME || 'SplitBill',
  branch: process.env.GITHUB_REPO_BRANCH || 'main',
});

export const isVercelRuntime = () => Boolean(process.env.VERCEL);
export const getGithubToken = () => process.env.GITHUB_TOKEN || '';
export const canUseGithubStorage = () => Boolean(getGithubToken());

const buildGithubContentsUrl = filePath => {
  const { owner, repo, branch } = githubConfig();
  const encodedPath = filePath
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${githubApiBase}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
};

const githubHeaders = () => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${getGithubToken()}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

const decodeGithubContent = content =>
  Buffer.from(String(content || '').replace(/\n/g, ''), 'base64').toString('utf-8');

const getGithubFile = async filePath => {
  const response = await fetch(buildGithubContentsUrl(filePath), {
    headers: githubHeaders(),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub read failed: ${response.status} ${errorText}`);
  }

  return response.json();
};

const readGithubJson = async filePath => {
  const file = await getGithubFile(filePath);
  if (!file?.content) {
    return null;
  }

  return JSON.parse(decodeGithubContent(file.content));
};

// Đọc kèm `sha` hiện tại để dùng cho optimistic-concurrency khi ghi lại
// (PUT kèm đúng sha vừa đọc; GitHub sẽ từ chối nếu ai đó vừa ghi đè trước).
const readGithubWithSha = async filePath => {
  const file = await getGithubFile(filePath);
  if (!file?.content) {
    return { data: null, sha: null };
  }

  return { data: JSON.parse(decodeGithubContent(file.content)), sha: file.sha };
};

const buildCommitMessage = saveMeta => {
  const at = saveMeta?.at || new Date().toISOString();
  const route = saveMeta?.route || 'unknown-route';
  const action = saveMeta?.action || 'unknown-action';
  return `Update shared data via ${route} - ${action} (${at})`;
};

const putGithubJson = async (filePath, data, sha, saveMeta) => {
  const { branch } = githubConfig();
  const body = {
    message: buildCommitMessage(saveMeta),
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
    branch,
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(buildGithubContentsUrl(filePath), {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`GitHub save failed: ${response.status} ${errorText}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
};

const writeGithubJson = async (filePath, data, saveMeta) => {
  const existingFile = await getGithubFile(filePath);
  try {
    return await putGithubJson(filePath, data, existingFile?.sha, saveMeta);
  } catch (error) {
    if (error?.status !== 409) {
      throw error;
    }

    const latestFile = await getGithubFile(filePath);
    return putGithubJson(filePath, data, latestFile?.sha, saveMeta);
  }
};

const MUTATE_MAX_ATTEMPTS = 5;

// Kho JSON dùng chung: đọc/ghi qua GitHub Contents API khi có GITHUB_TOKEN
// (bắt buộc trên Vercel vì filesystem chỉ đọc-ghi tạm thời), hoặc fallback
// đọc/ghi file cục bộ khi chạy local (vd. `vercel dev`).
export const createJsonStore = ({ localRelativePath, githubRelativePath, defaultData }) => {
  const localPath = path.join(process.cwd(), localRelativePath);
  // Serialize các lệnh mutate() trên cùng file trong 1 tiến trình Node, để 2
  // request local chạy gần như đồng thời không interleave đọc/ghi vào nhau.
  let localMutationQueue = Promise.resolve();

  const read = async () => {
    if (canUseGithubStorage()) {
      try {
        const data = await readGithubJson(githubRelativePath);
        if (data) {
          return data;
        }
      } catch (_error) {
        return defaultData;
      }
    }

    try {
      const raw = await fs.readFile(localPath, 'utf-8');
      return JSON.parse(raw);
    } catch (_error) {
      return defaultData;
    }
  };

  const write = async (data, saveMeta) => {
    if (canUseGithubStorage()) {
      await writeGithubJson(githubRelativePath, data, saveMeta);
      return { storage: 'github' };
    }

    if (isVercelRuntime()) {
      throw new Error('Chưa cấu hình GITHUB_TOKEN cho môi trường deploy');
    }

    await fs.writeFile(localPath, JSON.stringify(data, null, 2), 'utf-8');
    return { storage: 'file' };
  };

  // Đọc bản mới nhất -> áp dụng `applyFn` -> ghi lại, với retry thật sự khi
  // có xung đột: nếu ai đó ghi đè giữa lúc mình đọc và mình ghi, đọc lại bản
  // mới nhất rồi CHẠY LẠI `applyFn` trên bản đó (không ghi đè lại nội dung
  // cũ đã tính từ dữ liệu stale). Nhờ vậy 2 request cùng sửa dữ liệu gần như
  // đồng thời sẽ không làm mất thay đổi của nhau.
  const mutate = async (applyFn, saveMeta) => {
    if (canUseGithubStorage()) {
      for (let attempt = 0; attempt < MUTATE_MAX_ATTEMPTS; attempt += 1) {
        const { data, sha } = await readGithubWithSha(githubRelativePath);
        const current = data || defaultData;
        const next = await applyFn(current);
        if (next === current) return next;
        try {
          await putGithubJson(githubRelativePath, next, sha, saveMeta);
          return next;
        } catch (error) {
          if (error?.status === 409 || error?.status === 422) {
            continue;
          }
          throw error;
        }
      }
      throw new Error('Xung đột dữ liệu, vui lòng thử lại');
    }

    if (isVercelRuntime()) {
      throw new Error('Chưa cấu hình GITHUB_TOKEN cho môi trường deploy');
    }

    const runLocalMutation = async () => {
      let current;
      try {
        const raw = await fs.readFile(localPath, 'utf-8');
        current = JSON.parse(raw);
      } catch (_error) {
        current = defaultData;
      }
      const next = await applyFn(current);
      if (next === current) return next;
      await fs.writeFile(localPath, JSON.stringify(next, null, 2), 'utf-8');
      return next;
    };

    const result = localMutationQueue.then(runLocalMutation, runLocalMutation);
    // Giữ chain "sống" kể cả khi lệnh này lỗi, để lệnh mutate() tiếp theo
    // không bị kẹt chờ mãi một promise đã reject.
    localMutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return { read, write, mutate };
};

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

export const dataStore = createJsonStore({
  localRelativePath: 'src/data.json',
  githubRelativePath: process.env.GITHUB_DATA_PATH || 'src/data.json',
  defaultData,
});

export const emptyMatchHistory = { matches: [] };

export const matchHistoryStore = createJsonStore({
  localRelativePath: 'src/match-history.json',
  githubRelativePath: process.env.GITHUB_MATCH_HISTORY_PATH || 'src/match-history.json',
  defaultData: emptyMatchHistory,
});

// Giữ tên cũ để không vỡ các handler đang import readAppData/writeAppData.
export const readAppData = dataStore.read;
export const writeAppData = dataStore.write;
export const readDataFile = dataStore.read;

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
