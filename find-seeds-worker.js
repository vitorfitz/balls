importScripts('seedrandom.js', 'index.js');

const MAX_TICKS = 10000;
const BALL_TYPES = ballClasses.map(b => ({ name: b.name }));

function makeBall(i, pos, rng) {
    const data = ballClasses[i];
    const spinArgs = data.weapon?.spin ? [pos == 0 ? 0 : Math.PI, pos == 0 ? 1 : -1] : [];
    const theta = rng() * 2 * Math.PI;
    return new data.class(pos == 0 ? 50 : 350, 200, Math.cos(theta) * 5, Math.sin(theta) * 5, ...spinArgs, data.hp);
}

function simulate(t1Idx, t2Idx, seed) {
    const rng = new Math.seedrandom(seed);
    const b1 = makeBall(t1Idx, 0, rng), b2 = makeBall(t2Idx, 1, rng);
    const battle = new BallBattle([b1, b2], seed);
    battle.width = battle.height = 400;
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: 400, height: 400 };
    t = 0;

    let minHpDiff = 0, maxHpDiff = 0;
    for (let i = 0; i < MAX_TICKS && battle.balls.length > 1; i++) {
        t++;
        battle.updateTimeScale();
        battle.update();
        const p1 = battle.balls.find(b => b.team === b1.team && !b.owner);
        const p2 = battle.balls.find(b => b.team === b2.team && !b.owner);
        if (p1 && p2) {
            const diff = p1.hp - p2.hp;
            minHpDiff = Math.min(minHpDiff, diff);
            maxHpDiff = Math.max(maxHpDiff, diff);
        }
        if (p1 && !p2) {
            let hp = p1.hp;
            if (p1 instanceof DuplicatorBall) {
                hp = Math.max(...battle.balls.filter(b => b.team === b1.team).map(b => b.hp));
            }
            return { winner: 'p1', hp, units: battle.dupeCount?.[b1.team] ?? 1, ticks: t, hpSwing: maxHpDiff - minHpDiff };
        }
        if (p2 && !p1) {
            let hp = p2.hp;
            if (p2 instanceof DuplicatorBall) {
                hp = Math.max(...battle.balls.filter(b => b.team === b2.team).map(b => b.hp));
            }
            return { winner: 'p2', hp, units: battle.dupeCount?.[b2.team] ?? 1, ticks: t, hpSwing: maxHpDiff - minHpDiff };
        }
    }
    return { winner: 'draw' };
}

onmessage = (e) => {
    const { matches, threshold } = e.data;
    const dramaticSeeds = {};
    let progress = '';

    // for (let i = 0; i < BALL_TYPES.length; i++) {
    for (let i = 1; i < BALL_TYPES.length; i++) {
        for (let j = i + 1; j < BALL_TYPES.length; j++) {
            const key = `${BALL_TYPES[i].name}_${BALL_TYPES[j].name}`;
            const results = [];

            for (let seed = 0; seed < matches; seed++) {
                const r = simulate(i, j, seed);
                if (r.winner !== 'draw') results.push({ seed, ...r });
            }

            const durations = results.map(r => r.ticks).sort((a, b) => a - b);
            const durLimit = key == "Duplicator_Wrench" ? 6000 : 4000;
            const median = durations[Math.floor(durations.length / 2)] || durLimit;
            const maxTicks = Math.max(durLimit, median);

            const hasDupe = BALL_TYPES[i].name === 'Duplicator' || BALL_TYPES[j].name === 'Duplicator';
            const seeds = results.filter(r => {
                if (r.ticks > maxTicks) return false;
                if (!hasDupe && r.hpSwing < 30) return false;
                const winnerIdx = r.winner === 'p1' ? i : j;
                const loserIdx = r.winner === 'p1' ? j : i;
                const isDupe = BALL_TYPES[winnerIdx].name === 'Duplicator';
                const loserIsDupe = BALL_TYPES[loserIdx].name === 'Duplicator';
                const isDupBeatsWrench = isDupe && BALL_TYPES[loserIdx].name === 'Wrench';
                const effectiveThreshold = isDupBeatsWrench ? 20 : loserIsDupe ? 5 : threshold;
                return r.hp <= effectiveThreshold || (isDupe && r.units <= 5);
            }).map(r => r.seed);

            dramaticSeeds[key] = seeds;
            progress += `${key}: [${seeds.join(', ')}] (median: ${median}, cap: ${maxTicks})\n`;
            postMessage({ progress });
        }
    }

    const formatted = JSON.stringify(dramaticSeeds, (k, v) =>
        Array.isArray(v) ? JSON.stringify(v) : v, 2
    ).replace(/"\[/g, '[').replace(/\]"/g, ']');

    postMessage({ result: progress + '\n// Paste into ui.js:\nconst DRAMATIC_SEEDS = ' + formatted + ';' });
};
