"use strict"

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
        this.iFrames = {};
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
        // return;
        this.flipped = this.angVel < 0;
        this.weaponColFns.push((other) => {
            if (other.ball.team == this.ball.team) return;
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
        this.ballColFns.push((b, reflector) => {
            const source = reflector || this.ball;
            b.damage(this.dmg, source);
            if (!b.owner && !(b instanceof DuplicatorBall)) {
                const amt = (this.ball instanceof DaggerBall && (this.ball.owner || b instanceof GrimoireBall)) ? 0.5 : hitSlow;
                addToHitHistory([source, b], amt);
            }
        });
    }

    addDirChange() {
        this.ballColFns.push(() => this.angVel *= -1);
    }

    getIFrames(target) {
        let iframes = this.iframes;
        if (target instanceof GrowerBall) {
            iframes = Math.min(target.battle.isDuel ? 7 : 20, iframes);
        }
        return iframes;
    }

    scaleBy(s) {
        this.scale *= s;
        this.offset *= s;
        this.spriteShift *= s;
        if (this.range) this.range *= s;
        if (this.thickness) this.thickness *= s;
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
        this.knockBoost = 0;
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
        this.slamTimer = 0;
        this.slamSource = null;
    }

    checkSlamDamage(other = null) {
        if (this.slamTimer > 0 && !(this.slamSource == other && this.slamTimer == (this.battle.isDuel ? duelSlam : FFASlam))) {
            // this.damage(this.slamTimer, this.slamSource);

            let dmg;
            if (this.battle.isDuel) {
                dmg = this.slamTimer > 9 ? 3 :
                    this.slamTimer > 6 ? 2 :
                        1;
            }
            else {
                dmg = this.slamTimer > 19 ? 3 :
                    this.slamTimer > 15 ? 2 :
                        1;
            }
            // if (this.slamSource == other) console.log(t, "sadasdasd", this.slamTimer, dmg);
            this.damage(dmg, this.slamSource);

            // if (other && other instanceof Ball && other.team != this.team) {
            //     other.damage(dmg, this.slamSource);
            // }

            if (!(this instanceof GrowerBall || this instanceof DuplicatorBall)) {
                this.hitsThisFrame += 3 * dmg;
                this.slamSource.hitsThisFrame += 3 * dmg;
            }

            this.slamTimer = 0;
            this.slamSource = null;
        }
    }

    onWallCollision() {
        this.checkSlamDamage();
    }

    onCollision(b) {
        if (!(b instanceof Bullet)) {
            this.checkSlamDamage(b);
        }
        this.handleCollision(b);
    }

    addWeapon(w, canParry = w.range && w.thickness) {
        w.ball = this;
        this.weapons.push(w);
        if (w.ballColFns.length > 0) this.dmgWeapons.push(w);
        if (canParry) this.parryWeapons.push(w);
    }

    damage(dmg, source = null) {
        const hpBefore = this.hp;
        // if (t >= 8700 && t <= 8710 && this instanceof MachineGunBall) console.log(`[t=${t}] MachineGunBall.damage: dmg=${dmg.toFixed(2)} src=${source?.constructor.name} hp=${hpBefore.toFixed(2)}->${Math.max(0, hpBefore - dmg).toFixed(2)} speed=${Math.hypot(this.vx, this.vy).toFixed(2)} pos=(${this.x.toFixed(1)},${this.y.toFixed(1)})`, new Error().stack.split('\n').slice(1, 4).join(' | '));
        super.damage(dmg);
        this.flashTime = flashDur;
        if (source && !this.owner) {
            source.getRootOwner().damageDealt += Math.min(dmg, hpBefore);
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

    totalEnergy() {
        const b = this;
        let E = 0;
        E += 0.5 * b.mass * (b.vx ** 2 + b.vy ** 2);
        E += b.mass * b.battle.gravity * (b.battle.height - b.radius - b.y);
        E -= b.mass * (b.boostEnergy || 0);
        E -= b.mass * (b.knockBoost || 0);
        return E;
    }

    onUpdate(dt) {
        if (this.owner && this.owner.hp <= 0) {
            this.hp = 0;
            return;
        }
        if (this.slamTimer > 0) this.slamTimer -= dt;
        this.handleUpdate(dt);
    }

    handleUpdate(dt) { }

    handleCollision(b) { }

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
        b._pendingKnockDecay = true;
        const wallVel = this.velocity || 0;
        if (this.axis === VERTICAL) {
            b.x = this.pos + this.normal * b.radius;
            const bounced = -b.vx + wallVel / (1 + Math.abs(b.vx));
            b.vx = Math.abs(wallVel) > Math.abs(bounced) ? wallVel : bounced;
            // b.vx = bounced + wallVel;
        } else {
            b.y = this.pos + this.normal * b.radius;
            const bounced = -b.vy + wallVel / (1 + Math.abs(b.vy));
            b.vy = Math.abs(wallVel) > Math.abs(bounced) ? wallVel : bounced;
            // b.vy = bounced + wallVel;
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
function plusArenaInBounds(x, y, r, size, armWidth, holeSize, offset = 0) {
    const as = offset + (size - armWidth) / 2, ae = offset + (size + armWidth) / 2;
    const hs = offset + (size - holeSize) / 2, he = offset + (size + holeSize) / 2;
    if (x - r < offset || x + r > offset + size || y - r < offset || y + r > offset + size) return false;
    if (x + r > hs && x - r < he && y + r > hs && y - r < he) return false;
    return (x - r >= as && x + r <= ae) || (y - r >= as && y + r <= ae);
}

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
        b.vy = -b.vy;
        return true;
    }
    return false;
}


function ballsOverlap(b1, b2) {
    return Math.hypot(b2.x - b1.x, b2.y - b1.y) < b1.radius + b2.radius;
}

// Find time of collision between two balls (returns Infinity if no collision in dt)
function timeToCollision(b1, b2, dt, r1Override = null, r2Override = null) {
    if (b1 instanceof Ball && b2 instanceof Ball && (b1.inert || b2.inert)) return Infinity;
    if (b1 instanceof Bullet && b2 instanceof Bullet) return Infinity;
    if (b1 instanceof Bullet && b1.prevHitCredit == null && b2.team === b1.owner.team) return Infinity;
    if (b2 instanceof Bullet && b2.prevHitCredit == null && b1.team === b2.owner.team) return Infinity;

    // const isDebug = t >= 5900 && t <= 5950 && ((b1 instanceof GrimoireBall && b2 instanceof GrowerBall) || (b1 instanceof GrowerBall && b2 instanceof GrimoireBall));

    const r1 = r1Override ?? b1.radius;
    const r2 = r2Override ?? b2.radius;
    const R = r1 + r2;

    const dist0 = Math.hypot(b2.x - b1.x, b2.y - b1.y);
    if (dist0 < R) {
        // if (isDebug) {
        //     const [m, g] = b1 instanceof MirrorBall ? [b1, b2] : [b2, b1];
        //     console.log(`[t=${t}] timeToCollision SKIP (already overlapping) dist=${dist0.toFixed(2)} R=${R.toFixed(2)} r1=${r1.toFixed(2)}(actual=${b1.radius.toFixed(2)}) r2=${r2.toFixed(2)}(actual=${b2.radius.toFixed(2)}) Mirror.v=(${m.vx.toFixed(2)},${m.vy.toFixed(2)}) Grower.v=(${g.vx.toFixed(2)},${g.vy.toFixed(2)}) Grower.scale=${g.scale?.toFixed(3)}`);
        // }
        // if ((b1 instanceof GrowerBall || b2 instanceof GrowerBall) && (b1 instanceof MirrorBall || b2 instanceof MirrorBall)) console.log(t, "oof");
        return Infinity;
    }

    const s1 = b1.getTimeScale();
    const s2 = b2.getTimeScale();
    const g1 = (b1.gravity ? b1.battle.gravity : 0) * s1;
    const g2 = (b2.gravity ? b2.battle.gravity : 0) * s2;
    const dg = g2 - g1;

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

function decayKnockBoost(b, pct = 0.5) {
    if (b.knockBoost > 0) {
        const speed = Math.hypot(b.vx, b.vy);
        if (speed >= 1) {
            const newSpeed = speed - speed * pct;
            const decayKE = 0.5 * (speed * speed - newSpeed * newSpeed);
            const actualDecay = Math.min(b.knockBoost, decayKE);
            const scale = Math.sqrt((0.5 * speed * speed - actualDecay) / (0.5 * speed * speed));
            b.vx *= scale;
            b.vy *= scale;
            b.knockBoost -= actualDecay;
        }
    }
}

// Apply elastic impulse along a normal direction
// Full elastic collision with boost handling
const knockBoostEnabled = true;
function applyElasticCollision(b1, b2, nx, ny, fromMirror = false) {
    const bothGrowerOrNeither = (b1 instanceof GrowerBall) === (b2 instanceof GrowerBall);
    const boostScale = (b1 instanceof GrowerBall && b2 instanceof GrowerBall) ? 0 : 1;

    // Effective boost energy, capped by kinetic energy. Zero if both are growers.
    const effBoost1 = Math.min(b1.boostEnergy || 0, 0.5 * (b1.vx ** 2 + b1.vy ** 2)) * boostScale;
    const effBoost2 = Math.min(b2.boostEnergy || 0, 0.5 * (b2.vx ** 2 + b2.vy ** 2)) * boostScale;

    // Strip boost energy from velocity to get "unboosted" velocities for collision math
    const unboosted = (b, eff) => {
        if (eff <= 0) return { vx: b.vx, vy: b.vy };
        const spd = Math.hypot(b.vx, b.vy);
        if (spd < EPS) return { vx: b.vx, vy: b.vy };
        const s = Math.sqrt(Math.max(0, spd * spd - 2 * eff)) / spd;
        return { vx: b.vx * s, vy: b.vy * s };
    };

    const ub1 = unboosted(b1, effBoost1), ub2 = unboosted(b2, effBoost2);
    const velAlongNormal = (ub2.vx - ub1.vx) * nx + (ub2.vy - ub1.vy) * ny;

    // Reflect a boosted ball's velocity across the collision normal when it's
    // moving toward the other ball faster (in time-scaled space)
    const tryBoostReflect = (a, b, toB) => {
        if (!a.boostEnergy || a.boostEnergy <= 0) return;
        const dotA = (a.vx * a.getTimeScale()) * nx + (a.vy * a.getTimeScale()) * ny;
        const dotB = (b.vx * b.getTimeScale()) * nx + (b.vy * b.getTimeScale()) * ny;
        if (dotA * toB > 0 && (dotA - dotB) * toB > 0) {
            const dot = a.vx * nx + a.vy * ny;
            a.vx -= 2 * dot * nx;
            a.vy -= 2 * dot * ny;
        }
    };

    // Grower-vs-non-grower can still collide even when unboosted velocities diverge
    const growerEff = (b1 instanceof GrowerBall && !(b2 instanceof GrowerBall)) ? effBoost1
        : (b2 instanceof GrowerBall && !(b1 instanceof GrowerBall)) ? effBoost2 : 0;
    const isGrowerKnock = !fromMirror && knockBoostEnabled && !bothGrowerOrNeither && growerEff > 0;
    if (velAlongNormal > 0 && !isGrowerKnock) {
        tryBoostReflect(b1, b2, 1);
        tryBoostReflect(b2, b1, -1);
        return;
    }

    // Save originals for grower knock calculation
    const orig1x = b1.vx, orig1y = b1.vy;
    const orig2x = b2.vx, orig2y = b2.vy;

    // Compute impulse on unboosted velocities
    const bothInfinite = !isFinite(b1.mass) && !isFinite(b2.mass);
    const invM1 = b2.mass === 0 ? 0 : bothInfinite ? 1 : 1 / b1.mass;
    const invM2 = b1.mass === 0 ? 0 : bothInfinite ? 1 : 1 / b2.mass;
    const j = -2 * velAlongNormal / (invM1 + invM2);

    const post1x = ub1.vx - j * invM1 * nx, post1y = ub1.vy - j * invM1 * ny;
    const post2x = ub2.vx + j * invM2 * nx, post2y = ub2.vy + j * invM2 * ny;

    // Set velocity to post-collision unboosted + re-added boost energy
    const setVelWithBoost = (b, pvx, pvy, sign, eff) => {
        if (eff <= 0) { b.vx = pvx; b.vy = pvy; return; }
        const spd = Math.hypot(pvx, pvy);
        const target = Math.sqrt(spd * spd + 2 * eff);
        if (spd > EPS) { b.vx = pvx / spd * target; b.vy = pvy / spd * target; }
        else { b.vx = nx * sign * target; b.vy = ny * sign * target; }
    };

    // Identify grower and non-grower for knock boost (if applicable)
    const grower = isGrowerKnock ? (b1 instanceof GrowerBall ? b1 : b2) : null;
    const other = grower === b1 ? b2 : grower === b2 ? b1 : null;

    if (grower && other) {
        const isB1 = grower === b1;
        const gPost = isB1 ? { x: post1x, y: post1y } : { x: post2x, y: post2y };
        const gEff = isB1 ? effBoost1 : effBoost2;
        const oEff = isB1 ? effBoost2 : effBoost1;
        const gSign = isB1 ? -1 : 1;

        // Grower: unboosted collision result + its own boost re-added
        setVelWithBoost(grower, gPost.x, gPost.y, gSign, gEff);

        // Cap grower's velocity toward other to its pre-collision value.
        // Excess KE is saved and applied to other's speed at the end.
        const toOther = isB1 ? 1 : -1;
        const gOrigN = ((isB1 ? orig1x : orig2x) * nx + (isB1 ? orig1y : orig2y) * ny) * toOther;
        const gPostN = (grower.vx * nx + grower.vy * ny) * toOther;
        if (gPostN > gOrigN) {
            const delta = gPostN - gOrigN;
            const keTransfer = 0.5 * grower.mass * (gPostN * gPostN - gOrigN * gOrigN);
            grower.vx -= delta * toOther * nx;
            grower.vy -= delta * toOther * ny;
            grower._pendingOtherKE = (grower._pendingOtherKE || 0) + keTransfer;
            // if (t >= 2420 && t <= 2440) console.log(`[t=${t}] grower cap: gOrigN=${gOrigN.toFixed(3)} gPostN=${gPostN.toFixed(3)} delta=${delta.toFixed(3)} keTransfer=${keTransfer.toFixed(2)} _pendingOtherKE=${grower._pendingOtherKE.toFixed(2)}`);
        }

        // Other: elastic collision against grower's FULL (boosted) original velocity
        const oOrigX = isB1 ? orig2x : orig1x;
        const oOrigY = isB1 ? orig2y : orig1y;
        const gOrigX = isB1 ? orig1x : orig2x;
        const gOrigY = isB1 ? orig1y : orig2y;
        const fullVAN = (oOrigX - gOrigX) * nx + (oOrigY - gOrigY) * ny;
        const jFull = -2 * fullVAN / (invM1 + invM2);
        const oInvM = isB1 ? invM2 : invM1;
        const oNewVx = oOrigX + jFull * oInvM * nx;
        const oNewVy = oOrigY + jFull * oInvM * ny;
        other.vx = oNewVx;
        other.vy = oNewVy;

        // Re-add other's boost if it had one
        if (oEff > 0) {
            const spd = Math.hypot(other.vx, other.vy);
            if (spd > EPS) {
                const target = Math.sqrt(spd * spd + 2 * oEff) / spd;
                other.vx *= target;
                other.vy *= target;
            }
        }

        // Compute knock energy injected into the other ball
        const keGrowerBefore = 0.5 * grower.mass * ((isB1 ? orig1x : orig2x) ** 2 + (isB1 ? orig1y : orig2y) ** 2);
        const keGrowerAfter = 0.5 * grower.mass * (grower.vx ** 2 + grower.vy ** 2);
        const keOtherBefore = 0.5 * other.mass * (oOrigX ** 2 + oOrigY ** 2);
        const keOtherAfter = 0.5 * other.mass * (other.vx ** 2 + other.vy ** 2);
        const injected = (keGrowerAfter + keOtherAfter) - (keGrowerBefore + keOtherBefore);
        other.knockBoost += injected / other.mass;
    } else {
        // Standard case: apply unboosted collision + re-add each ball's boost
        setVelWithBoost(b1, post1x, post1y, -1, effBoost1);
        setVelWithBoost(b2, post2x, post2y, 1, effBoost2);
    }

    // Post-collision boost reflection: if a boosted ball is still closing on the
    // other (in time-scaled space), mirror its velocity across the normal
    for (const [a, b, toB] of [[b1, b2, 1], [b2, b1, -1]]) {
        if (a === other || b === other) continue; // already handled by grower knock
        if (a.boostEnergy > 0) {
            const relVel = ((a.vx * a.getTimeScale() - b.vx * b.getTimeScale()) * nx
                + (a.vy * a.getTimeScale() - b.vy * b.getTimeScale()) * ny) * toB;
            if (relVel > 0) tryBoostReflect(a, b, toB);
        }
    }

    // Apply KE transferred from grower cap to other's speed
    if (grower && other && grower._pendingOtherKE) {
        const spd = Math.hypot(other.vx, other.vy);
        const newSpd = Math.sqrt(spd * spd + 2 * grower._pendingOtherKE / other.mass);
        if (spd > EPS) { other.vx *= newSpd / spd; other.vy *= newSpd / spd; }
        else { other.vx = newSpd * nx * (isB1 ? 1 : -1); other.vy = newSpd * ny * (isB1 ? 1 : -1); }
        const actualAddedKE = 0.5 * other.mass * (newSpd * newSpd - spd * spd);
        other.knockBoost += actualAddedKE / other.mass;
        grower._pendingOtherKE = 0;
        // if (t >= 2420 && t <= 2440) console.log(`[t=${t}] E after pendingOtherKE=${grower.battle.totalEnergy().toFixed(2)} pendingOtherKE=${grower._pendingOtherKE?.toFixed(2)} actualAddedKE=${actualAddedKE.toFixed(2)}`);
    }
}

// Share knockBoost proportional to post-collision KE weighted by mass
function shareKnockBoost(b1, b2, prevBoost1 = b1.knockBoost, prevBoost2 = b2.knockBoost) {
    const totalBoost = prevBoost1 * b1.mass + prevBoost2 * b2.mass;
    if (totalBoost > 0) {
        b1.knockBoost -= prevBoost1;
        b2.knockBoost -= prevBoost2;

        const ke1 = b1.mass * (b1.vx * b1.vx + b1.vy * b1.vy);
        const ke2 = b2.mass * (b2.vx * b2.vx + b2.vy * b2.vy);
        const total = ke1 + ke2;
        if (total > 0) {
            b1.knockBoost += totalBoost * ke1 / total / b1.mass;
            b2.knockBoost += totalBoost * ke2 / total / b2.mass;
        }
    }
    // if (b1.knockBoost < 0 || b2.knockBoost < 0) console.log(`[t=${t}] b1.knockBoost=${b1.knockBoost} b2.knockBoost=${b2.knockBoost}`);
}

function applyPendingSlam(b) {
    if (b._pendingSlamTimer) {
        b.slamTimer = b._pendingSlamTimer;
        b.slamSource = b._pendingSlamSource;
        b._pendingSlamTimer = null;
        b._pendingSlamSource = null;
    }
}

// Elastic collision response
function resolveCollision(b1, b2, r1Override, r2Override) {
    // if (t >= 8700 && t <= 8710 && (b1 instanceof MachineGunBall || b2 instanceof MachineGunBall)) {
    //     const [mg, other] = b1 instanceof MachineGunBall ? [b1, b2] : [b2, b1];
    //     console.log(`[t=${t}] resolveCollision MG vs ${other.constructor.name}: MG speed=${Math.hypot(mg.vx, mg.vy).toFixed(2)} pos=(${mg.x.toFixed(1)},${mg.y.toFixed(1)}) other speed=${Math.hypot(other.vx, other.vy).toFixed(2)} pos=(${other.x.toFixed(1)},${other.y.toFixed(1)}) dist=${Math.hypot(mg.x - other.x, mg.y - other.y).toFixed(2)}`);
    // }

    if (!(b2 instanceof Bullet)) b1._pendingKnockDecay = true;
    if (!(b1 instanceof Bullet)) b2._pendingKnockDecay = true;

    const prevBoost1 = b1.knockBoost;
    const prevBoost2 = b2.knockBoost;

    b1.onCollision(b2);
    b2.onCollision(b1);
    applyPendingSlam(b1);
    applyPendingSlam(b2);

    const bounce1 = b1.shouldBounce(b2);
    const bounce2 = b2.shouldBounce(b1);
    if (!bounce1 || !bounce2) return;

    if (b1.mass == 0 && b2.mass == 0) return;

    const dx = b2.x - b1.x;
    const dy = b2.y - b1.y;
    const dist = Math.hypot(dx, dy);
    if (dist < EPS) return; // Avoid NaN from division by zero
    const nx = dx / dist;
    const ny = dy / dist;

    applyElasticCollision(b1, b2, nx, ny);

    // Ensure separation after all velocity modifications (including knockEnergy)
    const grower = (b1 instanceof GrowerBall && !(b2 instanceof GrowerBall)) ? b1 :
        (b2 instanceof GrowerBall && !(b1 instanceof GrowerBall)) ? b2 : null;
    if (grower && grower.boostEnergy > 0) {
        const other = grower === b1 ? b2 : b1;
        const sa = grower.getTimeScale();
        const sb = other.getTimeScale();
        const growerAlongN = grower.vx * sa * nx + grower.vy * sa * ny;
        const otherAlongN = other.vx * sb * nx + other.vy * sb * ny;

        // const isDebugPair = t >= 13100 && t <= 13140 && ((grower.id === 3 && other.id === 1) || (grower.id === 1 && other.id === 3));
        // if (isDebugPair) {
        //     const dist = Math.hypot(grower.x - other.x, grower.y - other.y);
        //     console.log(`[t=${t}] SEP-CHECK grower(id=${grower.id}) other(id=${other.id}) growerAlongN=${growerAlongN.toFixed(3)} otherAlongN=${otherAlongN.toFixed(3)} diff=${(growerAlongN - otherAlongN).toFixed(3)} dist=${dist.toFixed(2)} sumR=${(grower.radius + other.radius).toFixed(2)} overlap=${(grower.radius + other.radius - dist).toFixed(2)} nx=(${nx.toFixed(3)},${ny.toFixed(3)}) grower.v=(${grower.vx.toFixed(3)},${grower.vy.toFixed(3)}) other.v=(${other.vx.toFixed(3)},${other.vy.toFixed(3)}) sa=${sa.toFixed(3)} sb=${sb.toFixed(3)} r1Ov=${r1Override?.toFixed(2)} r2Ov=${r2Override?.toFixed(2)}`);
        // }

        const sign = grower === b1 ? 1 : -1;
        const boostLeniency = 1;

        if ((growerAlongN - otherAlongN) * sign > -boostLeniency) {
            const gy = grower.battle.gravity;
            const gx1 = grower.x + grower.vx * sa, gy1 = grower.y + grower.vy * sa + 0.5 * gy * sa * sa;
            const ox1 = other.x + other.vx * sb, oy1 = other.y + other.vy * sb + 0.5 * gy * sb * sb;
            const gr = (grower === b1 ? r1Override : r2Override) ?? grower.radius;
            const or_ = (other === b1 ? r1Override : r2Override) ?? other.radius;
            const overlap = (gr + or_) - Math.hypot(gx1 - ox1, gy1 - oy1);
            if (overlap > -boostLeniency) {
                const vDotN = other.vx * nx + other.vy * ny; // ensure addedKE always positive
                const boost = Math.max((overlap + 5) / (sb || 1), -2 * sign * vDotN);
                const speedBefore = Math.hypot(other.vx, other.vy);
                // const eBefore = grower.battle.totalEnergy();
                other.vx += boost * sign * nx;
                other.vy += boost * sign * ny;
                const addedKE = 0.5 * (Math.hypot(other.vx, other.vy) ** 2 - speedBefore ** 2);

                // const oldBoost = other.knockBoost;
                other.knockBoost += addedKE;
                // const eAfter = grower.battle.totalEnergy();
                // console.log(t, "GOT HERE", "boost", boost, "oldBoost", oldBoost, "addedKE", addedKE, "other.knockBoost", other.knockBoost, "dE", eAfter - eBefore);
            }
            else {
                // console.log(t, "GOT HERE no boost");
            }
        }
    }

    shareKnockBoost(b1, b2, prevBoost1, prevBoost2);
    // if (t == 638) console.log(`[t=${t}] post-resolveCollision ${b1.constructor.name}#${b1.id}: knockBoost=${b1.knockBoost.toFixed(4)} KE=${(0.5 * b1.mass * (b1.vx ** 2 + b1.vy ** 2)).toFixed(2)} | ${b2.constructor.name}#${b2.id}: knockBoost=${b2.knockBoost.toFixed(4)} KE=${(0.5 * b2.mass * (b2.vx ** 2 + b2.vy ** 2)).toFixed(2)}`);
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
    const hits = d <= (seg.r + b.radius);
    return hits;
}

function segmentToSegmentDist(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    return Math.min(
        distToSegment(ax1, ay1, bx1, by1, bx2, by2),
        distToSegment(ax2, ay2, bx1, by1, bx2, by2),
        distToSegment(bx1, by1, ax1, ay1, ax2, ay2),
        distToSegment(bx2, by2, ax1, ay1, ax2, ay2)
    );
}

function weaponWeaponContact(w1, w2) {
    const a = w1.getHitSegment();
    const b = w2.getHitSegment();
    const d = segmentToSegmentDist(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
    const hits = d <= a.r + b.r;
    // if ((w1.ball instanceof MirrorBall || w2.ball instanceof MirrorBall) && t >= 787 && t <= 795) {
    //     console.log("weaponWeaponContact", JSON.stringify({ t, d, threshold: a.r + b.r, hits, segA: a, segB: b }));
    // }
    return hits;
}

function addMirrorIFrames(src, target) {
    if (target instanceof MirrorBall && !(src.id in target._cantHitBall)) target._cantReflect[src.id] = mirrorCooldown;
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
    if (receiver instanceof GrowerBall) {
        const w = 1 / receiver.getDmgResistance();
        slowFactor = w + slowFactor * (1 - w);
        // console.log("w", w);
    }

    function applySlow(b) {
        b.slowFactor = b.slowTime > 0 ? Math.min(b.slowFactor, slowFactor) : slowFactor;
        b.slowTime = Math.max(b.slowTime, duration);
        // if (b.owner) applySlow(b.owner);
        // console.log(slowFactor, "to " + b.constructor.name + " for " + b.slowTime + " frames");
    }
    applySlow(attacker);
    applySlow(receiver);
}

function addToHitHistory(balls, factor = 1) {
    for (let a of balls) {
        if (a instanceof GrowerBall) {
            factor /= a.getDmgResistance();
        }
    }
    for (let a of balls) {
        a.hitsThisFrame += factor;
        a.hitsThisFrame += factor;
    }
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
        this.isDuel = balls.length == 2;
        for (let b of balls) {
            this.addBall(b);
        }

        this.lol = this.isDuel && ((balls[0] instanceof GrimoireBall && balls[1] instanceof MirrorBall) || (balls[1] instanceof GrimoireBall && balls[0] instanceof MirrorBall));
        if (this.lol) {
            for (let b of balls) {
                b.hp *= 0.5;
            }
        }

        this.buffHammer = this.isDuel && ((balls[0] instanceof HammerBall && balls[1] instanceof GrowerBall) || (balls[1] instanceof HammerBall && balls[0] instanceof GrowerBall));

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
                else if (b instanceof GrowerBall) maxBoosts = Math.max(maxBoosts, (b.scale ** 2 - 1));
                hasGrimoire = hasGrimoire || (b instanceof GrimoireBall);
            }

            this.targetTimeScale = (this.lol ? 0.99 : 0.9) ** count;
            this.targetTimeScale *= 1 / (1 + maxBoosts * (hasGrimoire ? 0.025 : 0.01));
        }
        else {
            let count = 0;
            for (let i = 0; i < this.balls.length; i++) {
                count += (this.balls[i] instanceof DuplicatorBall ? 0.1 : 1) * (this.balls[i].owner ? 0.5 : 1);
            }
            this.targetTimeScale = 0.95 ** Math.max(0, count);
            // this.targetTimeScale = 0.7;
        }

        // Gradual interpolation for smooth transitions
        this.baseTimeScale += (this.targetTimeScale - this.baseTimeScale) * 0.01;

        // Per-ball hit history slowdown (outside duels)
        const getHitSlowFactor = (b) => {
            let weighted = 0, totalWeight = 0;
            for (let i = 0; i < hitHistorySize; i++) {
                const age = (hitHistorySize + b.hitIndex - i) % hitHistorySize;
                const w = 0.9 ** (age * this.baseTimeScale ** 2);
                weighted += b.hitHistory[i] * w;
                totalWeight += w;
            }
            let intensity = weighted / totalWeight;
            if (this.lol) intensity /= (this.balls.length / 2);
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
                ts = Math.min(ts, b.getTimeScale(false), Math.max(getHitSlowFactor(b), 0.2 / this.baseTimeScale));
            }
            this.timeScale *= ts;
        }
        // console.log(this.timeScale);
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
        // if (!this.isDuel && ball instanceof LanceBall) {
        //     ball.startSpeed *= 1.1;
        // }
    }

    addCanvas(canvas, offset = 0) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.ctx.imageSmoothingEnabled = false;
        if (offset) this.ctx.translate(offset, offset);
        this.width = canvas.width - 2 * offset;
        this.height = canvas.height - 2 * offset;
        if (!this.walls) this.walls = createBorderWalls(this.width, this.height);
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
        // Decay knock boost once per tick
        for (const b of this.bodies) {
            decayKnockBoost(b, b._pendingKnockDecay ? 0.5 : 0.01);
            b._pendingKnockDecay = false;
        }

        // Reactivate inert balls that have escaped overlap
        for (const b of this.bodies) {
            if (b.inert && this.bodies.every(o => o.inert || o.team == b.team || !ballsOverlap(b, o))) {
                b.inert = false;
            }
        }

        let dt = 1;
        // let iterations = 0;
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
                    const b1 = this.bodies[i], b2 = this.bodies[j];
                    const radii1 = b1.pastRadii && b2 instanceof Ball ? b1.pastRadii : [b1.radius];
                    const radii2 = b2.pastRadii && b1 instanceof Ball ? b2.pastRadii : [b2.radius];

                    radiiLoop:
                    for (let i = radii1.length - 1; i >= 0; i--) {
                        for (let j = radii2.length - 1; j >= 0; j--) {
                            const r1 = radii1[i];
                            const r2 = radii2[j];
                            const tCol = timeToCollision(b1, b2, dt, r1, r2);

                            if (tCol < tBall) {
                                tBall = tCol;
                                pair = [b1, b2, r1, r2];
                                break radiiLoop;
                            }
                        }
                    }
                }
            }

            // --- Find earliest wall collision ---
            let tWall = Infinity;
            let wallEvents = [];

            for (const b of this.bodies) {
                for (const wall of this.walls) {
                    const tCol = wall.timeToCollision(b, dt);
                    if (tCol < tWall - EPS) {
                        tWall = tCol;
                        wallEvents = [{ ball: b, wall }];
                    } else if (Math.abs(tCol - tWall) <= EPS) {
                        wallEvents.push({ ball: b, wall });
                    }
                }
            }

            // --- Choose earliest event ---
            const tNext = Math.min(tBall, tWall);
            if (tNext === Infinity) {
                this.advanceAll(dt);
                return;
            }

            // if (t >= 8700 && t <= 8710 && (pair?.[0] instanceof MachineGunBall || pair?.[1] instanceof MachineGunBall || wallEvents.some(e => e.ball instanceof MachineGunBall))) {
            //     const mg = pair?.[0] instanceof MachineGunBall ? pair[0] : pair?.[1] instanceof MachineGunBall ? pair[1] : wallEvents.find(e => e.ball instanceof MachineGunBall)?.ball;
            //     console.log(`[t=${t}] physics step: dt_remaining=${dt.toFixed(6)} tNext=${tNext.toFixed(6)} tBall=${tBall.toFixed(6)} tWall=${tWall.toFixed(6)} MG pos=(${mg?.x.toFixed(3)},${mg?.y.toFixed(3)}) speed=${Math.hypot(mg?.vx, mg?.vy).toFixed(3)}`);
            // }

            this.advanceAll(tNext);
            dt -= tNext;

            // Ball-ball
            if (tBall <= tNext + EPS) {
                resolveCollision(pair[0], pair[1], pair[2], pair[3]);
            }

            // Walls
            if (tWall <= tNext + EPS) {
                for (const ev of wallEvents) {
                    ev.wall.resolve(ev.ball);
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
                            w.iFrames[target.id] = w.getIFrames(target);
                            addMirrorIFrames(b, target);
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

        this.hitThisFrame = new Set(); // tracks "weaponIdx-ballId" pairs that hit

        for (let step = 0; step < substeps; step++) {
            this.balls.forEach(
                (b) => {
                    const scaledDt = subDt * b.getTimeScale();
                    b.weapons.forEach(
                        (w) => w.updateFns.forEach((f) =>
                            f(scaledDt)));
                });
            this._checkWeaponCollisions(activeBalls);
        }

        // Decrement iframes for pairs that didn't hit during any substep
        for (const b of this.balls) {
            for (const w of b.dmgWeapons) {
                for (const id of Object.keys(w.iFrames)) {
                    if (w.DoT || !this.hitThisFrame.has(w.ball.id + "-" + w.theta + "-" + id)) {
                        w.iFrames[id]--;
                        if (w.iFrames[id] <= 0) delete w.iFrames[id];
                    }
                }
                // Clear contact tracking for balls not hit this frame
                if (w._inContact) {
                    for (const id of Object.keys(w._inContact)) {
                        if (!this.hitThisFrame.has(w.ball.id + "-" + w.theta + "-" + id)) {
                            delete w._inContact[id];
                        }
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

    _checkWeaponCollisions(balls) {
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const A = balls[i];
                const B = balls[j];

                // weapon - ball
                for (const w of A.dmgWeapons) {
                    if (A.team !== B.team && weaponHitsBall(w, B) && (w.DoT || !(B._cantHitBall?.[A.id] > 0))) {
                        this.hitThisFrame.add(A.id + "-" + w.theta + "-" + B.id);
                        addMirrorIFrames(A, B);
                        if (!(B.id in w.iFrames)) {
                            w.iFrames[B.id] = w.getIFrames(B);
                            w.ballColFns.forEach(fn => fn(B));
                        }
                    }
                }

                for (const w of B.dmgWeapons) {
                    if (B.team !== A.team && weaponHitsBall(w, A) && (w.DoT || !(A._cantHitBall?.[B.id] > 0))) {
                        this.hitThisFrame.add(B.id + "-" + w.theta + "-" + A.id);
                        addMirrorIFrames(B, A);
                        if (!(A.id in w.iFrames)) {
                            w.iFrames[A.id] = w.getIFrames(A);
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

                // Mirror vs Grimoire special case
                for (const [mirror, grimoire] of [[A, B], [B, A]]) {
                    if (mirror instanceof MirrorBall && grimoire instanceof GrimoireBall) {
                        const mw = mirror.parryWeapons[0];
                        const gw = grimoire.weapons[0];
                        if (mw && gw && weaponWeaponContact(mw, gw)) {
                            mw.weaponColFns.forEach(fn => fn(gw));
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
            if (playerCount <= s.players && !(s.players <= 2 && this.balls.some(b => b.radius > 75))) {
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
            const nextSize = this.arenaSize - 1;
            const nextOffset = (baseSize - nextSize) / 2;
            const nextArmWidth = Math.min(baseArmWidth, nextSize);
            const wouldPush = this.balls.some(b =>
                !plusArenaInBounds(b.x, b.y, b.radius, nextSize, nextArmWidth, this.arenaHoleSize, nextOffset)
            );
            if (!wouldPush) {
                const rate = 1 / sizeDelta;
                this.arenaSize -= 1;
                if (holeDelta > 0) this.arenaHoleSize -= holeDelta * rate;
                this.zoom += zoomDelta * rate;
                this.canvas.style.transform = `scale(${this.zoom})`;
            }
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

        this.isInBounds = (x, y, r) => plusArenaInBounds(x, y, r, size, armWidth, curHoleSize, offset);

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
                        b.x = wall.pos + wall.normal * (b.radius + 69 * EPS);
                        if (b.vx * wall.normal < 0) b.vx = -b.vx;
                    } else {
                        b.y = wall.pos + wall.normal * (b.radius + 69 * EPS);
                        if (b.vy * wall.normal < 0) b.vy = -b.vy;
                    }
                }
            }
        }
    }

    totalEnergy() {
        let E = 0;
        for (const b of this.bodies) {
            if (b instanceof Ball) {
                E += b.totalEnergy();
            }
        }
        return E;
    }

    update() {
        this.updateArenaShrink();

        for (const b of this.bodies) {
            b.slowAtFrameStart = b.slowTime > 0 ? b.slowFactor : 1;
            const mult = this.isDuel ? 1 + 0.1 * Math.max(0, this.balls.length - 2) ** 2 : 1;
            const asdf = 1 + 0.05 * (1 / (this.timeScale * mult));
            // if (b == this.bodies[0]) console.log(mult, asdf, this.timeScale, this.baseTimeScale);
            b.slowFactor = Math.min(1, b.slowFactor * asdf);
            b.hpAtFrameStart = b.hp;
        }

        for (const b of this.balls) {
            b.hitsThisFrame = 0;
        }

        // if (t == 638) {
        //     for (const b of this.bodies) {
        //         if (b instanceof MachineGunBall || b instanceof GrowerBall)
        //             console.log(`[t=${t}] PRE-physics ${b.constructor.name}#${b.id}: knockBoost=${b.knockBoost.toFixed(4)} boostEnergy=${(b.boostEnergy || 0).toFixed(4)}`);
        //     }
        // }

        this.updatePhysics();

        // Apply grows deferred from collision handling
        for (const b of this.bodies) {
            if (b._pendingGrow) b._pendingGrow.grower.applyGrow(b);
        }

        this.bodies.sort((a, b) => a.id - b.id);
        this.bodies.forEach((b) => b.onUpdate(b.getTimeScale()));

        this.updateWeapons();

        this.processDeaths();

        for (const b of this.balls) {
            if (this.isDuel) {
                b._hitHistoryAccum = (b._hitHistoryAccum || 0) + 1 / this.timeScale;
                while (b._hitHistoryAccum >= 1) {
                    b._hitHistoryAccum -= 1;
                    b.hitIndex = (b.hitIndex + 1) % hitHistorySize;
                    b.hitHistory[b.hitIndex] = b.hitsThisFrame;
                    b.hitsThisFrame = 0;
                }
            } else {
                b.hitIndex = (b.hitIndex + 1) % hitHistorySize;
                b.hitHistory[b.hitIndex] = b.hitsThisFrame;
            }
        }

        this.teamCount = {};
        this.balls.forEach((b) => {
            this.teamCount[b.team] = (this.teamCount[b.team] ?? 0) + 1
        });
        // console.log({ ...this.teamCount });

        // if (t >= 2420 && t <= 2440) {
        //     const rg = this.balls[8];
        //     console.log(`[t=${t}] rogue grower x=${rg.x} y=${rg.y} vx=${rg.vx} vy=${rg.vy}`);
        // }
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
        // while (t < 7070) {
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
            const pct = Math.min(3, (parseFloat(text) - from) / (to - from));
            if (pct < 1) val.style.color = `rgb(${Math.round(255 * pct)},0,0)`;
            else {
                let pct2 = (pct - 1) / 2;
                val.style.color = `rgb(${Math.round(255 - 32 * pct2)},0,${Math.round(223 * pct2)})`;
            }
        }

        ul.appendChild(li);
    }
    return ul;
}

// Duplicator: Reproduces on hit
const dmgCooldown = 7, dupeCooldown = 7, dupeLimit = 25;
class DuplicatorBall extends Ball {
    constructor(x, y, vx, vy, hp = 100, radius = 20, color = "#f86ffa", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.dmgCooldown = 0;
        this.dupeCooldown = 0;
    }

    handleCollision(b, reflector) {
        const owner = reflector || this;
        if ((!reflector && (this.inert || b.team == this.team)) || !(b instanceof Ball) || (owner.dmgCooldown > EPS)) return;

        // if (!(b instanceof DuplicatorBall)) console.log(`[t=${t}]`, this.id, "hit", this.dmgCooldown, this.dupeCooldown);
        b.damage(1, owner);
        if (!b.owner && !(b instanceof DuplicatorBall)) {
            addToHitHistory([this, b]);
        }

        if (reflector && reflector.dmgCooldown == null) reflector.extraUpdates.push(this.handleUpdate.bind(reflector));
        owner.dmgCooldown = dmgCooldown;

        if ((this.battle.teamCount[owner.team] ?? 0) >= dupeLimit || owner.hpAtFrameStart <= 1 || owner.dupeCooldown > EPS) return;

        // if (!(b instanceof DuplicatorBall)) this.battle.dupeCooldown[this.team] = 1;
        owner.dupeCooldown = dupeCooldown;
        // this.damage(1);

        const theta = this.battle.rng() * 2 * Math.PI;
        const baseParams = [owner.x, owner.y, Math.cos(theta) * 5, Math.sin(theta) * 5];
        const hp = Math.floor(owner.hpAtFrameStart / 2);
        let child;
        if (reflector) {
            child = new MirrorBall(...baseParams, theta, this.battle.rng() < 0.5 ? 1 : -1, hp);
            child.extraUpdates.push(this.handleUpdate.bind(child));
            child.weapons[0].scaleBy(this.radius / child.radius);
        }
        else {
            child = new DuplicatorBall(...baseParams, hp);
        }

        child.dmgCooldown = dmgCooldown;
        child.dupeCooldown = dupeCooldown;
        child.flashTime = flashDur;
        child.inert = true;
        child.team = owner.team;
        child.color = owner.color;
        child.radius = this.radius;
        child.owner = owner.owner;
        this.battle.addBall(child);
    }

    handleUpdate(dt) {
        // if (this instanceof MirrorBall) console.log("wowow", this.dmgCooldown, this.dupeCooldown);
        this.dmgCooldown -= dt;
        this.dupeCooldown -= dt;
    }

    getInfoEl() {
        return propsToList({
            "Population": { text: (this.battle.teamCount ? this.battle.teamCount[this.team] : 1) + "/" + dupeLimit, grad: { from: 1, to: 25 } },
        });
    }
}

const baseSpin = Math.PI * 0.07;
class DaggerBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#89d721", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const cfg = getWeaponConfig(DaggerBall);
        const dagger = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset);
        dagger.addCollider(28, 6);
        dagger.addSpin(baseSpin * dir);
        // dagger.addParry();
        dagger.addDamage(1, 1, false, 1.5);
        // dagger.addDirChange();

        this.scalingCooldown = 0;
        dagger.ballColFns.push((b) => {
            if (this.scalingCooldown <= EPS) {
                // dagger.angVel = (Math.abs(dagger.angVel) + baseSpin * (this.battle.isDuel ? 3 / 20 : 1 / 5)) * Math.sign(dagger.angVel);
                // this.scalingCooldown = (this.battle.isDuel ? 6 : 10);
                dagger.angVel = (Math.abs(dagger.angVel) + baseSpin * 0.15) * Math.sign(dagger.angVel);
                this.scalingCooldown = 6;
            }
        });

        this.addWeapon(dagger);
    }

    handleUpdate(dt) {
        this.scalingCooldown -= dt;
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
            "Damage": { text: this.weapons[0].dmg, grad: { from: 1, to: 15 } },
        });
    }
}

// Lance: Increases movement speed and combos
const comboLeniency = 5, boostPct = 0.05;
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
        lance.addCollider(90, 15, 56);
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
                    // if (t < 8900)
                    this.boostEnergy += energyGain;
                    this.boosts++;

                    const speed = Math.hypot(this.vx, this.vy);
                    const newSpeed = Math.sqrt(speed * speed + 2 * energyGain);
                    this.vx *= newSpeed / speed;
                    this.vy *= newSpeed / speed;
                }

                if (this.combo == 0 || oldHit < comboLeniency - 1) this.dist = 0;

                this.comboHits.add(target.id);
                const distToHit = 77 * this.startSpeed;
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
        // if (t >= 8900) this.boostEnergy = 0;

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
            "Speed Boost": { text: this.boosts * 100 * boostPct + "%", grad: { from: 0, to: 150 } },
            // "Combo": { text: this.combo, grad: { from: 0, to: 10 } },
        });
    }
}

