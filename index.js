"use strict"

const ELASTICITY = 1.0; // restitution for collisions (1.0 = perfectly elastic)
const EPS = 1e-9;
const flashDur = 60;
const hitHistorySize = 100;

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
        const alpha = this.ball.battle.renderAlpha || 0;
        const theta = (this.angVel && this._prevTheta !== undefined)
            ? this._prevTheta + (this.theta - this._prevTheta) * alpha
            : this.theta;
        Weapon.drawWeapon(
            this.ball.battle.ctx,
            this.ball._renderX ?? this.ball.x,
            this.ball._renderY ?? this.ball.y,
            theta, this.sprite, this.scale,
            this.ball.radius + this.offset, this.spriteShift, this.rotation
        );
    }

    addCollider(range, thickness, offset = 0) {
        this.range = range;
        this.thickness = thickness;
        this.colliderOffset = offset;
    }

    addSpin(angVel) {
        // return;
        this.angVel = angVel;
        this.updateFns.push((dt) => this.theta += dt * this.angVel);
    }

    addParry() {
        this.flipped = this.angVel < 0;
        this.weaponColFns.push((other) => {
            // Reverse if rotating toward the other weapon
            const toOther = Math.atan2(other.ball.y - this.ball.y, other.ball.x - this.ball.x);
            const approaching = Math.sin(toOther - this.theta) * this.angVel > 0;
            if (approaching) {
                this.angVel = -this.angVel;
                // this.ball.slowTime = other.ball.slowTime = 15;
            }
            this.flipped = this.angVel < 0;
        });
    }

    addDamage(dmg, iframes = 40, DoT = false, hitSlow = 10) {
        this.dmg = dmg;
        this.iframes = iframes;
        this.DoT = DoT;
        this.ballColFns.push((b) => {
            b.damage(this.dmg, this.ball);
            if (!b.owner && !(b instanceof DuplicatorBall)) {
                const amt = (this.ball instanceof DaggerBall && (this.ball.owner || b instanceof GrimoireBall)) ? 0.5 : hitSlow;
                this.ball.hitsThisFrame += amt;
                b.hitsThisFrame += amt;
            }
        });
    }

    addDirChange() {
        this.ballColFns.push(() => this.angVel *= -1);
    }

    static drawWeapon(ctx, x, y, angle, sprite, scale, offset, spriteShift, rotation) {
        const nx = Math.cos(angle), ny = Math.sin(angle);
        const tx = -ny, ty = nx;
        const wx = x + nx * offset + tx * spriteShift;
        const wy = y + ny * offset + ty * spriteShift;

        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(angle + rotation);
        ctx.scale(scale, scale);
        const leftPointing = Math.cos(rotation) < 0;
        ctx.drawImage(sprite, leftPointing ? -sprite.width : 0, -sprite.height);
        ctx.restore();
    };
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
        this.slowFactor = 1;
        this.slowAtFrameStart = 1;
    }

    getTimeScale(skipIfDuel = true) {
        if (skipIfDuel && this.battle.isDuel) return 1;
        return this.slowAtFrameStart;
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
        this.hitHistory = new Array(hitHistorySize).fill(0);
        this.hitIndex = 0;
        this.hitsThisFrame = 0;
        this.startSpeed = Math.hypot(vx, vy);
        this.damageDealt = 0;
    }

    addWeapon(w, canParry = w.range && w.thickness) {
        w.ball = this;
        this.weapons.push(w);
        if (w.ballColFns.length > 0) this.dmgWeapons.push(w);
        if (canParry) this.parryWeapons.push(w);
    }

    damage(dmg, source = null) {
        super.damage(dmg);
        this.flashTime = flashDur;
        if (source && !this.owner) {
            source.getRootOwner().damageDealt += Math.min(dmg, this.hp);
        }
    }

    draw() {
        this.weapons.forEach(w => w.draw());
        const flashPct = Math.max(0, this.flashTime / flashDur);
        const color = this.flashTime > 0
            ? `color-mix(in srgb, white ${Math.min(flashPct * 125, 90)}%, ${this.color})`
            : this.color;
        Ball.drawBall(this.battle.ctx, this._renderX, this._renderY, this.radius, color, Math.ceil(this.hp));
        if (this.flashTime > 0) this.flashTime--;
    }

    shouldBounce(other) { return true; }

    kineticEnergy() {
        return 0.5 * this.mass * (this.vx ** 2 + this.vy ** 2);
    }

    potentialEnergy() {
        return this.mass * this.battle.gravity * (this.battle.height - this.radius - this.y);
    }

    onUpdate(dt) {
        if (this.owner && this.owner.hp <= 0) {
            this.hp = 0;
            return;
        }
        this.handleUpdate(dt);
    }

    handleUpdate(dt) { }

    static drawBall(ctx, x, y, radius, color, text = null) {
        ctx.fillStyle = color;
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius - 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();

        if (text !== null) {
            ctx.fillStyle = "#000";
            ctx.font = `bold ${radius}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, x, y);
        }
    }

    getDisplayedHP() {
        return Math.ceil(this.hp);
    }
}

const HORIZONTAL = 0, VERTICAL = 1;

class Wall {
    // axis: HORIZONTAL (blocks Y movement) or VERTICAL (blocks X movement)
    // pos: position on the perpendicular axis
    // min, max: extent along the wall's axis
    // normal: +1 or -1, direction the wall faces
    constructor(axis, pos, min, max, normal) {
        this.axis = axis;
        this.pos = pos;
        this.min = min;
        this.max = max;
        this.normal = normal;
    }

    timeToCollision(b, dt) {
        const s = b.getTimeScale();
        const g = (b.gravity ? b.battle.gravity : 0) * s;

        if (this.axis === VERTICAL) {
            const vx = b.vx * s;
            const target = this.pos + this.normal * b.radius;
            if (vx * this.normal >= 0) return Infinity;
            const t = (target - b.x) / vx;
            if (t <= EPS || t > dt) return Infinity;
            const yAtT = b.y + b.vy * s * t + 0.5 * g * t * t;
            if (yAtT < this.min - b.radius || yAtT > this.max + b.radius) return Infinity;
            return t;
        } else {
            const vy = b.vy * s;
            const target = this.pos + this.normal * b.radius;
            if (g !== 0) {
                const a = 0.5 * g;
                const bq = vy;
                const c = b.y - target;
                const disc = bq * bq - 4 * a * c;
                if (disc < 0) return Infinity;
                const sqrtDisc = Math.sqrt(disc);
                const t = this.normal > 0 ? (-bq - sqrtDisc) / (2 * a) : (-bq + sqrtDisc) / (2 * a);
                if (t <= EPS || t > dt) return Infinity;
                const xAtT = b.x + b.vx * s * t;
                if (xAtT < this.min - b.radius || xAtT > this.max + b.radius) return Infinity;
                return t;
            } else {
                if (vy * this.normal >= 0) return Infinity;
                const t = (target - b.y) / vy;
                if (t <= EPS || t > dt) return Infinity;
                const xAtT = b.x + b.vx * s * t;
                if (xAtT < this.min - b.radius || xAtT > this.max + b.radius) return Infinity;
                return t;
            }
        }
    }

    resolve(b) {
        b.onWallCollision();
        if (!b.shouldBounceWall(this)) return;
        const wallVel = this.velocity || 0;
        if (this.axis === VERTICAL) {
            b.x = this.pos + this.normal * b.radius;
            const bounced = -b.vx * ELASTICITY;
            b.vx = Math.abs(wallVel) > Math.abs(bounced) ? wallVel : bounced;
        } else {
            b.y = this.pos + this.normal * b.radius;
            const bounced = -b.vy * ELASTICITY;
            b.vy = Math.abs(wallVel) > Math.abs(bounced) ? wallVel : bounced;
        }
    }
}

function createBorderWalls(width, height) {
    return [
        new Wall(VERTICAL, 0, 0, height, 1),       // left
        new Wall(VERTICAL, width, 0, height, -1),  // right
        new Wall(HORIZONTAL, 0, 0, width, 1),      // top
        new Wall(HORIZONTAL, height, 0, width, -1) // bottom
    ];
}

// Plus-shaped arena with center hole
// armWidth: width of the plus arms, holeSize: size of center square hole
function createPlusArenaWalls(size, armWidth, holeSize) {
    const armStart = (size - armWidth) / 2;
    const armEnd = (size + armWidth) / 2;
    const holeStart = (size - holeSize) / 2;
    const holeEnd = (size + holeSize) / 2;

    return [
        // Outer border - top arm
        new Wall(HORIZONTAL, 0, armStart, armEnd, 1),
        // Outer border - bottom arm  
        new Wall(HORIZONTAL, size, armStart, armEnd, -1),
        // Outer border - left arm
        new Wall(VERTICAL, 0, armStart, armEnd, 1),
        // Outer border - right arm
        new Wall(VERTICAL, size, armStart, armEnd, -1),

        // Corner cutoffs - top-left
        new Wall(VERTICAL, armStart, 0, armStart, 1),
        new Wall(HORIZONTAL, armStart, 0, armStart, 1),
        // Corner cutoffs - top-right
        new Wall(VERTICAL, armEnd, 0, armStart, -1),
        new Wall(HORIZONTAL, armStart, armEnd, size, 1),
        // Corner cutoffs - bottom-left
        new Wall(VERTICAL, armStart, armEnd, size, 1),
        new Wall(HORIZONTAL, armEnd, 0, armStart, -1),
        // Corner cutoffs - bottom-right
        new Wall(VERTICAL, armEnd, armEnd, size, -1),
        new Wall(HORIZONTAL, armEnd, armEnd, size, -1),

        // Center hole
        new Wall(VERTICAL, holeStart, holeStart, holeEnd, -1),
        new Wall(VERTICAL, holeEnd, holeStart, holeEnd, 1),
        new Wall(HORIZONTAL, holeStart, holeStart, holeEnd, -1),
        new Wall(HORIZONTAL, holeEnd, holeStart, holeEnd, 1),
    ];
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
    const g1 = (b1.gravity ? b1.battle.gravity : 0) * s1;
    const g2 = (b2.gravity ? b2.battle.gravity : 0) * s2;
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

        const tCol = (-b - Math.sqrt(disc)) / (2 * a);
        if (tCol > EPS && tCol <= dt) return tCol;
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

    // If already touching/overlapping at t=0, return immediately
    if (f(0) <= EPS) return EPS;

    // Binary search for first collision time
    let lo = 0, hi = dt;

    // First, find a point where they're overlapping
    let foundOverlap = false;
    for (let i = 1; i <= 8; i++) {
        if (f(dt * i / 8) <= 0) {
            hi = dt * i / 8;
            foundOverlap = true;
            break;
        }
    }
    if (!foundOverlap && f(dt) <= 0) {
        hi = dt;
        foundOverlap = true;
    }
    if (!foundOverlap) return Infinity;

    // Now binary search between lo and hi to find first collision
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
                    a.vx = a.vx - 2 * dot * nx;
                    a.vy = a.vy - 2 * dot * ny;
                }
            }
        }
        return;
    }

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

function applySlowTime(duration, attacker, receiver, slowFactor = 0.2) {
    if (receiver instanceof DuplicatorBall || attacker.hp <= 0 || receiver.hp <= 0 || slowFactor > receiver.slowFactor) return;
    // if (receiver instanceof DuplicatorBall || attacker.owner || attacker.hp <= 0 || receiver.owner || receiver.hp <= 0) return;

    function applySlow(b) {
        b.slowFactor = b.slowTime > 0 ? Math.min(b.slowFactor, slowFactor) : slowFactor;
        b.slowTime = Math.max(b.slowTime, duration);
        // if (b.owner) applySlow(b.owner);
        // console.log(slowFactor, "to " + b.constructor.name + " for " + b.slowTime + " frames");
    }
    applySlow(attacker);
    applySlow(receiver);
}

class BallBattle {
    constructor(balls, seed, gravity = 0.1) {
        this.balls = [];
        this.bodies = [];
        this.particles = [];
        this.gravity = gravity;

        this.nextID = 0;
        // this.debug = true;
        this.debug = false;
        for (let b of balls) {
            this.addBall(b);
        }
        this.isDuel = balls.length == 2;

        this.lastTime = null;
        this.accumulator = 0;
        this.timeScaleAccum = 0;
        this.timeScale = 1;
        this.baseTimeScale = 1;
        this.targetTimeScale = 1;

        this.rng = new Math.seedrandom(seed);
    }

    updateTimeScale() {
        if (this.isDuel) {
            let count = 0;
            for (const b of this.balls) {
                if (!(b instanceof DuplicatorBall) && b.owner instanceof GrimoireBall) {
                    if (b instanceof DaggerBall) count += 0.5;
                    else count++;
                }
            }

            let maxBoosts = 0;
            let hasGrimoire = false;
            for (const b of this.balls) {
                if (b instanceof LanceBall) maxBoosts = Math.max(maxBoosts, b.boosts);
                hasGrimoire = hasGrimoire || (b instanceof GrimoireBall);
            }

            this.targetTimeScale = 0.9 ** count;
            this.targetTimeScale *= 1 / (1 + maxBoosts * (hasGrimoire ? 0.025 : 0.01));
            // Gradual interpolation for smooth transitions
        }
        else {
            let count = 0;
            for (let i = 0; i < this.balls.length; i++) {
                count += (this.balls[i] instanceof DuplicatorBall ? 0.1 : 1) * (this.balls[i].owner ? 0.5 : 1);
            }
            this.targetTimeScale = 0.9 ** Math.max(0, count - 2);
        }

        this.baseTimeScale += (this.targetTimeScale - this.baseTimeScale) * 0.01;

        // Per-ball hit history slowdown (outside duels)
        const getHitSlowFactor = (b) => {
            let weighted = 0, totalWeight = 0;
            for (let i = 0; i < hitHistorySize; i++) {
                const age = (hitHistorySize + b.hitIndex - i) % hitHistorySize;
                const w = 0.85 ** (age * this.baseTimeScale ** 2);
                weighted += b.hitHistory[i] * w;
                totalWeight += w;
            }
            const intensity = weighted / totalWeight;
            return Math.max(0.2, 1 / (1 + 2 * intensity));
        };

        if (!this.isDuel) {
            for (const b of this.balls) {
                if (b.owner) continue;
                const slowFactor = getHitSlowFactor(b);
                if (slowFactor < b.slowFactor) {
                    b.slowFactor = slowFactor;
                    b.slowTime = Math.max(b.slowTime, 1);
                }
            }
        }

        this.timeScale = this.baseTimeScale;
        if (this.isDuel) {
            let ts = 1;
            for (let i = 0; i < this.balls.length; i++) {
                const b = this.balls[i];
                ts = Math.min(ts, b.getTimeScale(false), getHitSlowFactor(b));
            }
            this.timeScale *= ts;
        }
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

    addCanvas(canvas, offset = 0) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.ctx.imageSmoothingEnabled = false;
        if (offset) this.ctx.translate(offset, offset);
        this.width = canvas.width - 2 * offset;
        this.height = canvas.height - 2 * offset;
        this.walls = createBorderWalls(this.width, this.height);
    }

    addWall(wall) {
        this.walls.push(wall);
    }

    drawCircle(circle, color, borderColor = "#333", borderWidth = 0) {
        const ctx = this.ctx;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.fillStyle = color;

        const x = circle._renderX ?? circle.x;
        const y = circle._renderY ?? circle.y;
        ctx.beginPath();
        ctx.arc(x, y, circle.radius - ctx.lineWidth / 2, 0, Math.PI * 2);
        if (borderWidth > 0) ctx.stroke();
        ctx.fill();
    }

    advanceAll(adv) {
        for (const b of this.bodies) {
            const g = b.gravity ? this.gravity : 0;
            const s = b.getTimeScale();
            b.x = b.x + b.vx * s * adv;
            b.y = b.y + b.vy * s * adv + 0.5 * g * s * s * adv * adv;
            b.vy = b.vy + g * s * adv;
        }
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
        let iterations = 0;
        while (dt > EPS) {
            // if (++iterations > 1000) {
            //     console.warn(`[t=${t}] Physics loop exceeded 1000 iterations, bodies=${this.bodies.length}, dt=${dt}`);
            //     break;
            // }
            // --- Find earliest ball-ball collision ---
            let tBall = Infinity;
            let pair = null;

            for (let i = 0; i < this.bodies.length; i++) {
                for (let j = i + 1; j < this.bodies.length; j++) {
                    // const key = this.bodies[i].id + '-' + this.bodies[j].id;
                    // if (collidedThisFrame.has(key)) continue;
                    const tCol = timeToCollision(this.bodies[i], this.bodies[j], dt);
                    if (tCol < tBall) {
                        tBall = tCol;
                        pair = [this.bodies[i], this.bodies[j]];
                    }
                }
            }

            // --- Find earliest wall collision ---
            let tWall = Infinity;
            let wallEvents = [];

            for (const b of this.bodies) {
                for (const wall of this.walls) {
                    const t = wall.timeToCollision(b, dt);
                    if (t < tWall - EPS) {
                        tWall = t;
                        wallEvents = [{ ball: b, wall }];
                    } else if (Math.abs(t - tWall) <= EPS) {
                        wallEvents.push({ ball: b, wall });
                    }
                }
            }

            // --- Choose earliest event ---
            const tNext = Math.min(tBall, tWall);

            if (iterations > 980) {
                const pairStr = pair ? `${pair[0].constructor.name}#${pair[0].id} <-> ${pair[1].constructor.name}#${pair[1].id}` : 'none';
                console.log(`iter=${iterations} tNext=${tNext.toFixed(9)} tBall=${tBall.toFixed(9)} tWall=${tWall.toFixed(9)} pair=${pairStr}`);
            }

            if (tNext === Infinity) {
                this.advanceAll(dt);
                return;
            }

            this.advanceAll(tNext);
            dt -= tNext;

            // Ball-ball
            if (tBall <= tNext + EPS) {
                resolveCollision(pair[0], pair[1]);
                // collidedThisFrame.add(pair[0].id + '-' + pair[1].id);
            }

            // Walls
            if (tWall <= tNext + EPS) {
                for (const ev of wallEvents) {
                    ev.wall.resolve(ev.ball);
                    // Clear collision pairs involving this ball so it can re-collide after velocity change
                    // for (const key of [...collidedThisFrame]) {
                    //     if (key.startsWith(ev.ball.id + '-') || key.endsWith('-' + ev.ball.id)) {
                    //         collidedThisFrame.delete(key);
                    //     }
                    // }
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
                            w._collidingWith[target.id] = w.iframes;
                            for (let i = 0; i < rotations; i++) {
                                w.ballColFns.forEach(fn => fn(target));
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
                            f(scaledDt)));
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
        dead.forEach((b) => {
            b.slowTime = 0;
            const count = Math.ceil(b.radius * 0.5);
            for (let i = 0; i < count; i++) {
                this.particles.push(new DeathParticle(this, b.x, b.y, b.color));
            }
        });
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
                            w.ballColFns.forEach(fn => fn(B));
                        }
                    }
                }

                for (const w of B.dmgWeapons) {
                    if (B.team !== A.team && weaponHitsBall(w, A)) {
                        hitThisFrame.add(B.id + "-" + w.theta + "-" + A.id);
                        if (!(A.id in w._collidingWith)) {
                            w._collidingWith[A.id] = w.iframes;
                            w.ballColFns.forEach(fn => fn(A));
                        }
                    }
                }

                // weapon - weapon
                for (const w1 of A.parryWeapons) {
                    for (const w2 of B.parryWeapons) {
                        if (weaponWeaponContact(w1, w2)) {
                            w1.weaponColFns.forEach(fn => fn(w2));
                            w2.weaponColFns.forEach(fn => fn(w1));
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
        const alpha = this.renderAlpha || 0;

        // Interpolate positions for smooth rendering
        for (const b of this.bodies) {
            if (b._prevX !== undefined) {
                b._renderX = b._prevX + (b.x - b._prevX) * alpha;
                b._renderY = b._prevY + (b.y - b._prevY) * alpha;
            } else {
                b._renderX = b.x;
                b._renderY = b.y;
            }
        }

        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        this.drawArena(this.ctx);

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

        // Update and draw particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update();
            if (p.life <= 0) this.particles.splice(i, 1);
            else p.draw(this.ctx);
        }
    }

    updateArenaShrink() {
        if (!this.shrinkConfig) return;
        const playerCount = this.balls.filter(b => !b.owner).length;
        const { stages, baseSize, baseArmWidth, holeSize } = this.shrinkConfig;

        let targetSize = baseSize, targetHoleSize = holeSize, targetZoom = 1;
        for (const s of stages) {
            if (playerCount <= s.players) {
                targetSize = s.size;
                if (s.holeSize !== undefined) targetHoleSize = s.holeSize;
                if (s.zoom !== undefined) targetZoom = s.zoom;
            }
        }

        if (this.arenaSize === undefined) this.arenaSize = baseSize;
        if (this.arenaHoleSize === undefined) this.arenaHoleSize = holeSize;
        if (this.zoom === undefined) this.zoom = 1;

        const shrinking = this.arenaSize > targetSize + 0.1;

        if (!shrinking && Math.abs(this.arenaHoleSize - targetHoleSize) < 0.1) {
            for (const w of this.walls) w.velocity = 0;
            return;
        }

        const sizeDelta = this.arenaSize - targetSize;
        const holeDelta = this.arenaHoleSize - targetHoleSize;
        const zoomDelta = targetZoom - this.zoom;
        if (sizeDelta > 0) {
            const rate = 1 / sizeDelta;
            this.arenaSize -= 1;
            if (holeDelta > 0) this.arenaHoleSize -= holeDelta * rate;
            this.zoom += zoomDelta * rate;
            this.canvas.style.transform = `scale(${this.zoom})`;
        }
        const size = this.arenaSize;
        const curHoleSize = this.arenaHoleSize;
        const offset = (baseSize - size) / 2;
        const armWidth = Math.min(baseArmWidth, size);

        const holeVel = sizeDelta > 0 ? -holeDelta / sizeDelta : 0;

        this.walls = createPlusArenaWalls(size, armWidth, curHoleSize).map((w, i) => {
            w.pos += offset;
            w.min += offset;
            w.max += offset;
            // Last 4 walls are center hole - they move opposite to normal when shrinking
            w.velocity = i >= this.walls.length - 4 ? -w.normal * holeVel : w.normal;
            return w;
        });

        const as = offset + (size - armWidth) / 2, ae = offset + (size + armWidth) / 2;
        const hs = offset + (size - curHoleSize) / 2, he = offset + (size + curHoleSize) / 2;

        this.isInBounds = (x, y, r) => {
            if (x - r < offset || x + r > offset + size || y - r < offset || y + r > offset + size) return false;
            if (x + r > hs && x - r < he && y + r > hs && y - r < he) return false;
            return (x - r >= as && x + r <= ae) || (y - r >= as && y + r <= ae);
        };

        this.drawArena = (ctx) => {
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.moveTo(as, offset); ctx.lineTo(ae, offset); ctx.lineTo(ae, as);
            ctx.lineTo(offset + size, as); ctx.lineTo(offset + size, ae); ctx.lineTo(ae, ae);
            ctx.lineTo(ae, offset + size); ctx.lineTo(as, offset + size); ctx.lineTo(as, ae);
            ctx.lineTo(offset, ae); ctx.lineTo(offset, as); ctx.lineTo(as, as);
            ctx.closePath();
            ctx.moveTo(hs, hs); ctx.lineTo(hs, he); ctx.lineTo(he, he); ctx.lineTo(he, hs);
            ctx.closePath();
            ctx.fill("evenodd");
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.fill("evenodd");
        };

        // Remove turrets outside play area
        // this.bodies = this.bodies.filter(b => !(b instanceof Turret) || this.isInBounds(b.x, b.y, -b.radius));

        // Push bodies out of walls they've ended up inside (skip center hole walls - last 4)
        for (const b of this.bodies) {
            for (let i = 0; i < this.walls.length - 4; i++) {
                const wall = this.walls[i];
                const along = wall.axis === VERTICAL ? b.y : b.x;
                if (along < wall.min - b.radius || along > wall.max + b.radius) continue;
                const perp = wall.axis === VERTICAL ? b.x : b.y;
                if ((perp - wall.pos) * wall.normal < b.radius) {
                    if (wall.axis === VERTICAL) {
                        b.x = wall.pos + wall.normal * b.radius;
                        if (b.vx * wall.normal < 0) b.vx = -b.vx * ELASTICITY;
                    } else {
                        b.y = wall.pos + wall.normal * b.radius;
                        if (b.vy * wall.normal < 0) b.vy = -b.vy * ELASTICITY;
                    }
                }
            }
        }
    }

    update() {
        this.updateArenaShrink();

        for (const b of this.bodies) {
            b.slowAtFrameStart = b.slowTime > 0 ? b.slowFactor : 1;
            b.slowFactor = Math.min(1, b.slowFactor * (1 + 0.05 * (1 / this.timeScale)));
            b.hpAtFrameStart = b.hp;
        }

        for (const b of this.balls) {
            b.hitsThisFrame = 0;
        }

        this.updatePhysics();

        // Debug log at key frames
        // if (t >= 2360 && t <= 2380) {
        //     const state = this.balls.map(b => `${b.constructor.name}:hp=${b.hp.toFixed(2)},x=${b.x.toFixed(2)},y=${b.y.toFixed(2)}`).join(' | ');
        //     console.log(`t=${t} bodies=${this.bodies.length} ${state}`);
        // }

        this.bodies.sort((a, b) => a.id - b.id);
        this.bodies.forEach((b) => b.onUpdate(b.getTimeScale()));

        // t0 = performance.now();
        this.updateWeapons();
        // profiler.weapons += performance.now() - t0;

        this.processDeaths();

        for (const b of this.balls) {
            b.hitIndex = (b.hitIndex + 1) % hitHistorySize;
            b.hitHistory[b.hitIndex] = b.hitsThisFrame;
        }

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

    isInsideWall(x, y, radius) {
        if (this.isInBounds) return !this.isInBounds(x, y, radius);
        for (const wall of this.walls) {
            const along = wall.axis === VERTICAL ? y : x;
            if (along < wall.min || along > wall.max) continue;
            const perp = wall.axis === VERTICAL ? x : y;
            const dist = (perp - wall.pos) * wall.normal;
            if (dist < radius) return true;
        }
        return false;
    }

    async run(dt) {
        // while (t < 5500) {
        //     t++
        //     this.updateTimeScale();
        //     this.update();
        // }

        const loop = async (currentTime) => {
            if (this.lastTime !== null) {
                this.accumulator += (currentTime - this.lastTime) * this.timeScale;

                while (this.accumulator >= dt) {
                    t++;
                    // Store previous positions before update
                    for (const b of this.bodies) {
                        b._prevX = b.x;
                        b._prevY = b.y;
                        if (b.theta !== undefined) b._prevTheta = b.theta;
                    }
                    for (const b of this.balls) {
                        for (const w of b.weapons) w._prevTheta = w.theta;
                    }

                    if (!this.isDuel) this.updateTimeScale();
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

            this.timeScaleAccum += currentTime - this.lastTime;
            this.lastTime = currentTime;
            if (this.isDuel) {
                while (this.timeScaleAccum >= dt) {
                    this.updateTimeScale();
                    this.timeScaleAccum -= dt;
                }
            }
            // Interpolate for smooth rendering
            this.renderAlpha = this.accumulator / dt;
            this.render();
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }
}

function propsToList(propsMap) {
    const ul = document.createElement("ul");
    for (let p in propsMap) {
        const { text, grad } = propsMap[p];

        const li = document.createElement("li");
        li.textContent = p + "\u00A0";

        const val = document.createElement("strong");
        val.textContent = "" + text;
        li.appendChild(val);

        if (grad) {
            const { from, to } = grad;
            const pct = Math.min(4, (parseFloat(text) - from) / (to - from));
            if (pct < 1) val.style.color = `rgb(${Math.round(255 * pct)},0,0)`;
            else {
                let pct2 = (pct - 1) / 3;
                val.style.color = `rgb(${Math.round(255 - 32 * pct2)},0,${Math.round(223 * pct2)})`;
            }
        }

        ul.appendChild(li);
    }
    return ul;
}

// Duplicator: Reproduces on hit
const dmgCooldown = 5, dupeCooldown = 5, dupeLimit = 25;
class DuplicatorBall extends Ball {
    constructor(x, y, vx, vy, hp = 100, radius = 20, color = "#f86ffa", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.dmgCooldown = 0;
        this.dupeCooldown = 0;
    }

    onCollision(b) {
        if (this.inert || b.team == this.team || !(b instanceof Ball) || (this.dmgCooldown > EPS)) return;

        if (b instanceof Ball) {
            // if (!(b instanceof DuplicatorBall)) console.log(`[t=${t}]`, this.id, "hit", this.dmgCooldown, this.dupeCooldown);
            b.damage(1, this);
            if (!b.owner && !(b instanceof DuplicatorBall)) {
                this.hitsThisFrame++;
                b.hitsThisFrame++;
            }
        }
        this.dmgCooldown = dmgCooldown;

        if ((this.battle.dupeCount[this.team] ?? 0) >= dupeLimit || this.hpAtFrameStart <= 1 || this.dupeCooldown > EPS) return;

        // if (!(b instanceof DuplicatorBall)) this.battle.dupeCooldown[this.team] = 1;
        this.dupeCooldown = dupeCooldown;
        // this.damage(1);

        const theta = this.battle.rng() * 2 * Math.PI;
        const child = new DuplicatorBall(this.x, this.y, Math.cos(theta) * 5, Math.sin(theta) * 5, Math.floor(this.hpAtFrameStart / 2));
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

    getInfoEl() {
        return propsToList({
            "Population": { text: (this.battle.dupeCount ? this.battle.dupeCount[this.team] : 1) + "/" + dupeLimit, grad: { from: 1, to: 25 } },
        });
    }

    getDisplayedHP() {
        let max = 0;
        for (let b of this.battle.balls) {
            if (b instanceof DuplicatorBall && b.team == this.team) {
                max = Math.max(max, b.hp);
            }
        }
        return Math.ceil(max);
    }
}

// Dagger: Spins faster
const baseSpin = Math.PI * 0.085;
class DaggerBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#5fbf00", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const cfg = getWeaponConfig(DaggerBall);
        const dagger = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset);
        dagger.addCollider(30, 6);
        dagger.addSpin(baseSpin * dir);
        // dagger.addParry();
        dagger.addDamage(1, 1, false, 1.5);
        // dagger.addDirChange();

        this.scalingCooldown = {};
        dagger.ballColFns.push((b) => {
            if (!(b.id in this.scalingCooldown)) {
                dagger.angVel = (Math.abs(dagger.angVel) + Math.PI * 0.017) * Math.sign(dagger.angVel);
            }
            this.scalingCooldown[b.id] = 50;
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

    getInfoEl() {
        return propsToList({
            "Spin Boost": { text: Math.round((Math.abs(this.weapons[0].angVel) - baseSpin) * 100 / baseSpin) + "%", grad: { from: 0, to: 1000 } },
        });
    }
}

// Sword: Increases damage
class SwordBall extends Ball {
    constructor(x, y, vx, vy, theta, dir, hp = 100, radius = 25, color = "#ff6464", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const cfg = getWeaponConfig(SwordBall);
        const sword = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset);
        sword.addCollider(60, 8, 10);
        sword.addSpin(Math.PI * 0.021 * dir);
        sword.addParry();
        sword.addDamage(1, 40);
        // sword.addDirChange();
        sword.ballColFns.push(() =>
            sword.dmg++
        );
        this.addWeapon(sword);
    }

    getInfoEl() {
        return propsToList({
            "Damage": { text: this.weapons[0].dmg, grad: { from: 1, to: 20 } },
        });
    }
}

// Lance: Increases movement speed and combos
const comboLeniency = 6, boostPct = 0.05;
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

        const cfg = getWeaponConfig(LanceBall);
        const lance = new Weapon(Math.atan2(this.vy, this.vx), cfg.sprite, cfg.scale, cfg.offset, 0, cfg.rotation);
        lance.addCollider(92, 15, 58);
        lance.iframes = 0;
        lance.DoT = true;
        lance.ballColFns.push((target) => {
            const oldHit = this.hit;
            this.hit = comboLeniency;
            if (this.dist > 0 && this.damageThisTick == -1) {
                return -1;
            }

            if (this.damageThisTick == -1) {
                const isNewTarget = !this.comboHits.has(target.id);
                if (isNewTarget) {
                    const boostSpeed = boostPct * this.startSpeed;
                    const baseSpeed = this.startSpeed + boostSpeed * this.boosts;
                    const newBaseSpeed = baseSpeed + boostSpeed;
                    const energyGain = 0.5 * (newBaseSpeed * newBaseSpeed - baseSpeed * baseSpeed);
                    this.boostEnergy += energyGain;
                    this.boosts++;

                    const speed = Math.hypot(this.vx, this.vy);
                    const newSpeed = Math.sqrt(speed * speed + 2 * energyGain);
                    this.vx *= newSpeed / speed;
                    this.vy *= newSpeed / speed;
                }

                if (this.combo == 0 || oldHit < comboLeniency - 1) this.dist = 0;

                this.comboHits.add(target.id);
                const distToHit = 71 * this.startSpeed;
                const counts = Math.floor(-this.dist / distToHit) + 1;
                this.dist += counts * distToHit;

                const oldCombo = this.combo;
                this.combo += counts;
                this.damageThisTick = (oldCombo + this.combo + 1) * counts / 2;
            }

            target.damage(this.damageThisTick, this);

            const speed2 = this.vx ** 2 + this.vy ** 2;
            let slowness = (10 / this.battle.baseTimeScale) * Math.sqrt(this.startSpeed) / speed2;
            if (target.owner) slowness *= 1.5;
            // console.log(slowness);
            if (slowness < 1) applySlowTime(400, this, target, slowness);
        });

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

    getInfoEl() {
        return propsToList({
            "Speed Boost": { text: this.boosts * 100 * boostPct + "%", grad: { from: 0, to: 200 } },
            // "Combo": { text: this.combo, grad: { from: 0, to: 10 } },
        });
    }
}

// Machine Gun: fires bullets
const bulletRadius = 5, maxVolley = 220;
class MachineGunBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#61a3e9", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.damagePerRound = 10;
        this.pendingDamage = 0;
        this.bulletsPerRound = this.damagePerRound;
        this.reloadTime = 60;
        this.fireDelay = 0;
        this.bonusDmg = 0;
        this.bonusDmgRate = 0;
        this.ammoUse = 0;

        const cfg = getWeaponConfig(MachineGunBall);
        const gun = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset, cfg.shift || 0, cfg.rotation);
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

            if (this.battle.inBounds(spawnX, spawnY, bulletRadius) && !this.battle.isInsideWall(spawnX, spawnY, bulletRadius)) {
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
            let fd = 90 / (120 * 0.25 + 0.75 * this.bulletsPerRound);
            this.fireDelay += fd;
        }

        if (this.ammoUse >= 1 - EPS) {
            this.ammoUse = 0;
            this.damagePerRound += this.pendingDamage;
            this.pendingDamage = 0;
            this.bonusDmgRate = Math.max(0, this.damagePerRound - maxVolley) / maxVolley;
            this.bulletsPerRound = Math.min(maxVolley, this.damagePerRound);
            this.reloadTime = 60;
            this.fireDelay = 0;
        }
    }

    getInfoEl() {
        return propsToList({
            "Bullets": { text: this.damagePerRound + this.pendingDamage, grad: { from: 10, to: 150 } },
        });
    }
}

