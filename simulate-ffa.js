"use strict";

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

global.Image = class { onload() { } onerror() { } set src(v) { setTimeout(() => this.onload(), 0); } };

const seedrandom = require('./seedrandom.js');
Math.seedrandom = seedrandom;

const fs = require('fs');

let code = fs.readFileSync('./index.js', 'utf8');
code = code.replace('let t = 0;', 'global.t = 0;');
code = code.replace('let feedMatrix = {};', 'global.feedMatrix = {};');
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
global.BallBattle = BallBattle;
global.randomVel = randomVel;
global.createPlusArenaWalls = createPlusArenaWalls;
global.plusArenaCorners = plusArenaCorners;
global.ballClasses = ballClasses;
global.shuffle = shuffle;
global.FFA = FFA;
global.SnakeSegment = SnakeSegment;
`;

eval(code);
const { FFA_CONFIG, createFFABattle, createFFABall } = require('./ffa-config.js');

const BALL_TYPES = global.ballClasses.filter(b => b.name !== "Duplicator");
const MAX_TICKS = 20000;
const argMatches = parseInt(process.argv[2], 10);
const MATCHES = Number.isInteger(argMatches) && argMatches > 0 ? argMatches : 1000;
const EXCLUDE_COUNT = 3; // number of ball types sitting out each match (roster size = BALL_TYPES.length - EXCLUDE_COUNT)

// All C(BALL_TYPES.length, EXCLUDE_COUNT) unordered exclusion-sets, enumerated once
// in a fixed order. Cycling through this list (see `simulate`) gives each ball type
// exactly the same number of sit-outs over any run that's a multiple of the list's
// length, the same even-coverage guarantee the old single-index mod trick gave for
// EXCLUDE_COUNT === 1.
function combinations(n, k) {
    const result = [];
    const combo = [];
    (function build(start) {
        if (combo.length === k) { result.push([...combo]); return; }
        for (let i = start; i < n; i++) {
            combo.push(i);
            build(i + 1);
            combo.pop();
        }
    })(0);
    return result;
}
const EXCLUSION_SETS = combinations(BALL_TYPES.length, EXCLUDE_COUNT);

function simulate(matchIndex, baseSeed) {
    const seed = baseSeed + matchIndex;
    const { size } = FFA_CONFIG;

    // Sequential seeds + mod-N exclusion set guarantee an exactly even
    // spread of exclusions across any contiguous run of EXCLUSION_SETS.length
    // matches (unlike drawing the exclusion from the battle's own seeded
    // rng, which only converges to even over many trials).
    const excludeIdx = EXCLUSION_SETS[matchIndex % EXCLUSION_SETS.length];

    const result = createFFABattle(global.ballClasses, seed, createFFABall, global.BallBattle, excludeIdx);
    const battle = result.battle;

    battle.width = battle.height = size;
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    global.t = 0;

    const allBalls = battle.balls.filter(b => !b.owner);
    const deathLog = []; // teams in order of elimination (first dead = index 0)

    let grimMirrorStalemate = false;
    let consecutiveOOB = 0;
    let prevAlive = new Set(allBalls.map(b => b.team));
    for (let i = 0; i < MAX_TICKS && battle.balls.filter(b => !b.owner).length > 1; i++) {
        global.t++;
        battle.updateTimeScale();
        battle.update();

        const nowAlive = new Set(battle.balls.filter(b => !b.owner).map(b => b.team));
        for (const team of prevAlive) {
            if (!nowAlive.has(team)) deathLog.push(team);
        }
        prevAlive = nowAlive;

        for (const b of battle.bodies) {
            if (isNaN(b.x) || isNaN(b.y)) throw new Error(`NaN position on ${b.constructor.name}#${b.id} at t=${global.t} seed=${seed} excludeIdx=${excludeIdx}`);
        }

        let outOfBoundsCount = 0;
        for (const b of battle.balls) {
            if (b instanceof SnakeSegment) continue;
            if (!battle.inArenaBounds(b.x, b.y, b.radius - 1)) outOfBoundsCount++;
        }
        if (outOfBoundsCount > 0) {
            consecutiveOOB = (consecutiveOOB || 0) + 1;
            if (consecutiveOOB >= 3) throw new Error(`Ball out of bounds for 3+ ticks at t=${global.t} seed=${seed} excludeIdx=${excludeIdx}`);
        } else {
            consecutiveOOB = 0;
        }

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
    const kills = BALL_TYPES.map(t => {
        const b = allBalls.find(ball => ball.team === t.color);
        return b ? b.killCount : 0;
    });
    // placement: 1 = winner, allBalls.length = first to die. null for
    // excluded ball types, which didn't participate in this match at all.
    if (winner) deathLog.push(winner.team);
    const excludeSet = new Set(excludeIdx);
    const placements = BALL_TYPES.map((t, i) => {
        if (excludeSet.has(i)) return null;
        const pos = deathLog.indexOf(t.color);
        return pos === -1 ? allBalls.length : allBalls.length - pos;
    });

    return { winnerIdx, damages, kills, placements, grimMirrorStalemate, seed, excludeIdx };
}