// Machine Gun: fires bullets
const bulletRadius = 5, maxVolley = 110;
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
            let fd = (!this.battle.isDuel ? 1.5 : 1) * 110 / (110 * 0.266667 + 0.733333 * this.bulletsPerRound);
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
            "Bullets": { text: this.damagePerRound + this.pendingDamage, grad: { from: 10, to: 110 } },
        });
    }
}

class Bullet extends CircleBody {
    constructor(x, y, vx, vy, owner, dmg = 1, lifetime = 31) {
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
        if (b.hp <= 0) return;

        if (b instanceof Ball /*&& this.lifetime >= 0.05 * this.maxLifetime*/) {
            const hc = b == this.hitCredit ? this.prevHitCredit : this.hitCredit;
            // if (t >= 1290 && t <= 1300) {
            //     console.log(`[t=${t}] bullet handleCollision: hitting ${b.constructor.name}, hitCredit=${this.hitCredit.constructor.name}, prevHitCredit=${this.prevHitCredit?.constructor.name}, using hc=${hc.constructor.name}`);
            // }
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
        // if (t >= 2180 && t <= 2185) {
        //     const mirrorTheta = ((weapon.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        //     const bulletDir = Math.atan2(this.vy - wielder.vy, this.vx - wielder.vx);
        //     let velAngleDiff = Math.abs(bulletDir - mirrorTheta);
        //     if (velAngleDiff > Math.PI) velAngleDiff = 2 * Math.PI - velAngleDiff;
        //     console.log(`[t=${t}] reflect called: cooldown=${this.reflectCooldown.toFixed(2)}, hitCredit=${this.hitCredit.constructor.name}, overlap=${ballsOverlap(this, wielder)}, mirrorTheta=${(mirrorTheta * 180 / Math.PI).toFixed(1)}°, bulletDir=${(bulletDir * 180 / Math.PI).toFixed(1)}°, velAngleDiff=${(velAngleDiff * 180 / Math.PI).toFixed(1)}° (need >=90°)`);
        // }
        if (this.reflectCooldown > 0) return;
        // Don't re-reflect bullets we already own
        if (this.hitCredit === wielder) return;

        this.reflectCooldown = 20;
        if (ballsOverlap(this, wielder)) return;

        const mirrorTheta = ((weapon.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (wielder instanceof MirrorBall) {
            // Ignore bullets traveling away from mirror (coming from behind)
            let bulletDir = Math.atan2(this.vy, this.vx);
            let velAngleDiff = bulletDir - mirrorTheta;
            // Normalize to [-PI, PI]
            while (velAngleDiff > Math.PI) velAngleDiff -= 2 * Math.PI;
            while (velAngleDiff < -Math.PI) velAngleDiff += 2 * Math.PI;
            velAngleDiff = Math.abs(velAngleDiff);
            if (velAngleDiff < Math.PI / 2) return;
        }

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
        let nx, ny;

        // Mirror: aim directly at bullet owner with prediction
        if (wielder instanceof MirrorBall) {
            const target = this.owner;
            this.vx *= 1.4;
            this.vy *= 1.4;
            this.dmg *= 2;
            const speed = Math.hypot(this.vx, this.vy);

            // Solve interception: |T + V*t - P|² = (speed*t)²
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const tvx = target.vx, tvy = target.vy;

            // Quadratic: (tvx² + tvy² - speed²)t² + 2(dx*tvx + dy*tvy)t + (dx² + dy²) = 0
            const a = tvx * tvx + tvy * tvy - speed * speed;
            const b = 2 * (dx * tvx + dy * tvy);
            const c = dx * dx + dy * dy;

            let travelTime;
            if (Math.abs(a) < EPS) {
                // Linear case: target speed ≈ bullet speed
                travelTime = -c / b;
            } else {
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const t1 = (-b - Math.sqrt(disc)) / (2 * a);
                    const t2 = (-b + Math.sqrt(disc)) / (2 * a);
                    // Pick smallest positive time
                    travelTime = (t1 > 0 && t2 > 0) ? Math.min(t1, t2) : Math.max(t1, t2);
                } else {
                    travelTime = -1;
                }
            }

            if (travelTime > 0) {
                const g = this.battle.gravity;
                let predX = target.x + tvx * travelTime;
                let predY = target.y + tvy * travelTime + 0.5 * g * travelTime * travelTime;

                // Wall bounce prediction (with gravity for Y walls)
                const r = target.radius, w = this.battle.width, h = this.battle.height;
                if (predX < r) predX = r + (r - predX);
                else if (predX > w - r) predX = w - r - (predX - (w - r));

                // For Y walls, find bounce time via quadratic: y + vy*t + 0.5*g*t^2 = wallY
                const solveYBounce = (wallY) => {
                    const a = 0.5 * g, b = tvy, c = target.y - wallY;
                    if (Math.abs(a) < 1e-9) return b !== 0 ? -c / b : Infinity;
                    const disc = b * b - 4 * a * c;
                    if (disc < 0) return Infinity;
                    const t1 = (-b - Math.sqrt(disc)) / (2 * a);
                    const t2 = (-b + Math.sqrt(disc)) / (2 * a);
                    return Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
                };

                const tTop = solveYBounce(r), tBot = solveYBounce(h - r);
                const tBounce = Math.min(tTop, tBot);
                if (tBounce < travelTime) {
                    const vyAtBounce = tvy + g * tBounce;
                    const vyAfter = -vyAtBounce;
                    const tRemain = travelTime - tBounce;
                    const bounceY = tTop < tBot ? r : h - r;
                    predY = bounceY + vyAfter * tRemain + 0.5 * g * tRemain * tRemain;
                } else if (predY < r) {
                    predY = r + (r - predY);
                } else if (predY > h - r) {
                    predY = h - r - (predY - (h - r));
                }
                const aimDx = predX - this.x;
                const aimDy = predY - this.y;
                const aimDist = Math.hypot(aimDx, aimDy);

                const newVx = (aimDx / aimDist) * speed;
                const newVy = (aimDy / aimDist) * speed;

                // Only use prediction if it doesn't reflect backwards (into the mirror)
                // if (this.vx * newVx + this.vy * newVy >= 0) console.log(t, "cucurucu");
                if (this.vx * newVx + this.vy * newVy < 0) {
                    this.vx = newVx;
                    this.vy = newVy;
                    return;
                }
            }

            // For mirror, normal is the mirror's facing direction (not perpendicular to segment)
            nx = Math.cos(mirrorTheta);
            ny = Math.sin(mirrorTheta);
        }
        else {
            // Normal perpendicular to weapon
            nx = -dy / len;
            ny = dx / len;
        }

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
        if (b.hp <= 0) return;
        super.handleCollision(b);

        if (b instanceof Ball) {
            const hc = b == this.hitCredit ? this.prevHitCredit : this.hitCredit;
            if (!b.owner && !(b instanceof DuplicatorBall)) {
                let h = [b];
                if (hc == this.owner) h.push(this.owner);
                addToHitHistory(h);
            }

            if (hc instanceof MirrorBall || hc.team == this.owner.team) {
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
        wrench.addCollider(42, 6);
        wrench.addSpin(Math.PI * 0.019 * dir);
        wrench.addParry();
        wrench.addDamage(1, 40);
        wrench.addDirChange();
        this.turretCooldown = 0;
        this.turretCount = 0;
        this.ticksSinceDamage = 0;

        wrench.ballColFns.push((b, reflector) => {
            if (!reflector && this.turretCooldown >= EPS) return;

            const owner = reflector || this;
            // Contact point: on target ball's surface, toward the wrench ball
            const refPos = reflector || this;
            const dx = refPos.x - b.x, dy = refPos.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist < EPS) return;
            const nx = dx / dist, ny = dy / dist;
            // If reflected, spawn near mirror; otherwise spawn on target
            const tx = reflector
                ? refPos.x - nx * (refPos.radius + turretRadius)
                : b.x + nx * (b.radius + turretRadius);
            const ty = reflector
                ? refPos.y - ny * (refPos.radius + turretRadius)
                : b.y + ny * (b.radius + turretRadius);
            if (this.battle.inBounds(tx, ty, turretRadius)) {
                const overlaps = this.battle.bodies.some(body =>
                    body instanceof Turret &&
                    Math.hypot(body.x - tx, body.y - ty) < turretRadius * 2
                );
                if (overlaps) return;

                if (!reflector) this.turretCooldown = 50;
                owner.turretCount = (owner.turretCount || 0) + 1;
                owner.ticksSinceDamage = 0;

                // Reflect ball velocity away from turret
                const dot = b.vx * nx + b.vy * ny;
                if (dot > 0) {
                    b.vx -= 2 * dot * nx;
                    b.vy -= 2 * dot * ny;
                }
                const turret = new Turret(tx, ty, owner, this.battle.rng() * 2 * Math.PI, Math.PI * -0.01 * Math.sign(wrench.angVel));
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
        const ticksToPowerUp = 500;
        if (this.ticksSinceDamage <= ticksToPowerUp) return 1;
        const onlyDupes = this.battle.balls.length > 1 && this.battle.balls.every(b => b.team === this.team || b instanceof DuplicatorBall || b instanceof GrowerBall);
        return onlyDupes ? 1 + (this.ticksSinceDamage - ticksToPowerUp) / ticksToPowerUp : 1;
    }

    getInfoEl() {
        return propsToList({
            "Turrets": { text: this.turretCount, grad: { from: 0, to: 10 } },
        });
    }
}

const fireDelay = 34, knockForceThreshold = 0, knockResistance = 5000, knockDecel = 0.1;
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

    onCollision(b) {
        if (!(b instanceof Ball)) return;

        // Reflect ball as if turret has infinite mass (preserve ball energy)
        const dx = b.x - this.x, dy = b.y - this.y;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist, ny = dy / dist;
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) {
            b.vx -= 2 * dot * nx;
            b.vy -= 2 * dot * ny;
        }

        const impactForce = b.mass * Math.hypot(b.vx, b.vy);
        if (impactForce > knockForceThreshold) {
            const speed = impactForce / knockResistance;
            this.vx = -speed * nx;
            this.vy = -speed * ny;
        }
    }

    onUpdate(dt) {
        if (this.getRootOwner().hp <= 0) {
            this.hp = 0;
            return;
        }

        if (this.vx != 0 || this.vy != 0) {
            const speed = Math.hypot(this.vx, this.vy);
            const newSpeed = Math.max(0, speed - knockDecel * dt);
            const scale = newSpeed / speed;

            this.vx *= scale;
            this.vy *= scale;
            this.mass = 1000 / newSpeed;
        }

        const power = this.owner.getTurretPower?.() ?? 1;
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
                43
            );
            this.battle.addBody(bullet);
        }
    }

    shouldBounce(other) { return !(other instanceof Ball); }
}

// Grimoire: Summons undead minion clones
const minionScale = 0.75;
class GrimoireBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#a3a3c6", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.nextMinionHP = 0;

        const cfg = getWeaponConfig(GrimoireBall);
        const grimoire = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset, cfg.shift || 0, cfg.rotation);
        grimoire.iframes = 0;
        grimoire.addCollider(31, 17);
        grimoire.addSpin(Math.PI * 0.023 * dir);
        // grimoire.addParry();
        grimoire.addDirChange();

