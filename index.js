"use strict"

const d = new Date().getTime();
console.log(d);
Math.seedrandom(d);

const GRAVITY = 0.1;
const ELASTICITY = 1.0; // restitution for collisions (1.0 = perfectly elastic)
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

class CircleBody {
    constructor(x, y, vx, vy, hp, radius, mass = radius * radius, grav = true) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.hp = hp;
        this.radius = radius;
        this.mass = mass;
        this.freezeTime = 0;
        this.inert = false;
        this.gravity = grav;
    }

    onCollision(b) { }

    onWallCollision() { }

    onUpdate() { }

    shouldBounce(other) { return false; }

    shouldBounceWall(wall) { return true; }

    damage(dmg) {
        this.hp = Math.max(0, this.hp - dmg);
    }
}

class Ball extends CircleBody {
    constructor(x, y, vx, vy, hp, radius, color, mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, mass, true);
        this.mass = mass;
        this.color = color;
        this.weapons = [];
        this.parryWeapons = [];
        this.dmgWeapons = [];
    }

    addWeapon(w) {
        w.ball = this;
        this.weapons.push(w);
        if (w.ballColFns.length > 0) this.dmgWeapons.push(w);
        if (w.range && w.thickness) this.parryWeapons.push(w);
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
        ctx.fillText(this.hp, this.x, this.y);
    }

    shouldBounce(other) { return true; }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx ** 2 + this.vy ** 2);
    }

    potentialEnergy() {
        return this.mass * GRAVITY * (this.battle.height - this.radius - this.y);
    }
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

