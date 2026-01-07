// This runs inside the Webview
const pet = document.getElementById('pet');

// Apply the sprite we got from the HTML variable
pet.style.backgroundImage = `url('${spriteUri}')`;
pet.style.transform = 'scaleX(-1)';
let position = 10;
let direction = -1;

function wander() {
    position += direction * 0.5;
    pet.style.left = position + '%';
    

    // Wall collision
    if (position > 90) {
        direction = -1;
        pet.style.transform = 'scaleX(-1)';
    }
    if (position < 0) {
        direction = 1;
        pet.style.transform = 'scaleX(1)';
    }

    // Animate sprite frames (Simple version)
    // You can make this fancier later
    const frame = Math.floor(Date.now() / 200) % 3; 
    const framePosition = frame * 50; // assuming 50% shifts
    pet.style.backgroundPosition = `${framePosition}% 0%`;

    requestAnimationFrame(wander);
}

wander();