        grimoire.addDamage(1, 40);

        grimoire.ballColFns.push((target, reflector) => {
            if (target.depth > 2) return;
            if (target.depth > 1 && this.battle.rng() < 0.727) return;
            if (this.battle.teamCount[this.team] >= 50) return;

            this.nextMinionHP += this.minionHPGain;
            if (target instanceof DuplicatorBall && (this.battle.teamCount[this.team] ?? 0) >= dupeLimit) return;

            const minion = this.createMinion(target, reflector);
            if (minion && this.battle.inBounds(minion.x, minion.y, minion.radius)) {
                minion.inert = true;
                this.battle.addBall(minion);
            }
        });

        this.addWeapon(grimoire, false);
    }

    createMinion(target, reflector) {
        const newRadius = target.radius * minionScale;
        const Constructor = target.constructor;

        // Get constructor parameters based on ball type
        const args = this.getMinionArgs(target, Constructor, newRadius);
        if (!args) return null;

        const minion = new Constructor(...args);
        minion.depth = (target.depth ?? 0) + 1;
        const scale = minionScale ** minion.depth;

        // if (t >= 9590 && t <= 9600 && target instanceof LanceBall) {
        //     console.log(`[t=${t}] GrimoireBall.createMinion: target.boosts=${target.boosts} target.boostEnergy=${target.boostEnergy?.toFixed(2)} target.startSpeed=${target.startSpeed?.toFixed(2)} this.startSpeed=${this.startSpeed?.toFixed(2)} minionScale=${minionScale} spawnSpeed=${Math.hypot(...args.slice(2, 4)).toFixed(2)}`);
        // }

        minion.hp = this.nextMinionHP;
        minion.team = reflector?.team ?? this.team;
        minion.color = reflector?.color ?? this.color;
        minion.flashTime = flashDur;
        minion.id = this.battle.nextID++;
        minion.owner = reflector ?? this;
        minion.slowTime = this.slowTime;
        minion.slowFactor = this.slowFactor;
        minion.mass *= 1 / scale;

        // Copy boost properties
        this.copyBoosts(target, minion);

        // if (t >= 9590 && t <= 9600 && target instanceof LanceBall) {
        //     console.log(`[t=${t}] after copyBoosts: minion.boosts=${minion.boosts} minion.boostEnergy=${minion.boostEnergy?.toFixed(2)} minion.startSpeed=${minion.startSpeed?.toFixed(2)} spawnVel=(${minion.vx?.toFixed(2)},${minion.vy?.toFixed(2)}) speed=${Math.hypot(minion.vx, minion.vy).toFixed(2)}`);
        // }

        // Scale weapon properties
        for (const w of minion.weapons) {
            w.scaleBy(scale * (target.scale ?? 1));
            if (w.theta) w.theta = this.weapons[0].theta + Math.PI;
        }

        // Apply iframes
        for (const w of minion.weapons) {
            w.iFrames[target.id] = 20;
        }
        for (const w of target.weapons) {
            w.iFrames[minion.id] = 20;
        }

        return minion;
    }

    copyBoosts(target, minion) {
        for (let i = 0; i < target.weapons.length && i < minion.weapons.length; i++) {
            const tw = target.weapons[i], mw = minion.weapons[i];
            if (tw.dmg !== undefined) mw.dmg = tw.dmg;
            if (tw.angVel !== undefined) mw.angVel = Math.abs(tw.angVel) * Math.sign(mw.angVel || 1);
        }
        if (target instanceof MachineGunBall) {
            minion.damagePerRound = target.damagePerRound;
            minion.bulletsPerRound = target.bulletsPerRound;
            minion.bonusDmgRate = target.bonusDmgRate;
        }
        else if (target instanceof LanceBall) {
            minion.boostEnergy = target.boostEnergy;
            minion.boosts = target.boosts;
            minion.startSpeed = target.startSpeed / minionScale;
        }
        else if (target instanceof GrowerBall) {
            minion.scale = target.scale;
            minion.baseRadius = minion.radius / target.scale;
            minion.baseMass = minion.baseRadius * minion.baseRadius;
            minion.mass = minion.baseMass * minion.scale;
            minion.boostEnergy = target.boostEnergy;
            minion.pastRadii = [minion.radius];
            minion._engulfImmune = { [target.id]: 5 };
        }
        else if (target instanceof GrimoireBall) {
            minion.nextMinionHP = target.nextMinionHP;
        }
        else if (target instanceof HammerBall) {
            minion.spinRate = target.spinRate;
        }
    }

    getMinionArgs(target, Constructor, newRadius) {
        // if (Constructor === GrowerBall || Constructor === MirrorBall) return null;

        const theta = Math.atan2(target.vy, target.vx) + Math.PI;
        const speed = this.battle.lol ? this.startSpeed : this.startSpeed / minionScale;
        const baseArgs = [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed];

        if (Constructor === DaggerBall || Constructor === SwordBall || Constructor === MachineGunBall || Constructor === WrenchBall || Constructor === MirrorBall || Constructor === HammerBall) {
            return [...baseArgs, target.weapons[0]?.theta || 0, 1, this.nextMinionHP, newRadius];
        }
        if (Constructor === GrimoireBall) {
            return [...baseArgs, target.weapons[0]?.theta || 0, 1, this.nextMinionHP, newRadius];
        }
        if (Constructor === LanceBall) {
            const speed = (target.startSpeed * (1 + boostPct * target.boosts)) / minionScale;
            return [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed, this.nextMinionHP, newRadius];
        }
        if (Constructor === DuplicatorBall) {
            return [...baseArgs, this.nextMinionHP, newRadius];
        }
        // if (Constructor === GrowerBall && !this.battle.isDuel) {
        //     const speed = Math.min(this.startSpeed, target.startSpeed) / (minionScale * Math.sqrt(target.scale));
        //     // console.log("teto", speed);
        //     return [target.x, target.y, Math.cos(theta) * speed, Math.sin(theta) * speed, this.nextMinionHP, newRadius];
        // }
        return [...baseArgs, this.nextMinionHP, newRadius];
    }

    getInfoEl() {
        return propsToList({
            "Summon HP": { text: this.nextMinionHP + this.minionHPGain, grad: { from: this.minionHPGain, to: (this.battle.isDuel ? 25 : 15) } },
        });
    }

    onLoad() {
        this.minionHPGain = this.battle.isDuel ? 3 : 1;
    }
}

