export default async function handler(_req, res) {
  res.status(501).json({
    ok: false,
    error: 'Vercel deployment không hỗ trợ lưu trực tiếp vào src/data.json.',
  });
}
