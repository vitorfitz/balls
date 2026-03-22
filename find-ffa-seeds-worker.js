importScripts('seedrandom.js', 'index.js');

const MAX_TICKS = 15000;
const POSITIONS = [[150, 450], [150, 1050], [1350, 450], [1350, 1050], [450, 150], [1050, 150]];

// Match ui.js: get indices of non-Duplicator balls
const combatants = [];
for (let i = 0; i < ballClasses.length; i++) {
    if (ballClasses[i].class !== DuplicatorBall) combatants.push(i);
}

function simulate(seed) {
    const rng = new Math.seedrandom(seed);
    const size = 1500, armWidth = 900, holeSize = 300;

    // Match ui.js: makeBall(i, positions[j], rng, 5)
    const balls = combatants.map((i, j) => {
        const data = ballClasses[i];
        const [x, y] = POSITIONS[j];
        const spinArgs = data.weapon?.spin ? [
            x < 200 ? 0 : Math.PI,
            x < 200 ? 1 : -1,
        ] : [];
        const theta = rng() * 2 * Math.PI;
        const b = new data.class(x, y, Math.cos(theta) * 5, Math.sin(theta) * 5, ...spinArgs, data.hp);
        return b;
    });

    const battle = new BallBattle(balls, seed, 0.05);
    battle.width = battle.height = size;
    battle.walls = createPlusArenaWalls(size, armWidth, holeSize);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    battle.shrinkConfig = {
        baseSize: size, baseArmWidth: armWidth, holeSize,
        stages: [
            { players: 4, size: 900, zoom: 1.45 },
            { players: 2, size: 600, holeSize: 200, zoom: 1.8 },
        ]
    };
    const armStart = (size - armWidth) / 2, armEnd = (size + armWidth) / 2;
    const hs = (size - holeSize) / 2, he = (size + holeSize) / 2;
    battle.isInBounds = (x, y, r) => {
        if (x - r < 0 || x + r > size || y - r < 0 || y + r > size) return false;
        if (x + r > hs && x - r < he && y + r > hs && y - r < he) return false;
        return (x - r >= armStart && x + r <= armEnd) || (y - r >= armStart && y + r <= armEnd);
    };
    t = 0;

    for (let i = 0; i < MAX_TICKS && battle.balls.filter(b => !b.owner).length > 1; i++) {
        t++;
        battle.updateTimeScale();
        battle.update();
    }

    const winner = battle.balls.find(b => !b.owner);
    if (!winner) return null;

    const winnerData = ballClasses.find(b => b.color === winner.team);
    return { winnerName: winnerData.name, hp: Math.ceil(winner.hp), ticks: t };
}

onmessage = (e) => {
    const { matches, threshold, debugSeed } = e.data;

    if (debugSeed !== undefined) {
        const result = simulate(debugSeed, true);
        postMessage({ result: `Debug seed ${debugSeed}: ${result?.winnerName} wins with ${result?.hp} HP` });
        return;
    }

    const dramatic = [];

    for (let seed = 0; seed < matches; seed++) {
        if (seed % 50 === 0) {
            postMessage({ progress: `Searching... ${seed}/${matches} (found ${dramatic.length})` });
        }

        const result = simulate(seed);
        if (result && result.hp <= threshold) {
            dramatic.push({ seed, ...result });
        }
    }

    let output = `Found ${dramatic.length} dramatic seeds (HP <= ${threshold}):\n\n`;
    dramatic.sort((a, b) => a.hp - b.hp).forEach(r => {
        output += `Seed ${r.seed}: ${r.winnerName} wins with ${r.hp} HP (${r.ticks} ticks)\n`;
    });

    output += '\n// Seeds array:\nconst FFA_DRAMATIC_SEEDS = ' + JSON.stringify(dramatic.map(r => r.seed)) + ';';

    postMessage({ result: output });
};
