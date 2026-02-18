"use strict"

const d = new Date().getTime();
console.log(d);
Math.seedrandom(d);

const GRAVITY = 0.1;
const ELASTICITY = 1.0; // restitution for collisions (1.0 = perfectly elastic)
const SUBSTEPS = 1;
const EPS = 1e-9;
const flashDur = 20;

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
    constructor(theta, sprite, scale = 1, offset = 0, rotation = Math.PI / 4, flipped = false) {
        this.theta = theta;
        if (!(sprite in spriteReqs)) spriteReqs[sprite] = [];
        spriteReqs[sprite].push(this);
        this.scale = scale;
        this.offset = offset;
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

        const r0 = b.radius;
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

        const wx = ball.x + Math.cos(angle) * distance;
        const wy = ball.y + Math.sin(angle) * distance;

        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(angle + this.rotation);

        ctx.scale(this.scale, this.scale);

        ctx.drawImage(this.sprite, 0, -this.sprite.height);
        ctx.restore();
    }

    addCollider(range, thickness) {
        this.range = range;
        this.thickness = thickness;
    }

    addSpin(angVel) {
        this.angVel = angVel;
        this.updateFns.push((me, dt) => me.theta += dt * me.angVel);
    }

    addParry() {
        this.flipped = this.angVel < 0;
        this.weaponColFns.push((me, other) => {
            // Reverse if rotating toward the other weapon
            const toOther = Math.atan2(other.ball.y - me.ball.y, other.ball.x - me.ball.x);
            const approaching = Math.sin(toOther - me.theta) * me.angVel > 0;
            if (approaching) {
                me.angVel = -me.angVel;
                // me.ball.freezeTime = other.ball.freezeTime = 15;
            }
            me.flipped = me.angVel < 0;
        });
    }

    addDamageFn(fn, iframes = 15, freeze = 20, DoT = false) {
        this.dmgFn = fn;
        this.DoT = DoT;
        this.iframes = iframes;
        this.ballColFns.push((me, b) => {
            const dmg = fn(me, b);
            if (dmg == 0) return;
            b.damage(dmg);
            // me.ball.freezeTime = b.freezeTime = b instanceof DuplicatorBall ? Math.round(freeze / 2) : freeze;
            // me.ball.battle.dupeCooldown += me.ball.freezeTime;
            me.ball.freezeTime = b.freezeTime = b instanceof DuplicatorBall ? 0 : freeze;
        });
    }

    addDamage(dmg, iframes = 15, freeze = 20, DoT = false) {
        this.dmg = dmg;
        this.addDamageFn((me) => me.dmg, iframes, freeze, DoT);
    }
}