const growCooldown = 7;
const maxScale = 6.56;
const duelSlam = 10, FFASlam = 20;
class GrowerBall extends Ball {
    constructor(x, y, vx, vy, hp = 100, radius = 30, color = "#008a12", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.scale = 1;
        this.growCooldown = 0;
        this.baseMass = mass;
        this.baseRadius = radius;
        this.boostEnergy = 0;
        this.pastRadii = [radius];

        // this.scale = 4.5;
        // this.boostEnergy = this.baseRadius * 0.2 * (this.scale - 1);
        // this.mass = this.baseMass * this.scale;
        // this.radius = this.baseRadius * this.scale;
        // this.pastRadii = [this.radius];
    }

    getInfoEl() {
        return propsToList({
            "Size Boost": { text: Math.round((this.scale ** 2 - 1) * 100) + "%", grad: { from: 1, to: 1000 } },
        });
    }

    handleCollision(b, reflector) {
        const owner = reflector || this;
        if ((!reflector && (this.inert || b.team == this.team)) || !(b instanceof Ball)) return;
        b.damage(1, owner);
        b._pendingSlamTimer = this.battle.isDuel ? duelSlam : FFASlam;
        b._pendingSlamSource = owner;

        if (!(b instanceof GrowerBall || b instanceof DuplicatorBall)) {
            this.hitsThisFrame += 3;
            b.hitsThisFrame += 3;
        }

        // Initialize grower state on reflector
        if (reflector && reflector.scale == null) {
            reflector.scale = 1;
            reflector.baseRadius = reflector.radius;
            reflector.baseMass = reflector.mass;
            reflector.growCooldown = 0;
            reflector.pastRadii = [reflector.radius];
            if (this.battle.isDuel) reflector.getDmgResistance = GrowerBall.prototype.getDmgResistance.bind(reflector);
            reflector.extraUpdates.push(GrowerBall.prototype.handleUpdate.bind(reflector));
        }

        if (owner.scale >= maxScale || owner.growCooldown > EPS || (!reflector && (b instanceof GrowerBall))) return;
        owner.growCooldown = growCooldown;
        owner._pendingGrow = { reflector, grower: this };
    }

