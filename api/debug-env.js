import { blobAccess, canUseBlob, isVercelRuntime } from './_utils.js';

export default async function handler(_req, res) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN || '';

  return res.status(200).json({
    success: true,
    debug: {
      isVercel: isVercelRuntime(),
      hasBlobToken: canUseBlob(),
      blobTokenLength: blobToken.length,
      blobTokenPrefix: blobToken ? blobToken.slice(0, 18) : null,
      blobAccess,
      nodeEnv: process.env.NODE_ENV || null,
      vercelEnv: process.env.VERCEL_ENV || null,
      deploymentUrl: process.env.VERCEL_URL || null,
      hasVietQrClientId: Boolean(process.env.VIETQR_CLIENT_ID),
      hasVietQrApiKey: Boolean(process.env.VIETQR_API_KEY),
    },
  });
}