class Bullet extends CircleBody {
    constructor(x, y, vx, vy, owner, dmg = 1, lifetime = 30) {
        super(x, y, vx, vy, 1, bulletRadius, 0, false);
        this.owner = owner;
        this.reflectCooldown = 0;
        this.hitCredit = owner;
        this.prevHitCredit = null;
        this.dmg = dmg;
        this.color = "#111";
        this.lifetime = lifetime;
        this.maxLifetime = lifetime;
        this._hitThisFrame = new Set();
    }

    onLoad() {
        for (const b of this.battle.bodies) {
            if (b.team !== this.owner.team && ballsOverlap(this, b)) {
                this.onCollision(b);
                break;
            }
        }
    }

    onCollision(b) {
        if (this.hp <= 0) return;
        if (b instanceof Bullet) return;
        if (this._hitThisFrame.has(b.id)) return; // Already hit this frame
        this._hitThisFrame.add(b.id);
        this.handleCollision(b);
    }

    handleCollision(b) {
        if (b instanceof Ball /*&& this.lifetime >= 0.05 * this.maxLifetime*/) {
            const hc = b == this.hitCredit ? this.prevHitCredit : this.hitCredit;
            b.damage(this.dmg, hc.getRootOwner());
        }
        if (b instanceof Turret) this.hp = 0;
    }

