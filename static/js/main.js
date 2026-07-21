import { startWebcam, resizeCanvas } from './camera.js';
import { 
    loadFaceModels, 
    detectFaces, 
    processFaceMatching, 
    cacheMatchedFace, 
    cacheIgnoredFace, 
    getFaceIdHash,
    matchedFaces 
} from './faceDetector.js';
import { 
    loadCocoSsdModel, 
    detectObjects, 
    processObjectUpdates 
} from './objectDetector.js';
import { 
    drawCachedObjects, 
    drawCachedFaces, 
    drawSweepingLaserLine 
} from './renderer.js';

// DOM Elements
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

// Registration Modal
const registerModal = document.getElementById('register-modal');
const registerForm = document.getElementById('register-form');
const faceCropCanvas = document.getElementById('face-crop-canvas');
const cropCtx = faceCropCanvas.getContext('2d');
const btnCancelRegister = document.getElementById('btn-cancel-register');
const btnCloseModal = document.getElementById('close-modal');

// Controls
const modeButtons = document.querySelectorAll('.mode-btn');
const btnToggleVoice = document.getElementById('toggle-voice');

// State
let isSystemReady = false;
let isRegistering = false;
let activeMode = 'dual'; // 'dual', 'face', 'object'
let isVoiceEnabled = true; // default voice synthesizer enabled

let latestFaces = [];
let latestObjects = [];

let lastMatchTime = 0;
const MATCH_COOLDOWN_MS = 1500;
const IGNORE_COOLDOWN_MS = 8000;

let currentUnrecognizedDescriptor = null;
let activeObjects = {};

let lastFpsUpdate = 0;
let frameCount = 0;

let scannerY = 0;
let scannerDirection = 1;

// Logging Utility
function addLog(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    scanLogs.appendChild(entry);
    scanLogs.scrollTop = scanLogs.scrollHeight;
}

// Toast Utility
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

// Robotic Voice Synthesizer
function speakText(text) {
    if (!isVoiceEnabled) return;
    
    // Stop any ongoing speech immediately to keep responses snappy
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;  // Slightly accelerated pace
    utterance.pitch = 0.90; // Slightly deeper, robotic timber
    
    // Attempt to locate a natural/robotic English voice if available
    const voices = window.speechSynthesis.getVoices();
    const desiredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'));
    if (desiredVoice) {
        utterance.voice = desiredVoice;
    }
    
    window.speechSynthesis.speak(utterance);
}

// Start perception hub
async function initPerceptionSystem() {
    try {
        addLog("Initializing Neural Networks...", "system");
        
        modelSubstatus.textContent = "Loading face recognition models...";
        await loadFaceModels();
        addLog("Face models loaded successfully.", "success");
        
        modelSubstatus.textContent = "Loading object classifier models...";
        await loadCocoSsdModel();
        addLog("Object models loaded successfully.", "success");
        
        modelSubstatus.textContent = "Initializing camera feeds...";
        await startWebcam(video, canvas, () => resizeCanvas(video, canvas));
        
        loadingOverlay.classList.add('fade-out');
        systemStatus.querySelector('.status-indicator').className = 'status-indicator green';
        systemStatus.querySelector('.status-text').textContent = 'Perception Active';
        
        isSystemReady = true;
        addLog(`System initialized. Mode: ${activeMode.toUpperCase()}`, "success");
        
        // Announce boot completion
        speakText("ARGUS perception hub active.");
        
        // Start loops
        requestAnimationFrame(renderLoop);
        faceDetectionLoop();
        objectDetectionLoop();
        
    } catch (err) {
        console.error(err);
        loadingText.textContent = "System Fault";
        modelSubstatus.textContent = err.message || "Camera access denied.";
        systemStatus.querySelector('.status-indicator').className = 'status-indicator red';
        systemStatus.querySelector('.status-text').textContent = 'Fault';
        addLog(`Boot error: ${err.message}`, "error");
    }
}

// 60 FPS Render loop
function renderLoop() {
    if (!isSystemReady) return;
    
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        fpsCounter.textContent = `FPS: ${fps}`;
        frameCount = 0;
        lastFpsUpdate = now;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw scanner line
    const scannerState = drawSweepingLaserLine(ctx, canvas.width, canvas.height, scannerY, scannerDirection);
    scannerY = scannerState.y;
    scannerDirection = scannerState.dir;
    
    // Draw objects overlays if enabled
    if (activeMode === 'dual' || activeMode === 'object') {
        drawCachedObjects(ctx, latestObjects);
    }
    
    // Draw face overlays if enabled
    if (activeMode === 'dual' || activeMode === 'face') {
        drawCachedFaces(ctx, latestFaces, matchedFaces);
    }
    
    requestAnimationFrame(renderLoop);
}

// Background Face Detection Loop
async function faceDetectionLoop() {
    if (!isSystemReady || isRegistering || activeMode === 'object') {
        latestFaces = [];
        setTimeout(faceDetectionLoop, 300);
        return;
    }
    
    try {
        const faces = await detectFaces(video, canvas);
        latestFaces = faces;
        
        // Match faces
        lastMatchTime = await processFaceMatching(
            latestFaces,
            isRegistering,
            lastMatchTime,
            MATCH_COOLDOWN_MS,
            IGNORE_COOLDOWN_MS,
            updateProfileUI,
            clearProfileUI,
            openRegisterModal,
            addLog,
            showToast,
            speakText // Pass voice synthesizer
        );
    } catch (err) {
        console.error("Face detection loop error:", err);
    }
    
    setTimeout(faceDetectionLoop, 150);
}

