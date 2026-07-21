// Perception System Engine Initialization
const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const modelSubstatus = document.getElementById('model-substatus');
const systemStatus = document.getElementById('system-status');

// UI Panels
const profileDisplay = document.getElementById('profile-display');
const profileContent = profileDisplay.querySelector('.profile-content');
const placeholderProfile = profileDisplay.querySelector('.empty-profile-placeholder');
const objectsPlaceholder = document.getElementById('objects-placeholder');
const detectedObjectsList = document.getElementById('detected-objects-list');
const matchStatusBadge = document.getElementById('match-status');
const fpsCounter = document.getElementById('fps-counter');
const scanLogs = document.getElementById('scan-logs');

// Registration Modal Elements
const registerModal = document.getElementById('register-modal');
const registerForm = document.getElementById('register-form');
const faceCropCanvas = document.getElementById('face-crop-canvas');
const cropCtx = faceCropCanvas.getContext('2d');
const btnCancelRegister = document.getElementById('btn-cancel-register');
const btnCloseModal = document.getElementById('close-modal');

// Models
let faceDetectorModel = null;
let cocoSsdModel = null;
let isSystemReady = false;

// Lock states
let isMatchingActive = false;
let isRegistering = false;
let currentUnrecognizedDescriptor = null;
let lastMatchTime = 0;
const MATCH_COOLDOWN_MS = 1500; // Throttle matches to 1.5 seconds

// Cooldown list for ignored faces to prevent immediate re-prompts
let ignoredFaces = [];
const IGNORE_COOLDOWN_MS = 8000; // Don't prompt to register an ignored face for 8 seconds

// Tracking lists
let activeObjects = {};
let matchedFaces = {}; // Cache matching to avoid UI flickering
let lastFpsUpdate = 0;
let frameCount = 0;

// Log function
function addLog(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    scanLogs.appendChild(entry);
    scanLogs.scrollTop = scanLogs.scrollHeight;
}

// Toast notification
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-check';
    if (type === 'info') icon = 'fa-circle-info';
    if (type === 'error') icon = 'fa-circle-exclamation';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Load Models
// Global cache for AI detections
let latestFaces = [];
let latestObjects = [];

// Load Models
async function initPerceptionSystem() {
    try {
        addLog("Initializing Neural Networks...", "system");
        
        // 1. Load face-api models
        modelSubstatus.textContent = "Loading face detection layers...";
        await faceapi.nets.tinyFaceDetector.loadFromUri('/static/models');
        
        modelSubstatus.textContent = "Loading landmark detection layers...";
        await faceapi.nets.faceLandmark68Net.loadFromUri('/static/models');
        
        modelSubstatus.textContent = "Loading feature extraction layers...";
        await faceapi.nets.faceRecognitionNet.loadFromUri('/static/models');
        
        addLog("Face perception models loaded successfully.", "success");
        
        // 2. Load COCO-SSD object detector
        modelSubstatus.textContent = "Caching Object SSD layers (COCO network)...";
        cocoSsdModel = await cocoSsd.load();
        
        addLog("Object perception model loaded successfully.", "success");
        
        // Setup video
        modelSubstatus.textContent = "Accessing hardware imaging sensors...";
        await startWebcam();
        
        // Clear Loading Screen
        loadingOverlay.classList.add('fade-out');
        systemStatus.querySelector('.status-indicator').className = 'status-indicator green';
        systemStatus.querySelector('.status-text').textContent = 'Perception Active';
        
        isSystemReady = true;
        addLog("System initialized. 60 FPS rendering and background tracking active.", "success");
        
        // Start loops
        requestAnimationFrame(renderLoop);
        faceDetectionLoop();
        objectDetectionLoop();
        
    } catch (err) {
        console.error(err);
        loadingText.textContent = "Perception Boot Failure";
        modelSubstatus.textContent = err.message || "Ensure camera permissions are allowed.";
        systemStatus.querySelector('.status-indicator').className = 'status-indicator red';
        systemStatus.querySelector('.status-text').textContent = 'Sensor Fault';
        addLog(`System boot error: ${err.message}`, "error");
        showToast("System failed to boot. Check console for logs.", "error");
    }
}

