"use strict";

const RAID_CONFIG = {
    size: 900,
    gravity: 0.0,
    speed: 5,
    bossSpeed: 2,
    bossScale: 4,
    raidTeam: "sus",
    positions: [[100, 100], [100, 333], [100, 566], [100, 800], [450, 800], [800, 800], [800, 450], [800, 100], [450, 100]],
    shrinkStages: [
        { players: 3, size: 700, zoom: 1.14 },
    ],
    bossHP: {
        "Sword": 300,
        "Dagger": 300,
        "Lance": 300,
        "Wrench": 500,
        "Grimoire": 500,
        "Machine Gun": 500,
        "Hammer": 500,
        "Mirror": 500,
        "Club": 500,
    }
};

// bossIndex: index into ballClasses of the type to spawn as the giant boss.
function createRaidBattle(ballClasses, seed, bossIndex, createBallFn, BallBattle) {
    const { size, gravity, speed, bossHP, bossSpeed, bossScale, raidTeam, positions } = RAID_CONFIG;
    const rng = new Math.seedrandom(seed);

    const bossName = ballClasses[bossIndex].name;
    const hp = bossHP[bossName] ?? 500;
    // Grimoire and Mirror are mutually banned as raiders against each other's boss,
    // to avoid infinite minion-summoning loops (Grimoire clones Mirror's reflect behavior).
    let bannedNames = bossName === "Grimoire" || bossName === "Mirror" || bossName === "Duplicator" ? ["Grimoire", "Mirror"]
        : [bossName];
    bannedNames.push("Duplicator");

    const raiderIndices = ballClasses
        .map((b, i) => i)
        .filter((i) => !bannedNames.includes(ballClasses[i].name));

    // When a combatant is missing (e.g. Grimoire/Mirror mutual ban drops us to 8
    // raiders instead of 9), collapse the two split side slots into one centered
    // position so the layout still looks even.
    const pos = raiderIndices.length < positions.length
        ? [positions[0], [100, 450], ...positions.slice(3)]
        : [...positions];
    shuffle(pos, rng);

    const raiders = raiderIndices.map((i, j) => {
        const b = createBallFn(ballClasses, i, pos[j], rng, speed);
        b.team = raidTeam; // shared team disables friendly fire between raiders
        return b;
    });
    const boss = createBossBall(ballClasses, bossIndex, [size / 2, size / 2], bossSpeed, hp, bossScale * (bossName == "Duplicator" ? 0.5 : 1), rng);

    const battle = new BallBattle([boss, ...raiders], seed, gravity, RAID);
    battle.isDuel = false;
    battle.shrinkConfig = {
        baseSize: size,
        square: true,
        stages: RAID_CONFIG.shrinkStages,
    };

    return { battle, bossIndex, raiderIndices, boss };
}

function createBossBall(ballClasses, i, pos, speed, hp, scale, rng) {
    const data = ballClasses[i];
    const baseRadius = data.radius;
    const radius = baseRadius * scale;
    const spinArgs = data.weapon?.spin ? [0, 1] : [];
    const theta = rng() * 2 * Math.PI;

    const b = new data.class(pos[0], pos[1], Math.cos(theta) * speed, Math.sin(theta) * speed, ...spinArgs, hp, radius, data.color);
    b.maxHp = hp;
    b.giga = true;
    b.boostEnergy = 1;
    b.mass = b.baseMass = 5000;
    // b.angVelNerf = data.class == ClubBall || data.class == WrenchBall ? 2.7 : 3;
    b.angVelNerf = data.class == DaggerBall ? 3 : 2.5;

    for (const w of b.weapons) {
        if (b instanceof LanceBall) {
            const shrink = 7;
            w.offset -= shrink;
            for (let c of w.colliders) {
                if (c.colliderOffset > 0) c.colliderOffset -= shrink;
                c.range -= shrink;
            }
        }
        w.scaleBy((b instanceof DaggerBall) ? 2.66667 : scale);
        if (w.angVel) {
            w.angVel /= b.angVelNerf;
        }
    }
    return b;
}

if (typeof module !== 'undefined') {
    module.exports = { RAID_CONFIG, createRaidBattle, createBossBall };
}
