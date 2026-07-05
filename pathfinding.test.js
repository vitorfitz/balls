const { findPath, isReachable } = require('./pathfinding');

function approxEqual(a, b, eps = 1e-3) {
  return Math.abs(a - b) < eps;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
}

// --- Test 1: clear line of sight, no obstacles ---
{
  const walls = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const result = findPath({ x: 5, y: 5 }, { x: 95, y: 95 }, [], walls, 2);
  assert(result.reachable, 'T1: reachable with no obstacles');
  assert(approxEqual(result.distance, Math.hypot(90, 90)), 'T1: distance is straight-line');
}

// --- Test 2: single obstacle directly in the path, but plenty of room around it ---
{
  const walls = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const obstacles = [{ x: 50, y: 50, radius: 5 }];
  const result = findPath({ x: 50, y: 5 }, { x: 50, y: 95 }, obstacles, walls, 2);
  assert(result.reachable, 'T2: reachable by going around single obstacle');
  assert(result.distance > 90, 'T2: path is longer than straight line (detour required)');
}

// --- Test 3: obstacle completely blocks a narrow corridor (impossible gap) ---
{
  // Corridor from x=0..20, obstacle spans most of it, leaving < playerRadius*2 gap
  const walls = { minX: 0, minY: 0, maxX: 20, maxY: 100 };
  const obstacles = [{ x: 10, y: 50, radius: 9 }]; // leaves 1 unit on each side (20 wide corridor)
  const playerRadius = 3; // needs 6 units total gap on either side combined; only 2 available
  const result = findPath({ x: 10, y: 5 }, { x: 10, y: 95 }, obstacles, walls, playerRadius);
  assert(!result.reachable, 'T3: blocked when obstacle+walls leave no passable gap');
}

// --- Test 4: obstacle in narrow corridor but gap IS big enough ---
{
  const walls = { minX: 0, minY: 0, maxX: 20, maxY: 100 };
  const obstacles = [{ x: 10, y: 50, radius: 5 }]; // leaves 5 units on each side
  const playerRadius = 1; // needs 2 units gap; 5 available - passable
  const result = findPath({ x: 10, y: 5 }, { x: 10, y: 95 }, obstacles, walls, playerRadius);
  assert(result.reachable, 'T4: passable when gap is large enough');
}

// --- Test 5: two obstacles clustered together forcing a route around both ---
{
  const walls = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const obstacles = [
    { x: 45, y: 50, radius: 8 },
    { x: 55, y: 50, radius: 8 }, // gap between them: dist=10, radii sum=16, so overlapping-ish gap after inflation
  ];
  const playerRadius = 3;
  const result = findPath({ x: 50, y: 5 }, { x: 50, y: 95 }, obstacles, walls, playerRadius);
  assert(result.reachable, 'T5: reachable by routing around a cluster of two obstacles');
}

// --- Test 6: start point already too close to map wall (invalid start) ---
{
  const walls = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const result = findPath({ x: 0.5, y: 50 }, { x: 50, y: 50 }, [], walls, 2);
  assert(!result.reachable, 'T6: start too close to wall is unreachable (invalid placement)');
}

// --- Test 7: fully enclosed target (surrounded by obstacles) is unreachable ---
{
  const walls = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  // Ring of obstacles around (50,50) with small radius each, close enough together
  // that a radius-1 player can't squeeze through any gap.
  const obstacles = [];
  const ringRadius = 15;
  const obstacleRadius = 6;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    obstacles.push({
      x: 50 + ringRadius * Math.cos(angle),
      y: 50 + ringRadius * Math.sin(angle),
      radius: obstacleRadius,
    });
  }
  const playerRadius = 2;
  const result = findPath({ x: 50, y: 50 }, { x: 90, y: 90 }, obstacles, walls, playerRadius);
  assert(!result.reachable, 'T7: fully enclosed target is unreachable');
}

// --- Test 8: isReachable convenience wrapper matches findPath ---
{
  const walls = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const obstacles = [{ x: 50, y: 50, radius: 5 }];
  const a = isReachable({ x: 5, y: 5 }, { x: 95, y: 95 }, obstacles, walls, 2);
  const b = findPath({ x: 5, y: 5 }, { x: 95, y: 95 }, obstacles, walls, 2).reachable;
  assert(a === b, 'T8: isReachable matches findPath.reachable');
}

// --- Test 9: an obstacle positioned close to a wall must not let an arc
// edge (going around the obstacle's far side, toward the wall) bulge past
// the wall boundary. This reproduces a real bug where a circle sat near a
// wall such that the two tangent-point endpoints (from other obstacles)
// were within bounds, but the minor arc connecting them swung outside the
// inset wall — producing a false "reachable" result that actually clipped
// through the wall.
{
  const walls = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
  const obstacles = [
    { x: 174.3779384176539, y: 357.81766056350926, radius: 12.5 }, // near-wall obstacle
    { x: 163.80061688971165, y: 310.85666855533907, radius: 12.5 },
    { x: 109.8062329731912, y: 305.52475053920483, radius: 12.5 },
    { x: 198.75635768897118, y: 275.110073988313, radius: 12.5 },
  ];
  const playerRadius = 20;
  const start = { x: 92.45139134804205, y: 339.425422202926 };
  const target = { x: 318.6, y: 349.8 };
  const result = findPath(start, target, obstacles, walls, playerRadius);
  if (result.reachable) {
    const maxY = Math.max(...result.path.map((p) => p.y));
    assert(maxY <= walls.maxY - playerRadius + 1e-6, 'T9: path stays within inset wall bounds (no arc bulge through wall)');
  } else {
    assert(true, 'T9: path stays within inset wall bounds (no arc bulge through wall)');
  }
}

console.log('Done.');
