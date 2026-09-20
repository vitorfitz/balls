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

const ALL_BALL_TYPES = global.ballClasses.filter(b => b.name != "Duplicator");
const MAX_TICKS = 30000;

const cliArgs = process.argv.slice(2);
const bossNameArgs = [];
let argMatches;
for (const arg of cliArgs) {
    const parsed = parseInt(arg, 10);
    if (Number.isInteger(parsed) && parsed > 0 && String(parsed) === arg) {
        argMatches = parsed;
    } else {
        bossNameArgs.push(arg);
    }
}
const MATCHES = Number.isInteger(argMatches) && argMatches > 0 ? argMatches : 1000;

if (bossNameArgs.length > 1) {
    console.error(`Too many boss names given (max 1): ${bossNameArgs.join(', ')}`);
    process.exit(1);
}

function findBossIndex(name) {
    const idx = ALL_BALL_TYPES.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if (idx === -1) {
        console.error(`Unknown ball name: "${name}". Valid names: ${ALL_BALL_TYPES.map(t => t.name).join(', ')}`);
        process.exit(1);
    }
    return idx;
}

const BALL_TYPES = bossNameArgs.length === 1
    ? [ALL_BALL_TYPES[findBossIndex(bossNameArgs[0])]]
    : ALL_BALL_TYPES;

// Returns true if the boss won, false if raiders won (a raider survived), 'timeout' if neither died out.
async function simulate(bossIndex) {
    const seed = Date.now() + Math.random();
    const { size } = RAID_CONFIG;

    const result = createRaidBattle(global.ballClasses, seed, bossIndex, createFFABall, global.BallBattle);
    const battle = result.battle;
    const bossId = result.boss.id;
    const raiderIndices = result.raiderIndices;

    battle.width = battle.height = size;
    battle.walls = createBorderWalls(size, size);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };

    let consecutiveOOB = 0;
    let outcome = 'timeout';

    for (let i = 0; i < MAX_TICKS; i++) {
        battle.updateTimeScale();
        await battle.update();

        const bossAlive = battle.balls.some(b => b.id === bossId);
        const raidersAlive = battle.balls.some(b => !b.owner && b.id !== bossId);

        for (const b of battle.bodies) {
            if (isNaN(b.x) || isNaN(b.y)) throw new Error(`NaN position on ${b.constructor.name}#${b.id} at t=${battle.t} seed=${seed}`);
        }

        let outOfBoundsCount = 0;
        for (const b of battle.balls) {
            if (!battle.inRectBounds(b.x, b.y, b.radius - 1)) outOfBoundsCount++;
        }
        if (outOfBoundsCount > 0) {
            consecutiveOOB = (consecutiveOOB || 0) + 1;
            if (consecutiveOOB >= 3) throw new Error(`Ball out of bounds for 3+ ticks at t=${battle.t} seed=${seed}`);
        } else {
            consecutiveOOB = 0;
        }

        if (!bossAlive) { outcome = 'raiders'; break; }
        if (!raidersAlive) { outcome = 'boss'; break; }
    }

    return { outcome, seed, raiderIndices };
}