// Start Webcam
async function startWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false
    });
    video.srcObject = stream;
    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            resolve();
        };
    });
}

function resizeCanvas() {
    const rect = video.getBoundingClientRect();
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
}

window.addEventListener('resize', resizeCanvas);

// Scan line tracking
let scannerY = 0;
let scannerDirection = 1;

// Drawing Helper: Target corners
function drawTargetCorners(ctx, x, y, width, height, color) {
    const len = Math.min(20, width * 0.25, height * 0.25);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    
    // Top Left
    ctx.beginPath();
    ctx.moveTo(x + len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + len);
    ctx.stroke();
    
    // Top Right
    ctx.beginPath();
    ctx.moveTo(x + width - len, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + len);
    ctx.stroke();
    
    // Bottom Left
    ctx.beginPath();
    ctx.moveTo(x + len, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height - len);
    ctx.stroke();
    
    // Bottom Right
    ctx.beginPath();
    ctx.moveTo(x + width - len, y + height);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + width, y + height - len);
    ctx.stroke();
    
    ctx.shadowBlur = 0; // reset shadow
}

// Drawing Helper: Futuristic face landmark dots & lines
function drawFuturisticLandmarks(ctx, landmarks) {
    const pts = landmarks.positions;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
    ctx.lineWidth = 1.2;
    
    function drawPath(start, end, close = false) {
        ctx.beginPath();
        ctx.moveTo(pts[start].x, pts[start].y);
        for (let i = start + 1; i <= end; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        if (close) ctx.closePath();
        ctx.stroke();
    }
    
    // Draw connections mapping contours
    drawPath(0, 16);          // Jawline
    drawPath(17, 21);        // Left Eyebrow
    drawPath(22, 26);        // Right Eyebrow
    drawPath(27, 30);        // Nose Bridge
    drawPath(30, 35);        // Nose Bottom
    drawPath(36, 41, true);  // Left Eye
    drawPath(42, 47, true);  // Right Eye
    drawPath(48, 59, true);  // Outer lips
    drawPath(60, 67, true);  // Inner lips
    
    // Draw dots
    ctx.fillStyle = 'rgba(0, 242, 254, 0.75)';
    ctx.shadowBlur = 3;
    ctx.shadowColor = '#00f2fe';
    pts.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, 2 * Math.PI);
        ctx.fill();
    });
    ctx.shadowBlur = 0; // reset
}

// Main 60 FPS Render Loop (Canvas Overlays only)
function renderLoop() {
    if (!isSystemReady) return;
    
    // FPS tracking
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        fpsCounter.textContent = `FPS: ${fps}`;
        frameCount = 0;
        lastFpsUpdate = now;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Render sweeping laser line
    scannerY += 3.0 * scannerDirection;
    if (scannerY >= canvas.height) {
        scannerY = canvas.height;
        scannerDirection = -1;
    } else if (scannerY <= 0) {
        scannerY = 0;
        scannerDirection = 1;
    }
    
    const scanGradient = ctx.createLinearGradient(0, scannerY - 5, 0, scannerY + 5);
    scanGradient.addColorStop(0, 'rgba(0, 242, 254, 0)');
    scanGradient.addColorStop(0.5, 'rgba(0, 242, 254, 0.65)');
    scanGradient.addColorStop(1, 'rgba(0, 242, 254, 0)');
    ctx.fillStyle = scanGradient;
    ctx.fillRect(0, scannerY - 5, canvas.width, 10);
    
    // Draw latest cached objects and faces (Runs synchronously & smoothly)
    drawCachedObjects();
    drawCachedFaces();
    
    requestAnimationFrame(renderLoop);
}

