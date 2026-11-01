import { readAppData } from './_utils.js';

export default async function handler(_req, res) {
  try {
    const data = await readAppData({ fallbackToBundled: true });
    res.status(200).json(data);
  } catch (error) {
    // Không trả dữ liệu rỗng giả vờ "thành công" nữa: client sẽ báo lỗi
    // thay vì hiển thị danh sách thành viên trống.
    res.status(503).json({
      success: false,
      error: `Không tải được dữ liệu: ${error?.message || 'lỗi không xác định'}`,
    });
  }
}
