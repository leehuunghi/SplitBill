import fs from 'node:fs/promises';
import path from 'node:path';

const dataPath = path.join(process.cwd(), 'src', 'data.json');
const githubApiBase = 'https://api.github.com';

const defaultGithubConfig = {
  owner: process.env.GITHUB_REPO_OWNER || 'leehuunghi',
  repo: process.env.GITHUB_REPO_NAME || 'SplitBill',
  branch: process.env.GITHUB_REPO_BRANCH || 'main',
  path: process.env.GITHUB_DATA_PATH || 'src/data.json',
};

export const isVercelRuntime = () => Boolean(process.env.VERCEL);
export const getGithubToken = () => process.env.GITHUB_TOKEN || '';
export const canUseGithubStorage = () => Boolean(getGithubToken());

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

const getGithubConfig = () => defaultGithubConfig;

const buildGithubContentsUrl = () => {
  const { owner, repo, path: filePath, branch } = getGithubConfig();
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

const getGithubFile = async () => {
  const response = await fetch(buildGithubContentsUrl(), {
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

const readGithubData = async () => {
  const file = await getGithubFile();
  if (!file?.content) {
    return null;
  }

  return JSON.parse(decodeGithubContent(file.content));
};

const putGithubData = async (data, sha) => {
  const { branch } = getGithubConfig();
  const body = {
    message: `Update shared data (${new Date().toISOString()})`,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
    branch,
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(buildGithubContentsUrl(), {
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

const writeGithubData = async data => {
  const existingFile = await getGithubFile();
  try {
    return await putGithubData(data, existingFile?.sha);
  } catch (error) {
    if (error?.status !== 409) {
      throw error;
    }

    const latestFile = await getGithubFile();
    return putGithubData(data, latestFile?.sha);
  }
};

export const readAppData = async () => {
  if (canUseGithubStorage()) {
    try {
      const githubData = await readGithubData();
      if (githubData) {
        return githubData;
      }
    } catch (_error) {
      return defaultData;
    }
  }

  return readDataFile();
};

export const writeAppData = async data => {
  if (canUseGithubStorage()) {
    await writeGithubData(data);
    return { storage: 'github' };
  }

  if (isVercelRuntime()) {
    throw new Error('Chưa cấu hình GITHUB_TOKEN cho môi trường deploy');
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
