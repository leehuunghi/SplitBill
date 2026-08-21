// Hệ thống xếp hạng "sao" cho cầu thủ, tính từ lịch sử trận đấu.
//
// Ý tưởng: mỗi người có 1 điểm ẩn (rating kiểu Elo), điểm này quyết định
// số sao hiển thị. Rating KHÔNG được lưu vào file nào cả mà luôn được tính
// lại bằng cách "phát lại" toàn bộ matches theo thứ tự thời gian — giống
// cách computeMemberStats tính lại wins/losses, nên sửa/xoá 1 trận cũ là
// bảng xếp hạng tự khớp lại, không bao giờ lệch.
//
// Vì sao dùng Elo thay vì tỉ lệ thắng thuần:
//   - Thắng đội mạnh được nhiều điểm hơn thắng đội yếu.
//   - Người mới đá 2 trận thắng cả 2 không thể nhảy lên 5 sao (tỉ lệ thắng
//     100% nhưng mẫu quá nhỏ) — K-factor + cờ "tạm tính" xử lý việc này.

export const BASE_RATING = 1000; // điểm khởi điểm của người chưa đá trận nào
export const MIN_RATING = 500; // chặn dưới, tránh tụt vô hạn khi thua nhiều
export const PLACEMENT_MATCHES = 5; // số trận "định hạng" đầu tiên, điểm nhảy mạnh
export const PROVISIONAL_MATCHES = 3; // dưới ngưỡng này thì sao chỉ là tạm tính
export const STREAK_LENGTH = 3; // chuỗi thắng/thua từ mức này bắt đầu được nhân thêm
export const STREAK_MULTIPLIER = 1.25; // hệ số thưởng/phạt khi đang có chuỗi

export const MIN_STARS = 1;
export const MAX_STARS = 5;
// Vùng đệm chống "nhấp nháy" hạng: đứng sát mốc thì 1 trận thắng/thua sát nút
// không đủ để đổi sao, phải vượt hẳn mốc thêm ngần này điểm mới thăng/giảm.
export const STAR_HYSTERESIS = 15;

// Mốc quy đổi rating -> sao, đối xứng quanh BASE_RATING (1000 = 3 sao).
// Khoảng cách nới rộng dần ở 2 đầu: lên 5 sao hay tụt về 1 sao đều khó,
// còn quanh mức trung bình thì nhích 1 nửa sao chỉ cần ~30 điểm.
export const STAR_OFFSETS = [
  { offset: 180, stars: 5 },
  { offset: 120, stars: 4.5 },
  { offset: 70, stars: 4 },
  { offset: 30, stars: 3.5 },
];

// Quy đổi rating sang số sao (1 -> 5, bước 0.5).
export const starsFromRating = rating => {
  const diff = Number(rating || 0) - BASE_RATING;
  for (const { offset, stars } of STAR_OFFSETS) {
    if (diff >= offset) return stars;
    if (diff <= -offset) return Number((MAX_STARS + MIN_STARS - stars).toFixed(1)); // đối xứng: 5->1, 4.5->1.5...
  }
  return 3;
};

// Bảng quy đổi 2 CHIỀU sao <-> rating, dùng đúng các mốc trong STAR_OFFSETS
// nên round-trip khớp nhau: ratingFromStars(5) -> starsFromRating(...) vẫn
// ra 5. Dùng khi admin XẾP HẠNG BAN ĐẦU thủ công (baseline) — chọn 1 mức
// sao là quy được ra rating khởi điểm tương ứng.
export const STAR_RATING_TABLE = [
  ...STAR_OFFSETS.map(({ offset, stars }) => ({ stars, rating: BASE_RATING + offset })),
  { stars: 3, rating: BASE_RATING },
  ...STAR_OFFSETS.map(({ offset, stars }) => ({
    stars: Number((MAX_STARS + MIN_STARS - stars).toFixed(1)),
    rating: BASE_RATING - offset,
  })),
];

export const STAR_LEVELS = STAR_RATING_TABLE.map(e => e.stars).sort((a, b) => b - a);

export const ratingFromStars = stars => {
  const entry = STAR_RATING_TABLE.find(e => e.stars === Number(stars));
  return entry ? entry.rating : BASE_RATING;
};

export const isValidStarLevel = stars => STAR_RATING_TABLE.some(e => e.stars === Number(stars));