if (!isMainThread) {
    (async () => {
        const { bossIndex, count } = workerData;
        let bossWins = 0, raiderWins = 0, timeouts = 0;
        const outliers = [];
        // Per ball-type (indexed like ALL_BALL_TYPES): how many matches it participated
        // in, and of the matches where it was absent, how many the boss won.
        const participated = new Array(ALL_BALL_TYPES.length).fill(0);
        const absentTotal = new Array(ALL_BALL_TYPES.length).fill(0);
        const absentBossWins = new Array(ALL_BALL_TYPES.length).fill(0);

        for (let i = 0; i < count; i++) {
            // if ([12].indexOf(bossIndex) != -1) break;

            const { outcome, seed, raiderIndices } = await simulate(bossIndex);
            if (outcome === 'boss') bossWins++;
            else if (outcome === 'raiders') raiderWins++;
            else { timeouts++; outliers.push(seed); }

            if (outcome !== 'timeout') {
                const raiderSet = new Set(raiderIndices);
                for (let j = 0; j < ALL_BALL_TYPES.length; j++) {
                    const globalIdx = global.ballClasses.indexOf(ALL_BALL_TYPES[j]);
                    if (raiderSet.has(globalIdx)) {
                        participated[j]++;
                    } else {
                        absentTotal[j]++;
                        if (outcome === 'boss') absentBossWins[j]++;
                    }
                }
            }
        }
        parentPort.postMessage({ type: 'done', bossWins, raiderWins, timeouts, count, outliers, participated, absentTotal, absentBossWins });
    })();
} else {
    const NUM_WORKERS = os.cpus().length;
    // const NUM_WORKERS = 3;

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
        const n = ALL_BALL_TYPES.length;
        return results.reduce((acc, r) => ({
            bossWins: acc.bossWins + r.bossWins,
            raiderWins: acc.raiderWins + r.raiderWins,
            timeouts: acc.timeouts + r.timeouts,
            count: acc.count + r.count,
            outliers: acc.outliers.concat(r.outliers),
            participated: acc.participated.map((v, j) => v + r.participated[j]),
            absentTotal: acc.absentTotal.map((v, j) => v + r.absentTotal[j]),
            absentBossWins: acc.absentBossWins.map((v, j) => v + r.absentBossWins[j]),
        }), {
            bossWins: 0, raiderWins: 0, timeouts: 0, count: 0, outliers: [],
            participated: new Array(n).fill(0),
            absentTotal: new Array(n).fill(0),
            absentBossWins: new Array(n).fill(0),
        });
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

        console.log('\n=== BOSS WINRATE WHEN BALL EXCLUDED (- = never/always participated) ===\n');
        const colWidth = 12;
        console.log(''.padEnd(colWidth) + stats.map(s => s.name.slice(0, colWidth - 1).padStart(colWidth)).join(''));
        ALL_BALL_TYPES.forEach((t, j) => {
            const hasData = stats.some(s => {
                const participated = s.participated[j];
                const total = s.count - s.timeouts;
                return participated !== 0 && participated !== total && s.absentTotal[j] !== 0;
            });
            if (!hasData) return;
            const row = stats.map(s => {
                const participated = s.participated[j];
                const total = s.count - s.timeouts;
                if (participated === 0 || participated === total || s.absentTotal[j] === 0) return '-'.padStart(colWidth);
                const winrate = (s.absentBossWins[j] / s.absentTotal[j] * 100).toFixed(1) + '%';
                return winrate.padStart(colWidth);
            }).join('');
            console.log(t.name.padEnd(colWidth) + row);
        });

        // Per-ball average contribution to boss winrate when excluded, relative to that
        // boss's overall winrate. Positive = boss wins more without this ball (ball helps
        // raiders / hurts the boss when present, i.e. the ball is "strong" as a raider).
        // Negative = boss wins less without this ball (ball is a liability to raiders).
        console.log('\n=== AVG RAIDER CONTRIBUTION (boss winrate w/o ball - overall boss winrate) ===\n');
        const contributions = ALL_BALL_TYPES.map((t, j) => {
            const deltas = [];
            stats.forEach(s => {
                const participated = s.participated[j];
                const total = s.count - s.timeouts;
                if (participated === 0 || participated === total || s.absentTotal[j] === 0) return;
                const absentWinrate = s.absentBossWins[j] / s.absentTotal[j] * 100;
                const overallWinrate = s.bossWins / s.count * 100;
                deltas.push(absentWinrate - overallWinrate);
            });
            const avg = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
            return { name: t.name, avg, sampleSize: deltas.length };
        });

        const withData = contributions.filter(c => c.avg !== null).sort((a, b) => b.avg - a.avg);
        const withoutData = contributions.filter(c => c.avg === null);

        console.log('Ball'.padEnd(colWidth) + 'AvgDelta'.padStart(colWidth) + 'Bosses'.padStart(colWidth));
        console.log('-'.repeat(colWidth * 3));
        withData.forEach(c => {
            console.log(c.name.padEnd(colWidth) + (c.avg.toFixed(1) + 'pp').padStart(colWidth) + String(c.sampleSize).padStart(colWidth));
        });
        if (withoutData.length > 0) {
            console.log(`\n(no data: ${withoutData.map(c => c.name).join(', ')})`);
        }
    })();
}