    applyGrow(owner) {
        const { reflector } = owner._pendingGrow;
        owner._pendingGrow = null;

        let targetScale = Math.min(maxScale, Math.sqrt(owner.scale * owner.scale + (!this.battle.isDuel && reflector ? 0.2 : 0.3)));
        let targetRadius = owner.baseRadius * targetScale;

        if (this.battle.isInsideWall(owner.x, owner.y, targetRadius)) {
            let lo = owner.radius, hi = targetRadius;
            for (let i = 0; i < 10; i++) {
                const mid = (lo + hi) / 2;
                if (this.battle.isInsideWall(owner.x, owner.y, mid)) hi = mid;
                else lo = mid;
            }
            targetRadius = lo;
        }

        if (!owner.pastRadii.includes(targetRadius)) owner.pastRadii.push(targetRadius);
        const prevScale = owner.scale;
        const prevMass = owner.mass;
        const prevBoostEnergy = owner.boostEnergy || 0;
        const prevKE = 0.5 * prevMass * (owner.vx ** 2 + owner.vy ** 2);
        const prevPE = prevMass * this.battle.gravity * (this.battle.height - owner.radius - owner.y);

        owner.scale = targetRadius / owner.baseRadius;
        owner.mass = owner.baseMass * owner.scale;
        owner.radius = owner.baseRadius * owner.scale;

        if (reflector) {
            const growth = owner.scale / prevScale;
            for (const w of owner.weapons) w.scaleBy(growth);
        }

        if (!this.battle.isDuel) {
            owner.boostEnergy = 6 * (owner.scale - 1);
            const newKE = 0.5 * owner.mass * (owner.vx ** 2 + owner.vy ** 2);
            const newPE = owner.mass * this.battle.gravity * (this.battle.height - owner.radius - owner.y);
            const newBoostEnergy = owner.boostEnergy || 0;
            const prevTotal = prevKE + prevPE - prevMass * prevBoostEnergy - prevMass * (owner.knockBoost || 0);
            const newTotalBeforeAdj = newKE + newPE - owner.mass * newBoostEnergy - owner.mass * (owner.knockBoost || 0);
            const dE = newTotalBeforeAdj - prevTotal;
            if (dE > 0) owner.knockBoost += dE / owner.mass;
            else if (dE < 0) {
                const speed = Math.hypot(owner.vx, owner.vy);
                const newSpeed = Math.sqrt(Math.max(0, speed * speed - 2 * dE / owner.mass));
                if (speed > EPS) { owner.vx *= newSpeed / speed; owner.vy *= newSpeed / speed; }
            }
            // const adjKE = 0.5 * owner.mass * (owner.vx ** 2 + owner.vy ** 2);
            // console.log(`[t=${t}] grow energy: prevTotal=${prevTotal.toFixed(2)} newTotal=${(adjKE + newPE - owner.mass * (owner.boostEnergy || 0) - owner.mass * owner.knockBoost).toFixed(2)} dE=${dE.toFixed(2)} knockBoost=${owner.knockBoost.toFixed(4)} prevKE=${prevKE.toFixed(2)} newKE=${newKE.toFixed(2)} prevPE=${prevPE.toFixed(2)} newPE=${newPE.toFixed(2)} prevBoost=${(prevMass * prevBoostEnergy).toFixed(2)} newBoost=${(owner.mass * newBoostEnergy).toFixed(2)}`);
        }
    }