    onWallCollision() {
        this.hp = 0;
    }

    shouldBounce(other) { return false; }

    draw() {
        const ctx = this.battle.ctx;
        const fadeStart = this.maxLifetime * 0.3;
        ctx.globalAlpha = Math.min(1, this.lifetime / fadeStart);
        this.battle.drawCircle(this, this.color, "#333", 1);
        ctx.globalAlpha = 1;
    }

    onUpdate(dt) {
        this._hitThisFrame.clear();
        this.reflectCooldown -= dt;
        this.lifetime -= dt;
        if (this.lifetime <= 0) this.hp = 0;
    }

    reflect(wielder, weapon) {
        if (this.reflectCooldown > 0) return;

        this.reflectCooldown = 10;
        this.lifetime = this.maxLifetime;

        if (wielder.team != this.hitCredit.team) {
            this.prevHitCredit = this.hitCredit;
            if (this instanceof MGBullet && !wielder.owner) {
                wielder.hitsThisFrame++;
            }
        }
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
            const hc = b == this.hitCredit ? this.prevHitCredit : this.hitCredit;
            if (!b.owner && !(b instanceof DuplicatorBall)) {
                b.hitsThisFrame++;
                if (hc == this.owner) this.owner.hitsThisFrame++;
            }

            if (hc.team == this.owner.team) {
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
        const cfg = getWeaponConfig(WrenchBall);
        const wrench = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset, 0, cfg.rotation);
        wrench.addCollider(45, 6);
        wrench.addSpin(Math.PI * 0.019 * dir);
        wrench.addParry();
        wrench.addDamage(1, 40);
        wrench.addDirChange();
        this.turretCooldown = 0;
        this.turretCount = 0;
        this.ticksSinceDamage = 0;

        wrench.ballColFns.push((b) => {
            if (this.turretCooldown >= EPS) return;

            // Contact point: on target ball's surface, toward the wrench ball
            const dx = this.x - b.x, dy = this.y - b.y;
            const dist = Math.hypot(dx, dy);
            const nx = dx / dist, ny = dy / dist;
            const tx = b.x + nx * (b.radius + turretRadius);
            const ty = b.y + ny * (b.radius + turretRadius);
            if (this.battle.inBounds(tx, ty, turretRadius)) {
                // const overlaps = this.battle.bodies.some(body =>
                //     body instanceof Turret &&
                //     Math.hypot(body.x - tx, body.y - ty) < turretRadius * 2
                // );
                // if (overlaps) return;

                this.turretCooldown = 60;
                this.turretCount++;

                // Reflect ball velocity away from turret
                const dot = b.vx * nx + b.vy * ny;
                if (dot > 0) {
                    b.vx -= 2 * dot * nx;
                    b.vy -= 2 * dot * ny;
                }
                const turret = new Turret(tx, ty, this, this.battle.rng() * 2 * Math.PI, Math.PI * -0.01 * Math.sign(wrench.angVel));
                this.battle.addBody(turret);
            }
        });
        this.addWeapon(wrench);
    }

