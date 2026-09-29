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

    $('feed').addEventListener('click', () => vscode.postMessage({ type: 'feed' }));

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