class Ball {
    constructor(x, y, vx, vy, hp, radius, color, mass = radius * radius) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.hp = hp;
        this.radius = radius;
        this.mass = mass;
        this.color = color;
        this.weapons = [];
        this.parryWeapons = [];
        this.dmgWeapons = [];
        this.freezeTime = 0;
    }

    addWeapon(w) {
        w.ball = this;
        this.weapons.push(w);
        if (w.ballColFns.length > 0) this.dmgWeapons.push(w);
        if (w.weaponColFns.length > 0) this.parryWeapons.push(w);
    }

    damage(dmg) {
        this.hp = Math.max(0, this.hp - dmg);
        this.flashTime = flashDur;
    }

    draw() {
        this.weapons.forEach((w) => w.draw());

        const ctx = this.battle.ctx;
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius - ctx.lineWidth / 2, 0, Math.PI * 2);
        const flashPct = Math.max(0, this.flashTime / flashDur);
        ctx.fillStyle = this.flashTime > 0
            ? `color-mix(in srgb, white ${flashPct * 100}%, ${this.color})`
            : this.color;
        ctx.stroke();
        ctx.fill();
        if (this.flashTime > 0) this.flashTime--;

        ctx.fillStyle = "#000";
        ctx.font = `bold ${this.radius}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.hp, this.x, this.y);
    }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx ** 2 + this.vy ** 2);
    }

    potentialEnergy() {
        return this.mass * GRAVITY * (this.battle.height - this.radius - this.y);
    }

    onCollision(b) { }

    onUpdate() { }
}

const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

function timeToWallCollision(b, dt) {
    let tMin = Infinity;
    let wall = null;
    const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

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
    {
        const a = 0.5 * GRAVITY;
        const bq = b.vy;
        const c = b.y - b.radius;
        const disc = bq * bq - 4 * a * c;
        if (disc >= 0) {
            const t = (-bq - Math.sqrt(disc)) / (2 * a);
            if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = TOP; }
        }
    }

    // Bottom wall
    {
        const a = 0.5 * GRAVITY;
        const bq = b.vy;
        const c = b.y - (b.battle.height - b.radius);
        const disc = bq * bq - 4 * a * c;
        if (disc >= 0) {
            const t = (-bq + Math.sqrt(disc)) / (2 * a);
            if (t > EPS && t <= dt && t < tMin) { tMin = t; wall = BOTTOM; }
        }
    }

    return { t: tMin, wall };
}

function resolveWallCollision(b, wall) {
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

// Find time of collision with a stationary circle (accounts for gravity)
function timeToStationaryCollision(moving, stationary, dt) {
    const R = moving.radius + stationary.radius;
    const g = GRAVITY;

    // Position: p(t) = p0 + v*t + 0.5*g*t^2 (gravity only in y)
    // |stationary - p(t)|^2 = R^2
    // (dx - vx*t)^2 + (dy - vy*t - 0.5*g*t^2)^2 = R^2
    // Expanding gives a quartic, but we can solve iteratively or use the quadratic approx
    // For small dt, iterate with Newton's method on distance^2 - R^2

    const f = (t) => {
        const px = moving.x + moving.vx * t;
        const py = moving.y + moving.vy * t + 0.5 * g * t * t;
        return (stationary.x - px) ** 2 + (stationary.y - py) ** 2 - R * R;

    };

    // Check if already overlapping
    if (f(0) <= 0) return Infinity;

    // Binary search for root in [0, dt]
    if (f(dt) > 0) return Infinity; // No collision in interval

    let lo = 0, hi = dt;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid;
        else hi = mid;

    }

    return hi > EPS ? hi : Infinity;
}

// Find time of collision between two balls (returns Infinity if no collision in dt)
function timeToCollision(b1, b2, dt) {
    if (b1.inert || b2.inert) return Infinity;
    // Positions: p1(t) = p1 + v1*t + 0.5*g*t^2, p2(t) = p2 + v2*t + 0.5*g*t^2
    // Distance squared: |p2(t) - p1(t)|^2 = (r1+r2)^2
    // Since gravity affects both equally in y, it cancels out!
    // So: (dx + dvx*t)^2 + (dy + dvy*t)^2 = R^2
    // Expanding: (dvx^2 + dvy^2)*t^2 + 2*(dx*dvx + dy*dvy)*t + (dx^2 + dy^2 - R^2) = 0

    const dx = b2.x - b1.x;
    const dy = b2.y - b1.y;
    const dvx = b2.vx - b1.vx;
    const dvy = b2.vy - b1.vy;
    const R = b1.radius + b2.radius;

    const a = dvx * dvx + dvy * dvy;
    const b = 2 * (dx * dvx + dy * dvy);
    const c = dx * dx + dy * dy - R * R;

    if (a < EPS) return Infinity; // Not approaching

    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;

    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t > EPS && t <= dt) return t;
    return Infinity;
}

// Elastic collision response (no positional correction needed with exact timing)
function resolveCollision(b1, b2) {
    b1.onCollision(b2);
    b2.onCollision(b1);

    const dx = b2.x - b1.x;
    const dy = b2.y - b1.y;
    const dist = Math.hypot(dx, dy);

    const nx = dx / dist;
    const ny = dy / dist;

    // Remove lance boost from velocity for collision calculation
    const boosts = [b1, b2].map(b => {
        if (!(b instanceof LanceBall) || !b.boost) return { bx: 0, by: 0 };
        const speed = Math.hypot(b.vx, b.vy);
        const effectiveBoost = Math.min(b.boost, speed);
        return { bx: b.vx / speed * effectiveBoost, by: b.vy / speed * effectiveBoost };
    });

    const v1x = b1.freezeTime > 0 ? 0 : b1.vx - boosts[0].bx;
    const v1y = b1.freezeTime > 0 ? 0 : b1.vy - boosts[0].by;
    const v2x = b2.freezeTime > 0 ? 0 : b2.vx - boosts[1].bx;
    const v2y = b2.freezeTime > 0 ? 0 : b2.vy - boosts[1].by;

    const dvx = v2x - v1x;
    const dvy = v2y - v1y;
    const velAlongNormal = dvx * nx + dvy * ny;

    if (velAlongNormal > 0) {
        // console.log("early return - already separating");
        // Still need to clamp lance velocity even if separating
        for (const [a, b] of [[b1, b2], [b2, b1]]) {
            if (a instanceof LanceBall) {
                const toB = a === b1 ? 1 : -1;
                // Use actual velocities, not boost-adjusted
                const relVel = ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny) * toB;
                if (relVel <= 0) continue;

                const dot_a = a.vx * nx + a.vy * ny;
                const dot_b = b.vx * nx + b.vy * ny;
                if ((dot_a - dot_b) * toB > 0) {
                    const speed = Math.hypot(a.vx, a.vy);
                    if (speed > EPS && a.boost > 0) {
                        a.vx *= -1;
                        a.vy *= -1;
                    }
                }
            }
        }
        return;
    }

    const invMass1 = b1.freezeTime > 0 ? 0 : 1 / b1.mass;
    const invMass2 = b2.freezeTime > 0 ? 0 : 1 / b2.mass;
    const j = -(1 + ELASTICITY) * velAlongNormal / (invMass1 + invMass2);

    const new1x = v1x - j * invMass1 * nx;
    const new1y = v1y - j * invMass1 * ny;
    const new2x = v2x + j * invMass2 * nx;
    const new2y = v2y + j * invMass2 * ny;

    // Add boost back in the new velocity direction
    for (const [b, nvx, nvy, boost] of [[b1, new1x, new1y, boosts[0]], [b2, new2x, new2y, boosts[1]]]) {
        const boostMag = Math.hypot(boost.bx, boost.by);
        const newSpeed = Math.hypot(nvx, nvy);
        if (boostMag > 0 && newSpeed > EPS) {
            b.vx = nvx + nvx / newSpeed * boostMag;
            b.vy = nvy + nvy / newSpeed * boostMag;
        } else {
            b.vx = nvx;
            b.vy = nvy;
        }
    }

    for (const [a, b] of [[b1, b2], [b2, b1]]) {
        if (a instanceof LanceBall) {
            // Normal from a to b
            const toB = a === b1 ? 1 : -1;
            const relVel = ((v1x - v2x) * nx + (v1y - v2y) * ny) * -toB;
            if (relVel <= 0) continue; // wasn't chasing

            const dot_a = a.vx * nx + a.vy * ny;
            const dot_b = b.vx * nx + b.vy * ny;
            if ((dot_a - dot_b) * toB > 0) {
                const diff = (dot_a - dot_b) * toB;
                a.vx -= diff * nx * toB;
                a.vy -= diff * ny * toB;
            }
        }
    }
}

function advanceAll(balls, t) {
    for (const b of balls) {
        b.x += b.vx * t;
        b.y += b.vy * t + 0.5 * GRAVITY * t * t;
        b.vy += GRAVITY * t;
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

class BallBattle {
    constructor(balls) {
        this.balls = [];
        this.nextID = 0;
        // this.debug = true;
        this.debug = false;
        this.dupeCooldown = 0;
        for (let b of balls) {
            this.addBall(b);
        }
    }

    addBall(ball) {
        this.balls.push(ball);
        ball.battle = this;
        ball.id = this.nextID++;
    }

    addCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.width = canvas.width;
        this.height = canvas.height;
    }

    updatePhysics(dt = 1) {
        // DEBUG: Check for overlap at frame start
        // for (let i = 0; i < this.balls.length; i++) {
        //     for (let j = i + 1; j < this.balls.length; j++) {
        //         if (ballsOverlap(this.balls[i], this.balls[j])) {
        //             console.log("OVERLAP at frame start:", this.balls[i].constructor.name, this.balls[j].constructor.name,
        //                 "frozen:", this.balls[i].freezeTime, this.balls[j].freezeTime);
        //         }
        //     }
        // }

        const toUpdate = this.balls.filter((b) => b.freezeTime == 0);
        const frozen = this.balls.filter((b) => b.freezeTime > 0);

        // // Separate overlapping frozen balls
        // for (let i = 0; i < frozen.length; i++) {
        //     for (let j = i + 1; j < frozen.length; j++) {
        //         const b1 = frozen[i], b2 = frozen[j];
        //         const dx = b2.x - b1.x, dy = b2.y - b1.y;
        //         const dist = Math.hypot(dx, dy);
        //         const minDist = b1.radius + b2.radius;
        //         if (dist < minDist && dist > 0) {
        //             const overlap = (minDist - dist) / 2;
        //             const nx = dx / dist, ny = dy / dist;
        //             b1.x -= nx * overlap;
        //             b1.y -= ny * overlap;
        //             b2.x += nx * overlap;
        //             b2.y += ny * overlap;
        //         }
        //     }
        //     // Clamp to bounds
        //     const b = frozen[i];
        //     b.x = Math.max(b.radius, Math.min(this.width - b.radius, b.x));
        //     b.y = Math.max(b.radius, Math.min(this.height - b.radius, b.y));
        // }

        // Reactivate inert balls that have escaped overlap
        for (const b of toUpdate) {
            if (b.inert && this.balls.every(o => o.inert || !ballsOverlap(b, o))) {
                b.inert = false;
            }
        }

        while (dt > EPS) {
            // --- Find earliest ball-ball collision ---
            let tBall = Infinity;
            let pair = null;

            for (let i = 0; i < toUpdate.length; i++) {
                for (let j = i + 1; j < toUpdate.length; j++) {
                    const t = timeToCollision(toUpdate[i], toUpdate[j], dt);
                    if (t < tBall) {
                        tBall = t;
                        pair = [toUpdate[i], toUpdate[j]];
                    }
                }
                // Check collisions with frozen balls
                for (const f of frozen) {
                    const t = timeToStationaryCollision(toUpdate[i], f, dt);
                    if (t < tBall) {
                        tBall = t;
                        pair = [toUpdate[i], f];
                    }
                }
            }

            // --- Find earliest wall collision ---
            let tWall = Infinity;
            let wallEvents = [];

            for (const b of toUpdate) {
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
                advanceAll(toUpdate, dt);
                return;
            }

            advanceAll(toUpdate, tNext);
            dt -= tNext;

            // Ball-ball
            if (tBall <= tNext + EPS) {
                resolveCollision(pair[0], pair[1]);
                // DEBUG: Check if balls are still overlapping after resolution
                // if (ballsOverlap(pair[0], pair[1])) {
                //     const dist = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
                //     const minDist = pair[0].radius + pair[1].radius;
                //     console.log("NOT SEPARATED after resolution:", pair[0].constructor.name, pair[1].constructor.name,
                //         "dist:", dist.toFixed(2), "minDist:", minDist, "gap:", (dist - minDist).toFixed(4));
                // }
            }

            // Walls
            if (tWall <= tNext + EPS) {
                for (const ev of wallEvents) {
                    resolveWallCollision(ev.ball, ev.wall);
                }
            }
        }
    }

    updateWeapons(dt = 1) {
        this.dupeCooldown--;
        this.balls.forEach((b) => b.onUpdate());

        let toUpdate = [];
        for (let i = 0; i < this.balls.length; i++) {
            if (this.balls[i].freezeTime > 0) {
                this.balls[i].freezeTime--;
            }
            else {
                toUpdate.push(this.balls[i]);
            }
        }

        // Subdivide based on max angular velocity or lance speed to avoid tunneling
        const maxAngVel = Math.max(...toUpdate.flatMap(b => b.weapons.map(w => Math.abs(w.angVel || 0))), 0.01);
        const maxLanceSpeed = Math.max(...toUpdate.filter(b => b instanceof LanceBall).map(b => Math.hypot(b.vx, b.vy)), 0);
        const substeps = Math.max(Math.ceil(maxAngVel * dt / 0.1), Math.ceil(maxLanceSpeed * dt / 10));
        const subDt = dt / substeps;

        const hitThisFrame = new Set(); // tracks "weaponIdx-ballId" pairs that hit

        for (let step = 0; step < substeps; step++) {
            toUpdate.forEach(
                (b) => b.weapons.forEach(
                    (w) => w.updateFns.forEach((f) =>
                        f(w, subDt))));
            this._checkWeaponCollisions(toUpdate, hitThisFrame);
        }

        // Decrement iframes for pairs that didn't hit during any substep
        for (const b of toUpdate) {
            for (const w of b.dmgWeapons) {
                for (const id of Object.keys(w._collidingWith)) {
                    if (w.DoT || !hitThisFrame.has(w.ball.id + "-" + w.theta + "-" + id)) {
                        w._collidingWith[id]--;
                        if (w._collidingWith[id] <= 0) delete w._collidingWith[id];
                    }
                }
            }
        }

        this.balls = this.balls.filter((b) => b.hp > 0);
    }

    _checkWeaponCollisions(balls, hitThisFrame) {
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const A = balls[i];
                const B = balls[j];

                // weapon - ball
                for (const w of A.dmgWeapons) {
                    if (weaponHitsBall(w, B)) {
                        hitThisFrame.add(A.id + "-" + w.theta + "-" + B.id);
                        if (!(B.id in w._collidingWith)) {
                            w._collidingWith[B.id] = w.iframes;
                            w.ballColFns.forEach(fn => fn(w, B));
                        }
                    }
                }

                for (const w of B.dmgWeapons) {
                    if (weaponHitsBall(w, A)) {
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
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.debug) {
            this.ctx.globalAlpha = 0.4;
            for (const b of this.balls) {
                for (const w of b.weapons) {
                    if (w.range) {
                        const seg = w.getHitSegment();
                        this.ctx.beginPath();
                        this.ctx.moveTo(seg.x1, seg.y1);
                        this.ctx.lineTo(seg.x2, seg.y2);
                        this.ctx.strokeStyle = "red";
                        this.ctx.lineWidth = seg.r * 2;
                        this.ctx.lineCap = "round";
                        this.ctx.stroke();
                    }
                }
            }
            this.ctx.globalAlpha = 1;
        }
        this.balls.filter(b => b.inert).forEach(b => b.draw());
        this.balls.filter(b => !b.inert).forEach(b => b.draw());
    }

    async run() {
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

        // let energySum = 0;
        // for (let b of this.balls) {
        //     energySum += b.potentialEnergy() + b.kineticEnergy();
        // }
        // console.log(energySum);

        // if (k < 2000) {
        this.updatePhysics();
        this.updateWeapons();
        this.render();
        requestAnimationFrame(this.run.bind(this));
        // k++;
        // }
        // else {
        // const step = () => {
        //     this.updatePhysics();
        //     this.updateWeapons();
        //     this.render();
        //     setTimeout(() => requestAnimationFrame(step), 100);
        // };
        // step();
        // }
    }

    bug() {
        function inBounds(b) {
            return b.x >= b.radius && b.x <= b.battle.width - b.radius
                && b.y >= b.radius && b.y <= b.battle.height - b.radius;
        }

        let t = 0;
        while (inBounds(this.balls[0]) && inBounds(this.balls[1])) {
            this.updatePhysics();
            t++;
        }
    }
}
// let k = 0;

class DuplicatorBall extends Ball {
    constructor(x, y, vx, vy, hp = 100, radius = 20, color = "#d26ffa", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.inert = false;
        this.cooldown = 0;
    }

    onCollision(b) {
        if (this.inert || b instanceof DuplicatorBall || b.freezeTime > 0) return;

        if (this.battle.dupeCooldown <= 0) b.damage(1);
        if (this.cooldown > 0 || this.battle.dupeCooldown > 0) return;

        this.battle.dupeCooldown = 2;
        this.cooldown = 15;
        const child = new DuplicatorBall(this.x, this.y, ...randomVel(5), this.hp);
        child.cooldown = 15;
        child.inert = true;
        this.battle.addBall(child);
    }

    onUpdate() {
        this.cooldown--;
    }
}

class DaggerBall extends Ball {
    constructor(x, y, vx, vy, theta, hp = 100, radius = 25, color = "#5fbf00", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const dagger = new Weapon(theta, "sprites/dagger.png", 3, -12);
        dagger.addCollider(30, 6);
        dagger.addSpin(Math.PI * 0.066667);
        // dagger.addParry();
        dagger.addDamage(1, 1, 6);
        dagger.weaponColFns.push((me, other) => { });

        this.scalingCooldown = {};
        dagger.ballColFns.push((me, b) => {
            if (!(b.id in me.ball.scalingCooldown)) {
                me.ball.scalingCooldown[b.id] = 30;
                me.angVel = (Math.abs(me.angVel) + Math.PI * 0.016667) * Math.sign(me.angVel);
            }
        });
        this.addWeapon(dagger);
    }

    onUpdate() {
        if (this.freezeTime <= 0) {
            for (let key in this.scalingCooldown) {
                if (this.scalingCooldown[key] == 0) {
                    delete this.scalingCooldown[key];
                    break;
                }
                this.scalingCooldown[key]--;
            }
        }
    }
}

class SwordBall extends Ball {
    constructor(x, y, vx, vy, theta, hp = 100, radius = 25, color = "tomato", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const sword = new Weapon(theta, "sprites/sword.png", 4, -22);
        sword.addCollider(60, 8);
        sword.addSpin(Math.PI * 0.02);
        sword.addParry();
        sword.addDamage(1, 30);
        sword.ballColFns.push((me, b) =>
            me.dmg++
        );
        this.addWeapon(sword);
    }
}

const comboLeniency = 10;
class LanceBall extends Ball {
    constructor(x, y, vx, vy, theta, hp = 100, radius = 25, color = "#dfbf9f", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.boost = 0;
        this.dist = 0;
        this.combo = 0;
        this.hit = 0;
        this.damages = -1;

        const lance = new Weapon(theta, "sprites/lance.png", 3, -3);
        lance.addCollider(90, 9);
        lance.addDamageFn((me) => {
            const b = me.ball;
            const oldHit = b.hit;
            b.hit = comboLeniency;
            if (b.dist > 0 && b.damages == -1) {
                return 0;
            }

            if (b.damages == -1) {
                if (b.combo == 0 || oldHit < comboLeniency - 1) {
                    // console.log("reset");
                    b.dist = 0;
                }
                const counts = Math.floor(-b.dist / 300) + 1;
                b.dist += counts * 300;
                // console.log("damaged", counts, b.dist);

                const boost = 0.2;
                const speed = Math.hypot(b.vx, b.vy);
                const newSpeed = speed + boost;
                b.boost += boost;
                const scale = newSpeed / speed;
                b.vx *= scale;
                b.vy *= scale;

                const oldCombo = b.combo;
                b.combo += counts;
                b.damages = (oldCombo + b.combo + 1) * counts / 2;
            }

            return b.damages;
        }, 0, 12, true);

        lance.weaponColFns.push((me, other) => { });

        this.addWeapon(lance);
    }

    onUpdate() {
        this.damages = -1;
        this.weapons[0].theta = Math.atan2(this.vy, this.vx);
        if (this.freezeTime == 0) {
            this.dist -= this.vx ** 2 + this.vy ** 2;
            // console.log(this.dist, this.hit);
            if (this.hit == 0) {
                this.combo = 0;
            }
            else this.hit--;
        }
    }
}

function randomVel(abs) {
    const theta = Math.random(2 * Math.PI);
    return [Math.cos(theta) * abs, Math.sin(theta) * abs];
}

const balls = [
    new DaggerBall(50, 200, ...randomVel(5), 0, 100),
    // new SwordBall(50, 200, ...randomVel(5), Math.PI, 100),
    new DuplicatorBall(350, 200, ...randomVel(5), 50),
    // new LanceBall(50, 200, ...randomVel(5), Math.PI, 100),
];
const battle = new BallBattle(balls);
battle.addCanvas(document.getElementById("canvas"));
// battle.bug();
battle.run();    
