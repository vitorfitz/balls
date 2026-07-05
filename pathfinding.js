// ---------- Basic vector helpers ----------

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const normalize = (a) => {
  const len = Math.hypot(a.x, a.y);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
};

/**
 * Distance from point p to segment ab.
 */
function pointSegmentDistance(p, a, b) {
  const ab = sub(b, a);
  const abLenSq = dot(ab, ab);
  if (abLenSq === 0) return dist(p, a);
  let t = dot(sub(p, a), ab) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = add(a, scale(ab, t));
  return dist(p, closest);
}

/**
 * Does segment ab pass through (clip) circle c (strictly, not just touch)?
 * `epsilon` lets you treat tangent lines (which touch but don't cross) as clear.
 */
function segmentIntersectsCircle(a, b, circle, epsilon = 1e-7) {
  return pointSegmentDistance(circle, a, b) < circle.radius - epsilon;
}

// ---------- Inflated obstacle / wall setup ----------

/**
 * @param {{x:number,y:number,radius:number}[]} obstacles
 * @param {number} playerRadius
 * @returns inflated obstacles (Minkowski sum: radius += playerRadius)
 */
function inflateObstacles(obstacles, playerRadius) {
  return obstacles.map((o) => ({ x: o.x, y: o.y, radius: o.radius + playerRadius }));
}

/**
 * Map walls given as an axis-aligned rectangle {minX, minY, maxX, maxY}.
 * Inflating the player radius means the *point* player must stay within
 * an inset rectangle.
 */
function inflateWalls(walls, playerRadius) {
  return {
    minX: walls.minX + playerRadius,
    minY: walls.minY + playerRadius,
    maxX: walls.maxX - playerRadius,
    maxY: walls.maxY - playerRadius,
  };
}

/**
 * Does the segment ab leave the (inset) rectangular bounds at any point?
 * Since the rectangle is convex, checking both endpoints are inside is
 * sufficient (a segment between two points inside a convex region stays
 * inside the region).
 */
function segmentLeavesBounds(a, b, bounds) {
  const inside = (p) =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;
  return !inside(a) || !inside(b);
}

// ---------- Tangent lines between two circles ----------

/**
 * Compute the (up to 4) external + internal tangent lines between two
 * circles, returned as pairs of tangent points [pointOnC1, pointOnC2].
 * We only need *external* tangents for obstacle-avoidance path planning
 * (the player goes around the outside of both circles), since internal
 * tangents would require passing between the circles, which is exactly
 * what we're trying to avoid when they're obstacles.
 */
function externalTangentLines(c1, c2) {
  const d = dist(c1, c2);
  // If one circle is inside the other (or they're identical), no external tangents.
  if (d <= Math.abs(c1.radius - c2.radius) + 1e-9) return [];

  const dir = normalize(sub(c2, c1));
  const perp = { x: -dir.y, y: dir.x };

  // For external tangents, the tangent line offset angle from the
  // center line is the same on both circles (since radii can differ,
  // the line isn't parallel to the center line in general).
  const r1 = c1.radius;
  const r2 = c2.radius;
  // Angle between the center line and the tangent line, as seen from
  // either circle (guarded above to stay within asin's valid domain).
  const angle = Math.asin((r1 - r2) / d);

  const lines = [];
  for (const sign of [1, -1]) {
    const tangentDir = rotateAroundBy(perp, dir, angle * sign);
    const p1 = add(c1, scale(tangentDir, r1 * sign));
    const p2 = add(c2, scale(tangentDir, r2 * sign));
    lines.push([p1, p2]);
  }
  return lines;
}

/**
 * Helper: rotate vector `perp` toward `dir` by `angle` radians and return
 * the resulting unit vector, used to build tangent-point offsets.
 * Equivalent to constructing cos(angle)*perp - sin(angle)*dir (or + , per sign).
 */
function rotateAroundBy(perp, dir, angle) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return normalize({
    x: perp.x * cosA - dir.x * sinA,
    y: perp.y * cosA - dir.y * sinA,
  });
}

// ---------- Visibility graph ----------

/**
 * A graph node is either the start, the target, or a tangent point that
 * lies ON a specific circle. We track which circle (by index) a tangent
 * point belongs to, because valid movement between two tangent points on
 * the SAME circle must follow the circle's arc (added as an edge with
 * arc-length weight), not a straight chord (which would cut through the
 * obstacle).
 */