// Người mới đá điểm nhảy mạnh cho nhanh về đúng trình, đá nhiều rồi thì
// điểm ổn định dần (1 trận bất thường không làm rơi hạng ngay).
export const kFactor = played => {
  if (played < PLACEMENT_MATCHES) return 48;
  if (played < 15) return 32;
  return 24;
};

// Xác suất thắng kỳ vọng của đội có rating trung bình `mine` khi gặp `theirs`.
// Chênh 400 điểm ~ 10 ăn 1.
export const expectedScore = (mine, theirs) => 1 / (1 + 10 ** ((theirs - mine) / 400));

// Số sao mới sau 1 trận, có tính vùng đệm: giữ nguyên hạng cũ trừ khi rating
// vượt qua mốc một cách dứt khoát (hơn STAR_HYSTERESIS điểm).
export const nextStars = (rating, currentStars) => {
  const raw = starsFromRating(rating);
  if (raw > currentStars && starsFromRating(rating - STAR_HYSTERESIS) > currentStars) return raw;
  if (raw < currentStars && starsFromRating(rating + STAR_HYSTERESIS) < currentStars) return raw;
  return currentStars;
};

const emptyPlayer = () => ({
  rating: BASE_RATING,
  stars: 3,
  played: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  streak: 0, // dương = chuỗi thắng, âm = chuỗi thua
  bestRating: BASE_RATING,
});

const uniqueNumbers = list => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(id => !Number.isNaN(id)))];

const averageRating = (ids, getRating) =>
  ids.length ? ids.reduce((sum, id) => sum + getRating(id), 0) / ids.length : BASE_RATING;

// Phát lại toàn bộ lịch sử để ra rating/sao hiện tại của từng người.
//
// `baseline`: { [memberId]: sốSao } admin xếp hạng thủ công ở tab "Level ban
// đầu" — dùng làm ĐIỂM XUẤT PHÁT thay vì mặc định 1000/3★ cho những người có
// trong bảng này, để tránh 1 người chơi giỏi nhưng chỉ mới đá vài trận (số
// liệu ít, dễ lệch/"cảm tính") bị xếp ngang người mới. Có baseline thì
// KHÔNG còn là "tạm tính" nữa dù chưa đủ 3 trận, vì đây là đánh giá có chủ
// đích của admin chứ không phải suy ra từ mẫu nhỏ. Match sau đó vẫn cộng/trừ
// điểm bình thường từ mốc này.
//
// Trả về:
//   byId: { [memberId]: { rating, stars, played, wins, losses, draws, streak,
//                         provisional, seeded, lastDelta } }
//   eventsByMatchId: { [match.id]: { deltas: {id: điểm +/-},
//                                    promotions: [{id, stars}],
//                                    demotions: [{id, stars}] } }
export const computePlayerRatings = (matches, baseline = {}) => {
  const list = Array.isArray(matches) ? matches : [];
  // Lịch sử được lưu giảm dần theo ngày, phải đảo lại mới phát đúng thứ tự.
  const chronological = [...list].sort((a, b) => (a?.date < b?.date ? -1 : a?.date > b?.date ? 1 : 0));

  const state = new Map();
  const eventsByMatchId = {};
  const ensure = id => {
    const key = Number(id);
    if (!state.has(key)) state.set(key, emptyPlayer());
    return state.get(key);
  };

  Object.entries(baseline || {}).forEach(([id, stars]) => {
    if (!isValidStarLevel(stars)) return;
    const player = emptyPlayer();
    const level = Number(stars);
    player.rating = ratingFromStars(level);
    player.stars = level;
    player.bestRating = player.rating;
    player.seeded = true;
    state.set(Number(id), player);
  });

  chronological.forEach(match => {
    if (!match || match.result === 'pending') return; // chưa có kết quả -> chưa tính điểm
    const idsA = uniqueNumbers(match.teamA);
    const idsB = uniqueNumbers(match.teamB);
    if (!idsA.length || !idsB.length) return;

    // Chốt rating trước trận của cả 2 đội TRƯỚC khi cộng/trừ, để mọi người
    // trong cùng 1 trận đều được tính trên cùng một mốc.
    const getRating = id => ensure(id).rating;
    const avgA = averageRating(idsA, getRating);
    const avgB = averageRating(idsB, getRating);
    const expA = expectedScore(avgA, avgB);
    const scoreA = match.result === 'A' ? 1 : match.result === 'B' ? 0 : 0.5;

    const deltas = {};
    const promotions = [];
    const demotions = [];

    const applyTeam = (ids, expected, score) => {
      ids.forEach(id => {
        const player = ensure(id);
        const starsBefore = player.stars;

        let delta = kFactor(player.played) * (score - expected);
        // Đang có chuỗi thắng mà thắng tiếp (hoặc chuỗi thua mà thua tiếp)
        // thì nhân thêm — thăng/giảm hạng bám sát phong độ hiện tại.
        const onWinStreak = player.streak >= STREAK_LENGTH && delta > 0;
        const onLoseStreak = player.streak <= -STREAK_LENGTH && delta < 0;
        if (onWinStreak || onLoseStreak) delta *= STREAK_MULTIPLIER;
        delta = Math.round(delta);

        player.rating = Math.max(MIN_RATING, player.rating + delta);
        player.played += 1;
        player.lastDelta = delta;
        player.bestRating = Math.max(player.bestRating, player.rating);
        if (score === 1) {
          player.wins += 1;
          player.streak = player.streak > 0 ? player.streak + 1 : 1;
        } else if (score === 0) {
          player.losses += 1;
          player.streak = player.streak < 0 ? player.streak - 1 : -1;
        } else {
          player.draws += 1;
          player.streak = 0;
        }

        deltas[id] = delta;
        const starsAfter = nextStars(player.rating, starsBefore);
        player.stars = starsAfter;
        if (starsAfter > starsBefore) promotions.push({ id, stars: starsAfter });
        else if (starsAfter < starsBefore) demotions.push({ id, stars: starsAfter });
      });
    };

    applyTeam(idsA, expA, scoreA);
    applyTeam(idsB, 1 - expA, 1 - scoreA);

    if (match.id !== undefined && match.id !== null) {
      eventsByMatchId[match.id] = { deltas, promotions, demotions };
    }
  });

  const byId = {};
  state.forEach((player, id) => {
    byId[id] = {
      ...player,
      seeded: Boolean(player.seeded),
      // Dưới 3 trận thì số sao mới chỉ là ước lượng, chưa đủ dữ liệu để tin
      // — TRỪ KHI admin đã xếp hạng ban đầu thủ công (seeded), lúc đó không
      // còn là suy đoán từ mẫu nhỏ nữa.
      provisional: player.played < PROVISIONAL_MATCHES && !player.seeded,
    };
  });

  return { byId, eventsByMatchId };
};

