"use strict";

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

global.Image = class { onload() { } onerror() { } set src(v) { setTimeout(() => this.onload(), 0); } };

const seedrandom = require('./seedrandom.js');
Math.seedrandom = seedrandom;

const fs = require('fs');

let code = fs.readFileSync('./index.js', 'utf8');
code = code.replace(/const d = new Date.*?Math\.seedrandom\(d\);/s, '');
code = code.replace(/const balls = \[[\s\S]*$/s, '');

code += `
global.DaggerBall = DaggerBall;
global.GrowerBall = GrowerBall;
global.SwordBall = SwordBall;
global.LanceBall = LanceBall;
global.MachineGunBall = MachineGunBall;
global.DuplicatorBall = DuplicatorBall;
global.WrenchBall = WrenchBall;
global.GrimoireBall = GrimoireBall;
global.MirrorBall = MirrorBall;

global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createBorderWalls = createBorderWalls;
`;

eval(code);

const BALL_TYPES = [
    { name: 'Duplicator', create: (pos, rng) => new global.DuplicatorBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), 100) },
    { name: 'Grower', create: (pos, rng) => new global.GrowerBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), 100) },
    { name: 'Dagger', create: (pos, rng) => new global.DaggerBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1, 100) },
    { name: 'Lance', create: (pos, rng) => new global.LanceBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), 100) },
    { name: 'Machine Gun', create: (pos, rng) => new global.MachineGunBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1, 100) },
    { name: 'Wrench', create: (pos, rng) => new global.WrenchBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1, 100) },
    { name: 'Grimoire', create: (pos, rng) => new global.GrimoireBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1, 100) },
    { name: 'Sword', create: (pos, rng) => new global.SwordBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1, 100) },
    { name: 'Mirror', create: (pos, rng) => new global.MirrorBall(pos == 0 ? 50 : 350, 200, ...global.randomVel(5, rng), pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1, 100) }
];

const MAX_TICKS = 10000;
const MATCHES = 1000;

function simulate(t1Idx, t2Idx) {
    const rng = new Math.seedrandom();
    const b1 = BALL_TYPES[t1Idx].create(0, rng), b2 = BALL_TYPES[t2Idx].create(1, rng);

    const battle = new global.BallBattle([b1, b2]);
    battle.width = 400; battle.height = 400;
    battle.walls = createBorderWalls(400, 400);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: 400, height: 400 };
    global.t = 0;

    for (let i = 0; i < MAX_TICKS && battle.balls.length > 1; i++) {
        global.t++;
        battle.update();
        const p1 = battle.balls.find(b => b.team === b1.team && !b.owner);
        const p2 = battle.balls.find(b => b.team === b2.team && !b.owner);
        if (p1 && !p2) return 'p1';
        if (p2 && !p1) return 'p2';
    }
    return 'draw';
}

if (!isMainThread) {
    const { t1Idx, t2Idx, count } = workerData;
    let w1 = 0, w2 = 0, draws = 0;
    for (let i = 0; i < count; i++) {
        const r = simulate(t1Idx, t2Idx);
        if (r === 'p1') w1++; else if (r === 'p2') w2++; else draws++;
    }
    parentPort.postMessage({ w1, w2, draws });
} else {
    const NUM_WORKERS = os.cpus().length;
    // const NUM_WORKERS = 5;

    async function runMatchup(t1Idx, t2Idx) {
        const perWorker = Math.floor(MATCHES / NUM_WORKERS);
        const remainder = MATCHES % NUM_WORKERS;

        const promises = [];
        for (let i = 0; i < NUM_WORKERS; i++) {
            const count = perWorker + (i < remainder ? 1 : 0);
            if (count === 0) continue;
            promises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { t1Idx, t2Idx, count } });
                worker.on('message', resolve);
                worker.on('error', reject);
            }));
        }

        const results = await Promise.all(promises);
        return results.reduce((acc, r) => ({ w1: acc.w1 + r.w1, w2: acc.w2 + r.w2, draws: acc.draws + r.draws }), { w1: 0, w2: 0, draws: 0 });
    }

    (async () => {
        const results = {};
        BALL_TYPES.forEach(t => results[t.name] = { wins: 0, losses: 0, draws: 0 });

        console.log(`Simulating ${MATCHES} matches per matchup...\n`);

        for (let i = 0; i < BALL_TYPES.length; i++) {
            for (let j = i + 1; j < BALL_TYPES.length; j++) {
                // if (i != 2 && j != 2) continue;
                if (i == 6 && j == 8) continue;

                let w1, w2, draws;
                if (i == 0 && j == 8 /* Dupe vs Mirror */) { w1 = MATCHES * 0.4; w2 = MATCHES * 0.6; draws = 0 }
                else if (i == 0 && j == 6 /* Dupe vs Grim */) { w1 = MATCHES * 0.8; w2 = MATCHES * 0.2; draws = 0 }
                else
                    ({ w1, w2, draws } = await runMatchup(i, j));
                const t1 = BALL_TYPES[i], t2 = BALL_TYPES[j];

                results[t1.name].wins += w1; results[t1.name].losses += w2; results[t1.name].draws += draws;
                results[t2.name].wins += w2; results[t2.name].losses += w1; results[t2.name].draws += draws;

                console.log(`${t1.name} vs ${t2.name}: ${w1}-${w2}-${draws}`);
            }
        }

        console.log('\n=== RANKINGS ===');
        Object.entries(results)
            .map(([name, r]) => ({ name, ...r, score: r.wins - r.losses }))
            .sort((a, b) => b.score - a.score)
            .forEach((r, i) => console.log(`${i + 1}. ${r.name}: ${r.wins}W-${r.losses}L-${r.draws}D (score: ${r.score})`));
    })();
}