    damage(dmg, source) {
        super.damage(dmg, source);
        this.ticksSinceDamage = 0;
    }

    handleUpdate(dt) {
        this.turretCooldown -= dt;
        this.ticksSinceDamage += dt;
    }

    getTurretPower() {
        if (this.ticksSinceDamage <= 500) return 1;
        const onlyDupes = this.battle.balls.length > 1 && this.battle.balls.every(b => b.team === this.team || b instanceof DuplicatorBall);
        return onlyDupes ? 1 + Math.min(500, this.ticksSinceDamage - 500) / 50 : 1;
    }

    getInfoEl() {
        return propsToList({
            "Turrets": { text: this.turretCount, grad: { from: 0, to: 15 } },
        });
    }
}

const fireDelay = 38;
class Turret extends CircleBody {
    constructor(x, y, owner, theta, angVel) {
        super(x, y, 0, 0, 1, turretRadius, Infinity, false);
        this.owner = owner;
        this.theta = theta;
        this.angVel = angVel;
        this.fireDelay = fireDelay;
        this.zIndex = 0;
    }

    draw() {
        this.battle.drawCircle(this, this.owner.color, "#333", 2);

        const ctx = this.battle.ctx;
        const width = 5; // rectangle thickness
        const x = this._renderX ?? this.x;
        const y = this._renderY ?? this.y;
        const alpha = this.battle.renderAlpha || 0;
        const theta = this._prevTheta !== undefined
            ? this._prevTheta + (this.theta - this._prevTheta) * alpha
            : this.theta;

        ctx.save();

        // Move to origin point
        ctx.translate(x, y);

        // Rotate to match theta
        ctx.rotate(theta);

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

        const power = this.owner.getTurretPower();
        this.theta += this.angVel * (9 + power) / 10 * dt;
        this.fireDelay -= dt * power;
        if (this.fireDelay <= 0) {
            this.fireDelay = fireDelay;
            const spawnDist = this.radius + 6, speed = 5 * (24 + power) / 25;
            const bullet = new Bullet(
                this.x + Math.cos(this.theta) * spawnDist,
                this.y + Math.sin(this.theta) * spawnDist,
                Math.cos(this.theta) * speed,
                Math.sin(this.theta) * speed,
                this.owner,
                power,
                42
            );
            this.battle.addBody(bullet);
        }
    }

