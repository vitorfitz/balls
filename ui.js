"use strict"

const d = new Date().getTime();
console.log(d);
let battleSeed = d;
// let battleSeed = 654;

const dramaticCheck = document.getElementById("dramatic-check");

const menuDiv = document.getElementById("menu");
const fightBtn = document.getElementById("start");
const ballPicker = document.getElementById("balls");
const battleDiv = document.getElementById("battle");

const menuRadius = 226;
const ballBtnDiameter = 122;
const canvasPadding = 70;
let combatants = [];
let ballBtns = [];

{
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
        const offset = "16px";
        if (theta <= Math.PI) {
            nameSpan.style.top = offset;
        }
        else {
            nameSpan.style.bottom = offset;
        }
        btn.appendChild(nameSpan);

        btn.addEventListener("click", () => {
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

function makeBall(i, pos, rng) {
    const data = ballClasses[i];
    const spinArgs = data.weapon?.spin ? [
        pos == 0 ? 0 : Math.PI,
        pos == 0 ? 1 : -1,
    ] : [];
    const theta = rng() * 2 * Math.PI;
    return new data.class(
        pos == 0 ? 50 : 350,
        200,
        Math.cos(theta) * 5,
        Math.sin(theta) * 5,
        ...spinArgs,
        data.hp
    );
}

let battle;
let displayedHP = {};
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
            const offset = "8px";
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

fightBtn.addEventListener("click", function () {
    if (fightBtn.classList.contains("disabled")) return;

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
    battle = new BallBattle(combatants.map((comb, pos) => makeBall(comb, pos, rng)), battleSeed);
    battle.addCanvas(document.getElementById("canvas"));
    battle.run(10);
    updateBattleUI();
});
