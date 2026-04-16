importScripts('seedrandom.js', 'index.js');

const MAX_TICKS = 10000;
const BALL_TYPES = ballClasses.map(b => ({ name: b.name }));
const threshold = 10;

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
    battle.walls = createBorderWalls(400, 400);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: 400, height: 400 };
    t = 0;

    let minHpDiff = 0, maxHpDiff = 0;
    let dupeNearDeath = { [b1.team]: false, [b2.team]: false };
    let swordDaggerDramaticTick = { [b1.team]: null, [b2.team]: null };
    let dupeReachedMax = false;

    const isSwordDagger = (b1 instanceof SwordBall && b2 instanceof DaggerBall) || (b1 instanceof DaggerBall && b2 instanceof SwordBall);
    const isDupeHammer = (b1 instanceof DuplicatorBall && b2 instanceof HammerBall) || (b1 instanceof HammerBall && b2 instanceof DuplicatorBall);

    for (let i = 0; i < MAX_TICKS && battle.balls.length > 1; i++) {
        t++;
        battle.updateTimeScale();
        battle.update();
        const p1 = battle.balls.find(b => b.team === b1.team && !b.owner);
        const p2 = battle.balls.find(b => b.team === b2.team && !b.owner);

        const diff = (p1 ? p1.hp : 0) - (p2 ? p2.hp : 0);
        minHpDiff = Math.min(minHpDiff, diff);
        maxHpDiff = Math.max(maxHpDiff, diff);

        if (isSwordDagger) {
            for (const [ball, team] of [[p1, b1.team], [p2, b2.team]]) {
                if (ball instanceof DaggerBall && swordDaggerDramaticTick[team] === null && ball.hp <= threshold) {
                    swordDaggerDramaticTick[team] = t;
                }
            }
        }

        // Track if dupe ever had <=3 units with <=50 HP
        for (const [ball, team] of [[p1, b1.team], [p2, b2.team]]) {
            if (ball instanceof DuplicatorBall) {
                const units = battle.teamCount?.[team] ?? 1;
                const maxHp = Math.max(...battle.balls.filter(b => b.team === team).map(b => b.hp));
                if ((isDupeHammer && units <= 6 && dupeReachedMax) || (units <= 3 && maxHp <= 50)) dupeNearDeath[team] = true;
                if (units >= 25) dupeReachedMax = true;
            }
        }

        if (p1 && !p2) {
            let hp = p1.hp;
            if (p1 instanceof DuplicatorBall || ((p1 instanceof MirrorBall) && (p2 instanceof DuplicatorBall))) {
                hp = Math.max(...battle.balls.filter(b => b.team === b1.team).map(b => b.hp));
            }
            const hammerDmg = b2 instanceof HammerBall ? b2.weapons[0].dmg : null;
            return { winner: 'p1', hp, ticks: t, hpSwing: maxHpDiff - minHpDiff, dupeNearDeath: dupeNearDeath[b1.team], swordDaggerDramaticTick: swordDaggerDramaticTick[b1.team], hammerDmg };
        }
        if (p2 && !p1) {
            let hp = p2.hp;
            if (p2 instanceof DuplicatorBall || ((p2 instanceof MirrorBall) && (p1 instanceof DuplicatorBall))) {
                hp = Math.max(...battle.balls.filter(b => b.team === b2.team).map(b => b.hp));
            }
            const hammerDmg = b1 instanceof HammerBall ? b1.weapons[0].dmg : null;
            return { winner: 'p2', hp, ticks: t, hpSwing: maxHpDiff - minHpDiff, dupeNearDeath: dupeNearDeath[b2.team], swordDaggerDramaticTick: swordDaggerDramaticTick[b2.team], hammerDmg };
        }
    }
    return { winner: 'draw' };
}

onmessage = (e) => {
    const { matches } = e.data;
    const dramaticSeeds = {};
    let progress = '';

    for (let i = 0; i < BALL_TYPES.length; i++) {
        for (let j = i + 1; j < BALL_TYPES.length; j++) {
            // if (i != 1 || j != 6) continue;
            if (i == 6 && j == 8) continue;

            const key = `${BALL_TYPES[i].name}_${BALL_TYPES[j].name}`;
            // if (!(key in DRAMATIC_SEEDS)) continue;
            const results = [];

            let m = key == "Duplicator_Mirror" ? 0.1 :
                key == "Duplicator_Grimoire" ? 0.5 :
                    1;

            for (let seed = 0; seed < matches * m; seed++) {
                const r = simulate(i, j, seed);
                if (r.winner !== 'draw') results.push({ seed, ...r });
            }

            const durations = results.map(r => r.ticks).sort((a, b) => a - b);
            const durLimit = key == "Duplicator_Wrench" || key == "Grower_Wrench" ? 6000 : 4000;
            const median = durations[Math.floor(durations.length / 2)] || durLimit;
            const maxTicks = Math.max(durLimit, median);

            const hasDupe = BALL_TYPES[i].name === 'Duplicator' || BALL_TYPES[j].name === 'Duplicator';
            const isSwordDagger = (BALL_TYPES[i].name === 'Sword' && BALL_TYPES[j].name === 'Dagger') || (BALL_TYPES[i].name === 'Dagger' && BALL_TYPES[j].name === 'Sword');
            const seeds = results.filter(r => {
                if (r.ticks > maxTicks) return false;
                if (!hasDupe && r.hpSwing < 25) return false;

                const winnerIdx = r.winner === 'p1' ? i : j;
                const loserIdx = r.winner === 'p1' ? j : i;

                const winnerIsDupe = BALL_TYPES[winnerIdx].name === 'Duplicator';
                const loserIsDupe = BALL_TYPES[loserIdx].name === 'Duplicator';
                const winnerIsMirror = BALL_TYPES[winnerIdx].name === 'Mirror';
                const winnerIsHammer = BALL_TYPES[winnerIdx].name === 'Hammer';
                const loserIsHammer = BALL_TYPES[loserIdx].name === 'Hammer';

                const isDupBeatsWrench = winnerIsDupe && BALL_TYPES[loserIdx].name === 'Wrench';
                const isDupBeatsSword = winnerIsDupe && BALL_TYPES[loserIdx].name === 'Sword';
                const isDupBeatsMG = winnerIsDupe && BALL_TYPES[loserIdx].name === 'Machine Gun';
                const isHammerBeatsDupe = winnerIsHammer && loserIsDupe;
                const isHammerBeatsMirror = BALL_TYPES[winnerIdx].name === 'Hammer' && BALL_TYPES[loserIdx].name === 'Mirror';

                const hammerBeaters = ['Sword', 'Dagger', 'Machine Gun', 'Wrench', 'Lance', 'Mirror', 'Grimoire'];
                const useHammerDmg = (loserIsHammer && hammerBeaters.includes(BALL_TYPES[winnerIdx].name)) || isHammerBeatsMirror;

                const effectiveThreshold = useHammerDmg ? r.hammerDmg :
                    isDupBeatsWrench ? 50 :
                        (isDupBeatsSword || isDupBeatsMG || isHammerBeatsDupe) ? 3 :
                            (loserIsDupe || (winnerIsDupe && winnerIsMirror)) ? 5 :
                                threshold;
                return (r.hp <= effectiveThreshold || (winnerIsDupe && r.dupeNearDeath))
                    && !(isSwordDagger && r.swordDaggerDramaticTick !== null && r.ticks - r.swordDaggerDramaticTick <= 100);
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