function buildVisibilityGraph(starts, target, obstacles, bounds) {
  const nodes = [{ point: target, circleIndex: -1 }];
  const TARGET = 0;

  // One node per start, indices [1 .. starts.length].
  const STARTS = starts.map((s) => {
    const idx = nodes.length;
    nodes.push({ point: s, circleIndex: -1 });
    return idx;
  });

  // Generate tangent points from every circle pair, and also "direct"
  // pseudo-nodes for start/target aren't circle-bound so they connect
  // via plain tangent-from-point-to-circle, handled separately below.
  const circleTangentPointIndices = obstacles.map(() => []);

  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const tangents = externalTangentLines(obstacles[i], obstacles[j]);
      for (const [p1, p2] of tangents) {
        const idx1 = nodes.length;
        nodes.push({ point: p1, circleIndex: i });
        circleTangentPointIndices[i].push(idx1);

        const idx2 = nodes.length;
        nodes.push({ point: p2, circleIndex: j });
        circleTangentPointIndices[j].push(idx2);
      }
    }
  }

  // Tangent lines from every start and the target to every circle
  // (point-to-circle tangent: the two tangent lines from an external
  // point to a circle).
  for (const anchorIdx of [...STARTS, TARGET]) {
    const anchor = nodes[anchorIdx].point;
    for (let i = 0; i < obstacles.length; i++) {
      const pts = pointCircleTangentPoints(anchor, obstacles[i]);
      for (const p of pts) {
        const idx = nodes.length;
        nodes.push({ point: p, circleIndex: i });
        circleTangentPointIndices[i].push(idx);
      }
    }
  }

  const n = nodes.length;
  const adjacency = Array.from({ length: n }, () => []);

  const blocked = (a, b) => {
    if (segmentLeavesBounds(a, b, bounds)) return true;
    for (const c of obstacles) {
      if (segmentIntersectsCircle(a, b, c)) return true;
    }
    return false;
  };

  const addEdge = (i, j, weight) => {
    adjacency[i].push({ to: j, weight });
    adjacency[j].push({ to: i, weight });
  };

  // Straight-line edges between every pair of nodes not on the same
  // circle (or start/target), skipping ones that clip an obstacle or
  // leave the map bounds.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.circleIndex !== -1 && a.circleIndex === b.circleIndex) continue; // handled as arc below
      const pa = a.point;
      const pb = b.point;
      if (!blocked(pa, pb)) {
        addEdge(i, j, dist(pa, pb));
      }
    }
  }

  // Arc edges: any two tangent points that lie on the same circle can be
  // connected by going around the circle's boundary (the short way),
  // provided that arc doesn't pass through the *inside* of a different
  // overlapping obstacle, or outside the map bounds (e.g. a turret sitting
  // close to a wall: going around its far side would require swinging the
  // player's center past the wall). For simplicity/robustness we connect
  // all valid pairs on the same circle with the minor-arc length; if
  // obstacles overlap heavily, straight tangent edges to the next circle
  // out will naturally route around, and truly impossible arcs will just
  // be pruned by having no viable path (BFS/Dijkstra will fail to find a
  // route only if truly blocked everywhere, which correctly reflects an
  // inescapable pocket).
  for (let i = 0; i < obstacles.length; i++) {
    const pts = circleTangentPointIndices[i];
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const idxA = pts[a];
        const idxB = pts[b];
        const pa = nodes[idxA].point;
        const pb = nodes[idxB].point;
        if (arcClipsAnotherObstacle(obstacles[i], pa, pb, obstacles, i)) continue;
        if (arcLeavesBounds(obstacles[i], pa, pb, bounds)) continue;
        const arcLen = minorArcLength(obstacles[i], pa, pb);
        addEdge(idxA, idxB, arcLen);
      }
    }
  }

  return { nodes, adjacency, STARTS, TARGET };
}

/**
 * The two tangent points on `circle` as seen from external point `p`.
 * Returns [] if p is inside the circle (no tangents exist).
 */
function pointCircleTangentPoints(p, circle) {
  const d = dist(p, circle);
  if (d <= circle.radius) return []; // inside or on the circle: no tangents
  const toCenter = normalize(sub(circle, p));
  const perp = { x: -toCenter.y, y: toCenter.x };

  const tangentLen = Math.sqrt(d * d - circle.radius * circle.radius);
  // Angle between the line-to-center and the line-to-tangent-point, as seen from p.
  const angle = Math.asin(circle.radius / d);

  const points = [];
  for (const sign of [1, -1]) {
    const dir = rotateAroundBy(toCenter, perp, angle * sign);
    points.push(add(p, scale(dir, tangentLen)));
  }
  return points;
}

