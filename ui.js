"use strict"

const d = new Date().getTime();
console.log(d);
let battleSeed = d;
// let battleSeed = 1774667125058;

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
let ballBtns = [];
let mode = 0;

{
    // const theta0 = 13 * Math.PI / 8;
    const theta0 = 3 * Math.PI / 2;
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

function makeBall(i, pos, rng, speed = 5) {
    const data = ballClasses[i];
    const spinArgs = data.weapon?.spin ? [
        pos[0] < 200 ? 0 : Math.PI,
        pos[0] < 200 ? 1 : -1,
    ] : [];
    const theta = rng() * 2 * Math.PI;
    return new data.class(
        pos[0], pos[1],
        Math.cos(theta) * speed,
        Math.sin(theta) * speed,
        ...spinArgs,
        data.hp,
        undefined,
        data.color
    );
}

let battle;
let displayedHP = {};
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

        const hp = b.getDisplayedHP();
        const key = data.color;
        if (!(key in displayedHP)) displayedHP[key] = hp;
        displayedHP[key] += (hp - displayedHP[key]) * 0.05;

        hpText.textContent = hp;
        hpText.style.color = displayedHP[key] / data.hp < 0.25 ? "#fff" : "#333";
        drawHealthBar(hpCanvas, displayedHP[key], data.hp, data.color, i);

        // Update stat info
        const oldInfo = el.querySelector(".stat > ul");
        if (oldInfo) oldInfo.remove();
        if (b.getInfoEl) el.querySelector(".stat").appendChild(b.getInfoEl());
    });
    requestAnimationFrame(updateBattleUI);
}

function updateFFALeaderboard() {
    const lb = document.getElementById("leaderboard");

    // Build sorted list of combatants by HP, freezing dead ball positions
    const entries = combatants.map(i => {
        const data = ballClasses[i];
        const b = battle.balls.find(ball => ball.team === data.color && !ball.owner);
        if (!b && !deathOrder.includes(i)) deathOrder.push(i);
        return { i, data, b, hp: b ? b.getDisplayedHP() : 0 };
    });

    // Sort: alive balls by HP descending, dead balls by death order (first dead = last place)
    entries.sort((a, b) => {
        const aDead = deathOrder.includes(a.i);
        const bDead = deathOrder.includes(b.i);
        if (aDead && bDead) return deathOrder.indexOf(b.i) - deathOrder.indexOf(a.i);
        if (aDead) return 1;
        if (bDead) return -1;
        return b.hp - a.hp;
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

        const hp = b.getDisplayedHP();
        const key = data.color;
        if (!(key in displayedHP)) displayedHP[key] = hp;
        displayedHP[key] += (hp - displayedHP[key]) * 0.05;

        el.querySelector(".hp-text").textContent = hp;
        el.querySelector(".hp-text").style.color = displayedHP[key] / data.hp < 0.25 ? "#fff" : "#333";
        drawHealthBar(el.querySelector(".hp-canvas"), displayedHP[key], data.hp, data.color, false);
        el.querySelector(".dmg").lastChild.textContent = Math.round(b.damageDealt);

        const oldInfo = el.querySelector("ul");
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
    if (mode == 1) {
        startFFA();
    }

    if (!fightBtn.classList.contains("disabled")) {
        startDuel();
    }
});

function startFFA() {
    menuDiv.classList.add("hidden");
    battleDiv.classList.remove("hidden");
    battleDiv.classList.add("ffa-mode");

    const canvas = document.getElementById("canvas");
    const size = 1500, armWidth = 900, holeSize = 300;
    canvas.width = canvas.height = size + 2 * wallThickness;
    canvas.style.width = canvas.style.height = "800px";

    if (dramaticCheck.checked) {
        battleSeed = FFA_DRAMATIC_SEEDS[Math.floor(Math.random() * FFA_DRAMATIC_SEEDS.length)];
        console.log("used", battleSeed);
    }

    const rng = new Math.seedrandom(battleSeed);
    const armStart = (size - armWidth) / 2, armEnd = (size + armWidth) / 2;

    // Generate positions within the plus arms (avoid corners and center hole)
    const positions = [
        [750, 1350],
        [150, 450],
        [150, 1050],
        [1350, 450],
        [1350, 1050],
        [450, 150],
        [1050, 150],
    ];
    combatants = [];
    for (let i = 0; i < ballClasses.length; i++) {
        const b = ballClasses[i];
        if (b.class != DuplicatorBall /*&& b.class != GrowerBall*/) combatants.push(i);
    }

    battle = new BallBattle(combatants.map((i, j) => {
        const b = makeBall(i, positions[j], rng, 4);
        return b;
    }), battleSeed, 0.025);
    battle.addCanvas(canvas, wallThickness);
    battle.walls = createPlusArenaWalls(size, armWidth, holeSize);
    battle.zoom = 1;
    battle.shrinkConfig = {
        baseSize: size,
        baseArmWidth: armWidth,
        holeSize: holeSize,
        stages: [
            { players: 4, size: 900, zoom: 1.45 },
            { players: 2, size: 600, holeSize: 200, zoom: 1.8 },
        ]
    };
    battle.isInBounds = (x, y, r) => {
        const hs = (size - holeSize) / 2, he = (size + holeSize) / 2;
        // Outside arena bounds
        if (x - r < 0 || x + r > size || y - r < 0 || y + r > size) return false;
        // Inside center hole
        if (x + r > hs && x - r < he && y + r > hs && y - r < he) return false;
        // Inside plus arms
        return (x - r >= armStart && x + r <= armEnd) || (y - r >= armStart && y + r <= armEnd);
    };
    battle.drawArena = (ctx) => {
        const as = armStart, ae = armEnd, hs = (size - holeSize) / 2, he = (size + holeSize) / 2;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        // Outer plus shape (clockwise)
        ctx.moveTo(as, 0);
        ctx.lineTo(ae, 0);
        ctx.lineTo(ae, as);
        ctx.lineTo(size, as);
        ctx.lineTo(size, ae);
        ctx.lineTo(ae, ae);
        ctx.lineTo(ae, size);
        ctx.lineTo(as, size);
        ctx.lineTo(as, ae);
        ctx.lineTo(0, ae);
        ctx.lineTo(0, as);
        ctx.lineTo(as, as);
        ctx.closePath();
        // Center hole (counter-clockwise for evenodd)
        ctx.moveTo(hs, hs);
        ctx.lineTo(hs, he);
        ctx.lineTo(he, he);
        ctx.lineTo(he, hs);
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
    battle = new BallBattle(combatants.map((comb, i) => makeBall(comb, positions[i], rng)), battleSeed, 0.1);
    battle.addCanvas(document.getElementById("canvas"), wallThickness);
    battle.drawArena = (ctx) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, battle.width, battle.height);
        ctx.lineWidth = 2 * wallThickness;
        ctx.strokeRect(0, 0, battle.width, battle.height);
        ctx.fillRect(0, 0, battle.width, battle.height);
    };
    battle.run(10);
    updateBattleUI();
}