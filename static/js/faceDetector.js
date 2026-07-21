// State
export let matchedFaces = {};
export let ignoredFaces = [];
export let currentlyMatchingFaceIds = {};

// Keep track of voice warnings to prevent audio overlap spam (minimum 10s cooldown)
let lastVoiceWarningTime = 0;

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
    const resized = faceapi.resizeResults(faces, dims);
    
    // Sort faces by bounding box area (largest/closest first)
    return resized.sort((a, b) => {
        const areaA = a.detection.box.width * a.detection.box.height;
        const areaB = b.detection.box.width * b.detection.box.height;
        return areaB - areaA;
    });
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
    showToast,
    speak
) {
    const now = Date.now();
    
    if (faces.length === 0) {
        if (now - lastMatchTime > 3500) {
            clearProfileUI();
        }
        return lastMatchTime;
    }
    
    // 1. Process the primary face (index 0) to update the sidebar UI details
    const primaryFace = faces[0];
    const primaryFaceId = getFaceIdHash(primaryFace.descriptor);
    
    // Check if primary face is in cache
    let primaryCachedItem = null;
    for (const key in matchedFaces) {
        const item = matchedFaces[key];
        if (item.descriptor) {
            const dist = faceapi.euclideanDistance(primaryFace.descriptor, item.descriptor);
            if (dist < 0.55) {
                primaryCachedItem = item;
                break;
            }
        }
    }
    
    if (primaryCachedItem) {
        matchedFaces[primaryFaceId] = primaryCachedItem;
        updateProfileUI(primaryCachedItem.user);
    } else {
        // If primary face is unknown or still scanning, clear the sidebar details
        clearProfileUI();
    }
    
    // 2. Scan and match ALL visible faces concurrently (limited to top 3)
    const maxFacesToProcess = Math.min(faces.length, 3);
    let updatedMatchTime = lastMatchTime;
    
    for (let i = 0; i < maxFacesToProcess; i++) {
        const face = faces[i];
        const faceId = getFaceIdHash(face.descriptor);
        
        // Check if this specific face is in local cache
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
        
        // If already cached, skip matching
        if (cachedItem) {
            matchedFaces[faceId] = cachedItem;
            continue;
        }
        
        // If not in cache, query the DB (if throttled, not ignored, not registering, and not already fetching)
        if (!currentlyMatchingFaceIds[faceId] && !isRegistering && (now - lastMatchTime > MATCH_COOLDOWN_MS)) {
            // Check if ignored recently
            const isIgnored = ignoredFaces.some(ign => {
                const dist = faceapi.euclideanDistance(ign.descriptor, face.descriptor);
                return dist < 0.55 && (now - ign.time < IGNORE_COOLDOWN_MS);
            });
            
            if (!isIgnored) {
                currentlyMatchingFaceIds[faceId] = true;
                updatedMatchTime = now;
                
                // Fetch match from database asynchronously so it doesn't block other faces
                (async () => {
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
                            speak(`Welcome back, ${result.user.name}`);
                            
                            // If this was the primary face, update the UI immediately
                            if (i === 0) {
                                updateProfileUI(result.user);
                            }
                        } else {
                            // Unregistered face sighted
                            // Only trigger registration modal if it is the primary face, and modal is closed
                            if (i === 0 && !isRegistering) {
                                openRegisterModal(face);
                            }
                            
                            // Voice warning trigger (throttled to avoid sound overlay spam)
                            if (now - lastVoiceWarningTime > 10000) {
                                lastVoiceWarningTime = now;
                                speak("Warning: Unidentified biometric signature detected.");
                            }
                        }
                    } catch (err) {
                        console.error("Match face API error:", err);
                    } finally {
                        delete currentlyMatchingFaceIds[faceId];
                    }
                })();
            }
        }
    }
    
    return updatedMatchTime;
}
