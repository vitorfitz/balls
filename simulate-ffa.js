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
global.DuplicatorBall = DuplicatorBall;
global.WrenchBall = WrenchBall;
global.GrimoireBall = GrimoireBall;
global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createPlusArenaWalls = createPlusArenaWalls;
`;

eval(code);

const BALL_TYPES = [
    { name: 'Dagger', class: global.DaggerBall, color: '#5fbf00', spin: true },
    { name: 'Lance', class: global.LanceBall, color: '#dfbf9f', spin: false },
    { name: 'Machine Gun', class: global.MachineGunBall, color: '#61a3e9', spin: true },
    { name: 'Wrench', class: global.WrenchBall, color: '#ff9933', spin: true },
    { name: 'Grimoire', class: global.GrimoireBall, color: '#a3a3c6', spin: true },
    { name: 'Sword', class: global.SwordBall, color: '#ff6464', spin: true },
];

const POSITIONS = [[150, 450], [150, 1050], [1350, 450], [1350, 1050], [450, 150], [1050, 150]];
const MAX_TICKS = 15000;
const MATCHES = 500;

function simulate() {
    const seed = Date.now() + Math.random();
    const rng = new Math.seedrandom(seed);
    const size = 1500, armWidth = 900, holeSize = 300;

    const balls = BALL_TYPES.map((t, i) => {
        const [x, y] = POSITIONS[i];
        const theta = rng() * 2 * Math.PI;
        const vx = Math.cos(theta) * 5, vy = Math.sin(theta) * 5;
        const spinArgs = t.spin ? [0, 1] : [];
        return new t.class(x, y, vx, vy, ...spinArgs, 100);
    });

    const battle = new global.BallBattle(balls, seed, 0.05);
    battle.width = battle.height = size;
    battle.walls = global.createPlusArenaWalls(size, armWidth, holeSize);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    battle.shrinkConfig = {
        baseSize: size, baseArmWidth: armWidth, holeSize,
        stages: [
            { players: 4, size: 900, zoom: 1.45 },
            { players: 2, size: 600, holeSize: 200, zoom: 1.8 },
        ]
    };
    battle.isInBounds = () => true;
    global.t = 0;

    for (let i = 0; i < MAX_TICKS && battle.balls.filter(b => !b.owner).length > 1; i++) {
        global.t++;
        battle.updateTimeScale();
        battle.update();
    }

    const winner = battle.balls.find(b => !b.owner);
    const winnerIdx = winner ? BALL_TYPES.findIndex(t => t.color === winner.team) : -1;
    const damages = BALL_TYPES.map(t => {
        const b = balls.find(ball => ball.team === t.color);
        return b ? b.damageDealt : 0;
    });

    return { winnerIdx, damages };
}

if (!isMainThread) {
    const { count } = workerData;
    const wins = new Array(BALL_TYPES.length).fill(0);
    const totalDmg = new Array(BALL_TYPES.length).fill(0);

    for (let i = 0; i < count; i++) {
        const { winnerIdx, damages } = simulate();
        if (winnerIdx >= 0) wins[winnerIdx]++;
        damages.forEach((d, j) => totalDmg[j] += d);
    }
    parentPort.postMessage({ wins, totalDmg, count });
} else {
    const NUM_WORKERS = os.cpus().length;

    (async () => {
        const perWorker = Math.floor(MATCHES / NUM_WORKERS);
        const remainder = MATCHES % NUM_WORKERS;

        const promises = [];
        for (let i = 0; i < NUM_WORKERS; i++) {
            const count = perWorker + (i < remainder ? 1 : 0);
            if (count === 0) continue;
            promises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { count } });
                worker.on('message', resolve);
                worker.on('error', reject);
            }));
        }

        console.log(`Simulating ${MATCHES} FFA battles...\n`);
        const results = await Promise.all(promises);

        const wins = new Array(BALL_TYPES.length).fill(0);
        const totalDmg = new Array(BALL_TYPES.length).fill(0);
        let totalMatches = 0;

        results.forEach(r => {
            r.wins.forEach((w, i) => wins[i] += w);
            r.totalDmg.forEach((d, i) => totalDmg[i] += d);
            totalMatches += r.count;
        });

        console.log('=== FFA RESULTS ===\n');
        const stats = BALL_TYPES.map((t, i) => ({
            name: t.name,
            wins: wins[i],
            winrate: (wins[i] / totalMatches * 100).toFixed(1),
            avgDmg: Math.round(totalDmg[i] / totalMatches)
        })).sort((a, b) => b.wins - a.wins);

        console.log('Name'.padEnd(12) + 'Wins'.padStart(6) + 'Winrate'.padStart(10) + 'Avg Dmg'.padStart(10));
        console.log('-'.repeat(38));
        stats.forEach(s => {
            console.log(s.name.padEnd(12) + String(s.wins).padStart(6) + (s.winrate + '%').padStart(10) + String(s.avgDmg).padStart(10));
        });
    })();
}
