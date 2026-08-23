"use strict";

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

global.Image = class { onload() { } onerror() { } set src(v) { setTimeout(() => this.onload(), 0); } };

const seedrandom = require('./seedrandom.js');
Math.seedrandom = seedrandom;

const fs = require('fs');

let code = fs.readFileSync('./index.js', 'utf8');
code = code.replace('let t = 0;', 'global.t = 0;');
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
global.HammerBall = HammerBall;
global.ClubBall = ClubBall;
global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createPlusArenaWalls = createPlusArenaWalls;
global.plusArenaCorners = plusArenaCorners;
global.ballClasses = ballClasses;
global.RAID = RAID;
global.shuffle = shuffle;
global.createBorderWalls = createBorderWalls;
`;

eval(code);
const { RAID_CONFIG, createRaidBattle } = require('./raid-config.js');
const { createFFABall } = require('./ffa-config.js');

const BALL_TYPES = global.ballClasses.filter(b => b.name !== "Duplicator");
const MAX_TICKS = 30000;
const MATCHES = 1000;

// Returns true if the boss won, false if raiders won (a raider survived), 'timeout' if neither died out.
function simulate(bossIndex) {
    const seed = Date.now() + Math.random();
    const { size } = RAID_CONFIG;

    const result = createRaidBattle(global.ballClasses, seed, bossIndex, createFFABall, global.BallBattle);
    const battle = result.battle;
    const bossId = result.boss.id;

    battle.width = battle.height = size;
    battle.walls = createBorderWalls(size, size);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    global.t = 0;

    let consecutiveOOB = 0;
    let outcome = 'timeout';

    for (let i = 0; i < MAX_TICKS; i++) {
        global.t++;
        battle.updateTimeScale();
        battle.update();

        const bossAlive = battle.balls.some(b => b.id === bossId);
        const raidersAlive = battle.balls.some(b => !b.owner && b.id !== bossId);

        for (const b of battle.bodies) {
            if (isNaN(b.x) || isNaN(b.y)) throw new Error(`NaN position on ${b.constructor.name}#${b.id} at t=${global.t} seed=${seed}`);
        }

        let outOfBoundsCount = 0;
        for (const b of battle.balls) {
            if (!battle.inRectBounds(b.x, b.y, b.radius - 1)) outOfBoundsCount++;
        }
        if (outOfBoundsCount > 0) {
            consecutiveOOB = (consecutiveOOB || 0) + 1;
            if (consecutiveOOB >= 3) throw new Error(`Ball out of bounds for 3+ ticks at t=${global.t} seed=${seed}`);
        } else {
            consecutiveOOB = 0;
        }

        if (!bossAlive) { outcome = 'raiders'; break; }
        if (!raidersAlive) { outcome = 'boss'; break; }
    }

    return { outcome, seed };
}

if (!isMainThread) {
    const { bossIndex, count } = workerData;
    let bossWins = 0, raiderWins = 0, timeouts = 0;
    const outliers = [];

    for (let i = 0; i < count; i++) {
        if (bossIndex != 1) break;

        const { outcome, seed } = simulate(bossIndex);
        if (outcome === 'boss') bossWins++;
        else if (outcome === 'raiders') raiderWins++;
        else { timeouts++; outliers.push(seed); }
    }
    parentPort.postMessage({ type: 'done', bossWins, raiderWins, timeouts, count, outliers });
} else {
    // const NUM_WORKERS = os.cpus().length;
    const NUM_WORKERS = 3;

    async function runBossMatches(bossIndex) {
        const perWorker = Math.floor(MATCHES / NUM_WORKERS);
        const remainder = MATCHES % NUM_WORKERS;

        const promises = [];
        for (let i = 0; i < NUM_WORKERS; i++) {
            const count = perWorker + (i < remainder ? 1 : 0);
            if (count === 0) continue;
            promises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { bossIndex, count } });
                worker.on('message', msg => { if (msg.type === 'done') resolve(msg); });
                worker.on('error', reject);
            }));
        }

        const results = await Promise.all(promises);
        return results.reduce((acc, r) => ({
            bossWins: acc.bossWins + r.bossWins,
            raiderWins: acc.raiderWins + r.raiderWins,
            timeouts: acc.timeouts + r.timeouts,
            count: acc.count + r.count,
            outliers: acc.outliers.concat(r.outliers),
        }), { bossWins: 0, raiderWins: 0, timeouts: 0, count: 0, outliers: [] });
    }

    (async () => {
        console.log(`Simulating ${MATCHES} raid battles per boss type (${BALL_TYPES.length} boss types)...\n`);

        const stats = [];
        for (let i = 0; i < BALL_TYPES.length; i++) {
            const bossIndex = global.ballClasses.indexOf(BALL_TYPES[i]);
            const r = await runBossMatches(bossIndex);
            const winrate = (r.bossWins / r.count * 100).toFixed(1);
            stats.push({ name: BALL_TYPES[i].name, ...r, winrate });
            console.log(`${BALL_TYPES[i].name.padEnd(12)} boss winrate: ${winrate}%  (${r.bossWins}W-${r.raiderWins}L, ${r.timeouts} timeouts)`);
        }

        console.log('\n=== RAID BOSS WIN RATES ===\n');
        stats.sort((a, b) => b.bossWins - a.bossWins);
        console.log('Boss'.padEnd(12) + 'Winrate'.padStart(10) + 'Wins'.padStart(8) + 'Losses'.padStart(8) + 'Timeouts'.padStart(10));
        console.log('-'.repeat(50));
        stats.forEach(s => {
            console.log(s.name.padEnd(12) + (s.winrate + '%').padStart(10) + String(s.bossWins).padStart(8) + String(s.raiderWins).padStart(8) + String(s.timeouts).padStart(10));
        });

        const allOutliers = stats.flatMap(s => s.outliers.map(seed => ({ name: s.name, seed })));
        if (allOutliers.length > 0) {
            console.log(`\n=== TIMEOUTS (${allOutliers.length}) ===`);
            allOutliers.slice(0, 20).forEach(o => console.log(`  ${o.name} seed=${o.seed}`));
        }
    })();
}
