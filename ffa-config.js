"use strict";

const FFA_CONFIG = {
    size: 1500,
    armWidth: 900,
    holeSize: 300,
    gravity: 0.015,
    speed: 4,
    positions: [[450, 1350], [1050, 1350], [150, 450], [150, 1050], [1350, 450], [1350, 1050], [450, 150], [1050, 150], [750, 450]],
    shrinkStages: [
        { players: 5, size: 900, zoom: 1.45 },
        { players: 2, size: 600, holeSize: 200, zoom: 1.8 },
    ],
};

function createFFABattle(ballClasses, seed, createBallFn, BallBattle) {
    const { size, armWidth, holeSize, gravity, speed, positions } = FFA_CONFIG;
    const rng = new Math.seedrandom(seed);

    const pos = [...positions];
    for (let i = pos.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pos[i], pos[j]] = [pos[j], pos[i]];
    }

    const combatants = ballClasses
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.name !== "Duplicator")
        .map(({ i }) => i);

    let balls = combatants.map((i, j) => createBallFn(ballClasses, i, pos[j], rng, speed));
    // balls = balls.filter((b) => !(b instanceof GrimoireBall));

    const battle = new BallBattle(balls, seed, gravity);
    battle.walls = createPlusArenaWalls(size, armWidth, holeSize);
    battle.corners = plusArenaCorners(size, armWidth, holeSize);
    battle.shrinkConfig = {
        baseSize: size,
        baseArmWidth: armWidth,
        holeSize,
        stages: FFA_CONFIG.shrinkStages,
    };

    const armStart = (size - armWidth) / 2, armEnd = (size + armWidth) / 2;
    battle.isInBounds = (x, y, r) => plusArenaInBoundsFromWalls(x, y, r, battle.walls, battle.corners);

    return { battle, combatants, armStart, armEnd };
}

function createFFABall(ballClasses, i, pos, rng, speed) {
    const data = ballClasses[i];
    const spinArgs = data.weapon?.spin ? [
        pos[0] < 200 ? 0 : Math.PI,
        pos[0] < 200 ? 1 : -1,
    ] : [];
    const theta = rng() * 2 * Math.PI;
    const hp = data.name === "Mirror" ? 100 : data.hp;
    const b = new data.class(pos[0], pos[1], Math.cos(theta) * speed, Math.sin(theta) * speed, ...spinArgs, hp, undefined, data.color);
    b.maxHp = hp;
    return b;
}

if (typeof module !== 'undefined') {
    module.exports = { FFA_CONFIG, createFFABattle, createFFABall };
}