// Sao của 1 người khi chưa có trong bảng (chưa đá trận nào): mặc định 3 sao.
export const ratingOf = (byId, id) => byId?.[Number(id)]?.rating ?? BASE_RATING;
export const starsOf = (byId, id) => byId?.[Number(id)]?.stars ?? 3;

const shuffleList = list => {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Chia đội cân bằng theo rating nhưng vẫn có yếu tố ngẫu nhiên:
// bốc `candidates` cách chia ngẫu nhiên, giữ lại nhóm cân nhất rồi random
// trong nhóm đó. Nhờ vậy mỗi lần bấm ra đội hình khác nhau nhưng luôn cân,
// thay vì lúc nào cũng đúng 1 kết quả "tối ưu" cứng nhắc.
//
// So sánh bằng rating TRUNG BÌNH chứ không phải tổng: khi lẻ người, đội ít
// người hơn cần các cá nhân nhỉnh hơn mới cân.
export const splitBalancedTeams = (ids, byId, { candidates = 300, topPool = 8 } = {}) => {
  const list = uniqueNumbers(ids);
  if (list.length < 2) return { teamA: list, teamB: [] };

  const getRating = id => ratingOf(byId, id);
  const half = Math.ceil(list.length / 2);
  const options = [];

  for (let i = 0; i < candidates; i += 1) {
    const shuffled = shuffleList(list);
    const teamA = shuffled.slice(0, half);
    const teamB = shuffled.slice(half);
    const diff = Math.abs(averageRating(teamA, getRating) - averageRating(teamB, getRating));
    options.push({ teamA, teamB, diff });
  }

  options.sort((a, b) => a.diff - b.diff);
  const pool = options.slice(0, Math.max(1, Math.min(topPool, options.length)));
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return { teamA: picked.teamA, teamB: picked.teamB };
};

// Sức mạnh 1 đội để hiển thị: sao trung bình của các thành viên.
export const teamAverageStars = (ids, byId) => {
  const list = uniqueNumbers(ids);
  if (!list.length) return 0;
  const total = list.reduce((sum, id) => sum + starsOf(byId, id), 0);
  return Math.round((total / list.length) * 10) / 10;
};
