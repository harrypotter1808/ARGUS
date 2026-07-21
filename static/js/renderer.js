export function drawTargetCorners(ctx, x, y, width, height, color) {
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
    
    ctx.shadowBlur = 0;
}

export function drawFuturisticLandmarks(ctx, landmarks, color = '#00f2fe') {
    const pts = landmarks.positions;
    // Set wireframe opacity color based on matched state
    const rgbaColor = color === '#00f2fe' ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255, 140, 0, 0.25)';
    ctx.strokeStyle = rgbaColor;
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
    
    drawPath(0, 16);          // Jawline
    drawPath(17, 21);        // Left Eyebrow
    drawPath(22, 26);        // Right Eyebrow
    drawPath(27, 30);        // Nose Bridge
    drawPath(30, 35);        // Nose Bottom
    drawPath(36, 41, true);  // Left Eye
    drawPath(42, 47, true);  // Right Eye
    drawPath(48, 59, true);  // Outer lips
    drawPath(60, 67, true);  // Inner lips
    
    ctx.fillStyle = color === '#00f2fe' ? 'rgba(0, 242, 254, 0.75)' : 'rgba(255, 140, 0, 0.75)';
    ctx.shadowBlur = 3;
    ctx.shadowColor = color;
    pts.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, 2 * Math.PI);
        ctx.fill();
    });
    ctx.shadowBlur = 0;
}

export function drawSweepingLaserLine(ctx, width, height, y, dir) {
    let nextY = y + 3.0 * dir;
    let nextDir = dir;
    if (nextY >= height) {
        nextY = height;
        nextDir = -1;
    } else if (nextY <= 0) {
        nextY = 0;
        nextDir = 1;
    }
    
    const scanGradient = ctx.createLinearGradient(0, nextY - 5, 0, nextY + 5);
    scanGradient.addColorStop(0, 'rgba(0, 242, 254, 0)');
    scanGradient.addColorStop(0.5, 'rgba(0, 242, 254, 0.65)');
    scanGradient.addColorStop(1, 'rgba(0, 242, 254, 0)');
    ctx.fillStyle = scanGradient;
    ctx.fillRect(0, nextY - 5, width, 10);
    
    return { y: nextY, dir: nextDir };
}

export function drawCachedObjects(ctx, objects) {
    const filteredObjects = objects.filter(obj => obj.class !== 'person');
    
    filteredObjects.forEach(obj => {
        const [x, y, width, height] = obj.bbox;
        const magentaColor = '#ff007f';
        
        ctx.strokeStyle = 'rgba(255, 0, 127, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        
        drawTargetCorners(ctx, x, y, width, height, magentaColor);
        
        ctx.fillStyle = magentaColor;
        const label = `${obj.class} (${Math.round(obj.score * 100)}%)`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, y - 25 > 0 ? y - 25 : y, textWidth + 16, 25);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = "bold 13px 'Outfit', sans-serif";
        ctx.fillText(label, x + 8, y - 25 > 0 ? y - 8 : y + 17);
    });
}

export function drawCachedFaces(ctx, faces, matchedFaces) {
    faces.forEach(face => {
        const { x, y, width, height } = face.detection.box;
        
        let displayName = "Scanning Biometrics...";
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
        
        const isMatched = !!matchedItem;
        if (isMatched) {
            displayName = matchedItem.user.name;
        }
        
        // Color coding: Cyan for recognized, Amber for scanning/unidentified
        const primaryColor = isMatched ? '#00f2fe' : '#ff8c00';
        const borderAlphaColor = isMatched ? 'rgba(0, 242, 254, 0.12)' : 'rgba(255, 140, 0, 0.15)';
        const textFillColor = isMatched ? '#040814' : '#ffffff';
        
        drawFuturisticLandmarks(ctx, face.landmarks, primaryColor);
        
        ctx.strokeStyle = borderAlphaColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        
        drawTargetCorners(ctx, x, y, width, height, primaryColor);
        
        ctx.fillStyle = primaryColor;
        const textWidth = ctx.measureText(displayName).width;
        ctx.fillRect(x, y - 25 > 0 ? y - 25 : y, textWidth + 16, 25);
        
        ctx.fillStyle = textFillColor;
        ctx.font = "bold 13px 'Outfit', sans-serif";
        ctx.fillText(displayName, x + 8, y - 25 > 0 ? y - 8 : y + 17);
    });
}
