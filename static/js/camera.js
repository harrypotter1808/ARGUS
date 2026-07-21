export async function startWebcam(videoElement, canvasElement, resizeCallback) {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false
    });
    videoElement.srcObject = stream;
    
    return new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
            videoElement.play();
            resizeCallback();
            resolve();
        };
    });
}

export function resizeCanvas(videoElement, canvasElement) {
    const rect = videoElement.getBoundingClientRect();
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;
    canvasElement.style.width = `${rect.width}px`;
    canvasElement.style.height = `${rect.height}px`;
}
