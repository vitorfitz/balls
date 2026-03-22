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
global.SwordBall = SwordBall;
global.LanceBall = LanceBall;
global.MachineGunBall = MachineGunBall;
global.WrenchBall = WrenchBall;
global.Ball = Ball;
global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createBorderWalls = createBorderWalls;
`;

eval(code);

// Dummy ball - 100 HP, does nothing
class DummyBall extends global.Ball {
    constructor(x, y) {
        super(x, y, 0, 0, 100, 25, "#888888");
    }
}

const BALL_TYPES = [
    { name: 'Dagger', create: (rng) => new global.DaggerBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Lance', create: (rng) => new global.LanceBall(50, 200, ...global.randomVel(5, rng), 100) },
    { name: 'Machine Gun', create: (rng) => new global.MachineGunBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Wrench', create: (rng) => new global.WrenchBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Sword', create: (rng) => new global.SwordBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) }
];

const MAX_TICKS = 20000;
const MATCHES = 500;

function simulate(typeIdx) {
    const rng = new Math.seedrandom();
    const attacker = BALL_TYPES[typeIdx].create(rng);
    const dummy = new DummyBall(350, 200);

    const battle = new global.BallBattle([attacker, dummy]);
    battle.width = 400; battle.height = 400;
    battle.walls = global.createBorderWalls(400, 400);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: 400, height: 400 };
    global.t = 0;

    for (let tick = 1; tick <= MAX_TICKS; tick++) {
        global.t = tick;
        battle.update();
        if (dummy.hp <= 0) return tick;
    }
    return MAX_TICKS; // timeout
}

if (!isMainThread) {
    const { typeIdx, count } = workerData;
    const times = [];
    for (let i = 0; i < count; i++) {
        times.push(simulate(typeIdx));
    }
    parentPort.postMessage(times);
} else {
    const NUM_WORKERS = os.cpus().length;

    async function runTests(typeIdx) {
        const perWorker = Math.floor(MATCHES / NUM_WORKERS);
        const remainder = MATCHES % NUM_WORKERS;

        const promises = [];
        for (let i = 0; i < NUM_WORKERS; i++) {
            const count = perWorker + (i < remainder ? 1 : 0);
            if (count === 0) continue;
            promises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { typeIdx, count } });
                worker.on('message', resolve);
                worker.on('error', reject);
            }));
        }

        const results = await Promise.all(promises);
        return results.flat();
    }

    (async () => {
        console.log(`Simulating ${MATCHES} matches per ball type vs dummy (100 HP)...\n`);
        console.log('Ball Type      | Avg Ticks | Min   | Max   | Std Dev');
        console.log('---------------|-----------|-------|-------|--------');

        for (let i = 0; i < BALL_TYPES.length; i++) {
            const times = await runTests(i);
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            const min = Math.min(...times);
            const max = Math.max(...times);
            const std = Math.sqrt(times.reduce((s, t) => s + (t - avg) ** 2, 0) / times.length);

            console.log(`${BALL_TYPES[i].name.padEnd(14)} | ${avg.toFixed(1).padStart(9)} | ${String(min).padStart(5)} | ${String(max).padStart(5)} | ${std.toFixed(1).padStart(6)}`);
        }
    })();
}