if (!isMainThread) {
    const { count, startIndex, baseSeed } = workerData;
    const wins = new Array(BALL_TYPES.length).fill(0);
    const totalDmg = new Array(BALL_TYPES.length).fill(0);
    const totalDmgSq = new Array(BALL_TYPES.length).fill(0);
    const totalKills = new Array(BALL_TYPES.length).fill(0);
    const totalPlacement = new Array(BALL_TYPES.length).fill(0);
    const participations = new Array(BALL_TYPES.length).fill(0);
    let stalemateCount = 0;
    const outliers = [];

    for (let i = 0; i < count; i++) {
        const { winnerIdx, damages, kills, placements, grimMirrorStalemate, seed, excludeIdx } = simulate(startIndex + i, baseSeed);
        if (winnerIdx >= 0) wins[winnerIdx]++;
        damages.forEach((d, j) => { totalDmg[j] += d; totalDmgSq[j] += d * d; });
        kills.forEach((k, j) => totalKills[j] += k);
        placements.forEach((p, j) => totalPlacement[j] += p);
        const excludeSet = new Set(excludeIdx);
        for (let j = 0; j < BALL_TYPES.length; j++) {
            if (!excludeSet.has(j)) participations[j]++;
        }
        if (grimMirrorStalemate) stalemateCount++;
        const maxDmg = Math.max(...damages), minDmg = Math.min(...damages);
        if (maxDmg > 500 || minDmg < -10) {
            outliers.push({ seed, excludeIdx, damages: [...damages] });
        }
    }
    parentPort.postMessage({ type: 'done', wins, totalDmg, totalDmgSq, totalKills, totalPlacement, participations, count, stalemateCount, outliers, feedMatrix: global.feedMatrix });
} else {
    const NUM_WORKERS = os.cpus().length;
    // const NUM_WORKERS = 4;

    (async () => {
        const perWorker = Math.floor(MATCHES / NUM_WORKERS);
        const remainder = MATCHES % NUM_WORKERS;
        const baseSeed = Date.now();

        let completed = 0;
        let startIndex = 0;
        const promises = [];
        for (let i = 0; i < NUM_WORKERS; i++) {
            const count = perWorker + (i < remainder ? 1 : 0);
            if (count === 0) continue;
            const workerStartIndex = startIndex;
            startIndex += count;
            promises.push(new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { count, startIndex: workerStartIndex, baseSeed } });
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
        const totalKills = new Array(BALL_TYPES.length).fill(0);
        const totalPlacement = new Array(BALL_TYPES.length).fill(0);
        const participations = new Array(BALL_TYPES.length).fill(0);
        let totalMatches = 0;
        let totalStalemateCount = 0;
        let allOutliers = [];
        const feedMatrix = {}; // feedMatrix[victimKey][attackerKey] = count

        results.forEach(r => {
            r.wins.forEach((w, i) => wins[i] += w);
            r.totalDmg.forEach((d, i) => totalDmg[i] += d);
            r.totalDmgSq.forEach((d, i) => totalDmgSq[i] += d);
            r.totalKills.forEach((k, i) => totalKills[i] += k);
            r.totalPlacement.forEach((p, i) => totalPlacement[i] += p);
            r.participations.forEach((p, i) => participations[i] += p);
            totalMatches += r.count;
            totalStalemateCount += r.stalemateCount;
            if (r.outliers) allOutliers.push(...r.outliers);
            if (r.feedMatrix) {
                for (const victimKey in r.feedMatrix) {
                    const row = feedMatrix[victimKey] ??= {};
                    for (const attackerKey in r.feedMatrix[victimKey]) {
                        row[attackerKey] = (row[attackerKey] ?? 0) + r.feedMatrix[victimKey][attackerKey];
                    }
                }
            }
        });

        console.log('=== FFA RESULTS ===\n');
        console.log(`Grimoire/Mirror stalemates: ${totalStalemateCount}/${totalMatches}\n`);
        const stats = BALL_TYPES.map((t, i) => {
            const p = participations[i];
            return {
                name: t.name,
                wins: wins[i],
                winrate: (wins[i] / p * 100).toFixed(1),
                avgDmg: Math.round(totalDmg[i] / p),
                stdDmg: Math.round(Math.sqrt(totalDmgSq[i] / p - (totalDmg[i] / p) ** 2)),
                avgKills: (totalKills[i] / p).toFixed(2),
                avgPlacement: (totalPlacement[i] / p).toFixed(2),
            };
        }).sort((a, b) => b.wins - a.wins);

        console.log('Name'.padEnd(12) + 'Wins'.padStart(6) + 'Winrate'.padStart(10) + 'Avg Dmg'.padStart(10) + 'Std Dmg'.padStart(10) + 'Avg Kills'.padStart(11) + 'Avg Place'.padStart(11));
        console.log('-'.repeat(70));
        stats.forEach(s => {
            console.log(s.name.padEnd(12) + String(s.wins).padStart(6) + (s.winrate + '%').padStart(10) + String(s.avgDmg).padStart(10) + String(s.stdDmg).padStart(10) + String(s.avgKills).padStart(11) + String(s.avgPlacement).padStart(11));
        });

        // Feed matrix: feedMatrix[victimKey][attackerKey] = number of scaling/growth
        // hits attackerKey landed on victimKey (see recordFeed() in index.js). Keyed
        // by each class's constructor name with the "Ball" suffix stripped, which is
        // how recordFeed() derives its keys - map back to BALL_TYPES via the same
        // derivation rather than display name, since e.g. "Machine Gun" has a space
        // that the constructor-derived key doesn't.
        const keyForType = (t) => t.class.name.endsWith("Ball") ? t.class.name.slice(0, -4) : t.class.name;
        const typeForKey = {};
        BALL_TYPES.forEach((t, i) => typeForKey[keyForType(t)] = i);

        const fedIn = new Array(BALL_TYPES.length).fill(0);  // times this type was credited with a feed hit
        const feedCounts = BALL_TYPES.map(() => new Array(BALL_TYPES.length).fill(0)); // feedCounts[victim][attacker]
        for (const victimKey in feedMatrix) {
            const vi = typeForKey[victimKey];
            if (vi === undefined) continue;
            for (const attackerKey in feedMatrix[victimKey]) {
                const ai = typeForKey[attackerKey];
                if (ai === undefined) continue;
                const n = feedMatrix[victimKey][attackerKey];
                feedCounts[vi][ai] += n;
                fedIn[ai] += n;
            }
        }

        console.log('\n=== FEED MATRIX (rows fed columns, per-match averages) ===\n');
        const colWidth = 8;
        console.log(''.padEnd(12) + BALL_TYPES.map(t => t.name.slice(0, colWidth - 1).padStart(colWidth)).join(''));
        BALL_TYPES.forEach((t, vi) => {
            const p = participations[vi] || 1;
            const row = feedCounts[vi].map(n => (n / p).toFixed(2).padStart(colWidth)).join('');
            console.log(t.name.padEnd(12) + row);
        });

        // Normalized feed matrix: for each attacker (column), each victim's raw feed
        // count is divided by that attacker's total feed count, then divided again by
        // the victim's "fair share" of that total - i.e. the fraction of the attacker's
        // potential victims (weighted by how often each victim actually appeared
        // alongside that attacker) that this victim represents. This controls for
        // attackers whose mechanic simply scales far more/less often overall (e.g.
        // Machine Gun's per-bullet scaling vs. Grimoire's per-summon scaling), isolating
        // whether a given victim is disproportionately the source of an attacker's
        // scaling - not just how often that attacker scales in general.
        // Score of 1.0 = victim feeds this attacker exactly proportional to its own
        // participation rate; >1.0 = feeds more than its "fair share"; <1.0 = less.
        const totalOtherParticipations = BALL_TYPES.map((t, ai) =>
            BALL_TYPES.reduce((sum, t2, vi) => sum + (vi === ai ? 0 : participations[vi]), 0));

        console.log('\n=== NORMALIZED FEED MATRIX (victim\'s share of each attacker\'s feeds, vs. fair share) ===\n');
        console.log(''.padEnd(12) + BALL_TYPES.map(t => t.name.slice(0, colWidth - 1).padStart(colWidth)).join(''));
        BALL_TYPES.forEach((t, vi) => {
            const row = BALL_TYPES.map((t2, ai) => {
                if (vi === ai || fedIn[ai] === 0 || totalOtherParticipations[ai] === 0) return '-'.padStart(colWidth);
                const actualShare = feedCounts[vi][ai] / fedIn[ai];
                const fairShare = participations[vi] / totalOtherParticipations[ai];
                const score = fairShare > 0 ? actualShare / fairShare : 0;
                return score.toFixed(2).padStart(colWidth);
            }).join('');
            console.log(t.name.padEnd(12) + row);
        });

        console.log('\n=== AVG FEED SHARE (per-match, normalized vs. fair share) ===\n');
        const avgFeedShare = BALL_TYPES.map((t, vi) => {
            let sum = 0, count = 0;
            BALL_TYPES.forEach((t2, ai) => {
                if (vi === ai || fedIn[ai] === 0 || totalOtherParticipations[ai] === 0) return;
                const actualShare = feedCounts[vi][ai] / fedIn[ai];
                const fairShare = participations[vi] / totalOtherParticipations[ai];
                if (fairShare > 0) { sum += actualShare / fairShare; count++; }
            });
            return { name: t.name, avgShare: count > 0 ? sum / count : 0 };
        }).sort((a, b) => b.avgShare - a.avgShare);

        console.log('Name'.padEnd(12) + 'Avg Feed Share'.padStart(16));
        console.log('-'.repeat(28));
        avgFeedShare.forEach(s => {
            console.log(s.name.padEnd(12) + s.avgShare.toFixed(2).padStart(16));
        });

        if (allOutliers.length > 0) {
            console.log(`\n=== OUTLIERS (${allOutliers.length}) ===`);
            allOutliers.slice(0, 20).forEach(o => {
                const dmgStr = BALL_TYPES.map((t, i) => `${t.name}:${Math.round(o.damages[i])}`).join(' ');
                console.log(`  seed=${o.seed} excludeIdx=${o.excludeIdx} ${dmgStr}`);
            });
        }
    })();
}
