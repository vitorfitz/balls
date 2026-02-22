"use strict"

const d = new Date().getTime();
console.log(d);
Math.seedrandom(1771802437381);

const GRAVITY = 0.1;
const ELASTICITY = 1.0; // restitution for collisions (1.0 = perfectly elastic)
const EPS = 1e-9;
const flashDur = 20;
const SLOW_FACTOR = 0.2; // how slow "slowed" entities move

let t = 0;

let spriteReqs = {};

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

class Weapon {
    constructor(theta, sprite, scale = 1, offset = 0, spriteShift = 0, rotation = Math.PI / 4, flipped = false) {
        this.theta = theta;
        if (!(sprite in spriteReqs)) spriteReqs[sprite] = [];
        spriteReqs[sprite].push(this);
        this.scale = scale;
        this.offset = offset;
        this.spriteShift = spriteShift;
        this.rotation = rotation;
        this.flipped = flipped;
        this.ball = null;
        this.updateFns = [];
        this.weaponColFns = [];
        this.ballColFns = [];
        this._collidingWith = {};
    }

    getHitSegment() {
        const b = this.ball;
        const angle = this.theta;

        const r0 = b.radius + (this.colliderOffset || 0);
        const r1 = b.radius + this.range;

        return {
            x1: b.x + Math.cos(angle) * r0,
            y1: b.y + Math.sin(angle) * r0,
            x2: b.x + Math.cos(angle) * r1,
            y2: b.y + Math.sin(angle) * r1,
            r: this.thickness
        };
    }

    draw() {
        const ctx = this.ball.battle.ctx;
        const ball = this.ball;

        const angle = this.theta;
        const distance = ball.radius + this.offset;

        // normal direction
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);

        // tangent direction
        const tx = -Math.sin(angle);
        const ty = Math.cos(angle);

        const wx =
            ball.x +
            nx * distance +
            tx * this.spriteShift;

        const wy =
            ball.y +
            ny * distance +
            ty * this.spriteShift;

        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(angle + this.rotation);
        ctx.scale(this.scale, this.scale);

        // Anchor at bottom-left for right-pointing, bottom-right for left-pointing
        const leftPointing = Math.cos(this.rotation) < 0;
        const ax = leftPointing ? -this.sprite.width : 0;
        ctx.drawImage(this.sprite, ax, -this.sprite.height);
        ctx.restore();
    }

    addCollider(range, thickness, offset = 0) {
        this.range = range;
        this.thickness = thickness;
        this.colliderOffset = offset;
    }

    addSpin(angVel) {
        // return;
        this.angVel = angVel;
        this.updateFns.push((me, dt) => me.theta += dt * (me.angVel % (2 * Math.PI)));
    }

    addParry() {
        this.flipped = this.angVel < 0;
        this.weaponColFns.push((me, other) => {
            // Reverse if rotating toward the other weapon
            const toOther = Math.atan2(other.ball.y - me.ball.y, other.ball.x - me.ball.x);
            const approaching = Math.sin(toOther - me.theta) * me.angVel > 0;
            if (approaching) {
                me.angVel = -me.angVel;
                // me.ball.slowTime = other.ball.slowTime = 15;
            }
            me.flipped = me.angVel < 0;
        });
    }

    addDamageFn(fn, iframes = 15, slow = 0, DoT = false) {
        this.dmgFn = fn;
        this.DoT = DoT;
        this.iframes = iframes;
        this.ballColFns.push((me, b) => {
            const dmg = fn(me, b);
            if (dmg < 0) return;
            b.damage(dmg);
            applySlowTime(slow, me.ball, b);
        });
    }

    addDamage(dmg, iframes, slow, DoT) {
        this.dmg = dmg;
        this.addDamageFn((me) => me.dmg, iframes, slow, DoT);
    }

    addDirChange() {
        this.ballColFns.push((me) => me.angVel *= -1);
    }
}

class CircleBody {
    constructor(x, y, vx, vy, hp, radius, mass = radius * radius, grav = true) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.hp = hp;
        this.radius = radius;
        this.mass = mass;
        this.slowTime = 0;
        this.inert = false;
        this.gravity = grav;
        this.zIndex = 1;
    }

    getTimeScale() {
        return this._slowedAtFrameStart ? SLOW_FACTOR : 1;
    }

    getZIndex() {
        return this.zIndex - (this.inert ? 727 : 0);
    }

    onLoad() { }

    onCollision(b) { }

    onWallCollision() { }

    onUpdate() { }

    shouldBounce(other) { return false; }

    shouldBounceWall(wall) { return true; }

    damage(dmg) {
        this.hp = Math.max(0, this.hp - dmg);
    }

    getRootOwner() {
        let b = this;
        while (b.owner) {
            b = b.owner;
        }
        return b;
    }
}