    shouldBounce(other) { return true; }
}

// Grimoire: Summons undead minion clones
class GrimoireBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#a3a3c6", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.nextMinionHP = 0;

        const cfg = getWeaponConfig(GrimoireBall);
        const grimoire = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset, cfg.shift || 0, cfg.rotation);
        grimoire.iframes = 0;
        grimoire.addCollider(30, 17);
        grimoire.addSpin(Math.PI * 0.023 * dir);
        // grimoire.addParry();
        grimoire.addDirChange();

        grimoire.addDamage(1, 40);

        grimoire.ballColFns.push((target) => {
            this.nextMinionHP += this.battle.isDuel ? 3 : 2;
            if (target instanceof DuplicatorBall && (this.battle.dupeCount[this.team] ?? 0) >= dupeLimit) return;

            const minion = this.createMinion(target);
            if (minion && this.battle.inBounds(minion.x, minion.y, minion.radius)) {
                minion.inert = true;
                this.battle.addBall(minion);
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
        minion.slowFactor = this.slowFactor;
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
            minion.startSpeed = this.startSpeed * 4 / 3;
        }
    }

    getMinionArgs(target, Constructor, newRadius, scale) {
        const theta = Math.atan2(target.vy, target.vx) + Math.PI;
        const speed = this.startSpeed * 4 / 3;
        const baseArgs = [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed];

        if (Constructor === DaggerBall || Constructor === SwordBall || Constructor === MachineGunBall || Constructor === WrenchBall) {
            return [...baseArgs, target.weapons[0]?.theta || 0, 1, this.nextMinionHP, newRadius];
        }
        if (Constructor === GrimoireBall) {
            return [...baseArgs, target.weapons[0]?.theta || 0, 1, this.nextMinionHP, newRadius];
        }
        if (Constructor === LanceBall) {
            const speed = this.startSpeed * 4 / 3 + 1 / 3 * target.boosts;
            return [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed, this.nextMinionHP, newRadius];
        }
        if (Constructor === DuplicatorBall) {
            return [...baseArgs, this.nextMinionHP, newRadius];
        }
        return [...baseArgs, this.nextMinionHP, newRadius];
    }

    getInfoEl() {
        return propsToList({
            "Summon HP": { text: this.nextMinionHP + (this.battle.isDuel ? 3 : 2), grad: { from: 3, to: 30 } },
        });
    }
}