    getDmgResistance() {
        // if (this.battle.buffHammer) return 1;
        return this.scale ** 2 * 0.25 + 0.75;
    }

    damage(dmg, source = null) {
        // super.damage(dmg / this.scale, source);
        super.damage(dmg / this.getDmgResistance(), source);
    }

    handleUpdate(dt) {
        // if (t > 8900) this.boostEnergy = 0;
        this.growCooldown -= dt;

        if (!this.inert) {
            for (let b of this.battle.balls) {
                if (b.team != this.team) {
                    if (b._engulfImmune?.[this.id] > 0) {
                        b._engulfImmune[this.id] -= dt;
                        continue;
                    }
                    const dist = Math.hypot(this.x - b.x, this.y - b.y);
                    if (dist < this.radius - b.radius) {
                        b.damage(1, this);
                    }
                }
            }
        }

        // Clean up pastRadii: remove radii smaller than closest ball distance, but keep the largest one
        // if (t >= 7205) return;
        let minDist = Infinity;
        for (let b of this.battle.bodies) {
            if (!(b instanceof Bullet) && b != this) {
                minDist = Math.min(minDist, Math.hypot(this.x - b.x, this.y - b.y) - b.radius);
            }
        }
        const smallerRadii = this.pastRadii.filter(r => r < minDist);
        const largerRadii = this.pastRadii.filter(r => r >= minDist);
        if (smallerRadii.length > 0) {
            this.pastRadii = [...largerRadii, Math.max(...smallerRadii)];
        }
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

// Mirror: Reflects damage back to attackers
const mirrorCooldown = 8;
class MirrorBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#c0e8ff", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this._cantHitBall = {}; // weapon touched mirror -> can't hit ball
        this._cantReflect = {}; // weapon hit ball -> can't reflect
        this.collsThisFrame = {};
        this.collsThisFrame2 = {};
        this.extraUpdates = [];

        const cfg = getWeaponConfig(MirrorBall);
        const mirror = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset, cfg.shift || 0, cfg.rotation);
        mirror.addCollider(13, 30.5, 2);
        mirror.addSpin(Math.PI * 0.020 * dir);
        mirror.addParry();