class Ball extends CircleBody {
    constructor(x, y, vx, vy, hp, radius, color, mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, mass, true);
        this.mass = mass;
        this.color = color;
        this.team = this.color;
        this.weapons = [];
        this.parryWeapons = [];
        this.dmgWeapons = [];
    }

    addWeapon(w, canParry = w.range && w.thickness) {
        w.ball = this;
        this.weapons.push(w);
        if (w.ballColFns.length > 0) this.dmgWeapons.push(w);
        if (canParry) this.parryWeapons.push(w);
    }

    damage(dmg) {
        super.damage(dmg);
        this.flashTime = flashDur;
    }

    draw() {
        this.weapons.forEach((w) => w.draw());

        const flashPct = Math.max(0, this.flashTime / flashDur);
        const color = this.flashTime > 0
            ? `color-mix(in srgb, white ${flashPct * 100}%, ${this.color})`
            : this.color;
        this.battle.drawCircle(this, color, "#333", 2)

        if (this.flashTime > 0) this.flashTime--;

        const ctx = this.battle.ctx;
        ctx.fillStyle = "#000";
        ctx.font = `bold ${this.radius}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(Math.ceil(this.hp), this.x, this.y);
    }

    shouldBounce(other) { return true; }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx ** 2 + this.vy ** 2);
    }

    potentialEnergy() {
        return this.mass * GRAVITY * (this.battle.height - this.radius - this.y);
    }

    onUpdate(dt) {
        if (this.owner && this.owner.hp <= 0) {
            this.hp = 0;
            return;
        }
        this.handleUpdate(dt);
    }

    handleUpdate(dt) { }
}

const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

function timeToWallCollision(b, dt) {
    let tMin = Infinity;
    let wall = null;
    const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;
    const g = b.gravity ? GRAVITY : 0;

    // Left wall
    if (b.vx < 0) {
        const t = (b.radius - b.x) / b.vx;
        if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = LEFT; }
    }

    // Right wall
    if (b.vx > 0) {
        const t = (b.battle.width - b.radius - b.x) / b.vx;
        if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = RIGHT; }
    }

    // Top wall
    if (g > 0) {
        const a = 0.5 * g;
        const bq = b.vy;
        const c = b.y - b.radius;
        const disc = bq * bq - 4 * a * c;
        if (disc >= 0) {
            const t = (-bq - Math.sqrt(disc)) / (2 * a);
            if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = TOP; }
        }
    } else if (b.vy < 0) {
        const t = (b.radius - b.y) / b.vy;
        if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = TOP; }
    }

    // Bottom wall
    if (g > 0) {
        const a = 0.5 * g;
        const bq = b.vy;
        const c = b.y - (b.battle.height - b.radius);
        const disc = bq * bq - 4 * a * c;
        if (disc >= 0) {
            const t = (-bq + Math.sqrt(disc)) / (2 * a);
            if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = BOTTOM; }
        }
    } else if (b.vy > 0) {
        const t = (b.battle.height - b.radius - b.y) / b.vy;
        if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = BOTTOM; }
    }

    return { t: tMin, wall };
}

function resolveWallCollision(b, wall) {
    b.onWallCollision();
    if (!b.shouldBounceWall(wall)) return;

    if (wall === LEFT || wall === RIGHT) {
        b.vx = -b.vx * ELASTICITY;
    }
    if (wall === TOP || wall === BOTTOM) {
        b.vy = -b.vy * ELASTICITY;
    }
}

function resolveImmediateWallContact(b) {
    const floorY = b.battle.height - b.radius;

    if (b.y >= floorY - EPS && b.vy > 0) {
        b.y = floorY;
        b.vy = -b.vy * ELASTICITY;
        return true;
    }
    return false;
}


function ballsOverlap(b1, b2) {
    return Math.hypot(b2.x - b1.x, b2.y - b1.y) < b1.radius + b2.radius;
}

// Find time of collision between two balls (returns Infinity if no collision in dt)
function timeToCollision(b1, b2, dt) {
    if (b1 instanceof Ball && b2 instanceof Ball && (b1.inert || b2.inert)) return Infinity;
    if (b1 instanceof Bullet && b2 instanceof Bullet) return Infinity;
    if (b1 instanceof Turret && b2 instanceof Turret) return Infinity;
    if (b1 instanceof Bullet && b1.prevHitCredit == null && b2.team === b1.owner.team) return Infinity;
    if (b2 instanceof Bullet && b2.prevHitCredit == null && b1.team === b2.owner.team) return Infinity;
    if (ballsOverlap(b1, b2)) return Infinity;

    const s1 = b1.getTimeScale();
    const s2 = b2.getTimeScale();
    const g1 = (b1.gravity ? GRAVITY : 0) * s1;
    const g2 = (b2.gravity ? GRAVITY : 0) * s2;
    const dg = g2 - g1;
    const R = b1.radius + b2.radius;

    // Effective velocities accounting for slow
    const v1x = b1.vx * s1, v1y = b1.vy * s1;
    const v2x = b2.vx * s2, v2y = b2.vy * s2;

    // If gravity is the same, use quadratic solution
    if (Math.abs(dg) < EPS) {
        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const dvx = v2x - v1x;
        const dvy = v2y - v1y;

        const a = dvx * dvx + dvy * dvy;
        const b = 2 * (dx * dvx + dy * dvy);
        const c = dx * dx + dy * dy - R * R;

        if (a < EPS) return Infinity;

        const disc = b * b - 4 * a * c;
        if (disc < 0) return Infinity;

        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t > EPS && t <= dt) return t;
        return Infinity;
    }

    // Different gravity: binary search
    const f = (t) => {
        const p1x = b1.x + v1x * t;
        const p1y = b1.y + v1y * t + 0.5 * g1 * t * t;
        const p2x = b2.x + v2x * t;
        const p2y = b2.y + v2y * t + 0.5 * g2 * t * t;
        return (p2x - p1x) ** 2 + (p2y - p1y) ** 2 - R * R;
    };

    if (f(dt) > 0) return Infinity;

    let lo = 0, hi = dt;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid;
        else hi = mid;
    }

    return hi > EPS ? hi : Infinity;
}

// function a() {
//     let energySum = 0;
//     for (let b of battle.balls) {
//         energySum += b.potentialEnergy() + b.kineticEnergy();
//     }
//     return energySum;
// }

// Elastic collision response
function resolveCollision(b1, b2) {
    b1.onCollision(b2);
    b2.onCollision(b1);

    // if (b1 instanceof Bullet || b2 instanceof Bullet) {
    //     const bullet = b1 instanceof Bullet ? b1 : b2;
    //     const other = b1 instanceof Bullet ? b2 : b1;
    //     const dist = Math.hypot(b2.x - b1.x, b2.y - b1.y);
    //     const sumR = b1.radius + b2.radius;
    //     console.log(`[t=${t}] Bullet collision: bullet.id=${bullet.id} other.id=${other.id} dist=${dist.toFixed(4)} sumR=${sumR} overlap=${ballsOverlap(b1, b2)} bullet.hp=${bullet.hp}`);
    // }

    const bounce1 = b1.shouldBounce(b2);
    const bounce2 = b2.shouldBounce(b1);
    if (!bounce1 || !bounce2) return;

    if (b1.mass == 0 && b2.mass == 0) return;

    const dx = b2.x - b1.x;
    const dy = b2.y - b1.y;
    const dist = Math.hypot(dx, dy);

    const nx = dx / dist;
    const ny = dy / dist;

    // Remove lance boost from velocity for collision calculation
    const getUnboosted = (b) => {
        if (!(b instanceof LanceBall) || b.boostEnergy <= 0) return { vx: b.vx, vy: b.vy };
        const speed = Math.hypot(b.vx, b.vy);
        if (speed < EPS) return { vx: b.vx, vy: b.vy };
        // boostEnergy = 0.5 * (speed² - unboostedSpeed²), so unboostedSpeed = sqrt(speed² - 2*boostEnergy)
        const unboostedSpeed = Math.sqrt(Math.max(0, speed * speed - 2 * b.boostEnergy));
        return { vx: b.vx / speed * unboostedSpeed, vy: b.vy / speed * unboostedSpeed };
    };

    const ub1 = getUnboosted(b1), ub2 = getUnboosted(b2);
    const v1x = ub1.vx, v1y = ub1.vy;
    const v2x = ub2.vx, v2y = ub2.vy;

    const dvx = v2x - v1x;
    const dvy = v2y - v1y;
    const velAlongNormal = dvx * nx + dvy * ny;

    if (velAlongNormal > 0) {
        for (const [a, b] of [[b1, b2], [b2, b1]]) {
            if (a instanceof LanceBall) {
                const toB = a === b1 ? 1 : -1;
                const dot_a = a.vx * nx + a.vy * ny;
                const dot_b = b.vx * nx + b.vy * ny;
                if ((dot_a - dot_b) * toB > 0) {
                    const dot = a.vx * nx + a.vy * ny;
                    a.vx -= 2 * dot * nx;
                    a.vy -= 2 * dot * ny;
                }
            }
        }
        return;
    }

    // if (t >= 0 && (b1 instanceof LanceBall || b2 instanceof LanceBall)) console.log(`[t=${t}]`, `Entered with energy=${a()}, lance vel=${Math.hypot(battle.balls[0].vx, battle.balls[0].vy)}, unboosted lance vel=${Math.hypot(b1 instanceof LanceBall ? v1x : v2x, b1 instanceof LanceBall ? v1y : v2y)}, other vel=${Math.hypot(b1 instanceof LanceBall ? v2x : v1x, b1 instanceof LanceBall ? v2y : v1y)}`);

    const invMass1 = b2.mass == 0 ? 0 : 1 / b1.mass;
    const invMass2 = b1.mass == 0 ? 0 : 1 / b2.mass;
    const j = -(1 + ELASTICITY) * velAlongNormal / (invMass1 + invMass2);

    const new1x = v1x - j * invMass1 * nx;
    const new1y = v1y - j * invMass1 * ny;
    const new2x = v2x + j * invMass2 * nx;
    const new2y = v2y + j * invMass2 * ny;

    // Add boost back to new velocities (preserving boost energy, not speed delta)
    for (const [b, nvx, nvy, sign] of [[b1, new1x, new1y, -1], [b2, new2x, new2y, 1]]) {
        if (!(b instanceof LanceBall) || b.boostEnergy <= 0) {
            b.vx = nvx;
            b.vy = nvy;
            continue;
        }

        const newSpeed = Math.hypot(nvx, nvy);
        const targetSpeed = Math.sqrt(newSpeed * newSpeed + 2 * b.boostEnergy);

        if (newSpeed > EPS) {
            b.vx = nvx / newSpeed * targetSpeed;
            b.vy = nvy / newSpeed * targetSpeed;
        } else {
            // Near-zero velocity: apply boost along collision normal (away from other ball)
            b.vx = nx * sign * targetSpeed;
            b.vy = ny * sign * targetSpeed;
        }
    }

    for (const [a, b] of [[b1, b2], [b2, b1]]) {
        if (a instanceof LanceBall) {
            const toB = a === b1 ? 1 : -1;
            const relVel = ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny) * toB;
            if (relVel <= 0) continue;

            const dot_a = a.vx * nx + a.vy * ny;
            const dot_b = b.vx * nx + b.vy * ny;
            if ((dot_a - dot_b) * toB > 0) {
                const dot = a.vx * nx + a.vy * ny;
                a.vx -= 2 * dot * nx;
                a.vy -= 2 * dot * ny;
            }
        }
    }

    // if (t >= 0 && (b1 instanceof LanceBall || b2 instanceof LanceBall)) console.log(`Exited with energy=${a()}, lance vel=${Math.hypot(battle.balls[0].vx, battle.balls[0].vy)}, unboosted lance vel=${Math.hypot(b1 instanceof LanceBall ? new1x : new2x, b1 instanceof LanceBall ? new1y : new2y)}, other vel=${Math.hypot(b1 instanceof LanceBall ? new2x : new1x, b1 instanceof LanceBall ? new2y : new1y)}`);
}

function advanceAll(balls, t) {
    // return;
    for (const b of balls) {
        const dt = t * b.getTimeScale();
        const g = b.gravity ? GRAVITY : 0;
        b.x += b.vx * dt;
        b.y += b.vy * dt + 0.5 * g * dt * dt;
        b.vy += g * dt;
    }
}

function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);

    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));

    const x = x1 + t * dx;
    const y = y1 + t * dy;
    return Math.hypot(px - x, py - y);
}

function weaponHitsBall(w, b) {
    const seg = w.getHitSegment();
    const d = distToSegment(b.x, b.y, seg.x1, seg.y1, seg.x2, seg.y2);
    return d <= (seg.r + b.radius);
}

function weaponWeaponContact(w1, w2) {
    const a = w1.getHitSegment();
    const b = w2.getHitSegment();
    const cx = (b.x1 + b.x2) * 0.5;
    const cy = (b.y1 + b.y2) * 0.5;
    return distToSegment(cx, cy, a.x1, a.y1, a.x2, a.y2) <= a.r + b.r;
}

// Profiling
// const profiler = {
//     physics: 0, weapons: 0, render: 0, frames: 0,
//     log() {
//         if (++this.frames % 100 === 0) {
//             console.log(`[${this.frames}] physics: ${(this.physics / 100).toFixed(2)}ms, weapons: ${(this.weapons / 100).toFixed(2)}ms, render: ${(this.render / 100).toFixed(2)}ms, bodies: ${battle.bodies.length}`);
//             this.physics = this.weapons = this.render = 0;
//         }
//     }
// };

function applySlowTime(slow, attacker, receiver) {
    if (receiver instanceof DuplicatorBall || attacker.owner || attacker.hp <= 0 || receiver.owner || receiver.hp <= 0) return;
    attacker.slowTime = Math.max(attacker.slowTime, slow);
    receiver.slowTime = Math.max(receiver.slowTime, slow);
}

class BallBattle {
    constructor(balls) {
        this.balls = [];
        this.bodies = [];

        this.nextID = 0;
        this.debug = true;
        // this.debug = false;
        // this.dupeCooldown = {};
        for (let b of balls) {
            this.addBall(b);
        }

        this.lastTime = null;
        this.accumulator = 0;
    }

    addBody(body) {
        body.battle = this;
        this.bodies.push(body);
        if (body.id == null) body.id = this.nextID++;
        body.onLoad();
    }

    addBall(ball) {
        this.addBody(ball);
        this.balls.push(ball);
    }

    addCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.ctx.imageSmoothingEnabled = false;
        this.width = canvas.width;
        this.height = canvas.height;
    }

    drawCircle(circle, color, borderColor = "#333", borderWidth = 0) {
        const ctx = this.ctx;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.fillStyle = color;

        ctx.beginPath();
        ctx.arc(circle.x, circle.y, circle.radius - ctx.lineWidth / 2, 0, Math.PI * 2);
        if (borderWidth > 0) ctx.stroke();
        ctx.fill();
    }

    updatePhysics() {
        // Reactivate inert balls that have escaped overlap
        for (const b of this.bodies) {
            if (b.inert && this.bodies.every(o => o.inert || !ballsOverlap(b, o))) {
                b.inert = false;
            }
        }
        const tee = t;

        let dt = 1;
        const collidedThisFrame = new Set();
        while (dt > EPS) {
            // --- Find earliest ball-ball collision ---
            let tBall = Infinity;
            let pair = null;

            for (let i = 0; i < this.bodies.length; i++) {
                for (let j = i + 1; j < this.bodies.length; j++) {
                    const key = this.bodies[i].id + '-' + this.bodies[j].id;
                    if (collidedThisFrame.has(key)) continue;
                    const t = timeToCollision(this.bodies[i], this.bodies[j], dt);
                    if (t < tBall) {
                        tBall = t;
                        pair = [this.bodies[i], this.bodies[j]];
                    }
                }
            }

            // --- Find earliest wall collision ---
            let tWall = Infinity;
            let wallEvents = [];

            for (const b of this.bodies) {
                const res = timeToWallCollision(b, dt);
                if (res.t < tWall - EPS) {
                    tWall = res.t;
                    wallEvents = [{ ball: b, wall: res.wall }];
                } else if (Math.abs(res.t - tWall) <= EPS) {
                    wallEvents.push({ ball: b, wall: res.wall });
                }
            }

            // --- Choose earliest event ---
            const tNext = Math.min(tBall, tWall);

            if (tNext === Infinity) {
                advanceAll(this.bodies, dt);
                return;
            }

            advanceAll(this.bodies, tNext);
            dt -= tNext;

            // Ball-ball
            if (tBall <= tNext + EPS) {
                // console.log(`[t=${t}] Physics loop: tNext=${tNext.toFixed(6)} tBall=${tBall.toFixed(6)} remaining dt=${dt.toFixed(6)}`);
                resolveCollision(pair[0], pair[1]);
                collidedThisFrame.add(pair[0].id + '-' + pair[1].id);
            }

            // Walls
            if (tWall <= tNext + EPS) {
                for (const ev of wallEvents) {
                    resolveWallCollision(ev.ball, ev.wall);
                }
            }
        }
    }

    updateWeapons() {
        // Decrement slowTime for all balls
        for (const b of this.balls) {
            if (b.slowTime > 0) b.slowTime--;
        }

        // Handle fast-spinning weapons (>= 1 full rotation per frame) separately
        const TWO_PI = 2 * Math.PI;
        const activeBalls = this.balls.filter(b => !b.inert);
        for (const b of activeBalls) {
            const scaledDt = b.getTimeScale();
            for (const w of b.dmgWeapons) {
                const rotations = Math.floor(Math.abs(w.angVel || 0) * scaledDt / TWO_PI);
                if (rotations >= 1) {
                    // Deal damage once per full rotation to all enemies in range
                    for (const target of activeBalls) {
                        if (target.team === b.team) continue;
                        const dist = Math.hypot(target.x - b.x, target.y - b.y);
                        if (dist <= b.radius + Math.sqrt(w.range ** 2 + (w.thickness / 2) ** 2) + target.radius) {
                            for (let i = 0; i < rotations; i++) {
                                w.ballColFns.forEach(fn => fn(w, target));
                            }
                        }
                    }
                }
            }
        }

        // Subdivide based on remainder angular velocity or lance speed to avoid tunneling
        const maxAngVel = Math.max(...this.balls.flatMap(b => b.weapons.map(w => (Math.abs(w.angVel || 0) * b.getTimeScale()) % TWO_PI)), 0.01);
        const maxLanceSpeed = Math.max(...this.balls.filter(b => b instanceof LanceBall).map(b => Math.hypot(b.vx, b.vy)), 0);
        const substeps = Math.max(Math.ceil(maxAngVel / 0.1), Math.ceil(maxLanceSpeed / 10));
        const subDt = 1 / substeps;

        const hitThisFrame = new Set(); // tracks "weaponIdx-ballId" pairs that hit

        for (let step = 0; step < substeps; step++) {
            this.balls.forEach(
                (b) => {
                    const scaledDt = subDt * b.getTimeScale();
                    b.weapons.forEach(
                        (w) => w.updateFns.forEach((f) =>
                            f(w, scaledDt)));
                });
            this._checkWeaponCollisions(activeBalls, hitThisFrame);
        }

        // Decrement iframes for pairs that didn't hit during any substep
        for (const b of this.balls) {
            for (const w of b.dmgWeapons) {
                for (const id of Object.keys(w._collidingWith)) {
                    if (w.DoT || !hitThisFrame.has(w.ball.id + "-" + w.theta + "-" + id)) {
                        w._collidingWith[id]--;
                        if (w._collidingWith[id] <= 0) delete w._collidingWith[id];
                    }
                }
            }
        }
    }

    processDeaths() {
        const dead = this.balls.filter((b) => b.hp <= 0);
        dead.forEach((b) => b.slowTime = 0);
        this.balls = this.balls.filter((b) => b.hp > 0);
        this.bodies = this.bodies.filter((b) => b.hp > 0);
    }

    _checkWeaponCollisions(balls, hitThisFrame) {
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const A = balls[i];
                const B = balls[j];

                // weapon - ball
                for (const w of A.dmgWeapons) {
                    if (A.team !== B.team && weaponHitsBall(w, B)) {
                        hitThisFrame.add(A.id + "-" + w.theta + "-" + B.id);
                        if (!(B.id in w._collidingWith)) {
                            w._collidingWith[B.id] = w.iframes;
                            w.ballColFns.forEach(fn => fn(w, B));
                        }
                    }
                }

                for (const w of B.dmgWeapons) {
                    if (B.team !== A.team && weaponHitsBall(w, A)) {
                        hitThisFrame.add(B.id + "-" + w.theta + "-" + A.id);
                        if (!(A.id in w._collidingWith)) {
                            w._collidingWith[A.id] = w.iframes;
                            w.ballColFns.forEach(fn => fn(w, A));
                        }
                    }
                }

                // weapon - weapon
                for (const w1 of A.parryWeapons) {
                    for (const w2 of B.parryWeapons) {
                        if (weaponWeaponContact(w1, w2)) {
                            w1.weaponColFns.forEach(fn => fn(w1, w2));
                            w2.weaponColFns.forEach(fn => fn(w2, w1));
                        }
                    }
                }
            }
        }

        for (const ball of balls) {
            for (const w of ball.parryWeapons) {
                for (const body of this.bodies) {
                    if (body instanceof Bullet && body.owner !== ball) {
                        if (weaponHitsBall(w, body)) {
                            body.reflect(ball, w);
                        }
                    }
                }
            }
        }
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.debug) {
            this.ctx.globalAlpha = 0.5;
            for (const b of this.balls) {
                for (const w of b.weapons) {
                    if (w.range) {
                        const seg = w.getHitSegment();
                        this.ctx.beginPath();
                        this.ctx.moveTo(seg.x1, seg.y1);
                        this.ctx.lineTo(seg.x2, seg.y2);
                        this.ctx.strokeStyle = "red";
                        this.ctx.lineWidth = seg.r * 2;
                        this.ctx.lineCap = "butt";
                        this.ctx.stroke();
                    }
                }
            }
            this.ctx.globalAlpha = 1;
        }

        this.bodies
            .sort((a, b) => (a.getZIndex() - b.getZIndex()))
            .forEach(b => b.draw());
    }

    update() {
        for (const b of this.bodies) {
            b._slowedAtFrameStart = b.slowTime > 0 || (b.owner && b.owner.slowTime > 0);
            b.hpAtFrameStart = b.hp;
        }

        // let t0 = performance.now();
        this.updatePhysics();
        // profiler.physics += performance.now() - t0;

        for (let k in this.dupeCooldown) this.dupeCooldown[k]--;
        this.bodies.forEach((b) => b.onUpdate(b.getTimeScale()));

        // t0 = performance.now();
        this.updateWeapons();
        // profiler.weapons += performance.now() - t0;

        this.processDeaths();

        this.dupeCount = {};
        this.balls.forEach((b) => {
            if (b instanceof DuplicatorBall) this.dupeCount[b.team] = (this.dupeCount[b.team] ?? 0) + 1
        });
        // console.log({ ...this.dupeCount });
    }

    inBounds(x, y, radius) {
        return x >= radius && x <= this.width - radius
            && y >= radius && y <= this.height - radius;
    }

    async run(dt) {
        // while (t < 1600) {
        //     t++
        //     this.update();
        // }

        const loop = async (currentTime) => {
            if (this.lastTime !== null) {
                this.accumulator += currentTime - this.lastTime;

                while (this.accumulator >= dt) {
                    t++;
                    // let energySum = 0;
                    // for (let b of this.balls) {
                    //     energySum += b.potentialEnergy() + b.kineticEnergy();
                    // }
                    // console.log(energySum);

                    this.update();
                    this.accumulator -= dt;
                }
            }

            await Promise.all(
                Object.entries(spriteReqs).map(
                    async ([spriteName, weapons]) => {
                        const img = await loadImage(spriteName);
                        for (const weapon of weapons) {
                            weapon.sprite = img;
                        }
                    }
                )
            );
            spriteReqs = {};

            this.lastTime = currentTime;
            // let t0 = performance.now();
            this.render();
            // profiler.render += performance.now() - t0;
            // profiler.log();
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }
}

// Duplicator: Reproduces on hit
const dmgCooldown = 13, dupeCooldown = 26, dupeLimit = 26;
class DuplicatorBall extends Ball {
    constructor(x, y, vx, vy, hp = 50, radius = 20, color = "#d26ffa", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.dmgCooldown = 0;
        this.dupeCooldown = 0;
    }

    onCollision(b) {
        if (this.inert || b.team == this.team || !(b instanceof Ball) || (this.dmgCooldown > EPS)) return;

        if (b instanceof Ball) {
            // if (!(b instanceof DuplicatorBall)) console.log(`[t=${t}]`, this.id, "hit", this.dmgCooldown, this.dupeCooldown);
            b.damage(1);
        }
        this.dmgCooldown = dmgCooldown;

        if ((this.battle.dupeCount[this.team] ?? 0) >= dupeLimit || this.hpAtFrameStart <= 1 || this.dupeCooldown > EPS) return;

        // if (!(b instanceof DuplicatorBall)) this.battle.dupeCooldown[this.team] = 1;
        this.dupeCooldown = dupeCooldown;
        this.damage(1);

        const child = new DuplicatorBall(this.x, this.y, ...randomVel(5), this.hpAtFrameStart - (b instanceof DuplicatorBall ? 2 : 1));
        child.dmgCooldown = dmgCooldown;
        child.dupeCooldown = dupeCooldown;
        child.flashTime = flashDur;
        child.inert = true;
        child.team = this.team;
        child.color = this.color;
        child.radius = this.radius;
        child.owner = this.owner;
        this.battle.addBall(child);
    }

    handleUpdate(dt) {
        this.dmgCooldown -= dt;
        this.dupeCooldown -= dt;
    }
}

// Dagger: Spins faster
class DaggerBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#5fbf00", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const dagger = new Weapon(theta, "sprites/dagger.png", 3, -9);
        dagger.addCollider(30, 6);
        dagger.addSpin(Math.PI * 0.079 * dir);
        // dagger.addParry();
        dagger.addDamage(1, 1);
        // dagger.addDirChange();

        this.scalingCooldown = {};
        dagger.ballColFns.push((me, b) => {
            if (!(b.id in me.ball.scalingCooldown)) {
                me.angVel = (Math.abs(me.angVel) + Math.PI * 0.0158) * Math.sign(me.angVel);
                me.ball.scalingCooldown[b.id] = 24;
            }
        });

        this.addWeapon(dagger);
    }

    handleUpdate(dt) {
        for (let key in this.scalingCooldown) {
            if (this.scalingCooldown[key] <= 0) {
                delete this.scalingCooldown[key];
                break;
            }
            this.scalingCooldown[key] -= dt;
        }
    }
}

// Sword: Increases damage
class SwordBall extends Ball {
    constructor(x, y, vx, vy, theta, dir, hp = 100, radius = 25, color = "tomato", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const sword = new Weapon(theta, "sprites/sword.png", 4, -21);
        sword.addCollider(60, 8);
        sword.addSpin(Math.PI * 0.023 * dir);
        sword.addParry();
        sword.addDamage(1, 40);
        // sword.addDirChange();
        sword.ballColFns.push((me, b) =>
            me.dmg++
        );
        this.addWeapon(sword);
    }
}

// Lance: Increases movement speed and combos
const comboLeniency = 10, boostPct = 0.05;
class LanceBall extends Ball {
    constructor(x, y, vx, vy, hp = 100, radius = 25, color = "#dfbf9f", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.boostEnergy = 0;
        this.boosts = 0;
        this.dist = 0;
        this.combo = 0;
        this.hit = 0;
        this.damageThisTick = -1;
        this.tick = 0;
        this.comboHits = new Set();
        this.startSpeed = Math.hypot(vx, vy);

        const lance = new Weapon(Math.atan2(this.vy, this.vx), "sprites/spear.png", 4, -42, 0, 3 * Math.PI / 4);
        lance.addCollider(96, 15, 60);
        lance.addDamageFn((me, target) => {
            const b = me.ball;
            const oldHit = b.hit;
            b.hit = comboLeniency;
            if (b.dist > 0 && b.damageThisTick == -1) {
                return -1;
            }

            if (b.damageThisTick == -1) {
                const isNewTarget = !b.comboHits.has(target.id);
                if (isNewTarget) {
                    const boostSpeed = boostPct * this.startSpeed;
                    const speed = this.startSpeed + boostSpeed * b.boosts;
                    const newSpeed = speed + boostSpeed;
                    const energyGain = 0.5 * (newSpeed * newSpeed - speed * speed);
                    b.boostEnergy += energyGain;
                    b.boosts++;

                    const scale = newSpeed / speed;
                    b.vx *= scale;
                    b.vy *= scale;
                }

                if (b.combo == 0 || oldHit < comboLeniency - 1) b.dist = 0;

                b.comboHits.add(target.id);
                const distToHit = 82 * b.startSpeed;
                const counts = Math.floor(-b.dist / distToHit) + 1;
                b.dist += counts * distToHit;

                const oldCombo = b.combo;
                b.combo += counts;
                b.damageThisTick = (oldCombo + b.combo + 1) * counts / 2;
            }

            return b.damageThisTick;
        }, 0, undefined, true);

        this.addWeapon(lance);
    }

    handleUpdate(dt) {
        this.damageThisTick = -1;
        this.weapons[0].theta = Math.atan2(this.vy, this.vx);
        this.dist -= (this.vx ** 2 + this.vy ** 2) * dt;
        if (this.hit <= 0) {
            this.combo = 0;
            this.comboHits.clear();
        }
        else this.hit -= dt;
    }
}

// Machine Gun: fires bullets
const bulletRadius = 5, maxVolley = 120;
class MachineGunBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#4a90d9", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.damagePerRound = 10;
        this.pendingDamage = 0;
        this.bulletsPerRound = this.damagePerRound;
        this.reloadTime = 60;
        this.fireDelay = 0;
        this.bonusDmg = 0;
        this.bonusDmgRate = 0;
        this.ammoUse = 0;

        const gun = new Weapon(theta, "sprites/gun.png", 2, -9, 7, 0);
        gun.addCollider(45, 5);
        gun.addSpin(Math.PI * 0.017 * dir);
        gun.addParry();
        this.addWeapon(gun);
    }

    handleUpdate(dt) {
        this.reloadTime -= dt;
        if (this.reloadTime > EPS) return;

        this.fireDelay -= dt;

        while (this.fireDelay <= EPS && this.ammoUse < 1 - EPS) {
            this.bonusDmg += this.bonusDmgRate;
            const floor = Math.floor(this.bonusDmg);
            this.bonusDmg -= floor;
            let dmg = 1 + floor;

            // Offset position by how late this bullet is
            const spawnRadius = this.radius + this.weapons[0].range, speed = 7;
            const lateness = -this.fireDelay;
            const theta = this.weapons[0].theta - this.weapons[0].angVel * lateness;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            const ballX = this.x - this.vx * lateness;
            const ballY = this.y - this.vy * lateness;
            const spawnX = ballX + cosTheta * (spawnRadius + speed * lateness);
            const spawnY = ballY + sinTheta * (spawnRadius + speed * lateness);

            if (this.battle.inBounds(spawnX, spawnY, bulletRadius)) {
                const bullet = new MGBullet(
                    spawnX,
                    spawnY,
                    cosTheta * speed,
                    sinTheta * speed,
                    this,
                    dmg
                );
                this.battle.addBody(bullet);
            }

            this.ammoUse += 1 / this.bulletsPerRound;
            let fd = 90 / (120 * 0.2 + 0.8 * this.bulletsPerRound);
            this.fireDelay += fd;
        }

        if (this.ammoUse >= 1 - EPS) {
            this.ammoUse = 0;
            this.damagePerRound += this.pendingDamage;
            this.pendingDamage = 0;
            this.bonusDmgRate = Math.max(0, this.damagePerRound - maxVolley) / maxVolley;
            this.bulletsPerRound = Math.min(maxVolley, this.damagePerRound);
            // this.reloadTime = 60 + 200 / this.bulletsPerRound;
            this.reloadTime = 60;
            this.fireDelay = 0;
        }
    }
}

class Bullet extends CircleBody {
    constructor(x, y, vx, vy, owner, dmg = 1) {
        super(x, y, vx, vy, 1, bulletRadius, 0, false);
        this.owner = owner;
        this.reflectCooldown = 0;
        this.hitCredit = owner;
        this.prevHitCredit = null;
        this.dmg = dmg;
        this.color = "#111";
    }

    onLoad() {
        for (const b of this.battle.balls) {
            if (b.team !== this.owner.team && ballsOverlap(this, b)) {
                this.onCollision(b);
                break;
            }
        }
    }

    onCollision(b) {
        if (this.hp <= 0) return;
        if (b instanceof Bullet) return;
        this.handleCollision(b);
    }

    handleCollision(b) {
        if (b instanceof Ball) b.damage(this.dmg);
        if (b instanceof Turret) this.hp = 0;
    }

    onWallCollision() {
        this.hp = 0;
    }

    shouldBounce(other) { return false; }

    draw() {
        this.battle.drawCircle(this, this.color, "#333", 1);
    }

    onUpdate(dt) {
        this.reflectCooldown -= dt;
    }

    reflect(wielder, weapon) {
        if (this.reflectCooldown > 0) return;

        this.reflectCooldown = 10;
        if (wielder.team != this.hitCredit.team) this.prevHitCredit = this.hitCredit;
        this.hitCredit = wielder;

        // Get weapon segment direction
        const seg = weapon.getHitSegment();
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const len = Math.hypot(dx, dy);

        // Normal perpendicular to weapon
        let nx = -dy / len;
        let ny = dx / len;

        // Flip normal to face the incoming bullet
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
            nx = -nx;
            ny = -ny;
        }

        // Reflect velocity: v' = v - 2(v*n)n
        const dotFixed = this.vx * nx + this.vy * ny;
        this.vx -= 2 * dotFixed * nx;
        this.vy -= 2 * dotFixed * ny;
    }
}

class MGBullet extends Bullet {
    constructor(x, y, vx, vy, owner, dmg) {
        super(x, y, vx, vy, owner, dmg);
    }

    handleCollision(b) {
        super.handleCollision(b);

        if (b instanceof Ball) {
            // const damager = b.team == this.hitCredit.team ? this.prevHitCredit : this.hitCredit;
            // applySlowTime(20, damager, b);

            if (b.team != this.owner.team) {
                this.owner.pendingDamage += 1;
            }
        }
    }
}

// Wrench: Spawns turrets on hit
const turretRadius = 12.5;
class WrenchBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#ff9933", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const wrench = new Weapon(theta, "sprites/wrench.png", 2, -6, 0, 3 * Math.PI / 4);
        wrench.addCollider(45, 6);
        wrench.addSpin(Math.PI * 0.020 * dir);
        wrench.addParry();
        wrench.addDamage(1, 40);
        wrench.addDirChange();
        this.turretCooldown = 0;

        wrench.ballColFns.push((me, b) => {
            if (this.turretCooldown >= EPS) return;
            this.turretCooldown = 80;

            // Contact point: on target ball's surface, toward the wrench ball
            const dx = me.ball.x - b.x, dy = me.ball.y - b.y;
            const dist = Math.hypot(dx, dy);
            const nx = dx / dist, ny = dy / dist;
            const tx = b.x + nx * (b.radius + turretRadius);
            const ty = b.y + ny * (b.radius + turretRadius);
            if (me.ball.battle.inBounds(tx, ty, turretRadius)) {
                // Reflect ball velocity away from turret
                const dot = b.vx * nx + b.vy * ny;
                if (dot > 0) {
                    b.vx -= 2 * dot * nx;
                    b.vy -= 2 * dot * ny;
                }
                const turret = new Turret(tx, ty, me.ball, Math.random() * 2 * Math.PI, Math.PI * -0.01 * Math.sign(me.angVel));
                me.ball.battle.addBody(turret);
            }
        });
        this.addWeapon(wrench);
    }

    handleUpdate(dt) {
        this.turretCooldown -= dt;
    }
}

class Turret extends CircleBody {
    constructor(x, y, owner, theta, angVel) {
        super(x, y, 0, 0, 1, turretRadius, Infinity, false);
        this.owner = owner;
        this.theta = theta;
        this.angVel = angVel;
        this.fireDelay = 36;
        this.zIndex = 0;
    }

    draw() {
        this.battle.drawCircle(this, this.owner.color, "#333", 2);

        const ctx = this.battle.ctx;
        const width = 5; // rectangle thickness

        ctx.save();

        // Move to origin point
        ctx.translate(this.x, this.y);

        // Rotate to match theta
        ctx.rotate(this.theta);

        ctx.strokeStyle = "#333";
        ctx.lineWidth = 2;
        ctx.fillStyle = this.owner.color;

        // Draw rectangle extending forward
        ctx.beginPath();
        ctx.rect(5, -width / 2, 13, width);
        ctx.stroke();
        ctx.fill();

        ctx.restore();
    }

    onUpdate(dt) {
        if (this.getRootOwner().hp <= 0) {
            this.hp = 0;
            return;
        }

        this.theta += this.angVel * dt;
        this.fireDelay -= dt;
        if (this.fireDelay <= 0) {
            this.fireDelay = 36;
            const spawnDist = this.radius + 6, speed = 5;
            const bullet = new Bullet(
                this.x + Math.cos(this.theta) * spawnDist,
                this.y + Math.sin(this.theta) * spawnDist,
                Math.cos(this.theta) * speed,
                Math.sin(this.theta) * speed,
                this.owner,
                1
            );
            this.battle.addBody(bullet);
        }
    }

    shouldBounce(other) { return true; }
}

// Grimoire: Summons undead minion clones
class GrimoireBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#8652c5", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.nextMinionHP = 0;

        const grimoire = new Weapon(theta, "sprites/grimoire.webp", 2, -13, -1, Math.PI / 4);
        grimoire.iframes = 0;
        grimoire.addCollider(30, 17);
        grimoire.addSpin(Math.PI * 0.025 * dir);
        // grimoire.addParry();
        grimoire.addDirChange();

        grimoire.addDamage(1, 40);

        grimoire.ballColFns.push((me, target) => {
            this.nextMinionHP += 3;
            if (target instanceof DuplicatorBall && (this.battle.dupeCount[this.team] ?? 0) >= dupeLimit) return;

            const minion = this.createMinion(target);
            if (minion && me.ball.battle.inBounds(minion.x, minion.y, minion.radius)) {
                minion.inert = true;
                me.ball.battle.addBall(minion);
            }
        });

        this.addWeapon(grimoire, false);
    }

    createMinion(target) {
        const scale = 0.75;
        const newRadius = target.radius * scale;
        const Constructor = target.constructor;

        // Get constructor parameters based on ball type
        const args = this.getMinionArgs(target, Constructor, newRadius, scale);
        if (!args) return null;

        const minion = new Constructor(...args);
        minion.hp = this.nextMinionHP;
        minion.team = this.team;
        minion.color = this.color;
        minion.flashTime = flashDur;
        minion.id = this.battle.nextID++;
        minion.owner = this;
        minion.slowTime = this.slowTime;
        minion.mass *= 1 / 0.75;

        // Copy boost properties
        this.copyBoosts(target, minion);

        // Scale weapon properties
        for (const w of minion.weapons) {
            w.scale *= scale;
            w.offset *= scale;
            w.spriteShift *= scale;
            if (w.range) w.range *= scale;
            if (w.thickness) w.thickness *= scale;
            if (w.theta) w.theta = this.weapons[0].theta + Math.PI;
        }

        // Apply iframes
        for (const w of minion.weapons) {
            w._collidingWith[target.id] = 40;
        }
        for (const w of target.weapons) {
            w._collidingWith[minion.id] = 40;
        }

        return minion;
    }

    copyBoosts(target, minion) {
        for (let i = 0; i < target.weapons.length && i < minion.weapons.length; i++) {
            const tw = target.weapons[i], mw = minion.weapons[i];
            if (tw.dmg !== undefined) mw.dmg = tw.dmg;
            if (tw.angVel !== undefined) mw.angVel = Math.abs(tw.angVel) * Math.sign(mw.angVel || 1);
        }
        if (target.damagePerRound !== undefined) {
            minion.damagePerRound = target.damagePerRound;
            minion.bulletsPerRound = target.bulletsPerRound;
            minion.bonusDmgRate = target.bonusDmgRate;
        }
        if (target.boostEnergy !== undefined) {
            minion.boostEnergy = target.boostEnergy;
            minion.boosts = target.boosts;
            minion.startSpeed = 20 / 3;
        }
    }

    getMinionArgs(target, Constructor, newRadius, scale) {
        const theta = Math.atan2(target.vy, target.vx) + Math.PI;
        const speed = 20 / 3;
        const baseArgs = [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed];

        if (Constructor === DaggerBall || Constructor === SwordBall || Constructor === MachineGunBall || Constructor === WrenchBall || Constructor === HammerBall) {
            return [...baseArgs, target.weapons[0]?.theta || 0, 1, this.nextMinionHP, newRadius];
        }
        if (Constructor === GrimoireBall) {
            return [...baseArgs, target.weapons[0]?.theta || 0, 1, this.nextMinionHP, newRadius];
        }
        if (Constructor === LanceBall) {
            const speed = 20 / 3 + 1 / 3 * target.boosts;
            return [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed, this.nextMinionHP, newRadius];
        }
        if (Constructor === DuplicatorBall) {
            return [...baseArgs, this.nextMinionHP, newRadius];
        }
        return [...baseArgs, this.nextMinionHP, newRadius];
    }
}

// Hammer: Builds up angular velocity and damage passively, resets on hit but gains faster
class HammerBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#7a5230", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.baseAngVel = Math.PI * 0.01 * dir;
        this.baseDmg = 1;
        this.buildRate = 1;

        const hammer = new Weapon(theta, "sprites/hammer.webp", 3, -7, 0, 3 * Math.PI / 4);
        hammer.addCollider(60, 16, 38);
        hammer.addSpin(this.baseAngVel);
        hammer.addParry();
        hammer.addDamage(this.baseDmg, 30);

        hammer.ballColFns.push((me) => {
            me.ball.buildRate += 0.5;
            me.angVel = me.ball.baseAngVel;
            me.dmg = me.ball.baseDmg;
        });

        this.addWeapon(hammer);
    }

    handleUpdate(dt) {
        const w = this.weapons[0];
        w.angVel += Math.sign(w.angVel) * Math.PI * 0.00005 * this.buildRate * dt;
        w.dmg += 0.008 * this.buildRate * dt;
    }
}

function randomVel(abs) {
    const theta = Math.random(2 * Math.PI);
    // console.log([Math.cos(theta) * abs, Math.sin(theta) * abs]);
    return [Math.cos(theta) * abs, Math.sin(theta) * abs];
}

const balls = [
    // new DaggerBall(350, 200, ...randomVel(6), 0, 1, 100),
    // new SwordBall(350, 200, ...randomVel(6), 0, 1, 500),
    new DuplicatorBall(350, 200, ...randomVel(5), 50),
    // new LanceBall(50, 200, ...randomVel(5), 100),
    new MachineGunBall(50, 200, ...randomVel(5), Math.PI, 1, 100),
    // new WrenchBall(50, 200, ...randomVel(5), 0, 1, 100),
    // new GrimoireBall(350, 200, ...randomVel(5), 0, 1, 100)
    // new HammerBall(350, 200, ...randomVel(5), Math.PI, 1, 100)
];
const battle = new BallBattle(balls);
battle.addCanvas(document.getElementById("canvas"));
// battle.run(1.25);
battle.run(12.5);