// Background Object Detection Loop
async function objectDetectionLoop() {
    if (!isSystemReady || activeMode === 'face') {
        latestObjects = [];
        setTimeout(objectDetectionLoop, 400);
        return;
    }
    
    try {
        const objects = await detectObjects(video);
        
        // Detect newly appeared objects to announce verbally
        const filtered = objects.filter(obj => obj.class !== 'person');
        filtered.forEach(obj => {
            const now = performance.now();
            if (!activeObjects[obj.class] || (now - activeObjects[obj.class].lastSeen > 5000)) {
                speakText(`Object sighted: ${obj.class}`);
            }
        });
        
        latestObjects = objects;
        
        // Update sidebar UI and logs
        processObjectUpdates(latestObjects, objectsPlaceholder, detectedObjectsList, activeObjects, addLog);
    } catch (err) {
        console.error("Object detection loop error:", err);
    }
    
    setTimeout(objectDetectionLoop, 250);
}

// Voice Toggle Handler
btnToggleVoice.addEventListener('click', () => {
    isVoiceEnabled = !isVoiceEnabled;
    if (isVoiceEnabled) {
        btnToggleVoice.classList.remove('muted');
        btnToggleVoice.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        addLog("Voice feedback module active.", "system");
        speakText("Voice response enabled");
    } else {
        btnToggleVoice.classList.add('muted');
        btnToggleVoice.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        window.speechSynthesis.cancel();
        addLog("Voice feedback module muted.", "system");
    }
});

// Mode Selection Handler
modeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget;
        const newMode = targetBtn.getAttribute('data-mode');
        if (newMode === activeMode) return;
        
        // Update UI classes
        modeButtons.forEach(b => b.classList.remove('active'));
        targetBtn.classList.add('active');
        
        activeMode = newMode;
        addLog(`System mode changed to: ${activeMode.toUpperCase()}`, "info");
        showToast(`Mode: ${activeMode.toUpperCase()}`, "info");
        speakText(`Switching to ${newMode} mode.`);
        
        // Cleanup UI displays
        if (activeMode === 'face') {
            latestObjects = [];
            objectsPlaceholder.classList.remove('hidden');
            detectedObjectsList.innerHTML = '';
        } else if (activeMode === 'object') {
            latestFaces = [];
            clearProfileUI();
        }
    });
});

// Modal Actions
function openRegisterModal(face) {
    isRegistering = true;
    currentUnrecognizedDescriptor = face.descriptor;
    
    matchStatusBadge.textContent = "Registering";
    matchStatusBadge.className = "badge match-badge registering";
    
    const { x, y, width, height } = face.detection.box;
    
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
    
    registerForm.reset();
    registerModal.classList.remove('hidden');
    addLog("Unregistered profile sighted. Commencing biometric scan.", "info");
}

function closeRegisterModal(addIgnore = true) {
    registerModal.classList.add('hidden');
    
    if (addIgnore && currentUnrecognizedDescriptor) {
        cacheIgnoredFace(currentUnrecognizedDescriptor);
        addLog("Biometric registration deferred.", "system");
    }
    
    currentUnrecognizedDescriptor = null;
    isRegistering = false;
    matchStatusBadge.textContent = "Scanning";
    matchStatusBadge.className = "badge match-badge";
}

btnCancelRegister.addEventListener('click', () => closeRegisterModal(true));
btnCloseModal.addEventListener('click', () => closeRegisterModal(true));

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
            const faceId = getFaceIdHash(currentUnrecognizedDescriptor);
            cacheMatchedFace(faceId, result.user, currentUnrecognizedDescriptor);
            
            addLog(`Biometric database updated for: ${name}`, "success");
            showToast(`Profile created for ${name}!`, "success");
            speakText(`Profile registered. Welcome, ${name}`);
            updateProfileUI(result.user);
            closeRegisterModal(false);
        } else {
            showToast(result.error || "Database error", "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Server connection error", "error");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.querySelector('.btn-text').textContent = "Register Biometric Profile";
    }
});

// Profile UI View handlers
function updateProfileUI(user) {
    placeholderProfile.classList.add('hidden');
    profileContent.classList.remove('hidden');
    
    matchStatusBadge.textContent = "Recognized";
    matchStatusBadge.className = "badge match-badge matched";
    
    document.getElementById('prof-name').textContent = user.name;
    document.getElementById('prof-bio').textContent = user.bio;
    document.getElementById('prof-mobile').textContent = user.mobile || '--';
    document.getElementById('prof-address').textContent = user.address || '--';
    
    const skillsList = user.skills.split(',').map(s => s.trim()).filter(Boolean);
    document.getElementById('prof-skills-short').textContent = skillsList[0] || 'Perception Target';
    
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
        skillsGroup.innerHTML = '<span class="tag">None</span>';
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
        hobbiesGroup.innerHTML = '<span class="tag">None</span>';
    }
}

function clearProfileUI() {
    placeholderProfile.classList.remove('hidden');
    profileContent.classList.add('hidden');
    matchStatusBadge.textContent = "Scanning";
    matchStatusBadge.className = "badge match-badge";
}

document.getElementById('clear-logs').addEventListener('click', () => {
    scanLogs.innerHTML = '';
});

window.addEventListener('resize', () => {
    if (isSystemReady) {
        resizeCanvas(video, canvas);
    }
});

// Ensure voices are pre-loaded in browser cache (Safari/Chrome support)
if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {};
}

window.addEventListener('load', initPerceptionSystem);