        // Override hit segment to be perpendicular (wide mirror surface)
        mirror.getHitSegment = function () {
            const b = this.ball;
            const dist = b.radius + (this.colliderOffset + this.range) / 2;
            const nx = Math.cos(this.theta), ny = Math.sin(this.theta);
            const tx = -ny, ty = nx;  // perpendicular
            const cx = b.x + nx * dist, cy = b.y + ny * dist;
            return {
                x1: cx - tx * this.thickness,
                y1: cy - ty * this.thickness,
                x2: cx + tx * this.thickness,
                y2: cy + ty * this.thickness,
                r: (this.range - this.colliderOffset) / 2
            };
        };

        // Reflect damage using attacker's own weapon logic
        mirror.weaponColFns.push((otherWeapon) => {
            const attacker = otherWeapon.ball;
            if (attacker.team === this.team) return;

            // If in cooldown from hitting ball, don't reflect
            if (attacker.id in this._cantReflect) return;

            // Block this weapon from hitting the ball
            this._cantHitBall[attacker.id] = mirrorCooldown;

            // Mark as hit so iframes don't decrement while in contact
            this.battle.hitThisFrame.add(attacker.id + "-" + otherWeapon.theta + "-" + attacker.id);

            // Use attacker's ballColFns against themselves
            if (!(attacker.id in otherWeapon.iFrames)) {
                otherWeapon.iFrames[attacker.id] = otherWeapon.getIFrames(attacker);
                otherWeapon.ballColFns.forEach(fn => fn(attacker, this));
            }
        });