/**
 * Minor arc length between two points known to lie on `circle`'s boundary.
 */
function minorArcLength(circle, p1, p2) {
  const v1 = sub(p1, circle);
  const v2 = sub(p2, circle);
  const angle = Math.acos(
    Math.max(-1, Math.min(1, dot(v1, v2) / (circle.radius * circle.radius)))
  );
  return circle.radius * angle;
}

/**
 * Is `angle` within the minor arc [a1, a1+delta] (delta in (-PI, PI])
 * going the short way from a1 to a2? Handles wraparound.
 */
function angleWithinMinorArc(angle, a1, a2) {
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  let rel = angle - a1;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel <= -Math.PI) rel += 2 * Math.PI;

  return delta >= 0 ? rel >= -1e-9 && rel <= delta + 1e-9 : rel <= 1e-9 && rel >= delta - 1e-9;
}

/**
 * Analytic circle-circle intersection points, if any. Returns [] when
 * the circles don't intersect (too far apart, one contains the other,
 * or identical).
 */
function circleCircleIntersections(c1, c2) {
  const d = dist(c1, c2);
  const r1 = c1.radius;
  const r2 = c2.radius;
  if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];

  // Standard radical-line construction.
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(0, hSq));

  const dir = normalize(sub(c2, c1));
  const perp = { x: -dir.y, y: dir.x };
  const mid = add(c1, scale(dir, a));

  if (h < 1e-9) return [mid]; // tangent circles, single intersection point
  return [add(mid, scale(perp, h)), add(mid, scale(perp, -h))];
}

/**
 * Does the minor arc of `circle` between boundary points p1 and p2 pass
 * through the interior of any other obstacle? This matters once
 * obstacles are close enough to overlap (after Minkowski inflation) —
 * without this check, an arc edge could "tunnel" through a neighboring
 * obstacle, producing a false path through what is actually a sealed gap
 * between clustered circles.
 *
 * Solved analytically via circle-circle intersection points rather than
 * sampling: the arc clips `other` iff `other` reaches circle's boundary
 * at all (dist < r1+r2) and at least one of the (at most two)
 * intersection angles falls inside the arc's angular span. The one
 * additional case to handle is `circle` fully engulfed by `other` with
 * no boundary crossing at all (other fully contains this arc) — checked
 * via the containment distance test.
 */
function arcClipsAnotherObstacle(circle, p1, p2, obstacles, ownIndex) {
  const v1 = sub(p1, circle);
  const v2 = sub(p2, circle);
  const a1 = Math.atan2(v1.y, v1.x);
  const a2 = Math.atan2(v2.y, v2.x);

  for (let k = 0; k < obstacles.length; k++) {
    if (k === ownIndex) continue;
    const other = obstacles[k];

    const d = dist(circle, other);

    // `other` fully contains `circle` (including its whole boundary) -> whole arc is clipped.
    if (d + circle.radius <= other.radius + 1e-9) return true;

    const intersections = circleCircleIntersections(circle, other);
    for (const pt of intersections) {
      const v = sub(pt, circle);
      const angle = Math.atan2(v.y, v.x);
      if (angleWithinMinorArc(angle, a1, a2)) return true;
    }
  }
  return false;
}

/**
 * Does the minor arc of `circle` between boundary points p1 and p2 cross
 * outside the (inset) rectangular bounds at any point? Mirrors
 * arcClipsAnotherObstacle's approach but against the four axis-aligned
 * boundary lines instead of another circle: without this, an arc hugging
 * a circle that sits close to a wall can bulge past the wall (the tangent
 * *endpoints* can be within bounds while the arc between them briefly
 * exits), producing a false path that clips through the wall.
 *
 * Solved analytically: for each of the 4 boundary lines, find where the
 * circle crosses that line (if at all) and check whether any crossing
 * angle falls inside the arc's angular span. We also need the case where
 * the entire arc span is outside a boundary even without crossing it
 * within the span (e.g. the whole minor arc bulges past minY without the
 * endpoints crossing) — checked by additionally sampling the arc's
 * midpoint, which is exact enough since we only ever consider *minor*
 * arcs (span < 2*PI, and in practice always < PI for tangent-point pairs).
 */
