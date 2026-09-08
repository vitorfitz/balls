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

    // Lowest values seen over the whole match (not just at the moment it
    // ends), so e.g. a boss that dropped low and regenerated, or raiders who
    // dropped low and got healed/regrew, still count as having been near
    // defeat/wipeout.
    let minBossHpFrac = Infinity;
    let minRaidersHp = Infinity;

    for (let i = 0; i < MAX_TICKS; i++) {
        t++;
        battle.updateTimeScale();
        battle.update();

        const boss = battle.balls.find(b => b.id === bossId);
        const raiders = battle.balls.filter(b => b.team === raidTeam && !b.owner);
        let raidersHp = raiders.reduce((sum, b) => sum + b.hp, 0);
        if (bossIndex == 11) {
            if (raiders.length == 1 && raiders[0] instanceof WrenchBall) raidersHp *= 5;
        }
        else {
            if (raiders.length == 1 && (raiders[0] instanceof MirrorBall || ((bossIndex == 7 || bossIndex == 10) && raiders[0] instanceof DaggerBall))) raidersHp *= 5;
        }

        const bossHp = boss ? boss.hp : 0;

        const bossAlive = !!boss;
        const raidersAlive = battle.balls.some(b => b.team === raidTeam && !b.owner);

        if (bossAlive) minBossHpFrac = Math.min(minBossHpFrac, bossHp / boss.maxHp);
        if (raidersAlive) minRaidersHp = Math.min(minRaidersHp, raidersHp);

        if (!bossAlive || !raidersAlive) {
            const winner = bossAlive ? 'boss' : 'raiders';
            const winnerHp = bossAlive
                ? Math.min(bossHp / boss.maxHp, minBossHpFrac)
                : Math.min(raidersHp, minRaidersHp);
            return {
                winner,
                winnerHp,
                ticks: t,
            };
        }
    }
    return { winner: 'draw' };
}

onmessage = (e) => {
    const { matches, bossHpThreshold: bossHpThresholdPct, debugSeed, debugBoss } = e.data;
    const bossHpThreshold = bossHpThresholdPct / 100;

    if (debugSeed !== undefined) {
        const bossIndex = ballClasses.findIndex(b => b.name === debugBoss);
        const result = simulate(bossIndex, debugSeed);
        postMessage({ result: `Debug seed ${debugSeed} (boss=${debugBoss}): ${JSON.stringify(result)}` });
        return;
    }

    const raidDramaticSeeds = {};
    let progress = '';

    for (let bi = 0; bi < BOSS_TYPES.length; bi++) {
        // if (bi != 9) continue;

        const bossName = BOSS_TYPES[bi].name;
        const bossIndex = ballClasses.indexOf(BOSS_TYPES[bi]);
        const results = [];

        for (let seed = 0; seed < matches; seed++) {
            const r = simulate(bossIndex, seed);
            if (r.winner !== 'draw') results.push({ seed, ...r });
        }

        const bossWinSeeds = results
            .filter(r => r.winner === 'boss' && r.winnerHp <= bossHpThreshold)
            .map(r => r.seed);

        const raiderWinSeeds = results
            .filter(r => r.winner === 'raiders')
            .sort((a, b) => a.winnerHp - b.winnerHp)
            .slice(0, bossWinSeeds.length)
            .map(r => r.seed);

        const seeds = [...bossWinSeeds, ...raiderWinSeeds].sort((a, b) => a - b);

        raidDramaticSeeds[bossName] = seeds;
        progress += `${bossName}: [${seeds.join(', ')}] (boss: ${bossWinSeeds.length}, raiders: ${raiderWinSeeds.length})\n`;
        postMessage({ progress });
    }

    const formatted = JSON.stringify(raidDramaticSeeds, (k, v) =>
        Array.isArray(v) ? JSON.stringify(v) : v, 2
    ).replace(/"\[/g, '[').replace(/\]"/g, ']');

    postMessage({ result: progress + '\n// Paste into ui.js:\nconst RAID_DRAMATIC_SEEDS = ' + formatted + ';' });
};
