const GRAVITY = 0.3;
const ELASTICITY = 1.0; // restitution for collisions (1.0 = perfectly elastic)
const SUBSTEPS = 1;
const EPS = 1e-9;

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
        this._collidingWith = new Set();
    }

    _key(other) {
        return other instanceof Weapon
            ? "w" + other.ball.id + ":" + other.theta
            : "b" + other.id;
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
        this.weaponColFns.push((me, other, side) => {
            me.angVel = -side * me.angVel;
            me.flipped = me.angVel < 0;
        });
    }

    addDamage(dmg) {
        this.dmg = dmg;
        this.ballColFns.push((me, b) => b.damage(me.dmg));
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
    }

    addWeapon(w) {
        w.ball = this;
        this.weapons.push(w);
        if (w.ballColFns.length > 0) this.dmgWeapons.push(w);
        if (w.weaponColFns.length > 0) this.parryWeapons.push(w);
    }

    updatePhysics(dt = 1) {
        let remaining = dt;
        while (remaining > EPS) {
            let tMin = remaining;
            let wall = null;
            const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

            // Time to hit left wall: x + vx*t = radius
            if (this.vx < 0) {
                const t = (this.radius - this.x) / this.vx;
                if (t >= 0 && t < tMin) { tMin = t; wall = LEFT; }
            }
            // Time to hit right wall: x + vx*t = width - radius
            if (this.vx > 0) {
                const t = (this.battle.width - this.radius - this.x) / this.vx;
                if (t >= 0 && t < tMin) { tMin = t; wall = RIGHT; }
            }
            // Time to hit top wall: y + vy*t + 0.5*g*t^2 = radius
            // Solve: 0.5*g*t^2 + vy*t + (y - radius) = 0
            if (this.vy < 0 || this.y < this.radius) {
                const a = 0.5 * GRAVITY, b = this.vy, c = this.y - this.radius;
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const t = (-b - Math.sqrt(disc)) / (2 * a);
                    if (t > EPS && t < tMin) { tMin = t; wall = TOP; }
                }
            }
            // Time to hit bottom wall: y + vy*t + 0.5*g*t^2 = height - radius
            {
                const a = 0.5 * GRAVITY, b = this.vy, c = this.y - (this.battle.height - this.radius);
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const t = (-b + Math.sqrt(disc)) / (2 * a);
                    if (t > EPSs && t < tMin) { tMin = t; wall = BOTTOM; }
                }
            }

            // Advance to collision or end of timestep
            this.x += this.vx * tMin;
            this.y += this.vy * tMin + 0.5 * GRAVITY * tMin * tMin;
            this.vy += GRAVITY * tMin;
            remaining -= tMin;

            // Reflect velocity on collision
            if (wall == LEFT || wall == RIGHT) this.vx = -this.vx * ELASTICITY;
            if (wall == TOP || wall == BOTTOM) this.vy = -this.vy * ELASTICITY;
        }
    }

    damage(dmg) {
        this.hp -= dmg;
    }

    draw() {
        this.weapons.forEach((w) => w.draw());

        const ctx = this.battle.ctx;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();

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
}

const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

