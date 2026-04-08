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
global.GrowerBall = GrowerBall;
global.HammerBall = HammerBall;
global.Ball = Ball;
global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createBorderWalls = createBorderWalls;
`;

eval(code);

class DummyBall extends global.Ball {
    constructor(x, y) {
        super(x, y, 0, 0, 999, 25, "#888888");
    }
}

const BALL_TYPES = [
    { name: 'Dagger', create: (rng) => new global.DaggerBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Lance', create: (rng) => new global.LanceBall(50, 200, ...global.randomVel(5, rng), 100) },
    { name: 'Machine Gun', create: (rng) => new global.MachineGunBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Wrench', create: (rng) => new global.WrenchBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Sword', create: (rng) => new global.SwordBall(50, 200, ...global.randomVel(5, rng), 0, 1, 100) },
    { name: 'Grower', create: (rng) => new global.GrowerBall(50, 200, ...global.randomVel(5, rng), 100) },
    { name: 'Hammer', create: (rng) => new global.HammerBall(50, 200, ...global.randomVel(5, rng), 100) },
];

const MAX_TICKS = 50000;
const MATCHES = 1000;
const THRESHOLDS = [20, 100, 500];

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

    const results = [];
    let threshIdx = 0;

    for (let tick = 1; tick <= MAX_TICKS; tick++) {
        global.t = tick;
        battle.update();
        while (threshIdx < THRESHOLDS.length && attacker.damageDealt >= THRESHOLDS[threshIdx]) {
            results.push(tick);
            threshIdx++;
        }
        if (threshIdx === THRESHOLDS.length) break;
    }

    while (results.length < THRESHOLDS.length) results.push(MAX_TICKS);
    return results;
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
        console.log(`Simulating ${MATCHES} matches per ball type...\n`);
        const header = 'Ball Type     | ' + THRESHOLDS.map(t => `dmg≥${t}`.padStart(13)).join(' | ');
        console.log(header);
        console.log('-'.repeat(header.length));

        for (let i = 0; i < BALL_TYPES.length; i++) {
            const allResults = await runTests(i);
            const cols = THRESHOLDS.map((_, ti) => {
                const vals = allResults.map(r => r[ti]);
                const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                const std = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
                return `${avg.toFixed(0).padStart(5)}` + `(±${std.toFixed(0)})`.padStart(8);
            });
            console.log(`${BALL_TYPES[i].name.padEnd(13)} | ${cols.join(' | ')}`);
        }
    })();
}
