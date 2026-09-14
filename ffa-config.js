"use strict";

const FFA_CONFIG = {
    size: 1500,
    armWidth: 900,
    holeSize: 300,
    gravity: 0.0,
    speed: 5,
    positions: [[450, 1350], [1050, 1350], [150, 450], [150, 1050], [1350, 450], [1350, 1050], [450, 150], [1050, 150], [750, 450], [750, 1050]],
    shrinkStages: [
        { players: 6, size: 900, zoom: 1.45 },
        { players: 3, size: 600, holeSize: 200, zoom: 1.8 },
    ],
};

function createFFABattle(ballClasses, seed, createBallFn, BallBattle, excludeIdx = null, excludeCount = 1) {
    const { size, armWidth, holeSize, gravity, speed, positions } = FFA_CONFIG;
    const rng = new Math.seedrandom(seed);

    const eligible = ballClasses
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.name !== "Duplicator")
        .map(({ i }) => i);

    // Exclude `excludeCount` balls so the roster fits within `positions.length`.
    // Drawn before the position shuffle so it's stable regardless of how many
    // positions exist. Callers that need an exact, evenly-distributed exclusion
    // across many battles (e.g. bulk simulation) can pass `excludeIdx` (a single
    // index, or an array of indices into `eligible`) instead of leaving it to be
    // drawn from `rng`.
    let chosenExcludeIdxs;
    if (excludeIdx != null) {
        chosenExcludeIdxs = Array.isArray(excludeIdx) ? excludeIdx : [excludeIdx];
    } else {
        chosenExcludeIdxs = [];
        const pool = [...eligible.keys()];
        for (let i = 0; i < excludeCount && pool.length > 0; i++) {
            const j = Math.floor(rng() * pool.length);
            chosenExcludeIdxs.push(pool[j]);
            pool.splice(j, 1);
        }
    }
    const excludeSet = new Set(chosenExcludeIdxs);
    const combatants = eligible.filter((_, j) => !excludeSet.has(j));

    const pos = [...positions];
    shuffle(pos, rng);

    let balls = combatants.map((i, j) => createBallFn(ballClasses, i, pos[j], rng, speed));
    // balls = balls.filter((b) => !(b instanceof GrimoireBall));

    const battle = new BallBattle(balls, seed, gravity, FFA);
    battle.walls = createPlusArenaWalls(size, armWidth, holeSize);
    battle.corners = plusArenaCorners(size, armWidth, holeSize);
    battle.shrinkConfig = {
        baseSize: size,
        baseArmWidth: armWidth,
        holeSize,
        stages: FFA_CONFIG.shrinkStages,
    };

    const armStart = (size - armWidth) / 2, armEnd = (size + armWidth) / 2;
    battle.inArenaBounds = (x, y, r) => plusArenainRectBoundsFromWalls(x, y, r, battle.walls, battle.corners);

    return { battle, combatants, armStart, armEnd };
}

function createFFABall(ballClasses, i, pos, rng, speed) {
    const data = ballClasses[i];
    const spinArgs = data.weapon?.spin ? [
        rng() * 2 * Math.PI,
        rng() < 0.5 ? 1 : -1,
    ] : [];
    const theta = rng() * 2 * Math.PI;
    const b = new data.class(pos[0], pos[1], Math.cos(theta) * speed, Math.sin(theta) * speed, ...spinArgs, data.hp, undefined, data.color);
    b.maxHp = data.hp;
    return b;
}

if (typeof module !== 'undefined') {
    module.exports = { FFA_CONFIG, createFFABattle, createFFABall };
}