function timeToWallCollision(b, dt) {
    let tMin = Infinity;
    let wall = null;
    const LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

    // Left wall
    if (b.vx < 0) {
        const t = (b.radius - b.x) / b.vx;
        if (t > EPS && t <= dt) { tMin = t; wall = LEFT; }
    }

    // Right wall
    if (b.vx > 0) {
        const t = (b.battle.width - b.radius - b.x) / b.vx;
        if (t > EPS && t <= dt) { tMin = t; wall = RIGHT; }
    }

    // Top wall
    {
        const a = 0.5 * GRAVITY;
        const bq = b.vy;
        const c = b.y - b.radius;
        const disc = bq * bq - 4 * a * c;
        if (disc >= 0) {
            const t = (-bq - Math.sqrt(disc)) / (2 * a);
            if (t > EPS && t <= dt) { tMin = t; wall = TOP; }
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
            if (t > EPS && t <= dt) { tMin = t; wall = BOTTOM; }
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


// Find time of collision between two balls (returns Infinity if no collision in dt)
function timeToCollision(b1, b2, dt) {
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
    if (t >= 0 && t <= dt) return t;
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

    const dvx = b2.vx - b1.vx;
    const dvy = b2.vy - b1.vy;
    const velAlongNormal = dvx * nx + dvy * ny;

    if (velAlongNormal > 0) return; // Already separating

    const invMass1 = 1 / b1.mass;
    const invMass2 = 1 / b2.mass;
    const j = -(1 + ELASTICITY) * velAlongNormal / (invMass1 + invMass2);

    b1.vx -= j * invMass1 * nx;
    b1.vy -= j * invMass1 * ny;
    b2.vx += j * invMass2 * nx;
    b2.vy += j * invMass2 * ny;
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

    // midpoint of w2
    const cx = (b.x1 + b.x2) * 0.5;
    const cy = (b.y1 + b.y2) * 0.5;

    // direction of w1
    const dx = a.x2 - a.x1;
    const dy = a.y2 - a.y1;

    // vector from w1 base to contact
    const rx = cx - a.x1;
    const ry = cy - a.y1;

    const d = distToSegment(cx, cy, a.x1, a.y1, a.x2, a.y2);
    if (d > a.r + b.r) return null;

    const cross = dx * ry - dy * rx;
    const side = Math.sign(cross);

    return side;
}

class BallBattle {
    constructor(balls) {
        this.balls = [];
        this.nextID = 0;
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
        while (dt > EPS) {
            // --- Find earliest ball-ball collision ---
            let tBall = Infinity;
            let pair = null;

            for (let i = 0; i < this.balls.length; i++) {
                for (let j = i + 1; j < this.balls.length; j++) {
                    const t = timeToCollision(this.balls[i], this.balls[j], dt);
                    if (t < tBall) {
                        tBall = t;
                        pair = [this.balls[i], this.balls[j]];
                    }
                }
            }

            // --- Find earliest wall collision ---
            let tWall = Infinity;
            let wallEvents = [];

            for (const b of this.balls) {
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
                advanceAll(this.balls, dt);
                return;
            }

            advanceAll(this.balls, tNext);
            dt -= tNext;

            // Ball-ball
            if (tBall <= tNext + EPS) {
                resolveCollision(pair[0], pair[1]);
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
        const balls = this.balls;
        balls.forEach(
            (b) => b.weapons.forEach(
                (w) => w.updateFns.forEach((f) =>
                    f(w, dt))));

        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                const A = balls[i];
                const B = balls[j];

                // weapon - ball
                for (const w of A.dmgWeapons) {
                    if (weaponHitsBall(w, B)) {
                        const k = w._key(B);
                        if (!w._collidingWith.has(k)) {
                            w._collidingWith.add(k);
                            w.ballColFns.forEach(fn => fn(w, B));
                        }
                    } else {
                        w._collidingWith.delete(w._key(B));
                    }
                }

                for (const w of B.dmgWeapons) {
                    if (weaponHitsBall(w, A)) {
                        const k = w._key(A);
                        if (!w._collidingWith.has(k)) {
                            w._collidingWith.add(k);
                            w.ballColFns.forEach(fn => fn(w, A));
                        }
                    } else {
                        w._collidingWith.delete(w._key(A));
                    }
                }

                // weapon - weapon
                for (const w1 of A.parryWeapons) {
                    for (const w2 of B.parryWeapons) {

                        const side = weaponWeaponContact(w1, w2);
                        const k1 = w1._key(w2);
                        const k2 = w2._key(w1);

                        if (side) {
                            if (!w1._collidingWith.has(k1)) {
                                w1._collidingWith.add(k1);
                                w2._collidingWith.add(k2);

                                w1.weaponColFns.forEach(fn => fn(w1, w2, side));
                                w2.weaponColFns.forEach(fn => fn(w2, w1, -side));
                            }
                        } else {
                            w1._collidingWith.delete(k1);
                            w2._collidingWith.delete(k2);
                        }
                    }
                }
            }
        }
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        balls.forEach((b) => b.draw());
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

        this.updatePhysics();
        // console.log(this.balls.reduce((b) => b.potentialEnergy() + b.kineticEnergy()));
        this.updateWeapons();
        this.render();
        requestAnimationFrame(this.run.bind(this));
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
        console.log(this.balls[0].x, this.balls[0].y);
        console.log(this.balls[1].x, this.balls[1].y);
        console.log(t);
    }
}

class DaggerBall extends Ball {
    constructor(x, y, vx, vy, theta, hp = 100, radius = 25, color = "#5fbf00", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const dagger = new Weapon(theta, "sprites/dagger.png", 2, -6);
        dagger.addCollider(28, 6);
        dagger.addSpin(0.1);
        dagger.addParry();
        dagger.addDamage(1);
        dagger.ballColFns.push((me, b) => {
            me.angVel = (Math.abs(me.angVel) + 0.02) * Math.sign(me.angVel);
        });
        this.addWeapon(dagger);
    }
}

class SwordBall extends Ball {
    constructor(x, y, vx, vy, theta, hp = 100, radius = 25, color = "tomato", mass = radius * radius) {
        super(x, y, vx, vy, hp, radius, color, mass);
        const dagger = new Weapon(theta, "sprites/sword.png", 3, -16);
        dagger.addCollider(46, 9);
        dagger.addSpin(0.05);
        dagger.addParry();
        dagger.addDamage(1);
        dagger.ballColFns.push((me, b) =>
            me.dmg++
        );
        this.addWeapon(dagger);
    }
}

const balls = [
    new DaggerBall(50, 100, 2, 0, 0),
    new SwordBall(350, 100, -2, 0, Math.PI)
];
const battle = new BallBattle(balls);
battle.addCanvas(document.getElementById("canvas"));
battle.bug();
// battle.run();    
