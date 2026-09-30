// Runs inside the Digimon webview. The extension sends the pet's state; this file only renders and animates it.
(function () {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    const device = $('device');
    const screen = $('screen');
    const pet = $('pet');
    const zzz = $('zzz');

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
    const HEARTS = 4;
    const ENERGY_SEGMENTS = 8;
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
    buildMeter($('energy'), ENERGY_SEGMENTS, () => document.createElement('span'));

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'state') {
            render(message);
        } else if (message.type === 'play') {
            play(message.animation);
        }
    });

    $('food-tray').addEventListener('click', event => {
        const button = event.target.closest('.food');
        if (button && !button.disabled) {
            vscode.postMessage({ type: 'feed', food: button.dataset.food });
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
        }
    });

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

    function renderFood(state) {
        const tray = $('food-tray');
        if (tray.children.length !== state.food.length) {
            tray.replaceChildren(...state.food.map(item => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'food';
                button.dataset.food = item.kind;
                const count = document.createElement('span');
                count.className = 'count';
                const name = document.createElement('span');
                name.textContent = item.name;
                button.append(count, pixelArt(FOOD_ART[item.kind]), name);
                return button;
            }));
        }
        state.food.forEach((item, i) => {
            const button = tray.children[i];
            button.querySelector('.count').textContent = `×${item.count}`;
            button.disabled = state.isEgg || item.count === 0;
            const reason = state.isEgg ? 'Eggs do not eat' : item.count === 0 ? `Earn one every ${item.every} XP` : 'Click to feed';
            button.title = `${item.name}: ${item.effect}. ${reason}.`;
            button.setAttribute('aria-label', `Feed ${item.name}, ${item.count} left. ${item.effect}.`);
        });
        showProgress('next-food', state.nextFood);
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
            thumb.style.backgroundPosition = '0 0';
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
        $('roster-count').textContent = state.pendingEggs > 0
            ? `${state.roster.length}/${state.maxBuddies}, ${state.pendingEggs} egg waiting`
            : `${state.roster.length}/${state.maxBuddies}`;
        $('roster-count').classList.toggle('waiting', state.pendingEggs > 0);
        showProgress('next-egg', state.nextEgg);
    }

    function showProgress(prefix, { current, target }) {
        $(`${prefix}-fill`).style.width = `${(current / target) * 100}%`;
        $(`${prefix}-text`).textContent = `${current} / ${target}`;
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
        screen.dataset.claude = state.claudeStatus;
        $('name').textContent = state.name;
        $('stage').textContent = state.stage;

        const progress = state.xpNext === null ? 1 : Math.min(1, state.xp / state.xpNext);
        $('xp-fill').style.width = `${progress * 100}%`;
        $('xp-bar').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
        $('xp-text').textContent = state.xpNext === null ? 'Final form' : `${state.xp} / ${state.xpNext} XP`;

        fillMeter($('fullness'), state.fullness);
        fillMeter($('energy'), state.energy);
        $('mistakes').textContent = state.careMistakes === 1 ? '1 care mistake' : `${state.careMistakes} care mistakes`;
        $('age').textContent = `Age ${state.age}`;
        renderFood(state);
        renderRoster(state);
    }

    function play(animation) {
        if (animation === 'evolve') {
            pet.classList.remove('evolving');
            void pet.offsetWidth; // restart the CSS animation
            pet.classList.add('evolving');
            animation = 'happy';
        }
        transient = { animation, until: performance.now() + TRANSIENT_MS };
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
        }
        requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
    vscode.postMessage({ type: 'ready' });
})();