function arcLeavesBounds(circle, p1, p2, bounds) {
  const v1 = sub(p1, circle);
  const v2 = sub(p2, circle);
  const a1 = Math.atan2(v1.y, v1.x);
  const a2 = Math.atan2(v2.y, v2.x);

  const inside = (p) =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;

  if (!inside(p1) || !inside(p2)) return true;

  const r = circle.radius;

  // Vertical boundary lines (x = minX, x = maxX): circle crosses at
  // x = boundaryX where |boundaryX - circle.x| <= r.
  for (const boundaryX of [bounds.minX, bounds.maxX]) {
    const dx = boundaryX - circle.x;
    if (Math.abs(dx) > r) continue;
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    for (const sign of [1, -1]) {
      const angle = Math.atan2(sign * dy, dx);
      if (angleWithinMinorArc(angle, a1, a2)) return true;
    }
  }

  // Horizontal boundary lines (y = minY, y = maxY).
  for (const boundaryY of [bounds.minY, bounds.maxY]) {
    const dy = boundaryY - circle.y;
    if (Math.abs(dy) > r) continue;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    for (const sign of [1, -1]) {
      const angle = Math.atan2(dy, sign * dx);
      if (angleWithinMinorArc(angle, a1, a2)) return true;
    }
  }

  // Neither endpoint nor any boundary crossing falls inside the arc span,
  // but the whole minor arc could still bulge outside without a crossing
  // (e.g. bounds line passes entirely outside the circle in that
  // direction while the arc's midpoint still exceeds it due to convexity
  // — not actually possible for a straight axis-aligned line against a
  // circle, since a chord's midpoint-of-arc is the point of maximum
  // deviation and we've already checked all crossings). No further check
  // needed.
  return false;
}

// ---------- Dijkstra ----------

/**
 * Multi-source Dijkstra: `startIndices` may contain one or more node
 * indices, each seeded at distance 0. This is algorithmically identical
 * in cost to single-source Dijkstra on the same graph — we're just
 * initializing more entries in the frontier, not running the search
 * multiple times. Returns which start index produced the winning path
 * via `startIndex` (the graph node index, not the position in the
 * original starts array).
 */
function dijkstra(graph, startIndices, targetIdx) {
  const { adjacency, nodes } = graph;
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const visited = new Array(nodes.length).fill(false);
  for (const startIdx of startIndices) {
    dist[startIdx] = 0;
  }

  // Simple O(V^2) Dijkstra; fine for the modest node counts a visibility
  // graph produces. Swap in a binary heap if you have hundreds of obstacles.
  for (let iter = 0; iter < nodes.length; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = true;
    if (u === targetIdx) break;

    for (const { to, weight } of adjacency[u]) {
      const alt = dist[u] + weight;
      if (alt < dist[to]) {
        dist[to] = alt;
        prev[to] = u;
      }
    }
  }

  if (dist[targetIdx] === Infinity) {
    return { reachable: false, distance: Infinity, path: null, startIndex: -1 };
  }

  const path = [];
  let cur = targetIdx;
  while (cur !== -1) {
    path.push(nodes[cur].point);
    cur = prev[cur];
  }
  path.reverse();

  // The winning start is whichever seeded node the reconstructed path
  // begins at (path[0]); map that point back to its graph node index.
  const winningStartIdx = path.length ? findNodeIndex(nodes, path[0]) : -1;

  return { reachable: true, distance: dist[targetIdx], path, startIndex: winningStartIdx };
}

/**
 * Find the index of the node whose point matches `point` by reference
 * identity (nodes store the exact point objects passed in, so this is
 * safe and avoids float-comparison pitfalls).
 */
function findNodeIndex(nodes, point) {
  return nodes.findIndex((n) => n.point === point);
}

// ---------- Public API ----------

/**
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} target
 * @param {{x:number,y:number,radius:number}[]} obstacles
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} walls
 * @param {number} playerRadius
 * @returns {{reachable: boolean, distance: number, path: {x:number,y:number}[] | null}}
 */
function findPath(start, target, obstacles, walls, playerRadius) {
  const { reachable, distance, path } = findPathMulti(
    [start],
    target,
    obstacles,
    walls,
    playerRadius
  );
  return { reachable, distance, path };
}

