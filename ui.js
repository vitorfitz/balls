"use strict"

// const seedOverride = null;
const seedOverride = 324;
// const seedOverride = 369;

const dramaticCheck = document.getElementById("dramatic-check");

const menuDiv = document.getElementById("menu");
const fightBtn = document.getElementById("start");
const ballPicker = document.getElementById("balls");
const battleDiv = document.getElementById("battle");
const modeBtns = document.querySelectorAll("#mode>span");

const menuRadius = 210;
const ballBtnDiameter = 120;
const canvasPadding = 70;
const wallThickness = 3;
let combatants = [];
let ffaCombatants = [];
let ballBtns = [];
let mode = 0;
let battleSeed;

{
    const theta0 = 16 * Math.PI / 10;
    // const theta0 = 3 * Math.PI / 2;
    for (let i = 0; i < ballClasses.length; i++) {
        const btn = document.createElement("button");
        btn.style.width = btn.style.height = ballBtnDiameter + "px";
        ballBtns.push(btn);
        ballPicker.appendChild(btn);

        const theta = (theta0 + i * 2 * Math.PI / ballClasses.length) % (2 * Math.PI);
        btn.style.right = Math.cos(theta) * menuRadius + "px";
        btn.style.bottom = Math.sin(theta) * menuRadius + "px";

        const btnCanvas = document.createElement("canvas");
        btnCanvas.width = btnCanvas.height = ballBtnDiameter + 2 * canvasPadding;
        btnCanvas.getContext("2d").imageSmoothingEnabled = false;
        btn.appendChild(btnCanvas);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = ballClasses[i].name;
        const offset = ballClasses[i].name == "Grower" ? "12px" : "16px";
        if (theta <= Math.PI) {
            nameSpan.style.top = offset;
        }
        else {
            nameSpan.style.bottom = offset;
        }
        btn.appendChild(nameSpan);

        btn.addEventListener("click", () => {
            if (mode == 1) return;

            const ind = combatants.indexOf(i);
            if (ind != -1) {
                btn.classList.remove("selected");
                combatants.splice(ind, 1);
                fightBtn.classList.add("disabled");
            }
            else {
                if (combatants.length >= 2) {
                    ballBtns[combatants[0]].classList.remove("selected");
                    combatants.splice(0, 1);
                }
                btn.classList.add("selected");
                combatants.push(i);
                if (combatants.length == 2) fightBtn.classList.remove("disabled");
            }
        });

        const ctx = btnCanvas.getContext("2d");
        const data = ballClasses[i];
        const cx = ballBtnDiameter / 2 + canvasPadding, cy = ballBtnDiameter / 2 + canvasPadding;

        if (data.weapon) {
            loadImage(data.weapon.sprite).then(img => {
                Weapon.drawWeapon(ctx, cx, cy, theta, img, data.weapon.scale, data.radius + data.weapon.offset, data.weapon.shift || 0, data.weapon.rotation);
                Ball.drawBall(ctx, cx, cy, data.radius, data.color, data.hp);
            });
        }
        else {
            Ball.drawBall(ctx, cx, cy, data.radius, data.color, data.hp);
        }
    }
}

for (let i = 0; i < 2; i++) {
    modeBtns[i].addEventListener("click", function () {
        for (let j = 0; j < modeBtns.length; j++) {
            if (i == j) {
                modeBtns[j].classList.add("selected");
            }
            else {
                modeBtns[j].classList.remove("selected");
            }
        }

        mode = i;
        if (i == 1) {
            menuDiv.classList.add("ffa");
        }
        else {
            menuDiv.classList.remove("ffa");
        }
    });
}

function makeBall(i, pos, rng, speed = 5, hpOverride = null) {
    const data = ballClasses[i];
    const spinArgs = data.weapon?.spin ? [
        pos[0] < 200 ? 0 : Math.PI,
        pos[0] < 200 ? 1 : -1,
    ] : [];
    const theta = rng() * 2 * Math.PI;
    const ballHp = hpOverride ?? data.hp;
    const b = new data.class(
        pos[0], pos[1],
        Math.cos(theta) * speed,
        Math.sin(theta) * speed,
        ...spinArgs,
        ballHp,
        undefined,
        data.color
    );
    b.maxHp = ballHp;
    return b;
}

let battle;
let hp = {}, displayedHP = {};
let deathOrder = [];
const ball1Info = document.getElementById("ball1-info");
const ball2Info = document.getElementById("ball2-info");

function drawHealthBar(canvas, hp, maxHp, color, alignRight) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, w, h);

    const pct = Math.max(0, Math.min(1, hp / maxHp));
    const fillW = (w - 4) * pct;
    ctx.fillStyle = color;
    ctx.fillRect(alignRight ? w - 2 - fillW : 2, 2, fillW, h - 4);
}