        // Bounce balls that hit the front of the mirror
        mirror.iframes = 0;
        mirror.DoT = true;
        mirror._inContact = {};
        mirror.ballColFns.push((b) => {
            const mirrorTheta = ((mirror.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const oldvx = this.vx, oldvy = this.vy;

            // Mirror normal (perpendicular to mirror surface)
            const nx = Math.cos(mirrorTheta);
            const ny = Math.sin(mirrorTheta);

            // Skip if ball is already moving away from mirror
            const relVx = b.vx - this.vx, relVy = b.vy - this.vy;
            const velAlongNormal = relVx * nx + relVy * ny;
            let bounced = velAlongNormal <= -1;

            if (velAlongNormal < 0) {
                if (bounced) {
                    this._pendingKnockDecay = true;
                    b._pendingKnockDecay = true;
                }
                const prevBoost1 = this.knockBoost;
                const prevBoost2 = b.knockBoost
                applyElasticCollision(this, b, nx, ny, true);
                shareKnockBoost(this, b, prevBoost1, prevBoost2);
            }

            if (b.dmgWeapons.length === 0 && b.team !== this.team) {
                const newContact = !mirror._inContact[b.id];
                mirror._inContact[b.id] = true;

                const nColl = Math.max(+bounced, +newContact, this.collsThisFrame[b.id] ?? 0);
                // if (nColl > 0) console.log(+bounced, +newContact, this.collsThisFrame[b.id] ?? 0);
                for (let i = 0; i < nColl; i++) {
                    b.handleCollision(b, this);
                    applyPendingSlam(b);
                    if (ƒb._pendingGrow) b._pendingGrow.grower.applyGrow(b);
                }
            }
        });

        this.addWeapon(mirror);
    }

    handleCollision(b) {
        this.collsThisFrame2[b.id] = (this.collsThisFrame2[b.id] ?? 0) + 1;
    }

    handleUpdate(dt) {
        for (const k in this._cantHitBall) {
            this._cantHitBall[k] -= dt;
            if (this._cantHitBall[k] <= 0) delete this._cantHitBall[k];
        }
        for (const k in this._cantReflect) {
            this._cantReflect[k] -= dt;
            if (this._cantReflect[k] <= 0) delete this._cantReflect[k];
        }

        this.collsThisFrame = this.collsThisFrame2;
        this.collsThisFrame2 = {};

        for (let u of this.extraUpdates) {
            u(dt);
        }
    }

    damage(dmg, source) {
        // if (t >= 6435 && t <= 6440) console.log(`[t=${t}] MirrorBall.damage: dmg=${dmg.toFixed(2)} source=${source?.constructor.name} hp=${this.hp.toFixed(2)} cantHit=${source?.id in this._cantHitBall}`, new Error().stack.split('\n')[2].trim());
        if (source.id in this._cantHitBall) {
            this.weapons[0].weaponColFns.forEach(fn => fn(source.weapons[0]));
            return;
        }
        super.damage(dmg / (this.getDmgResistance?.() ?? 1), source);
    }

    getInfoEl() {
        const el = document.createElement("span");
        el.className = "na";
        el.textContent = "N/A";
        return el;
    }
}

const hammerAccel = 0.0016;
class HammerBall extends Ball {
    constructor(x, y, vx, vy, theta, dir = 1, hp = 100, radius = 25, color = "#c87941", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        this.spinRate = 5;
        this.power = 0;
        this.antiSwarmBoost = 0;
        this.pendingBoost = 0;

        const cfg = getWeaponConfig(HammerBall);
        const hammer = new Weapon(theta, cfg.sprite, cfg.scale, cfg.offset, 0, cfg.rotation);
        hammer.addCollider(50, 15, 30);
        hammer.addSpin(dir);
        hammer.addParry();
        hammer.addDirChange();
        hammer.addDamage(0, 1);

        hammer.ballColFns.push((b) => {
            let addedAntiSwarm = Math.sqrt(this.power / Math.sqrt(this.spinRate));
            addedAntiSwarm /= Math.exp(this.antiSwarmBoost * 0.2);
            const a = this.antiSwarmBoost * Math.sqrt(this.spinRate) * 0.05;
            this.power = a;
            if (t > 0) console.warn(t, "1 added", a, this.antiSwarmBoost);

            // console.log(t, "antiSwarmBoost", this.antiSwarmBoost, "addedAntiSwarm", addedAntiSwarm);
            this.pendingBoost += this.antiSwarmBoost;
            this.antiSwarmBoost += addedAntiSwarm;

            this.spinRate += 1;
        });

        this.addWeapon(hammer);
    }

    handleUpdate(dt) {
        const m = 3 * Math.sqrt(this.spinRate) - this.power;
        if (m < 0) console.warn("tetotoe");
        this.power += hammerAccel * m * dt;
        if (t % 50 == 1) console.log(t, "3 added", hammerAccel * m * dt);

        const oldAntiSwarm = this.pendingBoost;
        this.antiSwarmBoost *= Math.exp(-dt / 1000);
        this.pendingBoost *= Math.exp(-dt / 1000);
        const a = (oldAntiSwarm - this.pendingBoost) * (3 * Math.sqrt(this.spinRate) - this.power) * 0.22;
        this.power += a;
        if (t % 50 == 1) console.log(t, "2 added", a);

        const hammer = this.weapons[0];
        hammer.angVel = Math.sign(hammer.angVel) * 0.011 * Math.PI * (1 + this.power * 0.1) ** 2;
        hammer.dmg = (1 + this.power * 0.3) ** 2;
        hammer.iframes = Math.min(40, Math.PI / Math.abs(hammer.angVel));

        // if (t % 50 == 1) console.log(t, "spin", Math.abs(this.weapons[0].angVel / Math.PI).toFixed(3), "dmg", hammer.dmg, "antiSwarm", this.pendingBoost);
    }

    getInfoEl() {
        return propsToList({
            "Acceleration": { text: Math.round(this.spinRate * 100) / 100 + "x", grad: { from: 1, to: 5 } },
        });
    }
}

const ballClasses = [
    { name: "Duplicator", class: DuplicatorBall, hp: 100, radius: 20, color: "#f86ffa" },
    { name: "Grower", class: GrowerBall, hp: 100, radius: 30, color: "#008a12" },
    { name: "Dagger", class: DaggerBall, hp: 100, radius: 25, color: "#89d721", weapon: { sprite: "sprites/dagger.png", scale: 3, offset: -9, rotation: Math.PI / 4, spin: true } },
    { name: "Lance", class: LanceBall, hp: 100, radius: 25, color: "#dfbf9f", weapon: { sprite: "sprites/spear.png", scale: 4, offset: -44, rotation: 3 * Math.PI / 4, spin: false } },
    { name: "Machine Gun", class: MachineGunBall, hp: 100, radius: 25, color: "#61a3e9", weapon: { sprite: "sprites/gun.png", scale: 2, offset: -9, shift: 7, rotation: 0, spin: true } },
    { name: "Wrench", class: WrenchBall, hp: 100, radius: 25, color: "#ff9933", weapon: { sprite: "sprites/wrench.png", scale: 2, offset: -6, rotation: 3 * Math.PI / 4, spin: true } },
    { name: "Grimoire", class: GrimoireBall, hp: 100, radius: 25, color: "#a3a3c6", weapon: { sprite: "sprites/grimoire.png", scale: 2, offset: -13, shift: -1, rotation: Math.PI / 4, spin: true } },
    { name: "Sword", class: SwordBall, hp: 100, radius: 25, color: "#ff6464", weapon: { sprite: "sprites/sword.png", scale: 4, offset: -21, rotation: Math.PI / 4, spin: true } },
    { name: "Mirror", class: MirrorBall, hp: 100, radius: 25, color: "#7adac8", weapon: { sprite: "sprites/mirror.png", scale: 1, offset: -8, shift: 33, rotation: 0, spin: true } },
    { name: "Hammer", class: HammerBall, hp: 100, radius: 25, color: "#c87941", weapon: { sprite: "sprites/hammer.png", scale: 2.5, offset: -7, rotation: 3 * Math.PI / 4, spin: true } },
];

function getWeaponConfig(BallClass) {
    return ballClasses.find(b => b.class === BallClass)?.weapon;
}
