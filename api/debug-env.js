import { canUseGithubStorage, getGithubToken, isVercelRuntime } from './_utils.js';

export default async function handler(_req, res) {
  const githubToken = getGithubToken();

  return res.status(200).json({
    success: true,
    debug: {
      isVercel: isVercelRuntime(),
      hasGithubToken: canUseGithubStorage(),
      githubTokenLength: githubToken.length,
      githubTokenPrefix: githubToken ? githubToken.slice(0, 12) : null,
      githubRepoOwner: process.env.GITHUB_REPO_OWNER || 'leehuunghi',
      githubRepoName: process.env.GITHUB_REPO_NAME || 'SplitBill',
      githubRepoBranch: process.env.GITHUB_REPO_BRANCH || 'main',
      githubDataPath: process.env.GITHUB_DATA_PATH || 'src/data.json',
      nodeEnv: process.env.NODE_ENV || null,
      vercelEnv: process.env.VERCEL_ENV || null,
      deploymentUrl: process.env.VERCEL_URL || null,
      hasVietQrClientId: Boolean(process.env.VIETQR_CLIENT_ID),
      hasVietQrApiKey: Boolean(process.env.VIETQR_API_KEY),
    },
  });
}
