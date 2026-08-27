"use strict";
global.Image = class { onload() { } onerror() { } set src(v) { setTimeout(() => this.onload(), 0); } };
const seedrandom = require('./seedrandom.js');
Math.seedrandom = seedrandom;
const fs = require('fs');
let code = fs.readFileSync('./index.js', 'utf8');
code = code.replace('let t = 0;', 'global.t = 0;'); // make t a global so index.js logs using `t` work
code = code.replace(/const balls = \[[\s\S]*$/s, '');
code += `global.BallBattle = BallBattle; global.ballClasses = ballClasses; global.GrowerBall = GrowerBall; global.createPlusArenaWalls = createPlusArenaWalls; global.plusArenaCorners = plusArenaCorners; global.shuffle = shuffle; global.FFA = FFA;`;
eval(code);
const { createFFABattle, createFFABall } = require('./ffa-config.js');

const seed = parseFloat(process.argv[2]);
const tStart = parseInt(process.argv[3]) || 0;
const tEnd = parseInt(process.argv[4]) || tStart + 20;
// Which non-Duplicator ball to exclude from the roster (index into
// ballClasses.filter(b => b.name !== "Duplicator")). Pass the same
// `excludeIdx` simulate-ffa.js reported for this seed to reproduce the
// exact same battle; omitting it falls back to a random exclusion.
const excludeIdx = process.argv[5] !== undefined ? parseInt(process.argv[5]) : null;

const result = createFFABattle(global.ballClasses, seed, createFFABall, global.BallBattle, excludeIdx);
const battle = result.battle;
battle.width = battle.height = 1500;
battle.ctx = new Proxy({}, { get: () => () => { } });
battle.canvas = { width: 1500, height: 1500, style: {} };
global.t = 0;
global.DEBUG_CORNER = true;
global.DEBUG_CORNER_ID = 0;
global.DEBUG_CORNER_T0 = 11054;
global.DEBUG_CORNER_T1 = 11057;

for (let i = 0; i < tEnd && battle.balls.filter(b => !b.owner).length > 1; i++) {
    global.t++;
    battle.updateTimeScale();
    battle.update();
    for (const b of battle.bodies) {
        if (isNaN(b.x) || isNaN(b.y)) {
            console.error(`NaN at t=${global.t} ${b.constructor.name}#${b.id} pos=(${b.x},${b.y}) v=(${b.vx},${b.vy}) owner=${b.owner ? b.owner.constructor.name + '#' + b.owner.id : 'none'}`);
            process.exit(1);
        }
    }

    if (global.t >= tStart) {
        const g0 = battle.balls.find(b => b.id === 0);
        if (g0) {
            // console.log(`t=${global.t} DEBUG#0 pos=(${g0.x.toFixed(3)},${g0.y.toFixed(3)}) v=(${g0.vx.toFixed(3)},${g0.vy.toFixed(3)}) r=${g0.radius.toFixed(2)} wallBoundX=${!!g0.wallBoundX} wallBoundY=${!!g0.wallBoundY} inert=${g0.inert} knockBoost=${g0.knockBoost?.toFixed(3)}`);
            for (const c of battle.corners) {
                const d = Math.hypot(g0.x - c.x, g0.y - c.y);
                // if (d < g0.radius + 20) console.log(`    corner(${c.x.toFixed(1)},${c.y.toFixed(1)}) dist=${d.toFixed(3)} r=${g0.radius.toFixed(2)} overlap=${d < g0.radius}`);
            }
        }
        const tracked = battle.balls.find(b => b.id === 7);
        // if (tracked) console.log(`t=${global.t} TRACK#7 pos=(${tracked.x.toFixed(5)},${tracked.y.toFixed(5)}) v=(${tracked.vx.toFixed(4)},${tracked.vy.toFixed(4)}) stunned=${tracked.isStunned()} stunTime=${tracked.stunTime.toFixed(2)} slow=${tracked.getTimeScale().toFixed(4)} wallBoundX=${!!tracked.wallBoundX} wallBoundY=${!!tracked.wallBoundY} mass=${tracked.mass === Infinity ? 'Inf' : tracked.mass.toFixed(1)} gravity=${tracked.gravity}`);
        // console.log(`t=${global.t} arenaSize=${(battle.arenaSize || 1500).toFixed(1)} corners=${JSON.stringify(battle.corners?.map(c => ({ x: c.x.toFixed(1), y: c.y.toFixed(1) })))}`);
        for (const b of battle.balls) {
            const oob = !battle.inArenaBounds(b.x, b.y, b.radius - 1);
            if (oob || process.argv[6] === 'all')
                console.log(`t=${global.t} ${b.constructor.name}#${b.id} pos=(${b.x.toFixed(5)},${b.y.toFixed(5)}) r=${b.radius.toFixed(1)} v=(${b.vx.toFixed(2)},${b.vy.toFixed(2)}) arenaSize=${(battle.arenaSize || 1500).toFixed(0)} slow=${b.getTimeScale()}${oob ? ' OOB' : ''}`);
            // if (oob && b.id === 4630) {
            //     console.log(`  walls:`);
            //     for (let i = 0; i < battle.walls.length; i++) {
            //         const w = battle.walls[i];
            //         const along = w.axis === 0 ? b.x : b.y; // VERTICAL=1 checks y, HORIZONTAL=0 checks x
            //         const perp = w.axis === 0 ? b.y : b.x;
            //         const dist = (perp - w.pos) * w.normal;
            //         console.log(`    wall[${i}] axis=${w.axis} pos=${w.pos.toFixed(2)} min=${w.min.toFixed(2)} max=${w.max.toFixed(2)} normal=${w.normal} along=${along.toFixed(2)} perp=${perp.toFixed(2)} dist=${dist.toFixed(3)} r=${b.radius.toFixed(1)} inRange=${along >= w.min && along <= w.max} fail=${along >= w.min && along <= w.max && dist < b.radius}`);
            //     }
            //     console.log(`  corners:`);
            //     for (const c of battle.corners) {
            //         const d = Math.hypot(b.x - c.x, b.y - c.y);
            //         console.log(`    corner (${c.x.toFixed(1)},${c.y.toFixed(1)}) dist=${d.toFixed(3)} r=${b.radius.toFixed(1)} fail=${d < b.radius}`);
            //     }
            // }
        }
    }
}
