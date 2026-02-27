"use strict"

const d = new Date().getTime();
console.log(d);
Math.seedrandom(d);
// Math.seedrandom(1772147498956);
// 1771802437381 good seed

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

function makeBall(i, pos) {
    const data = ballClasses[i];
    const spinArgs = data.weapon.spin ? [
        pos == 0 ? 0 : Math.PI,
        pos == 0 ? 1 : -1,
    ] : [];
    return new data.class(
        pos == 0 ? 50 : 300,
        200,
        ...randomVel(5),
        ...spinArgs,
        data.hp
    );
}

let battle;
const ball1Info = document.getElementById("ball1-info");
const ball2Info = document.getElementById("ball2-info");

function updateBattleUI() {
    if (!battle || battle.balls.length < 2) return;

    [ball1Info, ball2Info].forEach((el, i) => {
        const data = ballClasses[combatants[i]];
        const b = battle.balls.find(ball => ball.team === data.color && !ball.owner)
            || battle.balls.find(ball => ball.team === data.color);
        if (!b) { el.innerHTML = `<div class="name">${data.name}</div><div class="stat">DEFEATED</div>`; return; }

        let stats = `HP: ${Math.ceil(b.hp)}`;
        if (b.getInfoEl) stats += `<br>${b.getInfoEl().innerText.replace(/\n/g, '<br>')}`;
        el.innerHTML = `<div class="name">${data.name}</div><div class="stat">${stats}</div>`;
    });
    requestAnimationFrame(updateBattleUI);
}

fightBtn.addEventListener("click", function () {
    if (fightBtn.classList.contains("disabled")) return;

    menuDiv.classList.add("hidden");
    battleDiv.classList.remove("hidden");

    battle = new BallBattle(combatants.map((comb, pos) => makeBall(comb, pos)));
    battle.addCanvas(document.getElementById("canvas"));
    battle.run(12.5);
    updateBattleUI();
});