function updateBattleUI() {
    if (!battle) return;

    hp = {};
    for (let b of battle.balls) {
        if (b.owner == null) {
            hp[b.team] = Math.max(hp[b.team] ?? 0, Math.ceil(b.hp));
        }
    }

    if (mode === 1) {
        updateFFALeaderboard();
        requestAnimationFrame(updateBattleUI);
        return;
    }

    [ball1Info, ball2Info].forEach((el, i) => {
        const data = ballClasses[combatants[i]];
        const b = battle.balls.find(ball => ball.team === data.color && !ball.owner);
        if (!b) { el.innerHTML = `<div class="name">${data.name}</div><div class="stat"><span class="ded">💀</span></div>`; return; }

        let hpCanvas = el.querySelector(".hp-canvas"), hpText = el.querySelector(".hp-text");
        if (!hpCanvas) {
            hpCanvas = document.createElement("canvas");
            hpCanvas.className = "hp-canvas";
            hpCanvas.width = 120;
            hpCanvas.height = 28;

            hpText = document.createElement("span");
            hpText.className = "hp-text";
            const offset = "7px";
            if (i == 0) hpText.style.left = offset;
            else hpText.style.right = offset;

            const hpBar = document.createElement("div");
            hpBar.className = "hp-bar";
            hpBar.appendChild(hpText);
            hpBar.appendChild(hpCanvas);

            el.innerHTML = `<div class="name">${data.name}</div><div class="stat"></div>`;
            el.querySelector(".stat").appendChild(hpBar);
            if (b.getInfoEl) el.querySelector(".stat").appendChild(b.getInfoEl());
        }

        const key = data.color;
        if (!(key in displayedHP)) displayedHP[key] = hp[key];
        displayedHP[key] += (hp[key] - displayedHP[key]) * 0.05;

        hpText.textContent = hp[key];
        hpText.style.color = displayedHP[key] / data.hp < 0.25 ? "#fff" : "#333";
        drawHealthBar(hpCanvas, displayedHP[key], data.hp, data.color, i);

        // Update stat info
        const oldInfo = el.querySelector(".stat > :last-child");
        if (oldInfo) oldInfo.remove();
        if (b.getInfoEl) el.querySelector(".stat").appendChild(b.getInfoEl());
    });
    requestAnimationFrame(updateBattleUI);
}

function updateFFALeaderboard() {
    const lb = document.getElementById("leaderboard");

    // Build sorted list of combatants by HP, freezing dead ball positions
    const entries = ffaCombatants.map(i => {
        const data = ballClasses[i];
        const b = battle.balls.find(ball => ball.team === data.color && !ball.owner);
        if (!b && !deathOrder.includes(i)) deathOrder.push(i);
        return { i, data, b, hpPct: b ? hp[b.team] / b.maxHp : 0 };
    });

    // Sort: alive balls by HP% descending, dead balls by death order (first dead = last place)
    entries.sort((a, b) => {
        const aDead = deathOrder.includes(a.i);
        const bDead = deathOrder.includes(b.i);
        if (aDead && bDead) return deathOrder.indexOf(b.i) - deathOrder.indexOf(a.i);
        if (aDead) return 1;
        if (bDead) return -1;
        return b.hpPct - a.hpPct;
    });

    entries.forEach(({ i, data, b }) => {
        let el = lb.querySelector(`[data-idx="${i}"]`);
        if (!el) {
            el = document.createElement("div");
            el.className = "lb-entry";
            el.dataset.idx = i;
            el.innerHTML = `<div class="name">${data.name}</div><div class="stat"><div class="hp-bar"><span class="hp-text"></span><canvas class="hp-canvas" width="110" height="24"></canvas><span class="dmg"><span style="margin-right:4px">🗡️</span>${Math.round(b.damageDealt)}</span></div></div>`;
            lb.appendChild(el);
        }

        el.classList.toggle("dead", !b);
        if (!b) {
            el.querySelector(".hp-text").textContent = "0";
            el.querySelector(".hp-text").style.color = "#fff";
            drawHealthBar(el.querySelector(".hp-canvas"), 0, 1, "#333", false);
            return;
        }

        const key = data.color;
        if (!(key in displayedHP)) displayedHP[key] = hp[key];
        displayedHP[key] += (hp[key] - displayedHP[key]) * 0.05;

        el.querySelector(".hp-text").textContent = hp[key];
        el.querySelector(".hp-text").style.color = displayedHP[key] / b.maxHp < 0.25 ? "#fff" : "#333";
        drawHealthBar(el.querySelector(".hp-canvas"), displayedHP[key], b.maxHp, data.color, false);
        el.querySelector(".dmg").lastChild.textContent = Math.round(b.damageDealt);

        const oldInfo = el.children[1].children[1];
        if (oldInfo) oldInfo.remove();
        if (b.getInfoEl) el.querySelector(".stat").appendChild(b.getInfoEl());
    });

    // Reorder DOM elements
    entries.forEach(({ i }, idx) => {
        const el = lb.querySelector(`[data-idx="${i}"]`);
        el.style.top = (idx * 85) + "px";
        el.style.zIndex = 11 - idx;
    });
}

