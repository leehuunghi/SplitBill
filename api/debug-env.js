import { blobAccess, canUseBlob, getBlobToken, isVercelRuntime } from './_utils.js';

export default async function handler(_req, res) {
  const blobToken = getBlobToken();
  const blobTokenSource = process.env.SPLIT_BILL_BLOB_TOKEN
    ? 'SPLIT_BILL_BLOB_TOKEN'
    : process.env.BLOB_READ_WRITE_TOKEN
      ? 'BLOB_READ_WRITE_TOKEN'
      : null;

  return res.status(200).json({
    success: true,
    debug: {
      isVercel: isVercelRuntime(),
      hasBlobToken: canUseBlob(),
      blobTokenLength: blobToken.length,
      blobTokenPrefix: blobToken ? blobToken.slice(0, 18) : null,
      blobTokenSource,
      blobAccess,
      nodeEnv: process.env.NODE_ENV || null,
      vercelEnv: process.env.VERCEL_ENV || null,
      deploymentUrl: process.env.VERCEL_URL || null,
      hasVietQrClientId: Boolean(process.env.VIETQR_CLIENT_ID),
      hasVietQrApiKey: Boolean(process.env.VIETQR_API_KEY),
    },
  });
}
