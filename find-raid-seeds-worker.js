importScripts('seedrandom.js', 'index.js', 'ffa-config.js', 'raid-config.js');

const MAX_TICKS = 30000;
const BOSS_TYPES = ballClasses;
const DUPLICATOR_BOSS_HP_SUM_THRESHOLD = 500;

async function simulate(bossIndex, seed) {
    const { size } = RAID_CONFIG;

    const result = createRaidBattle(ballClasses, seed, bossIndex, createFFABall, BallBattle);
    const battle = result.battle;
    const bossTeam = result.boss.team;
    const isDuplicatorBoss = result.boss instanceof DuplicatorBall;
    const raidTeam = RAID_CONFIG.raidTeam;

    battle.width = battle.height = size;
    battle.walls = createBorderWalls(size, size);
    battle.ctx = new Proxy({}, { get: () => () => { } });
    battle.canvas = { width: size, height: size, style: {} };

    let minBossHpFrac = Infinity;
    let minRaidersHp = Infinity;

    for (let i = 0; i < MAX_TICKS; i++) {
        battle.updateTimeScale();
        await battle.update();

        const bossBodies = battle.balls.filter(b => b.team === bossTeam && !b.owner);
        const raiders = battle.balls.filter(b => b.team === raidTeam && !b.owner);
        const raidersHp = raiders.reduce((sum, b) => sum + b.hp, 0);

        const bossAlive = bossBodies.length > 0;
        const raidersAlive = raiders.length > 0;

        if (bossAlive && !isDuplicatorBoss) {
            const boss = bossBodies[0];
            minBossHpFrac = Math.min(minBossHpFrac, boss.hp / boss.maxHp);
        }
        if (raidersAlive) minRaidersHp = Math.min(minRaidersHp, raidersHp);

        if (!bossAlive || !raidersAlive) {
            const winner = bossAlive ? 'boss' : 'raiders';
            let winnerHp = bossAlive
                ? (isDuplicatorBoss ? bossBodies.reduce((sum, b) => sum + b.hp, 0) : Math.min(bossBodies[0].hp / bossBodies[0].maxHp, minBossHpFrac))
                : Math.min(raidersHp, minRaidersHp);
            if (!bossAlive && raiders.length == 1 && (raiders[0] instanceof MirrorBall || ((bossIndex == 8 || bossIndex == 11 || bossIndex == 13 || bossIndex == 14) && raiders[0] instanceof DaggerBall) || (bossIndex == 0 && raiders[0] instanceof HammerBall) || (bossIndex == 12 && raiders[0] instanceof WrenchBall))) {
                winnerHp *= 5;
            }
            return {
                winner,
                winnerHp,
                ticks: battle.t,
            };
        }
    }
    return { winner: 'draw' };
}

onmessage = async (e) => {
    const { matches, bossHpThreshold: bossHpThresholdPct, debugSeed, debugBoss } = e.data;
    const bossHpThreshold = bossHpThresholdPct / 100;

    if (debugSeed !== undefined) {
        const bossIndex = ballClasses.findIndex(b => b.name === debugBoss);
        const result = await simulate(bossIndex, debugSeed);
        postMessage({ result: `Debug seed ${debugSeed} (boss=${debugBoss}): ${JSON.stringify(result)}` });
        return;
    }

    const raidDramaticSeeds = {};
    let progress = '';

    for (let bi = 0; bi < BOSS_TYPES.length; bi++) {
        // if (bi != 0) continue;

        const bossName = BOSS_TYPES[bi].name;
        const bossIndex = ballClasses.indexOf(BOSS_TYPES[bi]);
        const isDuplicatorBoss = bossName === "Duplicator";
        const results = [];

        for (let seed = 0; seed < (bi == 13 ? matches * 2 : matches); seed++) {
            const r = await simulate(bossIndex, seed);
            if (r.winner !== 'draw') results.push({ seed, ...r });
        }

        const bossWinSeeds = results
            .filter(r => r.winner === 'boss' && (isDuplicatorBoss ? r.winnerHp <= DUPLICATOR_BOSS_HP_SUM_THRESHOLD : r.winnerHp <= bossHpThreshold))
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
