// Đã tách thành 2 trang riêng:
// - ChiaTeamView.jsx  -> /chiateam (xem đội hình + lịch sử, không có quyền random/lưu)
// - ChiaTeamAdmin.jsx -> /admin/chiateam (chọn thành viên, random, chọn ngày, lưu kết quả)
// File này giữ lại để export mặc định về bản admin, tránh vỡ import cũ nếu còn sót.
export { default } from './ChiaTeamAdmin.jsx';
