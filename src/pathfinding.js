// pathfinding.js
export function findPath(start, end, imageData) {
  const { width, height, data } = imageData;

  const stepSize = 6;        // เพิ่มจาก 2 → 6 ลดจำนวนจุดตั้งแต่ต้น
  const WALL_MARGIN = 3;     // ลดจาก 4 → 3 ให้เส้นตรงบนทางแคบผ่านได้
  const CENTER_RANGE = 12;
  const CENTER_WEIGHT = 1;   // ลดจาก 3 → 1 ลด bias ที่ทำให้เส้นหักโค้งหาศูนย์กลาง

  /* ------------------ Utils ------------------ */

  const heuristic = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;

  const isPathColor = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const idx = (y * width + x) * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
    return (
      a > 200 &&
      Math.abs(r - 195) < 15 &&
      Math.abs(g - 195) < 15 &&
      Math.abs(b - 195) < 15
    );
  };

  const isWalkable = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (!isPathColor(x, y)) return false;
    for (let dx = -WALL_MARGIN; dx <= WALL_MARGIN; dx++) {
      for (let dy = -WALL_MARGIN; dy <= WALL_MARGIN; dy++) {
        if (!isPathColor(x + dx, y + dy)) return false;
      }
    }
    return true;
  };

  const distanceToWall = (x, y) => {
    for (let r = 1; r <= CENTER_RANGE; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (!isPathColor(Math.round(x + dx), Math.round(y + dy))) return r;
        }
      }
    }
    return CENTER_RANGE;
  };

  const findNearestWalkable = (pos) => {
    const [sx, sy] = pos;
    if (isWalkable(sx, sy)) return [Math.round(sx), Math.round(sy)];
    for (let r = 1; r < 80; r++) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        const x = sx + r * Math.cos(a);
        const y = sy + r * Math.sin(a);
        if (isWalkable(x, y)) return [Math.round(x), Math.round(y)];
      }
    }
    return null;
  };

  /* ------------------ A* ------------------ */

  const startPos = findNearestWalkable(start);
  const endPos   = findNearestWalkable(end);

  if (!startPos || !endPos) {
    console.error("❌ ไม่พบจุดเริ่มหรือปลายที่เดินได้");
    return [];
  }

  const open   = new Map();
  const closed = new Set();
  const cameFrom = new Map();

  open.set(key(...startPos), { pos: startPos, g: 0, f: heuristic(startPos, endPos) });

  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    // ไม่ใช้ diagonal เพื่อให้เส้นทางเป็นแนวตั้ง/แนวนอนเท่านั้น
  ];

  let iterations = 0;
  const MAX_ITER = 80000;

  while (open.size > 0 && iterations < MAX_ITER) {
    iterations++;

    let currentKey = null;
    let currentNode = null;
    for (const [k, v] of open) {
      if (!currentNode || v.f < currentNode.f) { currentKey = k; currentNode = v; }
    }
    if (!currentNode) break;

    const [cx, cy] = currentNode.pos;

    if (heuristic([cx, cy], endPos) < stepSize * 2) {
      const raw = [];
      let k = currentKey;
      while (k) {
        const [x, y] = k.split(",").map(Number);
        raw.push([x, y]);
        k = cameFrom.get(k);
      }
      raw.reverse();
      console.log(`✅ Path found: ${raw.length} points`);

      // ── String-pulling: Ramer–Douglas–Peucker simplification ──────────
      const simplified = rdpSimplify(raw, 12.0); // epsilon = 8px (เพิ่มจาก 4 → 8 ให้ตรงขึ้น)
      console.log(`✅ After RDP: ${simplified.length} points`);
      return simplified;
    }

    open.delete(currentKey);
    closed.add(currentKey);

    for (const [dx, dy] of directions) {
      const nx = cx + dx * stepSize;
      const ny = cy + dy * stepSize;
      const nk = key(nx, ny);

      if (closed.has(nk) || !isWalkable(nx, ny)) continue;

      const wallDist    = distanceToWall(nx, ny);
      const wallPenalty = (CENTER_RANGE - wallDist) * CENTER_WEIGHT;
      const g = currentNode.g + Math.hypot(dx * stepSize, dy * stepSize) + wallPenalty;
      const f = g + heuristic([nx, ny], endPos);

      if (!open.has(nk) || g < open.get(nk).g) {
        open.set(nk, { pos: [nx, ny], g, f });
        cameFrom.set(nk, currentKey);
      }
    }
  }

  console.error("❌ ไม่พบเส้นทาง");
  return [];
}

/* ──────────────────────────────────────────────────────────────────
 * Ramer–Douglas–Peucker (RDP) Path Simplification
 * ลบจุดกลางที่อยู่ใกล้เส้นตรงระหว่างจุดต้น-ปลายออก
 * epsilon (px): ยิ่งมากยิ่ง smooth แต่อาจตัดทางโค้งทิ้ง
 * ค่าแนะนำ: 3–6 px สำหรับ step size = 6
 * ────────────────────────────────────────────────────────────────── */
function rdpSimplify(points, epsilon = 4.0) {
  if (points.length < 3) return points;

  const perpendicularDist = (p, lineStart, lineEnd) => {
    const [x0, y0] = p;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(x0 - x1, y0 - y1);
    const t = Math.max(0, Math.min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / lenSq));
    return Math.hypot(x0 - (x1 + t * dx), y0 - (y1 + t * dy));
  };

  const rdp = (pts, start, end, eps, result) => {
    let maxDist = 0;
    let maxIdx  = 0;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(pts[i], pts[start], pts[end]);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > eps) {
      rdp(pts, start, maxIdx, eps, result);
      result.push(pts[maxIdx]);
      rdp(pts, maxIdx, end, eps, result);
    }
  };

  const result = [points[0]];
  rdp(points, 0, points.length - 1, epsilon, result);
  result.push(points[points.length - 1]);
  return result;
}