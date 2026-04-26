import { blobAccess, canUseBlob, isVercelRuntime } from './_utils.js';

export default async function handler(_req, res) {
  return res.status(200).json({
    success: true,
    debug: {
      isVercel: isVercelRuntime(),
      hasBlobToken: canUseBlob(),
      blobAccess,
      nodeEnv: process.env.NODE_ENV || null,
      vercelEnv: process.env.VERCEL_ENV || null,
      hasVietQrClientId: Boolean(process.env.VIETQR_CLIENT_ID),
      hasVietQrApiKey: Boolean(process.env.VIETQR_API_KEY),
    },
  });
}