// Background Face Detection Loop (Throttled)
async function faceDetectionLoop() {
    if (!isSystemReady || isRegistering) {
        setTimeout(faceDetectionLoop, 200);
        return;
    }
    
    try {
        // High scoreThreshold to filter out noise, inputSize 320 for blurry camera edge resolution
        const faceOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 });
        const faces = await faceapi.detectAllFaces(video, faceOptions)
            .withFaceLandmarks()
            .withFaceDescriptors();
            
        // Scale landmarks and bounding boxes to match canvas output coordinates
        const dims = { width: canvas.width, height: canvas.height };
        latestFaces = faceapi.resizeResults(faces, dims);
        
        // Execute face matching workflow in the background
        processFaceMatching(latestFaces);
        
    } catch (err) {
        console.error("Face detection thread error:", err);
    }
    
    setTimeout(faceDetectionLoop, 150); // Loop runs ~6-7 times per second (150ms delay)
}

// Background Object Detection Loop (Throttled)
async function objectDetectionLoop() {
    if (!isSystemReady) {
        setTimeout(objectDetectionLoop, 300);
        return;
    }
    
    try {
        // Run with maximum 15 boxes and a lower scoreThreshold of 0.35 to catch blurry objects
        const objects = await cocoSsdModel.detect(video, 15, 0.35);
        latestObjects = objects;
        
        // Update sidebar list items and logs
        processObjectUpdates(latestObjects);
        
    } catch (err) {
        console.error("Object detection thread error:", err);
    }
    
    setTimeout(objectDetectionLoop, 250); // Loop runs 4 times per second (250ms delay)
}

// DrawCachedObjects (Sync canvas drawing at 60 FPS)
function drawCachedObjects() {
    const filteredObjects = latestObjects.filter(obj => obj.class !== 'person');
    
    filteredObjects.forEach(obj => {
        const [x, y, width, height] = obj.bbox;
        const magentaColor = '#ff007f';
        
        // Draw faint translucent bounding box
        ctx.strokeStyle = 'rgba(255, 0, 127, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        
        // Draw Targeting Corners
        drawTargetCorners(ctx, x, y, width, height, magentaColor);
        
        // Draw Label background
        ctx.fillStyle = magentaColor;
        const label = `${obj.class} (${Math.round(obj.score * 100)}%)`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, y - 25 > 0 ? y - 25 : y, textWidth + 16, 25);
        
        // Draw Label text
        ctx.fillStyle = '#ffffff';
        ctx.font = "bold 13px 'Outfit', sans-serif";
        ctx.fillText(label, x + 8, y - 25 > 0 ? y - 8 : y + 17);
    });
}

// DrawCachedFaces (Sync canvas drawing at 60 FPS)
function drawCachedFaces() {
    latestFaces.forEach(face => {
        const { x, y, width, height } = face.detection.box;
        const cyanColor = '#00f2fe';
        
        // Find if this face matches any in our local cache using Euclidean distance
        let displayName = "Scanning face...";
        let matchedItem = null;
        for (const key in matchedFaces) {
            const item = matchedFaces[key];
            if (item.descriptor) {
                const dist = faceapi.euclideanDistance(face.descriptor, item.descriptor);
                if (dist < 0.55) {
                    matchedItem = item;
                    break;
                }
            }
        }
        
        if (matchedItem) {
            displayName = matchedItem.user.name;
        }
        
        // Draw face landmark dots and lines (Futuristic wireframe overlay)
        drawFuturisticLandmarks(ctx, face.landmarks);
        
        // Draw faint translucent bounding box
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        
        // Draw Targeting Corners
        drawTargetCorners(ctx, x, y, width, height, cyanColor);
        
        // Draw Label background
        ctx.fillStyle = cyanColor;
        const label = displayName;
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, y - 25 > 0 ? y - 25 : y, textWidth + 16, 25);
        
        // Draw Label text
        ctx.fillStyle = '#040814';
        ctx.font = "bold 13px 'Outfit', sans-serif";
        ctx.fillText(label, x + 8, y - 25 > 0 ? y - 8 : y + 17);
    });
}

