"use strict";

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

global.Image = class { onload() { } onerror() { } set src(v) { setTimeout(() => this.onload(), 0); } };

const fs = require('fs');

let code = fs.readFileSync('./index.js', 'utf8');
code = code.replace(/const d = new Date.*?Math\.seedrandom\(d\);/s, '');
code = code.replace(/const balls = \[[\s\S]*$/s, '');
code = code.replace(/"use strict"/, '');

code += `
global.DaggerBall = DaggerBall;
global.SwordBall = SwordBall;
global.LanceBall = LanceBall;
global.MachineGunBall = MachineGunBall;
global.DuplicatorBall = DuplicatorBall;
global.WrenchBall = WrenchBall;
global.GrimoireBall = GrimoireBall;
global.BallBattle = BallBattle;
global.randomVel = randomVel;
`;

eval(code);

const BALL_TYPES = [
    { name: 'Dagger', create: () => new global.DaggerBall(50, 200, ...global.randomVel(5), 0, 1, 100) },
    { name: 'Sword', create: () => new global.SwordBall(50, 200, ...global.randomVel(5), 0, 1, 100) },
    { name: 'Lance', create: () => new global.LanceBall(50, 200, ...global.randomVel(5), 100) },
    { name: 'MachineGun', create: () => new global.MachineGunBall(50, 200, ...global.randomVel(5), 0, 1, 100) },
    { name: 'Duplicator', create: () => new global.DuplicatorBall(50, 200, ...global.randomVel(5), 50) },
    { name: 'Wrench', create: () => new global.WrenchBall(50, 200, ...global.randomVel(5), 0, 1, 100) },
    { name: 'Grimoire', create: () => new global.GrimoireBall(50, 200, ...global.randomVel(5), 0, 1, 100) }
];

const MAX_TICKS = 10000;
const MATCHES = 500;

function simulate(t1Idx, t2Idx) {
    const b1 = BALL_TYPES[t1Idx].create(), b2 = BALL_TYPES[t2Idx].create();
    b2.x = 350;
    if (b2.weapons[0]) b2.weapons[0].theta = Math.PI;

    const battle = new global.BallBattle([b1, b2]);
    battle.width = 400; battle.height = 400;
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: 400, height: 400 };

    for (let i = 0; i < MAX_TICKS && battle.balls.length > 1; i++) {
        battle.update();
        const p1Alive = battle.balls.some(b => b.team === b1.team);
        const p2Alive = battle.balls.some(b => b.team === b2.team);
        if (p1Alive && !p2Alive) return 'p1';
        if (p2Alive && !p1Alive) return 'p2';
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
                const { w1, w2, draws } = await runMatchup(i, j);
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
