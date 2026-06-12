export function getClosestTransitionPoint(coords, rooms) {
  const transitions = ["ลิฟท์1", "ลิฟท์2", "บรรได"];
  let closest = null;
  let minDist = Infinity;
  transitions.forEach((name) => {
    const room = rooms[name];
    if (room && room.coords) {
      const dist = Math.hypot(coords[0] - room.coords[0], coords[1] - room.coords[1]);
      if (dist < minDist) { minDist = dist; closest = name; }
    }
  });
  return closest;
}

/**
 * แปลงเส้นทาง เป็นขั้นตอนคำแนะนำ
 *
 * ทิศซ้าย/ขวา ใช้ cross product:
 *   cross = vBefore.x * vAfter.y - vBefore.y * vAfter.x
 *   Canvas Y-down: cross > 0 = ขวา, cross < 0 = ซ้าย
 */
export function generateNavigationSteps(path) {
  if (!path || path.length < 2) return [];

  const PIXELS_PER_METER   = 22;
  const TURN_THRESHOLD_RAD = 0.52;  // ~30°
  const MIN_SEGMENT_PX     = 30;    // ปรับลดลงมาเพื่อรับรู้การเลี้ยวในทางเดินสั้นๆ
  // MERGE_TURN_PX: ถ้า straight ระหว่าง 2 turn สั้นกว่านี้ → พิจารณา merge/cancel
  const MERGE_TURN_PX      = 30;    // ปรับลดลงมาเพื่อไม่ให้ยกเลิกการเลี้ยวตามจริงที่ติดๆ กัน

  const rawHeadings = [];
  for (let i = 0; i < path.length - 1; i++) {
    rawHeadings.push(
      Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0])
    );
  }

  const headings = rawHeadings;

  const rawSteps = [];
  let segStart   = 0;
  let segDist    = 0;

  const flushStraight = (endIdx) => {
    if (segDist <= 0) return;
    const meters = Math.max(1, Math.round(segDist / PIXELS_PER_METER));
    rawSteps.push({
      action: "STRAIGHT",
      distance: meters,
      text: `เดินตรงไปประมาณ ${meters} เมตร`,
      startPointIdx: segStart,
      endPointIdx: endIdx,
      _rawPx: segDist,
    });
    segDist  = 0;
    segStart = endIdx;
  };

  for (let i = 0; i < headings.length; i++) {
    segDist += Math.hypot(
      path[i + 1][0] - path[i][0],
      path[i + 1][1] - path[i][1]
    );

    if (i < headings.length - 1) {
      let diff = headings[i + 1] - headings[i];
      while (diff >  Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      if (Math.abs(diff) >= TURN_THRESHOLD_RAD) {
        if (segDist < MIN_SEGMENT_PX) continue;

        flushStraight(i + 1);

        const vBx = Math.cos(headings[i]);
        const vBy = Math.sin(headings[i]);
        const vAx = Math.cos(headings[i + 1]);
        const vAy = Math.sin(headings[i + 1]);
        const cross = vBx * vAy - vBy * vAx;

        const isRight = cross > 0;
        rawSteps.push({
          action: isRight ? "TURN_RIGHT" : "TURN_LEFT",
          distance: 0,
          _cross: cross,
          text: isRight ? "เลี้ยวขวา" : "เลี้ยวซ้าย",
          startPointIdx: i + 1,
          endPointIdx:   i + 1,
        });
      }
    }
  }

  flushStraight(path.length - 1);

  // ── merge + clean ────────────────────────────────────────────────
  // pass 1: จัดการ turn คู่ที่คั่นด้วย straight สั้น
  //   - ทิศเดียวกัน (L+L, R+R) → merge เป็น turn เดียว
  //   - ทิศตรงข้าม (L+R, R+L) → noise → ตัดทั้งคู่ออก รักษา straight
  const cleaned = cleanTurnPairs(rawSteps, MERGE_TURN_PX);

  // pass 2: merge STRAIGHT ติดกัน
  const result = mergeStraights(cleaned);

  result.push({
    action: "ARRIVE",
    distance: 0,
    text: "ถึงจุดหมายปลายทางแล้ว",
    startPointIdx: path.length - 1,
    endPointIdx:   path.length - 1,
  });

  return result;
}

/* ─────────────────────────────────────────────────────────────────
 * cleanTurnPairs
 *
 * pattern: TURN_A → STRAIGHT(px ≤ threshold) → TURN_B
 *
 * กรณี A และ B ทิศเดียวกัน (cross sign เดียวกัน):
 *   → merge เป็น TURN เดียว (cross รวม) เพื่อให้แน่ใจว่าไม่หาย
 *
 * กรณี A และ B ทิศตรงข้าม (cross sign ต่างกัน = zigzag):
 *   → ตัด TURN_A และ TURN_B ออก คงเฉพาะ STRAIGHT ไว้
 *     (เดินตรงผ่านโค้งเล็กน้อยได้เลย)
 *
 * วนซ้ำจนไม่มีอะไรเปลี่ยน
 * ───────────────────────────────────────────────────────────────── */
function cleanTurnPairs(steps, thresholdPx) {
  let out = [...steps];
  let changed = true;

  while (changed) {
    changed = false;
    const next = [];
    let i = 0;

    while (i < out.length) {
      const a = out[i];
      const b = out[i + 1];
      const c = out[i + 2];

      const isTurnPair =
        a && (a.action === "TURN_LEFT" || a.action === "TURN_RIGHT") &&
        b && b.action === "STRAIGHT" && (b._rawPx ?? b.distance * 22) <= thresholdPx &&
        c && (c.action === "TURN_LEFT" || c.action === "TURN_RIGHT");

      if (isTurnPair) {
        const sameDir = a.action === c.action;

        if (sameDir) {
          // ทิศเดียวกัน → merge เป็น turn เดียว
          const totalCross = (a._cross ?? 0) + (c._cross ?? 0);
          const isRight = totalCross > 0;
          next.push({
            action: isRight ? "TURN_RIGHT" : "TURN_LEFT",
            distance: 0,
            _cross: totalCross,
            text: isRight ? "เลี้ยวขวา" : "เลี้ยวซ้าย",
            startPointIdx: a.startPointIdx,
            endPointIdx:   c.endPointIdx,
          });
          // straight ตรงกลางหายไป (ระยะสั้นมาก ไม่มีนัย)
        } else {
          // ทิศตรงข้าม = zigzag noise → เก็บแค่ straight ตรงกลาง
          next.push({ ...b });
        }

        i += 3;
        changed = true;
      } else {
        next.push(a);
        i++;
      }
    }

    out = next;
  }

  return out;
}

function smoothAngles(angles, window = 3) {
  if (angles.length <= window) return angles;
  const half   = Math.floor(window / 2);
  const result = [];
  for (let i = 0; i < angles.length; i++) {
    let sinSum = 0, cosSum = 0, count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= angles.length) continue;
      sinSum += Math.sin(angles[j]);
      cosSum += Math.cos(angles[j]);
      count++;
    }
    result.push(Math.atan2(sinSum / count, cosSum / count));
  }
  return result;
}

function mergeStraights(steps) {
  const out = [];
  for (const s of steps) {
    if (
      s.action === "STRAIGHT" &&
      out.length > 0 &&
      out[out.length - 1].action === "STRAIGHT"
    ) {
      const prev = out[out.length - 1];
      prev.distance += s.distance;
      prev.text = `เดินตรงไปประมาณ ${prev.distance} เมตร`;
      prev.endPointIdx = s.endPointIdx;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}