// Background Object Updates (Logs & Sidebar)
function processObjectUpdates(objects) {
    const filteredObjects = objects.filter(obj => obj.class !== 'person');
    const now = performance.now();
    
    if (filteredObjects.length > 0) {
        objectsPlaceholder.classList.add('hidden');
        detectedObjectsList.innerHTML = '';
        
        filteredObjects.forEach(obj => {
            // Append to UI sidebar list
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

// Background Face Matching logic
async function processFaceMatching(faces) {
    const now = Date.now();
    
    if (faces.length === 0) {
        // Clear sidebar if no face seen for 3.5s
        if (now - lastMatchTime > 3500) {
            clearProfileUI();
        }
        return;
    }
    
    // Process the primary face (e.g. closest or largest)
    const face = faces[0];
    const faceId = getFaceIdHash(face.descriptor);
    
    // Check if this face matches any in our local cache using Euclidean distance
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
        // Cache under current faceId hash to speed up future direct lookups
        matchedFaces[faceId] = cachedItem;
        updateProfileUI(cachedItem.user);
        lastMatchTime = now;
        return;
    }
    
    // Run DB match request (throttled)
    if (!isMatchingActive && !isRegistering && (now - lastMatchTime > MATCH_COOLDOWN_MS)) {
        // Check if this face was ignored recently
        const isIgnored = ignoredFaces.some(ign => {
            const dist = faceapi.euclideanDistance(ign.descriptor, face.descriptor);
            return dist < 0.55 && (now - ign.time < IGNORE_COOLDOWN_MS);
        });
        
        if (!isIgnored) {
            await performFaceMatching(face);
        }
    }
}

// Perform match against SQLite database
async function performFaceMatching(face) {
    isMatchingActive = true;
    lastMatchTime = Date.now();
    
    const descriptorArray = Array.from(face.descriptor);
    
    try {
        const response = await fetch('/api/match_face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embedding: descriptorArray })
        });
        
        const result = await response.json();
        
        if (result.matched) {
            const faceId = getFaceIdHash(face.descriptor);
            matchedFaces[faceId] = {
                user: result.user,
                descriptor: face.descriptor,
                timestamp: Date.now()
            };
            addLog(`Face matched: ${result.user.name} (distance: ${result.distance.toFixed(3)})`, "success");
            showToast(`Welcome back, ${result.user.name}!`, "success");
            updateProfileUI(result.user);
        } else {
            // Unregistered Face -> Open Register Modal
            openRegisterModal(face);
        }
    } catch (err) {
        console.error("Match face API error:", err);
    } finally {
        isMatchingActive = false;
    }
}

// Generate simple hash code for descriptor mapping cache
function getFaceIdHash(descriptor) {
    // Slice a portion of the float vector to make a fingerprint key
    return descriptor.slice(0, 10).map(n => n.toFixed(3)).join('');
}

// Modal handling
function openRegisterModal(face) {
    isRegistering = true;
    currentUnrecognizedDescriptor = face.descriptor;
    
    matchStatusBadge.textContent = "Registering";
    matchStatusBadge.className = "badge match-badge registering";
    
    // Capture face crop representation
    const { x, y, width, height } = face.detection.box;
    
    // Draw cropped face onto preview canvas
    faceCropCanvas.width = 120;
    faceCropCanvas.height = 120;
    cropCtx.drawImage(
        video, 
        x - 10 > 0 ? x - 10 : 0, 
        y - 10 > 0 ? y - 10 : 0, 
        width + 20, 
        height + 20, 
        0, 0, 120, 120
    );
    
    // Reset Form
    registerForm.reset();
    
    // Show Modal
    registerModal.classList.remove('hidden');
    addLog("Unidentified face detected. Initiating biometric profile registration.", "info");
}

function closeRegisterModal(addIgnore = true) {
    registerModal.classList.add('hidden');
    
    if (addIgnore && currentUnrecognizedDescriptor) {
        // Add to temporary ignore list to prevent loops
        ignoredFaces.push({
            descriptor: currentUnrecognizedDescriptor,
            time: Date.now()
        });
        addLog("Biometric registration deferred.", "system");
    }
    
    currentUnrecognizedDescriptor = null;
    isRegistering = false;
    matchStatusBadge.textContent = "Scanning";
    matchStatusBadge.className = "badge match-badge";
}

// Submit Registration Form
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentUnrecognizedDescriptor) return;
    
    const name = document.getElementById('reg-name').value;
    const mobile = document.getElementById('reg-mobile').value;
    const address = document.getElementById('reg-address').value;
    const skills = document.getElementById('reg-skills').value;
    const hobbies = document.getElementById('reg-hobbies').value;
    
    const payload = {
        name,
        mobile,
        address,
        skills,
        hobbies,
        embedding: Array.from(currentUnrecognizedDescriptor)
    };
    
    const btnSubmit = document.getElementById('btn-submit-register');
    btnSubmit.disabled = true;
    btnSubmit.querySelector('.btn-text').textContent = "Saving...";
    
    try {
        const response = await fetch('/api/register_face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Cache descriptor mapping immediately
            const faceId = getFaceIdHash(currentUnrecognizedDescriptor);
            matchedFaces[faceId] = {
                user: result.user,
                descriptor: currentUnrecognizedDescriptor,
                timestamp: Date.now()
            };
            
            addLog(`Successfully registered biometric profile for ${name}`, "success");
            showToast(`Profile created for ${name}!`, "success");
            updateProfileUI(result.user);
            closeRegisterModal(false); // Close without putting in ignore list
        } else {
            showToast(result.error || "Failed to register profile", "error");
        }
    } catch (err) {
        console.error("Register face API error:", err);
        showToast("Server communication error", "error");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.querySelector('.btn-text').textContent = "Register Biometric Profile";
    }
});

