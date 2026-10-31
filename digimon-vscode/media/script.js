// Runs inside the Digimon webview. The extension sends the pet's state; this file only renders and animates it.
(function () {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    const device = $('device');
    const screen = $('screen');
    const pet = $('pet');
    const zzz = $('zzz');
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
    const POTION_ART = {
        palette: { k: '#9aa0a6', g: '#d8e6f0', p: '#a970e0', l: '#d2b0f5' },
        rows: ['...kk...', '...gg...', '..gppg..', '.gpplpg.', '.gppppg.', '.gppppg.', '..gppg..', '...gg...'],
    };
    const FLAME_ART = {
        palette: { r: '#e5484d', o: '#f08a3c', y: '#e8b931' },
        rows: ['..r...', '..rr..', '.rorr.', '.roor.', 'roooyr', 'royyor', '.ryyr.'],
    };
    // Item drags carry this type so the screen only accepts items, and roster slots only accept buddies.
    const ITEM_TYPE = 'application/x-digimon-item';
    const BUDDY_TYPE = 'application/x-digimon-buddy';
    // Reactions float up from the pet as small pixel icons.
    const HEART_ART = { palette: { r: '#e5484d' }, rows: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'] };
    const SWEAT_ART = { palette: { b: '#7fb2e5', w: '#e6f3ff' }, rows: ['..b..', '..b..', '.bbb.', 'bbwbb', 'bbbbb', '.bbb.'] };
    const MOOD_REACTION_EVERY_MS = 14000;
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

    $('items').addEventListener('click', event => {
        const buy = event.target.closest('.buy');
        if (buy) {
            if (!buy.disabled) {
                vscode.postMessage({ type: 'buyPotion' });
            }
            return;
        }
        const button = event.target.closest('.item');
        if (button && !button.disabled) {
            useItem(JSON.parse(button.dataset.item));
        }
    });

    $('items').addEventListener('dragstart', event => {
        const button = event.target.closest('.item');
        if (!button || button.disabled) {
            event.preventDefault();
            return;
        }
        event.dataTransfer.setData(ITEM_TYPE, button.dataset.item);
        event.dataTransfer.effectAllowed = 'move';
    });

    // Drop food or a potion on the screen to use it, exactly like clicking it.
    screen.addEventListener('dragover', event => {
        if (event.dataTransfer.types.includes(ITEM_TYPE)) {
            event.preventDefault();
            screen.classList.add('drop-target');
        }
    });
    screen.addEventListener('dragleave', event => {
        if (!screen.contains(event.relatedTarget)) {
            screen.classList.remove('drop-target');
        }
    });
    screen.addEventListener('drop', event => {
        screen.classList.remove('drop-target');
        const data = event.dataTransfer.getData(ITEM_TYPE);
        if (data) {
            event.preventDefault();
            useItem(JSON.parse(data));
        }
    });

    $('stage').addEventListener('click', () => {
        if (current?.canChangeForm) {
            vscode.postMessage({ type: 'changeForm' });
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
        if (!button || button.disabled) {
            return;
        }
        if (button.dataset.action === 'crack') {
            vscode.postMessage({ type: 'crackEgg' });
        } else {
            vscode.postMessage({ type: 'chooseEgg', lineId: button.dataset.lineId });
        }
    });

    $('roster').addEventListener('click', event => {
        const button = event.target.closest('.buddy');
        if (button && button.dataset.id && !button.classList.contains('active')) {
            vscode.postMessage({ type: 'switch', id: button.dataset.id });
        }
    });

    // Drag a buddy onto another slot to move it there.
    $('roster').addEventListener('dragstart', event => {
        const button = event.target.closest('.buddy');
        if (!button?.dataset.id) {
            event.preventDefault();
            return;
        }
        event.dataTransfer.setData(BUDDY_TYPE, button.dataset.id);
        event.dataTransfer.effectAllowed = 'move';
    });
    $('roster').addEventListener('dragover', event => {
        const target = event.target.closest('.buddy');
        if (target?.dataset.id && event.dataTransfer.types.includes(BUDDY_TYPE)) {
            event.preventDefault();
            $('roster').querySelectorAll('.drop-target').forEach(slot => slot.classList.toggle('drop-target', slot === target));
            target.classList.add('drop-target');
        }
    });
    $('roster').addEventListener('dragleave', event => {
        if (!$('roster').contains(event.relatedTarget)) {
            $('roster').querySelectorAll('.drop-target').forEach(slot => slot.classList.remove('drop-target'));
        }
    });
    $('roster').addEventListener('drop', event => {
        $('roster').querySelectorAll('.drop-target').forEach(slot => slot.classList.remove('drop-target'));
        const target = event.target.closest('.buddy');
        const dragged = event.dataTransfer.getData(BUDDY_TYPE);
        if (!current || !dragged || !target?.dataset.id || target.dataset.id === dragged) {
            return;
        }
        event.preventDefault();
        const ids = current.roster.map(buddy => buddy.id).filter(id => id !== dragged);
        ids.splice(current.roster.findIndex(buddy => buddy.id === target.dataset.id), 0, dragged);
        vscode.postMessage({ type: 'reorder', ids });
    });

    pet.addEventListener('click', () => {
        if (current && !current.isEgg && current.mood !== 'sleeping') {
            play('happy');
            floatIcons(HEART_ART, 3);
        }
    });

    // Every so often, a hungry or worn-out pet says so.
    setInterval(() => {
        if (!current || current.isEgg || current.mood === 'sleeping' || sceneRunning) {
            return;
        }
        if (current.mood === 'starving' || current.mood === 'hungry') {
            floatIcons(FOOD_ART.meat, 1);
        } else if (current.mood === 'exhausted' || current.energy <= 0.2) {
            floatIcons(SWEAT_ART, 1);
        }
    }, MOOD_REACTION_EVERY_MS);

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

    function useItem(item) {
        if (item.potion) {
            vscode.postMessage({ type: 'drinkPotion' });
        } else {
            vscode.postMessage({ type: 'feed', food: item.food });
        }
    }

    /** Foods are bought as they are eaten; potions are stocked first, then drunk. Rebuilt only when the set changes. */
    function renderItems(state) {
        const grid = $('items');
        const tiles = state.food.length + 1;
        if (grid.children.length !== tiles) {
            const foods = state.food.map(item => itemTile(FOOD_ART[item.kind], item.name, { food: item.kind }));
            const potion = itemTile(POTION_ART, 'XP Potion', { potion: true });
            const buy = document.createElement('button');
            buy.type = 'button';
            buy.className = 'buy';
            buy.textContent = '+';
            const slot = document.createElement('div');
            slot.className = 'item-slot';
            slot.append(potion, buy);
            grid.replaceChildren(...foods.map(tile => {
                const wrap = document.createElement('div');
                wrap.className = 'item-slot';
                wrap.appendChild(tile);
                return wrap;
            }), slot);
        }
        const buttons = grid.querySelectorAll('.item');
        state.food.forEach((item, i) => {
            const button = buttons[i];
            const affordable = state.bits >= item.price;
            caption(button.querySelector('.badge'), [{ num: item.price }]);
            setUsable(button, !state.isEgg && affordable);
            const reason = state.isEgg ? 'Eggs do not eat' : affordable ? 'Click or drag onto your Digimon to buy and feed' : `Needs ${(item.price - state.bits).toLocaleString()} more bits`;
            button.title = `${item.name}: ${item.effect}. ${item.price} bits. ${reason}.`;
            button.setAttribute('aria-label', `Buy ${item.name} for ${item.price} bits. ${item.effect}. ${reason}.`);
        });
        const potion = buttons[state.food.length];
        caption(potion.querySelector('.badge'), ['×', { num: state.potions }]);
        setUsable(potion, state.potions > 0);
        const effect = `+${state.potionXp.toLocaleString()} XP`;
        potion.title = state.potions > 0 ? `XP Potion: ${effect}. Click or drag onto your Digimon to drink.` : `XP Potion: ${effect}. Buy one with +, or crack a spare egg.`;
        potion.setAttribute('aria-label', `Drink an XP potion, ${effect}. ${state.potions} owned.`);
        const buy = grid.querySelector('.buy');
        buy.disabled = state.bits < state.potionPrice;
        buy.title = buy.disabled
            ? `Needs ${(state.potionPrice - state.bits).toLocaleString()} more bits for an XP potion`
            : `Buy an XP potion for ${state.potionPrice.toLocaleString()} bits`;
        buy.setAttribute('aria-label', buy.title);
        caption($('bits'), [{ num: state.bits }, ' bits']);
    }

    function itemTile(art, name, item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'item';
        button.dataset.item = JSON.stringify(item);
        const label = document.createElement('span');
        label.textContent = name;
        const badge = document.createElement('span');
        badge.className = 'badge';
        button.append(pixelArt(art), label, badge);
        return button;
    }

    function setUsable(button, usable) {
        button.disabled = !usable;
        button.draggable = usable;
    }

    /**
     * The egg bar doubles as the frenzy timer: egg progress is paused during a frenzy, so the bar burns orange and
     * drains as the frenzy runs out. The countdown runs locally between state updates, which only come on changes.
     */
    let frenzyEndsAt = 0;
    function renderEggProgress() {
        if (!current) {
            return;
        }
        const left = frenzyEndsAt - Date.now();
        const element = $('frenzy');
        const meter = $('egg-meter');
        element.hidden = left <= 0;
        meter.classList.toggle('on-fire', left > 0);
        if (left <= 0) {
            fillMeter(meter, current.nextEgg.current / current.nextEgg.target);
            caption($('egg-caption'), ['Next egg ', { num: Math.floor(current.nextEgg.current / current.nextEgg.target * 100) }, '%']);
        } else {
            fillMeter(meter, Math.min(1, left / current.frenzyMs));
            caption($('egg-caption'), ['Egg paused']);
            const minutes = Math.ceil(left / 60_000);
            element.replaceChildren(pixelArt(FLAME_ART), document.createTextNode(' Coding frenzy: XP ×3, '));
            const num = document.createElement('span');
            num.className = 'num';
            num.textContent = String(minutes);
            element.append(num, document.createTextNode(minutes === 1 ? ' minute left' : ' minutes left'));
        }
    }
    setInterval(renderEggProgress, 15_000);

    function renderRoster(state) {
        const slots = state.roster.map(buddy => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `buddy${buddy.active ? ' active' : ''}`;
            button.dataset.id = buddy.id;
            button.title = buddy.active ? `${buddy.name} (${buddy.stage}), active` : `Switch to ${buddy.name} (${buddy.stage})`;
            button.setAttribute('aria-pressed', String(buddy.active));
            button.draggable = true;
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
        }), crackButton());
    }

    function crackButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'path crack';
        button.dataset.action = 'crack';
        button.title = 'Turn this egg into 2 XP potions instead';
        button.append(pixelArt(POTION_ART), document.createTextNode(' Crack into 2 potions'));
        return button;
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
        $('stage').disabled = !state.canChangeForm;
        $('stage').title = state.canChangeForm ? 'Change form' : '';

        device.dataset.screen = state.appearance.screen;
        renderProgress(state);

        fillMeter($('fullness'), state.fullness);
        fillMeter($('energy'), state.energy);
        $('age').textContent = `Age ${state.age}`;
        renderChoice(state);
        renderItems(state);
        frenzyEndsAt = state.frenzyMsLeft > 0 ? Date.now() + state.frenzyMsLeft : 0;
        renderEggProgress();
        renderRoster(state);
    }

    function play(animation) {
        if (animation === 'levelUp') {
            levelUpEffect();
            animation = 'happy';
        } else if (animation === 'eat') {
            // Hearts once it has had a moment to chew.
            setTimeout(() => floatIcons(HEART_ART, 3), 900);
        }
        transient = { animation, until: performance.now() + TRANSIENT_MS };
    }

    function floatIcons(art, count) {
        for (let i = 0; i < count; i++) {
            const icon = document.createElement('div');
            icon.className = 'float';
            icon.style.left = `${Math.round(x) + (count === 1 ? SIZE_PX / 2 - 7 : 14 + i * 14)}px`;
            icon.style.bottom = `${SIZE_PX + 16}px`;
            icon.style.animationDelay = `${i * 0.18}s`;
            icon.appendChild(pixelArt(art));
            fx.appendChild(icon);
            setTimeout(() => icon.remove(), 1800 + i * 180);
        }
    }

    function levelUpEffect() {
        const label = document.createElement('div');
        label.className = 'level-up';
        label.textContent = 'LV UP!';
        label.style.left = `${Math.max(4, Math.round(x) - 4)}px`;
        label.style.bottom = `${SIZE_PX + 20}px`;
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
        }
        showThumbFrame(false);
        requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
    vscode.postMessage({ type: 'ready' });
})();
