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
global.GrowerBall = GrowerBall;
global.DaggerBall = DaggerBall;
global.SwordBall = SwordBall;
global.LanceBall = LanceBall;
global.MachineGunBall = MachineGunBall;
global.DuplicatorBall = DuplicatorBall;
global.WrenchBall = WrenchBall;
global.GrimoireBall = GrimoireBall;
global.MirrorBall = MirrorBall;
global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createPlusArenaWalls = createPlusArenaWalls;
global.ballClasses = ballClasses;
`;

eval(code);
const { FFA_CONFIG, createFFABattle, createFFABall } = require('./ffa-config.js');

const BALL_TYPES = global.ballClasses.filter(b => b.name !== "Duplicator");
const MAX_TICKS = 15000;
const MATCHES = 1000;

function simulate() {
    const seed = Date.now() + Math.random();
    const { size } = FFA_CONFIG;

    const result = createFFABattle(global.ballClasses, seed, createFFABall, global.BallBattle, global.createPlusArenaWalls);
    const battle = result.battle;

    battle.width = battle.height = size;
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    global.t = 0;

    // Track all balls before any die
    const allBalls = battle.balls.filter(b => !b.owner);

    let grimMirrorStalemate = false;
    for (let i = 0; i < MAX_TICKS && battle.balls.filter(b => !b.owner).length > 1; i++) {
        global.t++;
        battle.updateTimeScale();
        battle.update();

        const alive = battle.balls.filter(b => !b.owner);
        if (alive.length === 2 &&
            alive.every(b => (b instanceof GrimoireBall || b instanceof MirrorBall) && b.hp > 20)) {
            grimMirrorStalemate = true;
            alive.sort((a, b) => b.hp - a.hp);
            if (alive[0].hp > alive[1].hp) alive[1].hp = 0;
            else { alive[0].hp = 0; alive[1].hp = 0; } // draw: kill both
            battle.processDeaths();
            break;
        }
    }

    const winner = battle.balls.find(b => !b.owner);
    const winnerIdx = winner ? BALL_TYPES.findIndex(t => t.color === winner.team) : -1;
    const damages = BALL_TYPES.map(t => {
        const b = allBalls.find(ball => ball.team === t.color);
        return b ? b.damageDealt : 0;
    });

    return { winnerIdx, damages, grimMirrorStalemate };
}

if (!isMainThread) {
    const { count } = workerData;
    const wins = new Array(BALL_TYPES.length).fill(0);
    const totalDmg = new Array(BALL_TYPES.length).fill(0);
    const totalDmgSq = new Array(BALL_TYPES.length).fill(0);
    let stalemateCount = 0;

    for (let i = 0; i < count; i++) {
        const { winnerIdx, damages, grimMirrorStalemate } = simulate();
        if (winnerIdx >= 0) wins[winnerIdx]++;
        damages.forEach((d, j) => { totalDmg[j] += d; totalDmgSq[j] += d * d; });
        if (grimMirrorStalemate) stalemateCount++;
    }
    parentPort.postMessage({ type: 'done', wins, totalDmg, totalDmgSq, count, stalemateCount });
} else {
    const NUM_WORKERS = os.cpus().length;
    // const NUM_WORKERS = 3;

    (async () => {
        const perWorker = Math.floor(MATCHES / NUM_WORKERS);
        const remainder = MATCHES % NUM_WORKERS;

        let completed = 0;
        const promises = [];
        for (let i = 0; i < NUM_WORKERS; i++) {
            const count = perWorker + (i < remainder ? 1 : 0);
            if (count === 0) continue;
            promises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { count } });
                worker.on('message', msg => {
                    if (msg.type === 'progress') {
                        completed++;
                        process.stdout.write(`\rProgress: ${completed}/${MATCHES} (${(completed / MATCHES * 100).toFixed(1)}%)`);
                    } else if (msg.type === 'done') {
                        resolve(msg);
                    }
                });
                worker.on('error', reject);
            }));
        }

        console.log(`Simulating ${MATCHES} FFA battles...`);
        const results = await Promise.all(promises);
        console.log('\n');

        const wins = new Array(BALL_TYPES.length).fill(0);
        const totalDmg = new Array(BALL_TYPES.length).fill(0);
        const totalDmgSq = new Array(BALL_TYPES.length).fill(0);
        let totalMatches = 0;
        let totalStalemateCount = 0;

        results.forEach(r => {
            r.wins.forEach((w, i) => wins[i] += w);
            r.totalDmg.forEach((d, i) => totalDmg[i] += d);
            r.totalDmgSq.forEach((d, i) => totalDmgSq[i] += d);
            totalMatches += r.count;
            totalStalemateCount += r.stalemateCount;
        });

        console.log('=== FFA RESULTS ===\n');
        console.log(`Grimoire/Mirror stalemates: ${totalStalemateCount}/${totalMatches}\n`);
        const stats = BALL_TYPES.map((t, i) => ({
            name: t.name,
            wins: wins[i],
            winrate: (wins[i] / totalMatches * 100).toFixed(1),
            avgDmg: Math.round(totalDmg[i] / totalMatches),
            stdDmg: Math.round(Math.sqrt(totalDmgSq[i] / totalMatches - (totalDmg[i] / totalMatches) ** 2))
        })).sort((a, b) => b.wins - a.wins);

        console.log('Name'.padEnd(12) + 'Wins'.padStart(6) + 'Winrate'.padStart(10) + 'Avg Dmg'.padStart(10) + 'Std Dmg'.padStart(10));
        console.log('-'.repeat(48));
        stats.forEach(s => {
            console.log(s.name.padEnd(12) + String(s.wins).padStart(6) + (s.winrate + '%').padStart(10) + String(s.avgDmg).padStart(10) + String(s.stdDmg).padStart(10));
        });
    })();
}