fightBtn.addEventListener("click", function () {
    if (seedOverride != null) {
        battleSeed = seedOverride;
    }
    else {
        const d = new Date().getTime();
        console.log(d);
        battleSeed = d;
    }

    if (mode == 1) {
        startFFA();
        return;
    }

    if (!fightBtn.classList.contains("disabled")) {
        startDuel();
    }
});

async function startFFA() {
    menuDiv.classList.add("hidden");
    battleDiv.classList.remove("hidden");
    battleDiv.classList.add("ffa-mode");

    const canvas = document.getElementById("canvas");
    const { size, armWidth, holeSize } = FFA_CONFIG;
    canvas.width = canvas.height = size + 2 * wallThickness;
    canvas.style.width = canvas.style.height = "800px";

    if (dramaticCheck.checked) {
        battleSeed = FFA_DRAMATIC_SEEDS[Math.floor(Math.random() * FFA_DRAMATIC_SEEDS.length)];
        console.log("used", battleSeed);
    }

    const result = createFFABattle(ballClasses, battleSeed, createFFABall, BallBattle, createPlusArenaWalls);
    battle = result.battle;
    ffaCombatants = result.combatants;
    const { armStart, armEnd } = result;

    battle.addCanvas(canvas, wallThickness);
    battle.zoom = 1;
    battle.drawArena = (ctx) => {
        const as = armStart, ae = armEnd, hs = (size - holeSize) / 2, he = (size + holeSize) / 2;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(as, 0); ctx.lineTo(ae, 0); ctx.lineTo(ae, as);
        ctx.lineTo(size, as); ctx.lineTo(size, ae); ctx.lineTo(ae, ae);
        ctx.lineTo(ae, size); ctx.lineTo(as, size); ctx.lineTo(as, ae);
        ctx.lineTo(0, ae); ctx.lineTo(0, as); ctx.lineTo(as, as);
        ctx.closePath();
        ctx.moveTo(hs, hs); ctx.lineTo(hs, he); ctx.lineTo(he, he); ctx.lineTo(he, hs);
        ctx.closePath();
        ctx.fill("evenodd");
        ctx.lineWidth = 2 * wallThickness;
        ctx.stroke();
        ctx.fill("evenodd");
    };
    battle.run(10);
    updateBattleUI();
}

function startDuel() {
    // Use dramatic seed if available and dramatic mode is on
    if (dramaticCheck.checked) {
        const [i, j] = combatants[0] < combatants[1] ? combatants : [combatants[1], combatants[0]];
        const key = `${ballClasses[i].name}_${ballClasses[j].name}`;
        const seeds = DRAMATIC_SEEDS[key];
        // console.log(key);
        if (seeds?.length) {
            battleSeed = seeds[Math.floor(Math.random() * seeds.length)];
            console.log("used", battleSeed);
            combatants = [i, j];
        }
    }

    menuDiv.classList.add("hidden");
    battleDiv.classList.remove("hidden");

    const rng = new Math.seedrandom(battleSeed);
    const positions = [[50, 200], [350, 200]];
    canvas.width = canvas.height = "406";

    battle = new BallBattle(combatants.map((comb, i) => makeBall(comb, positions[i], rng)), battleSeed, 0.1);
    battle.addCanvas(document.getElementById("canvas"), wallThickness);
    const closureBattle = battle;
    battle.drawArena = (ctx) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, closureBattle.width, closureBattle.height);
        ctx.lineWidth = 2 * wallThickness;
        ctx.strokeRect(0, 0, closureBattle.width, closureBattle.height);
        ctx.fillRect(0, 0, closureBattle.width, closureBattle.height);
    };
    battle.run(10);
    updateBattleUI();
}

document.getElementById("back").addEventListener("click", () => {
    battle?.stop();
    battle = null;
    displayedHP = {};
    deathOrder = [];
    battleDiv.classList.add("hidden");
    battleDiv.classList.remove("ffa-mode");
    menuDiv.classList.remove("hidden");
    document.getElementById("leaderboard").innerHTML = "";
    document.getElementById("canvas").style.transform = "";
    document.getElementById("canvas").style.width = "";
    document.getElementById("canvas").style.height = "";
}); 