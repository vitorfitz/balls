importScripts('seedrandom.js', 'index.js', 'ffa-config.js', 'raid-config.js');

const MAX_TICKS = 30000;
const BOSS_TYPES = ballClasses.filter(b => b.name !== "Duplicator");

function simulate(bossIndex, seed) {
    const { size } = RAID_CONFIG;

    const result = createRaidBattle(ballClasses, seed, bossIndex, createFFABall, BallBattle);
    const battle = result.battle;
    const bossId = result.boss.id;
    const raidTeam = RAID_CONFIG.raidTeam;

    battle.width = battle.height = size;
    battle.walls = createBorderWalls(size, size);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };
    t = 0;

    const bossMaxHp = result.boss.maxHp;
    const raiderMaxHpTotal = battle.balls
        .filter(b => b.team === raidTeam && !b.owner)
        .reduce((sum, b) => sum + b.maxHp, 0);

    for (let i = 0; i < MAX_TICKS; i++) {
        t++;
        battle.updateTimeScale();
        battle.update();

        const boss = battle.balls.find(b => b.id === bossId);
        const raidersHp = battle.balls
            .filter(b => b.team === raidTeam && !b.owner)
            .reduce((sum, b) => sum + b.hp + (b instanceof MirrorBall ? 50 : 0), 0);

        const bossHp = boss ? boss.hp : 0;
        const raidersPct = raidersHp / raiderMaxHpTotal;

        const bossAlive = !!boss;
        const raidersAlive = battle.balls.some(b => b.team === raidTeam && !b.owner);

        if (!bossAlive || !raidersAlive) {
            const winner = bossAlive ? 'boss' : 'raiders';
            const winnerHp = bossAlive ? bossHp : raidersHp;
            const winnerHpPct = bossAlive ? bossHp / bossMaxHp : raidersPct;
            return {
                winner,
                winnerHp,
                winnerHpPct,
                ticks: t,
            };
        }
    }
    return { winner: 'draw' };
}

onmessage = (e) => {
    const { matches, bossHpThreshold, hpPctThreshold, debugSeed, debugBoss } = e.data;

    if (debugSeed !== undefined) {
        const bossIndex = ballClasses.findIndex(b => b.name === debugBoss);
        const result = simulate(bossIndex, debugSeed);
        postMessage({ result: `Debug seed ${debugSeed} (boss=${debugBoss}): ${JSON.stringify(result)}` });
        return;
    }

    const raidDramaticSeeds = {};
    let progress = '';

    for (let bi = 0; bi < BOSS_TYPES.length; bi++) {
        const bossName = BOSS_TYPES[bi].name;
        const bossIndex = ballClasses.indexOf(BOSS_TYPES[bi]);
        const results = [];

        for (let seed = 0; seed < matches; seed++) {
            const r = simulate(bossIndex, seed);
            if (r.winner !== 'draw') results.push({ seed, ...r });
        }

        const seeds = results.filter(r =>
            r.winner === 'boss' ? r.winnerHp <= bossHpThreshold : r.winnerHpPct <= hpPctThreshold
        ).map(r => r.seed);

        raidDramaticSeeds[bossName] = seeds;
        progress += `${bossName}: [${seeds.join(', ')}]\n`;
        postMessage({ progress });
    }

    const formatted = JSON.stringify(raidDramaticSeeds, (k, v) =>
        Array.isArray(v) ? JSON.stringify(v) : v, 2
    ).replace(/"\[/g, '[').replace(/\]"/g, ']');

    postMessage({ result: progress + '\n// Paste into ui.js:\nconst RAID_DRAMATIC_SEEDS = ' + formatted + ';' });
};