function randomVel(abs, rng) {
    const theta = rng() * 2 * Math.PI;
    return [Math.cos(theta) * abs, Math.sin(theta) * abs];
}

class DeathParticle {
    constructor(battle, x, y, color) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.radius = 3 + Math.random() * 4;
        this.color = color;
        this.life = 1;
        this.decay = 0.02 + Math.random() * 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }

    draw(ctx) {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * this.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

const ballClasses = [
    { name: "Duplicator", class: DuplicatorBall, hp: 100, radius: 20, color: "#f86ffa" },
    { name: "Dagger", class: DaggerBall, hp: 100, radius: 25, color: "#5fbf00", weapon: { sprite: "sprites/dagger.png", scale: 3, offset: -9, rotation: Math.PI / 4, spin: true } },
    { name: "Lance", class: LanceBall, hp: 100, radius: 25, color: "#dfbf9f", weapon: { sprite: "sprites/spear.png", scale: 4, offset: -42, rotation: 3 * Math.PI / 4, spin: false } },
    { name: "Machine Gun", class: MachineGunBall, hp: 100, radius: 25, color: "#61a3e9", weapon: { sprite: "sprites/gun.png", scale: 2, offset: -9, shift: 7, rotation: 0, spin: true } },
    { name: "Wrench", class: WrenchBall, hp: 100, radius: 25, color: "#ff9933", weapon: { sprite: "sprites/wrench.png", scale: 2, offset: -6, rotation: 3 * Math.PI / 4, spin: true } },
    { name: "Grimoire", class: GrimoireBall, hp: 100, radius: 25, color: "#a3a3c6", weapon: { sprite: "sprites/grimoire.webp", scale: 2, offset: -13, shift: -1, rotation: Math.PI / 4, spin: true } },
    { name: "Sword", class: SwordBall, hp: 100, radius: 25, color: "#ff6464", weapon: { sprite: "sprites/sword.png", scale: 4, offset: -21, rotation: Math.PI / 4, spin: true } },
];

function getWeaponConfig(BallClass) {
    return ballClasses.find(b => b.class === BallClass)?.weapon;
}