/**
 * Multi-source variant of findPath: given several candidate starting
 * points, finds the shortest path from ANY of them to `target`. Starts
 * that are invalid (already overlapping an obstacle, or outside the
 * inset map bounds) are silently skipped rather than failing the whole
 * call. If every start is invalid, the result is unreachable.
 *
 * @param {{x:number,y:number}[]} starts
 * @param {{x:number,y:number}} target
 * @param {{x:number,y:number,radius:number}[]} obstacles
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} walls
 * @param {number} playerRadius
 * @returns {{reachable: boolean, distance: number, path: {x:number,y:number}[] | null, startIndex: number}}
 *   `startIndex` is the index into the original `starts` array that produced
 *   the winning path, or -1 if unreachable.
 */
function findPathMulti(starts, target, obstacles, walls, playerRadius) {
  const inflatedObstacles = inflateObstacles(obstacles, playerRadius);
  const insetBounds = inflateWalls(walls, playerRadius);

  const insideBounds = (p) =>
    p.x >= insetBounds.minX &&
    p.x <= insetBounds.maxX &&
    p.y >= insetBounds.minY &&
    p.y <= insetBounds.maxY;

  const startBlocked = (p) =>
    !insideBounds(p) || inflatedObstacles.some((c) => dist(p, c) < c.radius);

  // Silently drop invalid starts, keeping track of their original index
  // so the result can report which entry in the caller's array won.
  const validStarts = [];
  starts.forEach((s, originalIndex) => {
    if (!startBlocked(s)) validStarts.push({ point: s, originalIndex });
  });

  if (validStarts.length === 0 || startBlocked(target)) {
    return { reachable: false, distance: Infinity, path: null, startIndex: -1 };
  }

  // Fast path: any start with direct line of sight to the target wins
  // outright (shortest possible path for that start is a straight line,
  // so only worth comparing distances among the direct-sighted ones).
  let bestDirect = null;
  for (const { point, originalIndex } of validStarts) {
    const blocked =
      segmentLeavesBounds(point, target, insetBounds) ||
      inflatedObstacles.some((c) => segmentIntersectsCircle(point, target, c));
    if (blocked) continue;
    const d = dist(point, target);
    if (!bestDirect || d < bestDirect.distance) {
      bestDirect = { distance: d, path: [point, target], startIndex: originalIndex };
    }
  }

  // Any start without direct line of sight still needs the graph search,
  // so unless EVERY valid start has direct line of sight, we must build
  // the graph and let Dijkstra consider both direct and routed starts
  // together (a routed start could still beat a distant direct one).
  const allDirect = validStarts.every(({ point }) => {
    return (
      !segmentLeavesBounds(point, target, insetBounds) &&
      !inflatedObstacles.some((c) => segmentIntersectsCircle(point, target, c))
    );
  });
  if (allDirect) {
    return { reachable: true, ...bestDirect };
  }

  const graph = buildVisibilityGraph(
    validStarts.map((v) => v.point),
    target,
    inflatedObstacles,
    insetBounds
  );
  const result = dijkstra(graph, graph.STARTS, graph.TARGET);

  if (!result.reachable) {
    return { reachable: false, distance: Infinity, path: null, startIndex: -1 };
  }

  // Map the winning graph node back to the caller's original start index.
  const winningValidStartPos = graph.STARTS.indexOf(result.startIndex);
  const winningOriginalIndex =
    winningValidStartPos === -1 ? -1 : validStarts[winningValidStartPos].originalIndex;

  const graphResult = {
    reachable: true,
    distance: result.distance,
    path: result.path,
    startIndex: winningOriginalIndex,
  };

  // The graph search only sees routed edges through tangent points; a
  // start with direct line of sight is already covered as a straight
  // two-point edge in the visibility graph (start/target always get
  // pairwise edges when unobstructed), so Dijkstra already accounts for
  // bestDirect internally. No separate comparison needed here.
  return graphResult;
}

/**
 * Yes/no reachability only (skips shortest-path bookkeeping cost-wise
 * equivalent, but convenient if that's all you need).
 */
function isReachable(start, target, obstacles, walls, playerRadius) {
  return findPath(start, target, obstacles, walls, playerRadius).reachable;
}

/**
 * Yes/no reachability only, multi-start variant.
 */
function isReachableMulti(starts, target, obstacles, walls, playerRadius) {
  return findPathMulti(starts, target, obstacles, walls, playerRadius).reachable;
}

if (typeof module != "undefined") module.exports = {
  findPath,
  findPathMulti,
  isReachable,
  isReachableMulti,
  inflateObstacles,
  inflateWalls,
  segmentIntersectsCircle,
  externalTangentLines,
  pointCircleTangentPoints,
};
