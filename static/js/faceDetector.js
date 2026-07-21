// State
export let matchedFaces = {};
export let ignoredFaces = [];

let isMatchingActive = false;

export async function loadFaceModels() {
    await faceapi.nets.tinyFaceDetector.loadFromUri('/static/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/static/models');
    await faceapi.nets.faceRecognitionNet.loadFromUri('/static/models');
}

export async function detectFaces(video, canvas) {
    const faceOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 });
    const faces = await faceapi.detectAllFaces(video, faceOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();
        
    const dims = { width: canvas.width, height: canvas.height };
    return faceapi.resizeResults(faces, dims);
}

export function getFaceIdHash(descriptor) {
    return descriptor.slice(0, 10).map(n => n.toFixed(3)).join('');
}

export function cacheMatchedFace(faceId, user, descriptor) {
    matchedFaces[faceId] = {
        user: user,
        descriptor: descriptor,
        timestamp: Date.now()
    };
}

export function cacheIgnoredFace(descriptor) {
    ignoredFaces.push({
        descriptor: descriptor,
        time: Date.now()
    });
}

export async function processFaceMatching(
    faces, 
    isRegistering, 
    lastMatchTime, 
    MATCH_COOLDOWN_MS, 
    IGNORE_COOLDOWN_MS, 
    updateProfileUI, 
    clearProfileUI, 
    openRegisterModal,
    addLog,
    showToast
) {
    const now = Date.now();
    
    if (faces.length === 0) {
        if (now - lastMatchTime > 3500) {
            clearProfileUI();
        }
        return lastMatchTime;
    }
    
    const face = faces[0];
    const faceId = getFaceIdHash(face.descriptor);
    
    // 1. Check local cache using Euclidean distance
    let cachedItem = null;
    for (const key in matchedFaces) {
        const item = matchedFaces[key];
        if (item.descriptor) {
            const dist = faceapi.euclideanDistance(face.descriptor, item.descriptor);
            if (dist < 0.55) {
                cachedItem = item;
                break;
            }
        }
    }
    
    if (cachedItem) {
        matchedFaces[faceId] = cachedItem; // speed up direct lookup
        updateProfileUI(cachedItem.user);
        return now;
    }
    
    // 2. Query Database (throttled)
    if (!isMatchingActive && !isRegistering && (now - lastMatchTime > MATCH_COOLDOWN_MS)) {
        // Check if ignored recently
        const isIgnored = ignoredFaces.some(ign => {
            const dist = faceapi.euclideanDistance(ign.descriptor, face.descriptor);
            return dist < 0.55 && (now - ign.time < IGNORE_COOLDOWN_MS);
        });
        
        if (!isIgnored) {
            isMatchingActive = true;
            try {
                const descriptorArray = Array.from(face.descriptor);
                const response = await fetch('/api/match_face', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embedding: descriptorArray })
                });
                
                const result = await response.json();
                
                if (result.matched) {
                    cacheMatchedFace(faceId, result.user, face.descriptor);
                    addLog(`Face matched: ${result.user.name} (distance: ${result.distance.toFixed(3)})`, "success");
                    showToast(`Welcome back, ${result.user.name}!`, "success");
                    updateProfileUI(result.user);
                } else {
                    openRegisterModal(face);
                }
            } catch (err) {
                console.error("Match face API error:", err);
            } finally {
                isMatchingActive = false;
            }
            return now;
        }
    }
    return lastMatchTime;
}