// Cancel / Close buttons
btnCancelRegister.addEventListener('click', () => closeRegisterModal(true));
btnCloseModal.addEventListener('click', () => closeRegisterModal(true));

// Profile details views
function updateProfileUI(user) {
    placeholderProfile.classList.add('hidden');
    profileContent.classList.remove('hidden');
    
    matchStatusBadge.textContent = "Recognized";
    matchStatusBadge.className = "badge match-badge matched";
    
    document.getElementById('prof-name').textContent = user.name;
    document.getElementById('prof-bio').textContent = user.bio;
    document.getElementById('prof-mobile').textContent = user.mobile || '--';
    document.getElementById('prof-address').textContent = user.address || '--';
    
    // Render short title
    const skillsList = user.skills.split(',').map(s => s.trim()).filter(Boolean);
    document.getElementById('prof-skills-short').textContent = skillsList[0] || 'Perception Target';
    
    // Render tags
    const skillsGroup = document.getElementById('prof-skills-tags');
    skillsGroup.innerHTML = '';
    if (skillsList.length > 0) {
        skillsList.forEach(skill => {
            const tag = document.createElement('span');
            tag.className = 'tag cyan-tag';
            tag.textContent = skill;
            skillsGroup.appendChild(tag);
        });
    } else {
        skillsGroup.innerHTML = '<span class="tag">None listed</span>';
    }
    
    const hobbiesGroup = document.getElementById('prof-hobbies-tags');
    hobbiesGroup.innerHTML = '';
    const hobbiesList = user.hobbies.split(',').map(h => h.trim()).filter(Boolean);
    if (hobbiesList.length > 0) {
        hobbiesList.forEach(hobby => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = hobby;
            hobbiesGroup.appendChild(tag);
        });
    } else {
        hobbiesGroup.innerHTML = '<span class="tag">None listed</span>';
    }
}

function clearProfileUI() {
    placeholderProfile.classList.remove('hidden');
    profileContent.classList.add('hidden');
    matchStatusBadge.textContent = "Scanning";
    matchStatusBadge.className = "badge match-badge";
}

// Clear log list
document.getElementById('clear-logs').addEventListener('click', () => {
    scanLogs.innerHTML = '';
});

// Start systems
window.addEventListener('load', initPerceptionSystem);
