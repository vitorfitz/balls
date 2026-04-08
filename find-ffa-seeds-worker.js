importScripts('seedrandom.js', 'index.js', 'ffa-config.js');

const MAX_TICKS = 20000;

function simulate(seed) {
    const { size } = FFA_CONFIG;

    const result = createFFABattle(ballClasses, seed, createFFABall, BallBattle, createPlusArenaWalls);
    const battle = result.battle;

    battle.width = battle.height = size;
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    t = 0;
    let runnerUp = null;
    let prevAlive = battle.balls.filter(b => !b.owner);

    for (let i = 0; i < MAX_TICKS && battle.balls.filter(b => !b.owner).length > 1; i++) {
        t++;
        battle.updateTimeScale();
        battle.update();

        const alive = battle.balls.filter(b => !b.owner);
        const eliminated = prevAlive.filter(b => !alive.includes(b));
        if (eliminated.length) runnerUp = eliminated[eliminated.length - 1];
        prevAlive = alive;

        if (alive.length === 2 &&
            alive.every(b => (b instanceof GrimoireBall || b instanceof MirrorBall) && b.hp > 20)) {
            alive.sort((a, b) => b.hp - a.hp);
            if (alive[0].hp > alive[1].hp) alive[1].hp = 0;
            else { alive[0].hp = 0; alive[1].hp = 0; }
            battle.processDeaths();
            break;
        }
    }

    const winner = battle.balls.find(b => !b.owner);
    if (!winner) return null;

    let hammerDmg = null;

    if (winner instanceof HammerBall) {
        if (runnerUp instanceof MirrorBall) hammerDmg = winner.weapons[0].dmg;
    }
    else if (runnerUp instanceof HammerBall) { // winner instanceof MirrorBall
        hammerDmg = runnerUp.weapons[0].dmg / (winner.getDmgResistance?.() ?? 1);
    }

    const winnerData = ballClasses.find(b => b.color === winner.team);
    return { winnerName: winnerData.name, hp: Math.ceil(winner.hp), ticks: t, hammerDmg };
}

onmessage = (e) => {
    const { matches, threshold, debugSeed } = e.data;

    if (debugSeed !== undefined) {
        const result = simulate(debugSeed);
        postMessage({ result: `Debug seed ${debugSeed}: ${result?.winnerName} wins with ${result?.hp} HP` });
        return;
    }

    const dramatic = [];

    for (let seed = 0; seed < matches; seed++) {
        if (seed % 50 === 0) {
            postMessage({ progress: `Searching... ${seed}/${matches} (found ${dramatic.length})` });
        }

        const result = simulate(seed);
        const effectiveThreshold = result?.hammerDmg ?? threshold;
        if (result && result.hp <= effectiveThreshold) {
            dramatic.push({ seed, ...result });
        }
    }

    let output = `Found ${dramatic.length} dramatic seeds (HP <= ${threshold}):\n\n`;
    dramatic.sort((a, b) => a.hp - b.hp).forEach(r => {
        output += `Seed ${r.seed}: ${r.winnerName} wins with ${r.hp} HP (${r.ticks} ticks)\n`;
    });

    output += '\n// Seeds array:\nconst FFA_DRAMATIC_SEEDS = ' + JSON.stringify(dramatic.map(r => r.seed)) + ';';

    postMessage({ result: output });
};