// Find time of collision with a stationary circle (accounts for gravity)
function timeToStationaryCollision(moving, stationary, dt) {
    const R = moving.radius + stationary.radius;
    const g = moving.gravity ? GRAVITY : 0;

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
    if (ballsOverlap(b1, b2)) return Infinity;

    const g1 = b1.gravity ? GRAVITY : 0;
    const g2 = b2.gravity ? GRAVITY : 0;
    const dg = g2 - g1;
    const R = b1.radius + b2.radius;

    // If gravity is the same, use quadratic solution
    if (Math.abs(dg) < EPS) {
        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const dvx = b2.vx - b1.vx;
        const dvy = b2.vy - b1.vy;

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
        const p1x = b1.x + b1.vx * t;
        const p1y = b1.y + b1.vy * t + 0.5 * g1 * t * t;
        const p2x = b2.x + b2.vx * t;
        const p2y = b2.y + b2.vy * t + 0.5 * g2 * t * t;
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

// Elastic collision response (no positional correction needed with exact timing)
function resolveCollision(b1, b2) {
    // Use freeze state from frame start, not current (which may have been modified by earlier collisions)
    const frozen1 = b1._frozenAtFrameStart;
    const frozen2 = b2._frozenAtFrameStart;

    // if (t >= 5015 && t <= 5020) {
    //     console.log(`t=${t} COLLISION: ${b1.constructor.name} vs ${b2.constructor.name}`);
    //     console.log(`  b1 vel BEFORE: (${b1.vx.toFixed(3)}, ${b1.vy.toFixed(3)}) frozen=${frozen1}`);
    //     console.log(`  b2 vel BEFORE: (${b2.vx.toFixed(3)}, ${b2.vy.toFixed(3)}) frozen=${frozen2}`);
    // }

    b1.onCollision(b2);
    b2.onCollision(b1);

    const bounce1 = b1.shouldBounce(b2);
    const bounce2 = b2.shouldBounce(b1);
    if (!bounce1 || !bounce2) return;

    if (b1.mass == 0 && b2.mass == 0) return;
    if (frozen1 && frozen2) return;

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

    const v1x = frozen1 ? 0 : b1.vx - boosts[0].bx;
    const v1y = frozen1 ? 0 : b1.vy - boosts[0].by;
    const v2x = frozen2 ? 0 : b2.vx - boosts[1].bx;
    const v2y = frozen2 ? 0 : b2.vy - boosts[1].by;

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
        if (bounce1 && bounce2 && isNaN(b1.vx) && isNaN(b2.vx)) console.log("nanana 2");
        return;
    }

    const invMass1 = b2.mass == 0 || frozen1 ? 0 : 1 / b1.mass;
    const invMass2 = b1.mass == 0 || frozen2 ? 0 : 1 / b2.mass;
    const j = -(1 + ELASTICITY) * velAlongNormal / (invMass1 + invMass2);

    const new1x = v1x - j * invMass1 * nx;
    const new1y = v1y - j * invMass1 * ny;
    const new2x = v2x + j * invMass2 * nx;
    const new2y = v2y + j * invMass2 * ny;

    // Add boost back in the new velocity direction
    for (const [b, nvx, nvy, boost, wasFrozen] of [[b1, new1x, new1y, boosts[0], frozen1], [b2, new2x, new2y, boosts[1], frozen2]]) {
        if (wasFrozen) continue; // Don't modify frozen ball's velocity
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

    // if (t >= 5015 && t <= 5020) {
    //     console.log(`  b1 vel AFTER: (${b1.vx.toFixed(3)}, ${b1.vy.toFixed(3)})`);
    //     console.log(`  b2 vel AFTER: (${b2.vx.toFixed(3)}, ${b2.vy.toFixed(3)})`);
    // }
}

function advanceAll(balls, t) {
    for (const b of balls) {
        const g = b.gravity ? GRAVITY : 0;
        b.x += b.vx * t;
        b.y += b.vy * t + 0.5 * g * t * t;
        b.vy += g * t;
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
        this.bodies = [];

        this.nextID = 0;
        // this.debug = true;
        this.debug = false;
        this.dupeCooldown = 0;
        for (let b of balls) {
            this.addBall(b);
        }

        this.lastTime = null;
        this.accumulator = 0;
        this.fixedDt = 10;
    }

    addBody(body) {
        body.battle = this;
        this.bodies.push(body);
    }

    addBall(ball) {
        this.addBody(ball);
        this.balls.push(ball);
        ball.id = this.nextID++;
    }

    addCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
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
        // Snapshot freeze state at frame start - used by resolveCollision
        for (const b of this.bodies) {
            b._frozenAtFrameStart = b.freezeTime > 0;
        }

        const freezePred = (b) => b.freezeTime > 0 || (b.owner && b.owner.freezeTime > 0);
        const toUpdate = this.bodies.filter((b) => !freezePred(b));
        const frozen = this.bodies.filter(freezePred);

        // Reactivate inert balls that have escaped overlap
        for (const b of toUpdate) {
            if (b.inert && this.bodies.every(o => o.inert || !ballsOverlap(b, o))) {
                b.inert = false;
            }
        }

        let dt = 1;
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

    updateWeapons() {
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
        const substeps = Math.max(Math.ceil(maxAngVel / 0.1), Math.ceil(maxLanceSpeed / 10));
        const subDt = 1 / substeps;

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
    }

    processDeaths() {
        const dead = this.balls.filter((b) => b.hp <= 0);
        dead.forEach((b) => b.freezeTime = 0);
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

        for (const ball of balls) {
            for (const w of ball.parryWeapons) {
                for (const body of this.bodies) {
                    if (body instanceof MGBullet && body.owner !== ball) {
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
            this.ctx.globalAlpha = 0.7;
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
        this.bodies.filter(b => b.inert).forEach(b => b.draw());
        this.bodies.filter(b => !b.inert).forEach(b => b.draw());
    }

    update() {
        this.updatePhysics();

        this.dupeCooldown--;
        this.bodies.forEach((b) => b.onUpdate());

        this.updateWeapons();

        this.processDeaths();

        this.dupeCount = this.balls.reduce((acc, v) => acc + (+(v instanceof DuplicatorBall)), 0);
    }

    inBounds(x, y, radius) {
        return x >= radius && x <= this.width - radius
            && y >= radius && y <= this.height - radius;
    }

    async run() {
        const loop = async (currentTime) => {
            // let energySum = 0;
            // for (let b of this.balls) {
            //     energySum += b.potentialEnergy() + b.kineticEnergy();
            // }
            // console.log(energySum);

            if (this.lastTime !== null) {
                this.accumulator += currentTime - this.lastTime;

                while (this.accumulator >= this.fixedDt) {
                    this.update();
                    this.accumulator -= this.fixedDt;
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
            this.render();
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);

        // if (t < sus) {
        //     for (let i = 0; i < 100 && t < sus; i++) {
        //         t++;
        //         this.update();
        //     }
        //     this.render();
        //     requestAnimationFrame(this.run.bind(this));
        // }
        // else {
        //     const step = () => {
        //         let energySum = 0;
        //         for (let b of this.balls) {
        //             energySum += b.potentialEnergy() + b.kineticEnergy();
        //         }
        //         console.log(t, energySum);
        //         t++;

        //         this.update();
        //         this.render();
        //         setTimeout(() => requestAnimationFrame(step), 100);
        //     };
        //     step();
        // }
    }
}
// let t = 0;
// const sus = 300;

class DuplicatorBall extends Ball {
    constructor(x, y, vx, vy, hp = 100, radius = 20, color = "#d26ffa", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.cooldown = 0;
    }

    onCollision(b) {
        if (this.inert || b instanceof DuplicatorBall || b.freezeTime > 0 || !(b instanceof Ball)) return;

        if (this.battle.dupeCooldown <= 0 && b instanceof Ball) {
            b.damage(1);
        }
        if (this.cooldown > 0 || this.battle.dupeCooldown > 0 || this.battle.dupeCount >= 40) return;

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

const bulletRadius = 5, maxVolley = 200;
class MachineGunBall extends Ball {
    constructor(x, y, vx, vy, theta, hp = 100, radius = 25, color = "#4a90d9", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.damagePerRound = 10;
        this.bulletsFired = 0;
        this.reloadTime = 60;
        this.fireDelay = 0;
        this.bulletDmg = 1;
        this.extraDmg = 0;
        this.bulletsPerRound = this.damagePerRound;

        const gun = new Weapon(theta, "sprites/gun.png", 2, -9, 7, 0);
        gun.addCollider(40, 5);
        gun.addSpin(Math.PI * 0.02);
        gun.addParry();
        this.addWeapon(gun);
    }

    onUpdate() {
        if (this.freezeTime > 0) return;
        if (this.reloadTime > 0) { this.reloadTime--; return; }
        if (this.fireDelay > 0) { this.fireDelay--; return; }

        if (this.bulletsFired < this.bulletsPerRound) {
            let dmg = this.bulletDmg;
            if (Math.random() < this.extraDmg / this.bulletsPerRound - this.bulletsFired) {
                this.extraDmg--;
                dmg++;
            }

            const spawnRadius = this.radius + 40, speed = 7;
            const cosTheta = Math.cos(this.weapons[0].theta);
            const sinTheta = Math.sin(this.weapons[0].theta);

            const spawnX = this.x + cosTheta * spawnRadius;
            const spawnY = this.y + sinTheta * spawnRadius;
            if (!this.battle.inBounds(spawnX, spawnY, bulletRadius)) return;

            const bullet = new MGBullet(
                spawnX,
                spawnY,
                cosTheta * speed,
                sinTheta * speed,
                this,
                dmg
            );
            this.battle.addBody(bullet);

            this.bulletsFired++;
            this.fireDelay = 0;
        } else {
            this.bulletsFired = 0;
            this.reloadTime = 60;
            if (this.damagePerRound > maxVolley) {
                this.bulletDmg = Math.floor(this.damagePerRound / maxVolley);
                this.extraDmg = this.damagePerRound % maxVolley;
                this.bulletsPerRound = maxVolley;
            }
            else {
                this.bulletsPerRound = this.damagePerRound;
            }
        }
    }
}

class MGBullet extends CircleBody {
    constructor(x, y, vx, vy, owner, dmg = 1) {
        super(x, y, vx, vy, 1, bulletRadius, 0, false);
        this.owner = owner;
        this.reflectCooldown = 0;
        this.reflector = owner;
        this.dmg = dmg;

        for (const b of owner.battle.balls) {
            if (ballsOverlap(this, b)) {
                this.onCollision(b);
                break;
            }
        }
    }

    onCollision(b) {
        if (b instanceof MGBullet) return;
        if (b == this.owner && b == this.reflector) return;
        b.damage(this.dmg);

        const damager = this.reflector == b ? this.owner : this.reflector;
        const ft = b instanceof DuplicatorBall ? 0 : 10;
        if (damager.hp > 0) damager.freezeTime = ft;
        b.freezeTime = ft;

        if (b != this.owner && this.hp == 1) {
            this.owner.damagePerRound += 2;
            // if (this.owner.bulletsFired > 0) this.owner.bulletsFired += 2;
        }

        this.hp -= b instanceof DuplicatorBall ? 0 : 1;
        // this.dmg--;
        // if (this.dmg <= 0) this.hp = 0;
    }

    onWallCollision() {
        this.hp = 0;
    }

    shouldBounce(other) { return false; }

    draw() {
        this.battle.drawCircle(this, this.color, "#333", 1);
    }

    onUpdate() {
        if (this.owner.freezeTime <= 0) this.reflectCooldown--;
    }

    reflect(owner, weapon) {
        if (this.owner === owner || this.reflectCooldown > 0) return;

        // this.owner.freezeTime = owner.freezeTime = 10;
        this.reflectCooldown = 25;
        this.reflector = owner;

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

        this.reflected = true;
    }
}

function randomVel(abs) {
    const theta = Math.random(2 * Math.PI);
    return [Math.cos(theta) * abs, Math.sin(theta) * abs];
}

const balls = [
    // new DaggerBall(350, 200, ...randomVel(5), 0, 100),
    // new SwordBall(50, 200, ...randomVel(5), 0, 100),
    new DuplicatorBall(50, 200, ...randomVel(5), 50),
    // new LanceBall(50, 200, ...randomVel(5), Math.PI, 100),
    new MachineGunBall(350, 200, ...randomVel(5), Math.PI, 100),
];
const battle = new BallBattle(balls);
battle.addCanvas(document.getElementById("canvas"));
// battle.bug();
battle.run();
