"use strict";

global.Image = class { onload() { } onerror() { } set src(v) { setTimeout(() => this.onload(), 0); } };

const fs = require('fs');

let code = fs.readFileSync('./index.js', 'utf8');
code = code.replace(/const d = new Date.*?Math\.seedrandom\(.*?\);/s, '');
code = code.replace(/const balls = \[[\s\S]*$/s, '');
code = code.replace(/"use strict"/, '');

function runBattle(slowed) {
    // Patch asd before eval
    const patchedCode = code.replace(/let asd = .*?;/, `let asd = ${slowed};`);
    
    const wrapped = `
        ${patchedCode}
        return { DaggerBall, MachineGunBall, BallBattle, Bullet, t };
    `;
    const { DaggerBall, MachineGunBall, BallBattle, Bullet } = new Function(wrapped)();
    
    const dagger = new DaggerBall(350, 200, 3.7889344531775704, 4.65230864297759, 0, 1, 100);
    const mg = new MachineGunBall(50, 200, 4.997334240027659, 0.16324978850578045, Math.PI, 1, 100);
    
    const battle = new BallBattle([dagger, mg]);
    battle.width = 400; battle.height = 400;
    battle.ctx = new Proxy({}, { get: () => () => {} });
    battle.canvas = { width: 400, height: 400 };
    
    const log = [];
    let bulletsFired = 0, lastBulletCount = 0;
    
    for (let tick = 0; tick < 50000 && battle.balls.length > 1; tick++) {
        const bulletsBefore = battle.bodies.filter(b => b instanceof Bullet).length;
        battle.update();
        const bulletsAfter = battle.bodies.filter(b => b instanceof Bullet).length;
        const newBullets = Math.max(0, bulletsAfter - bulletsBefore + (bulletsBefore - battle.bodies.filter(b => b instanceof Bullet && b.hp > 0).length));
        
        // Count bullets spawned this tick
        const currentBullets = battle.bodies.filter(b => b instanceof Bullet).length;
        if (currentBullets > lastBulletCount) {
            bulletsFired += currentBullets - lastBulletCount;
        }
        lastBulletCount = battle.bodies.filter(b => b instanceof Bullet).length;
        
        const shouldLog = (slowed ? (tick >= 395 && tick <= 420) : (tick >= 75 && tick <= 105)) || tick % 500 === 0;
        if (shouldLog) {
            const d = battle.balls.find(b => b instanceof DaggerBall);
            const m = battle.balls.find(b => b instanceof MachineGunBall);
            log.push({
                t: tick,
                daggerHP: d?.hp ?? 0,
                mgHP: m?.hp ?? 0,
                daggerAngVel: d?.weapons[0]?.angVel?.toFixed(4) ?? 'dead',
                mgReload: m?.reloadTime?.toFixed(2) ?? 'dead',
                mgFireDelay: m?.fireDelay?.toFixed(2) ?? 'dead',
                mgAmmoUse: m?.ammoUse?.toFixed(2) ?? 'dead',
                bullets: bulletsFired,
                activeBullets: currentBullets
            });
        }
    }
    
    const d = battle.balls.find(b => b instanceof DaggerBall);
    const m = battle.balls.find(b => b instanceof MachineGunBall);
    
    return {
        winner: d?.hp > 0 ? 'dagger' : (m?.hp > 0 ? 'mg' : 'draw'),
        finalHP: { dagger: d?.hp ?? 0, mg: m?.hp ?? 0 },
        bulletsFired,
        log,
        finalTick: log[log.length - 1]?.t ?? 0
    };
}

console.log("=== NON-SLOWED (asd=false) ===");
const normal = runBattle(false);
console.log("Winner:", normal.winner, "| Bullets fired:", normal.bulletsFired, "| Final tick:", normal.finalTick, "| Game-time:", normal.finalTick);
console.log("Final HP - Dagger:", normal.finalHP.dagger, "MG:", normal.finalHP.mg);
normal.log.forEach(l => 
    console.log(`t=${l.t}: reload=${l.mgReload} fd=${l.mgFireDelay} ammo=${l.mgAmmoUse} bullets=${l.bullets}`)
);

console.log("\n=== SLOWED (asd=true) ===");
const slow = runBattle(true);
console.log("Winner:", slow.winner, "| Bullets fired:", slow.bulletsFired, "| Final tick:", slow.finalTick, "| Game-time:", slow.finalTick / 5);
console.log("Final HP - Dagger:", slow.finalHP.dagger, "MG:", slow.finalHP.mg);
slow.log.forEach(l => 
    console.log(`t=${l.t} (gt=${l.t/5}): reload=${l.mgReload} fd=${l.mgFireDelay} ammo=${l.mgAmmoUse} bullets=${l.bullets}`)
);

console.log("\n=== DIVERGENCE POINT (comparing at equivalent game-time) ===");
// Slowed runs at 0.2x, so tick 500 slowed = tick 100 normal
for (const n of normal.log) {
    const equivalentSlowTick = n.t * 5; // 1 normal tick = 5 slow ticks
    const s = slow.log.find(l => l.t === equivalentSlowTick);
    if (!s) continue;
    if (n.daggerHP !== s.daggerHP || n.mgHP !== s.mgHP) {
        console.log(`First divergence at game-time ${n.t} (normal t=${n.t}, slow t=${equivalentSlowTick}):`);
        console.log(`  Normal: dagger=${n.daggerHP} mg=${n.mgHP} bullets=${n.bullets}`);
        console.log(`  Slowed: dagger=${s.daggerHP} mg=${s.mgHP} bullets=${s.bullets}`);
        break;
    }
}
