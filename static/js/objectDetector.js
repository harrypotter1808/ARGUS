let cocoSsdModel = null;

export async function loadCocoSsdModel() {
    cocoSsdModel = await cocoSsd.load();
}

export async function detectObjects(video) {
    if (!cocoSsdModel) return [];
    // Max 15 boxes, threshold 0.35 for blurry cameras
    return await cocoSsdModel.detect(video, 15, 0.35);
}

export function processObjectUpdates(objects, objectsPlaceholder, detectedObjectsList, activeObjects, addLog) {
    const filteredObjects = objects.filter(obj => obj.class !== 'person');
    const now = performance.now();
    
    if (filteredObjects.length > 0) {
        objectsPlaceholder.classList.add('hidden');
        detectedObjectsList.innerHTML = '';
        
        filteredObjects.forEach(obj => {
            const li = document.createElement('li');
            li.className = 'object-item';
            li.innerHTML = `
                <div class="object-info">
                    <i class="fa-solid fa-cube text-magenta"></i>
                    <span class="object-name">${obj.class}</span>
                </div>
                <span class="object-confidence">${Math.round(obj.score * 100)}%</span>
            `;
            detectedObjectsList.appendChild(li);
            
            // Log new object encounters
            if (!activeObjects[obj.class] || (now - activeObjects[obj.class].lastSeen > 5000)) {
                addLog(`Object detected: ${obj.class} (${Math.round(obj.score * 100)}%)`, "object");
            }
            activeObjects[obj.class] = { lastSeen: now };
        });
    } else {
        objectsPlaceholder.classList.remove('hidden');
        detectedObjectsList.innerHTML = '';
    }
}
