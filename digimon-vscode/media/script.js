// Runs inside the Digimon webview. The extension sends the pet's state; this file only renders and animates it.
(function () {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    const device = $('device');
    const screen = $('screen');
    const pet = $('pet');
    const zzz = $('zzz');
    const emote = $('emote');
    const fx = $('fx');

    // Sprite sheets are 3x4 grids of 16px frames, indexed row-major. Eggs are a 3x1 strip.
    const SHEET_ANIMATIONS = {
        idle: [0, 1],
        happy: [1, 7],
        eat: [2, 11],
        refuse: [5, 8],
        sleep: [4, 10],
        sad: [9, 3],
    };
    const EGG_ANIMATIONS = { idle: [0, 1] };
    const MOOD_ANIMATIONS = {
        sleeping: 'sleep',
        starving: 'sad',
        exhausted: 'sad',
        hungry: 'idle',
        happy: 'idle',
    };
    // 8x8 pixel art, one character per pixel; '.' is transparent.
    const FOOD_ART = {
        meat: {
            palette: { r: '#c8553d', d: '#8f3a2a', w: '#f2efe6' },
            rows: ['...rrrr.', '..rrrrrr', '.rrrrrrd', '.rrrrrdd', '..rrrdd.', '.ww.dd..', 'www.....', '.w......'],
        },
        vitamin: {
            palette: { k: '#9aa0a6', g: '#6fb7e0', y: '#e8b931' },
            rows: ['...kk...', '...kk...', '..gggg..', '.gggggg.', '.gyyyyg.', '.gyyyyg.', '.gggggg.', '..gggg..'],
        },
        sirloin: {
            palette: { r: '#b5473a', d: '#7d2f27', w: '#f0d5c8' },
            rows: ['........', '.rrrrr..', 'rrwrrrr.', 'rrrrwrrd', 'rwrrrrrd', '.rrrrrd.', '..dddd..', '........'],
        },
    };
    // Icons shown in the speech bubble above the pet, same 8x8 pixel format.
    const EMOTE_ART = {
        happy: {
            palette: { y: '#f5c542', k: '#3a2a00' },
            rows: ['..yyyy..', '.yyyyyy.', 'yykyykyy', 'yyyyyyyy', 'ykyyyyky', 'yykkkkyy', '.yyyyyy.', '..yyyy..'],
        },
        sad: {
            palette: { b: '#7fb2e5', k: '#132a45', w: '#dff1ff' },
            rows: ['..bbbb.w', '.bbbbbbw', 'bbkbbkbb', 'bbbbbbbb', 'bbbbbbbb', 'bbkkkkbb', 'bkbbbbkb', '.bbbbbb.'],
        },
        shout: {
            palette: { m: '#f2a93b', d: '#a8641a', w: '#e5484d' },
            rows: ['......w.', '....mmw.', '..mmmmw.', 'ddmmmm.w', 'ddmmmm..', '..mmmmw.', '....mmw.', '......w.'],
        },
    };
    const HEART_ART = { palette: { r: '#e5484d' }, rows: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'] };
    const EMOTE_MS = 2200;
    const MOOD_EMOTE_EVERY_MS = 14000;
    const HEARTS = 4;
    const SEGMENTS = { 'xp-meter': 24, energy: 8, 'egg-meter': 20 };
    const FRAME_MS = 500;
    const TRANSIENT_MS = 2000;
    const SIZE_PX = 64;
    const SPEED_PX_PER_SECOND = 20;

    let current = null;
    let transient = null;
    let x = 0;
    let direction = 1;
    let lastTime = performance.now();

    buildMeter($('fullness'), HEARTS, () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#heart');
        svg.appendChild(use);
        return svg;
    });
    for (const [id, count] of Object.entries(SEGMENTS)) {
        buildMeter($(id), count, () => document.createElement('span'));
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'state') {
            render(message);
        } else if (message.type === 'play') {
            play(message.animation);
        } else if (message.type === 'evolve') {
            evolutionScene(message);
        }
    });

    $('food-tray').addEventListener('click', event => {
        const button = event.target.closest('.food');
        if (button && !button.disabled) {
            vscode.postMessage({ type: 'feed', food: button.dataset.food });
        }
    });

    $('claude').addEventListener('click', () => {
        if (current?.claudeStatus === 'waiting') {
            vscode.postMessage({ type: 'focusClaude' });
        }
    });

    $('paths').addEventListener('click', event => {
        const button = event.target.closest('.path');
        if (button) {
            vscode.postMessage({ type: 'choose', branch: button.dataset.branch });
        }
    });

    $('egg-choices').addEventListener('click', event => {
        const button = event.target.closest('.path');
        if (button && !button.disabled) {
            vscode.postMessage({ type: 'chooseEgg', lineId: button.dataset.lineId });
        }
    });

    $('roster').addEventListener('click', event => {
        const button = event.target.closest('.buddy');
        if (button && button.dataset.id && !button.classList.contains('active')) {
            vscode.postMessage({ type: 'switch', id: button.dataset.id });
        }
    });

    pet.addEventListener('click', () => {
        if (current && !current.isEgg && current.mood !== 'sleeping') {
            play('happy');
            if (Math.random() < 0.5) {
                showEmote('shout');
            } else {
                floatHearts(3);
            }
        }
    });

    // Every so often, a hungry or worn-out pet says so.
    setInterval(() => {
        if (!current || current.isEgg || current.mood === 'sleeping' || sceneRunning) {
            return;
        }
        if (current.mood === 'starving' || current.mood === 'hungry') {
            showEmote('hungry');
        } else if (current.mood === 'exhausted' || current.energy <= 0.2) {
            showEmote('sad');
        }
    }, MOOD_EMOTE_EVERY_MS);

    function buildMeter(container, count, create) {
        for (let i = 0; i < count; i++) {
            container.appendChild(create());
        }
    }

    function fillMeter(container, fraction) {
        const lit = Math.ceil(fraction * container.children.length);
        Array.from(container.children).forEach((cell, i) => cell.classList.toggle('on', i < lit));
        container.setAttribute('aria-label', `${Math.round(fraction * 100)}%`);
    }

    function pixelArt({ palette, rows }) {
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
        svg.setAttribute('shape-rendering', 'crispEdges');
        svg.setAttribute('aria-hidden', 'true');
        rows.forEach((row, y) => [...row].forEach((pixel, x) => {
            if (pixel !== '.') {
                const rect = document.createElementNS(svgNs, 'rect');
                rect.setAttribute('x', String(x));
                rect.setAttribute('y', String(y));
                rect.setAttribute('width', '1');
                rect.setAttribute('height', '1');
                rect.setAttribute('fill', palette[pixel]);
                svg.appendChild(rect);
            }
        }));
        return svg;
    }

    /** Write text where numbers render in the pixel face: parts are strings or { num }. */
    function caption(element, parts) {
        element.replaceChildren(...parts.map(part => {
            if (typeof part === 'string') {
                return document.createTextNode(part);
            }
            const span = document.createElement('span');
            span.className = 'num';
            span.textContent = part.num.toLocaleString();
            return span;
        }));
    }

    function renderProgress(state) {
        const progress = state.levelXp / state.levelXpNeeded;
        fillMeter($('xp-meter'), progress);
        $('xp-meter').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
        caption($('level'), ['Lv ', { num: state.level }]);
        caption($('xp-caption'), [{ num: state.levelXpNeeded - state.levelXp }, ' XP to Lv ', { num: state.level + 1 }]);
        if (state.evolveAtLevel === null) {
            caption($('evolve-caption'), ['Final form']);
        } else if (state.choice) {
            caption($('evolve-caption'), ['Ready to evolve']);
        } else {
            caption($('evolve-caption'), [state.isEgg ? 'Hatches at Lv ' : 'Evolves at Lv ', { num: state.evolveAtLevel }]);
        }
    }

    function renderChoice(state) {
        $('evolve').hidden = !state.choice;
        if (!state.choice) {
            return;
        }
        $('paths').replaceChildren(...state.choice.map(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'path';
            button.dataset.branch = option.branch;
            button.setAttribute('aria-label', `Digivolve into ${option.name}, then ${option.next.join(', then ')}`);
            const thumb = document.createElement('div');
            thumb.className = 'thumb';
            thumb.style.backgroundImage = `url('${option.spriteUri}')`;
            const name = document.createElement('strong');
            name.textContent = option.name;
            const next = document.createElement('small');
            next.textContent = `then ${option.next.join(', then ')}`;
            button.append(thumb, name, next);
            return button;
        }));
    }

    function renderFood(state) {
        const tray = $('food-tray');
        if (tray.children.length !== state.food.length) {
            tray.replaceChildren(...state.food.map(item => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'food';
                button.dataset.food = item.kind;
                const name = document.createElement('span');
                name.textContent = item.name;
                const price = document.createElement('span');
                price.className = 'price';
                button.append(pixelArt(FOOD_ART[item.kind]), name, price);
                return button;
            }));
        }
        state.food.forEach((item, i) => {
            const button = tray.children[i];
            const affordable = state.bits >= item.price;
            caption(button.querySelector('.price'), [{ num: item.price }, ' bits']);
            button.disabled = state.isEgg || !affordable;
            const reason = state.isEgg ? 'Eggs do not eat' : affordable ? 'Click to buy and feed' : `Needs ${(item.price - state.bits).toLocaleString()} more bits`;
            button.title = `${item.name}: ${item.effect}. ${reason}.`;
            button.setAttribute('aria-label', `Buy ${item.name} for ${item.price} bits. ${item.effect}. ${reason}.`);
        });
        caption($('bits'), [{ num: state.bits }, ' bits']);
    }

    function renderRoster(state) {
        const slots = state.roster.map(buddy => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `buddy${buddy.active ? ' active' : ''}`;
            button.dataset.id = buddy.id;
            button.title = buddy.active ? `${buddy.name} (${buddy.stage}), active` : `Switch to ${buddy.name} (${buddy.stage})`;
            button.setAttribute('aria-pressed', String(buddy.active));
            const thumb = document.createElement('div');
            thumb.className = `thumb${buddy.isEgg ? ' egg' : ''}`;
            thumb.style.backgroundImage = `url('${buddy.spriteUri}')`;
            button.appendChild(thumb);
            return button;
        });
        for (let i = state.roster.length; i < state.maxBuddies; i++) {
            const empty = document.createElement('div');
            empty.className = 'buddy empty';
            empty.setAttribute('aria-hidden', 'true');
            slots.push(empty);
        }
        $('roster').replaceChildren(...slots);
        $('roster-count').textContent = `${state.roster.length}/${state.maxBuddies}`;
        fillMeter($('egg-meter'), state.nextEgg.current / state.nextEgg.target);
        const eggIn = state.nextEgg.target - state.nextEgg.current;
        caption($('egg-caption'), ['Next egg in ', { num: eggIn }, ' XP']);
        renderEggOffer(state);
        showThumbFrame(true);
    }

    function renderEggOffer(state) {
        $('egg-offer').hidden = !state.eggOffer;
        if (!state.eggOffer) {
            return;
        }
        const more = state.eggsWaiting > 1 ? ` (${state.eggsWaiting - 1} more after this)` : '';
        $('egg-offer-note').textContent = state.partyFull
            ? `New egg! Your party is full: release a buddy to make room${more}.`
            : `New egg! Choose one to raise${more}:`;
        $('egg-choices').replaceChildren(...state.eggOffer.map(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'path';
            button.dataset.lineId = option.lineId;
            button.disabled = state.partyFull;
            button.setAttribute('aria-label', `Choose the ${option.name} egg`);
            const thumb = document.createElement('div');
            thumb.className = 'thumb egg';
            thumb.style.backgroundImage = `url('${option.spriteUri}')`;
            const name = document.createElement('strong');
            name.textContent = `${option.name} egg`;
            button.append(thumb, name);
            return button;
        }));
    }

    /** Roster and path previews idle between their first two frames, in step with the main pet. */
    let thumbFrame = -1;
    function showThumbFrame(force) {
        const frame = Math.floor(performance.now() / FRAME_MS) % 2;
        if (frame === thumbFrame && !force) {
            return;
        }
        thumbFrame = frame;
        document.querySelectorAll('.thumb').forEach(thumb => {
            thumb.style.backgroundPosition = `${frame * 50}% 0%`;
        });
    }

    function render(state) {
        current = state;
        pet.style.backgroundImage = `url('${state.spriteUri}')`;
        pet.classList.toggle('egg', state.isEgg);
        pet.setAttribute('aria-label', state.name);
        device.classList.toggle('egg', state.isEgg);
        screen.classList.toggle('sleeping', state.mood === 'sleeping');

        $('status').textContent = state.isEgg ? '' : state.moodLabel;
        $('claude').textContent = state.claudeLabel;
        $('claude').disabled = state.claudeStatus !== 'waiting';
        screen.dataset.claude = state.claudeStatus;
        $('name').textContent = state.name;
        $('stage').textContent = state.stage;

        device.dataset.screen = state.appearance.screen;
        renderProgress(state);

        fillMeter($('fullness'), state.fullness);
        fillMeter($('energy'), state.energy);
        $('age').textContent = `Age ${state.age}`;
        renderChoice(state);
        renderFood(state);
        renderRoster(state);
    }

    function play(animation) {
        if (animation === 'levelUp') {
            levelUpEffect();
            animation = 'happy';
        } else if (animation === 'cheer') {
            showEmote('shout');
            animation = 'happy';
        } else if (animation === 'eat') {
            // After a moment of chewing: sometimes a happy face, otherwise hearts.
            setTimeout(() => Math.random() < 0.5 ? showEmote('happy') : floatHearts(3), 900);
        }
        transient = { animation, until: performance.now() + TRANSIENT_MS };
    }

    let emoteTimer;
    function showEmote(kind) {
        const art = kind === 'hungry' ? FOOD_ART.meat : EMOTE_ART[kind];
        emote.replaceChildren(pixelArt(art));
        emote.hidden = false;
        // Restart the pop-in animation when one bubble replaces another.
        emote.style.animation = 'none';
        void emote.offsetWidth;
        emote.style.animation = '';
        clearTimeout(emoteTimer);
        emoteTimer = setTimeout(() => { emote.hidden = true; }, EMOTE_MS);
    }

    function floatHearts(count) {
        for (let i = 0; i < count; i++) {
            const heart = document.createElement('div');
            heart.className = 'float';
            heart.style.left = `${Math.round(x) + 14 + i * 14}px`;
            heart.style.bottom = `${SIZE_PX + 16}px`;
            heart.style.animationDelay = `${i * 0.18}s`;
            heart.appendChild(pixelArt(HEART_ART));
            fx.appendChild(heart);
            setTimeout(() => heart.remove(), 1800 + i * 180);
        }
    }

    function levelUpEffect() {
        const label = document.createElement('div');
        label.className = 'level-up';
        label.textContent = 'LV UP!';
        label.style.left = `${Math.max(4, Math.round(x) - 4)}px`;
        label.style.bottom = `${SIZE_PX + 58}px`; // above the speech bubble, which can show at the same time
        fx.appendChild(label);
        setTimeout(() => label.remove(), 1700);
        for (let i = 0; i < 10; i++) {
            const spark = document.createElement('div');
            spark.className = 'sparkle';
            const angle = (i / 10) * Math.PI * 2;
            spark.style.left = `${Math.round(x) + SIZE_PX / 2}px`;
            spark.style.bottom = `${18 + SIZE_PX / 2}px`;
            spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * 44)}px`);
            spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * 44)}px`);
            fx.appendChild(spark);
            setTimeout(() => spark.remove(), 1000);
        }
        screen.classList.remove('leveling');
        void screen.offsetWidth;
        screen.classList.add('leveling');
    }

    let sceneRunning = false;
    function evolutionScene({ from, to }) {
        const scene = $('evolve-scene');
        const old = $('scene-old');
        const next = $('scene-new');
        old.style.backgroundImage = `url('${from.spriteUri}')`;
        old.classList.toggle('egg', from.isEgg);
        next.style.backgroundImage = `url('${to.spriteUri}')`;
        $('scene-caption').textContent = from.isEgg ? `It hatched into ${to.name}!` : `Digivolved into ${to.name}!`;
        // Re-inserting the scene restarts every CSS animation inside it from the beginning.
        scene.hidden = true;
        void scene.offsetWidth;
        scene.hidden = false;
        sceneRunning = true;
        emote.hidden = true;
        pet.style.visibility = 'hidden';
        setTimeout(() => {
            scene.hidden = true;
            sceneRunning = false;
            pet.style.visibility = '';
            play('happy');
        }, 3900);
    }

    function activeAnimation(now) {
        if (current.isEgg) {
            return 'idle';
        }
        if (transient && now < transient.until) {
            return transient.animation;
        }
        return MOOD_ANIMATIONS[current.mood] || 'idle';
    }

    function showFrame(index, rows) {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const y = rows > 1 ? (row * 100) / (rows - 1) : 0;
        pet.style.backgroundPosition = `${column * 50}% ${y}%`;
    }

    function step(now) {
        const seconds = Math.min(now - lastTime, 100) / 1000;
        lastTime = now;

        if (current) {
            const maxX = Math.max(0, screen.clientWidth - SIZE_PX);
            const animation = activeAnimation(now);
            if (current.isEgg) {
                x = maxX / 2;
            } else if (animation === 'idle') {
                x += direction * SPEED_PX_PER_SECOND * seconds;
                if (x >= maxX) {
                    x = maxX;
                    direction = -1;
                } else if (x <= 0) {
                    x = 0;
                    direction = 1;
                }
            }
            x = Math.min(x, maxX);

            const animations = current.isEgg ? EGG_ANIMATIONS : SHEET_ANIMATIONS;
            const frames = animations[animation] || animations.idle;
            showFrame(frames[Math.floor(now / FRAME_MS) % frames.length], current.isEgg ? 1 : 4);
            // Sprites face left, so mirror them when walking right.
            pet.style.transform = `translateX(${Math.round(x)}px) scaleX(${direction > 0 && !current.isEgg ? -1 : 1})`;
            zzz.style.left = `${Math.round(x) + SIZE_PX - 8}px`;
            zzz.style.bottom = `${SIZE_PX + 14}px`;
            emote.style.left = `${Math.round(x) + SIZE_PX / 2 - 6}px`;
            emote.style.bottom = `${SIZE_PX + 22}px`;
        }
        showThumbFrame(false);
        requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
    vscode.postMessage({ type: 'ready' });
})();
