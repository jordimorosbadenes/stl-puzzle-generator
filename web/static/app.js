// Estado global
let puzzleData = {
    grid: null,
    pieces: null,
    solutions: [],
    currentSolutionIndex: -1,
    viewMode: 'isometric' // 'isometric' o '3d'
};

const PIECE_COLORS = [
    "#FF6666", "#FFCC66", "#99CC66", "#66CCCC", "#6699CC",
    "#CC99CC", "#FF99CC", "#CCCCCC", "#99CC99", "#CC6666",
    "#99CCCC", "#CC9966", "#66CC99", "#9966CC", "#9999CC",
    "#FF9966", "#FF6699", "#66FF99", "#99FFCC", "#FFCC99"
];

// Colores de sombra (versiones oscuras)
const SHADOW_COLORS = PIECE_COLORS.map(c => {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgb(${Math.max(0, r-50)}, ${Math.max(0, g-50)}, ${Math.max(0, b-50)})`;
});

// Canvas variables
const puzzleCanvas = document.getElementById('puzzle-canvas');
const galleryCanvas = document.getElementById('gallery-canvas');
const puzzleCtx = puzzleCanvas.getContext('2d');
const galleryCtx = galleryCanvas.getContext('2d');

// Event Listeners
document.getElementById('generate-btn').addEventListener('click', generatePuzzle);
document.getElementById('solve-10-btn').addEventListener('click', () => findSolutions(10));
document.getElementById('solve-50-btn').addEventListener('click', () => findSolutions(50));
document.getElementById('next-btn').addEventListener('click', nextSolution);
document.getElementById('prev-btn').addEventListener('click', prevSolution);
document.getElementById('original-btn').addEventListener('click', showOriginal);
const exportStlBtn = document.getElementById('export-stl-btn');
if (exportStlBtn) exportStlBtn.addEventListener('click', exportSTL);

// Utility Functions: separar estados de panel principal y visor 3D
function showMainStatus(message, type = 'info') {
    const mainStatus = document.getElementById('status');
    if (mainStatus) {
        mainStatus.textContent = message;
        mainStatus.className = `status ${type}`;
    }
    console.log(`[status-main:${type}]`, message);
}

function showViewerStatus(message, type = 'info') {
    const viewerStatus = document.getElementById('status-viewer');
    if (viewerStatus) {
        viewerStatus.textContent = message;
        viewerStatus.className = `status ${type}`;
    }
    console.log(`[status-viewer:${type}]`, message);
}

async function generatePuzzle() {
    try {
        showMainStatus('⏳ Generando puzzle...', 'info');
        
        // Animación de generación
        puzzleCtx.fillStyle = 'rgba(102, 126, 234, 0.1)';
        puzzleCtx.fillRect(0, 0, puzzleCanvas.width, puzzleCanvas.height);

        const M = parseInt(document.getElementById('M').value);
        const N = parseInt(document.getElementById('N').value);
        const min_size = parseInt(document.getElementById('min_size').value);
        const max_size = parseInt(document.getElementById('max_size').value);
        const border_prob = parseInt(document.getElementById('border_prob').value) / 100;
        const air_prob = parseInt(document.getElementById('air_prob').value) / 100;
        const mode = document.getElementById('mode').value;

        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                M, N, min_size, max_size, border_prob, air_prob, mode
            })
        });

        const data = await response.json();

        if (data.success) {
            puzzleData.grid = data.grid;
            puzzleData.pieces = data.pieces;
            puzzleData.solutions = [];
            puzzleData.currentSolutionIndex = -1;

            showMainStatus(`✅ ${data.piece_count} piezas generadas`, 'success');
            // Mantener la vista actual (isometric por defecto si es primera vez)
            if (puzzleData.viewMode === 'flat') {
                drawPuzzleFlat();
            } else {
                drawPuzzle();
            }
            drawGallery();
            updateSolutionInfo();
            // Actualizar visor 3D automáticamente
            if (typeof scheduleViewerUpdate === 'function') {
                scheduleViewerUpdate();
            }
        } else {
            showMainStatus(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showMainStatus(`❌ Error: ${error.message}`, 'error');
    }
}

async function findSolutions(max_solutions) {
    if (!puzzleData.grid || !puzzleData.pieces) {
        showMainStatus('⚠️ Primero genera un puzzle', 'error');
        return;
    }

    try {
        showMainStatus(`⏳ Buscando ${max_solutions} soluciones...`, 'info');

        const response = await fetch('/api/find_solutions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_solutions })
        });

        const data = await response.json();

        if (data.success) {
            showMainStatus(`✅ ${data.solutions_count} soluciones encontradas`, 'success');
            puzzleData.solutions = data.solutions_count;
            puzzleData.currentSolutionIndex = -1;
            updateSolutionInfo();
        } else {
            showMainStatus(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showMainStatus(`❌ Error: ${error.message}`, 'error');
    }
}

function nextSolution() {
    if (puzzleData.solutions === 0) return;
    if (puzzleData.currentSolutionIndex === -1) {
        puzzleData.currentSolutionIndex = 0;
    } else {
        puzzleData.currentSolutionIndex = (puzzleData.currentSolutionIndex + 1) % puzzleData.solutions;
    }
    updateSolutionInfo();
}

function prevSolution() {
    if (puzzleData.solutions === 0) return;
    if (puzzleData.currentSolutionIndex === -1) {
        puzzleData.currentSolutionIndex = puzzleData.solutions - 1;
    } else {
        puzzleData.currentSolutionIndex = (puzzleData.currentSolutionIndex - 1 + puzzleData.solutions) % puzzleData.solutions;
    }
    updateSolutionInfo();
}

function showOriginal() {
    puzzleData.currentSolutionIndex = -1;
    updateSolutionInfo();
}

function updateSolutionInfo() {
    const infoEl = document.getElementById('solution-info');
    if (puzzleData.currentSolutionIndex === -1) {
        infoEl.textContent = `Solución: 0 (Original) | Encontradas: ${puzzleData.solutions}`;
    } else {
        infoEl.textContent = `Solución: ${puzzleData.currentSolutionIndex + 1} | Encontradas: ${puzzleData.solutions}`;
    }
    // Dibujar respetando la vista actual
    if (puzzleData.viewMode === 'flat') {
        drawPuzzleFlat();
    } else {
        drawPuzzle();
    }
}

// Drawing Functions - VISUALIZACIÓN ISOMÉTRICA MEJORADA
function drawPuzzle() {
    if (!puzzleData.grid || !puzzleData.pieces) return;

    const grid = puzzleData.grid;
    const pieces = puzzleData.pieces;
    const M = grid.length;
    const N = grid[0].length;

    const w = puzzleCanvas.width;
    const h = puzzleCanvas.height;
    
    const cellSize = Math.min(
        2 * w / (N + M + 1),
        4 * h / (N + M + 1),
        180
    );

    // Clear canvas con gradiente de fondo
    const gradientBg = puzzleCtx.createLinearGradient(0, 0, w, h);
    gradientBg.addColorStop(0, '#f5f7fa');
    gradientBg.addColorStop(1, '#e9ecef');
    puzzleCtx.fillStyle = gradientBg;
    puzzleCtx.fillRect(0, 0, w, h);

    // Calcular bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let r = 0; r < M; r++) {
        for (let c = 0; c < N; c++) {
            const x = c * cellSize * 0.5 - r * cellSize * 0.5;
            const y = r * cellSize * 0.25 + c * cellSize * 0.25;
            
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x + cellSize);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y + cellSize);
        }
    }

    const puzzleWidth = maxX - minX;
    const puzzleHeight = maxY - minY;
    const offsetX = (w - puzzleWidth) / 2 - minX;
    const offsetY = (h - puzzleHeight) / 2 - minY;

    const isometricX = (row, col) => offsetX + col * cellSize * 0.5 - row * cellSize * 0.5;
    const isometricY = (row, col) => offsetY + row * cellSize * 0.25 + col * cellSize * 0.25;

    // Crear mapa de piezas
    let cellPieceMap = {};
    for (let r = 0; r < M; r++) {
        for (let c = 0; c < N; c++) {
            cellPieceMap[`${r},${c}`] = -1;
        }
    }

    for (let idx = 0; idx < pieces.length; idx++) {
        for (let cell of pieces[idx]) {
            cellPieceMap[`${cell[0]},${cell[1]}`] = idx;
        }
    }

    // Crear lista de todos los cubos a dibujar con su profundidad
    let cubosADibujar = [];

    // Agregar cubos de piezas
    for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx++) {
        const piece = pieces[pieceIdx];
        const color = PIECE_COLORS[pieceIdx % PIECE_COLORS.length];
        
        for (let cell of piece) {
            const r = cell[0];
            const c = cell[1];
            
            cubosADibujar.push({
                r, c,
                color,
                x: isometricX(r, c),
                y: isometricY(r, c),
                depth: r + c
            });
        }
    }

    // Agregar cubos especiales (borde, vacío)
    for (let r = 0; r < M; r++) {
        for (let c = 0; c < N; c++) {
            const pieceIdx = cellPieceMap[`${r},${c}`];
            
            if (pieceIdx === -1) {
                const val = grid[r][c];
                let color = '#e0e0e0';
                if (val === 0) color = '#333333';
                else if (val === -1) color = '#f0f0f0';
                
                cubosADibujar.push({
                    r, c,
                    color,
                    x: isometricX(r, c),
                    y: isometricY(r, c),
                    depth: r + c
                });
            }
        }
    }

    // Ordenar por profundidad (atrás a adelante)
    cubosADibujar.sort((a, b) => a.depth - b.depth);

    // Dibujar en orden de profundidad
    for (let cubo of cubosADibujar) {
        drawIsometricCubeSimple(cubo.x, cubo.y, cellSize, cubo.color);
    }
}

function drawIsometricCubeSimple(x, y, size, color, gaps = {}) {
    const s = size;

    // Sombra
    puzzleCtx.shadowColor = 'rgba(0,0,0,0.2)';
    puzzleCtx.shadowBlur = 5;
    puzzleCtx.shadowOffsetX = 1;
    puzzleCtx.shadowOffsetY = 1;

    // Cara superior
    const gradTop = puzzleCtx.createLinearGradient(
        x + s * 0.25, y,
        x + s * 0.25, y + s * 0.25
    );
    gradTop.addColorStop(0, color);
    gradTop.addColorStop(1, shadeColor(color, -10));
    puzzleCtx.fillStyle = gradTop;
    
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(x + s * 0.5, y);
    puzzleCtx.lineTo(x + s, y + s * 0.25);
    puzzleCtx.lineTo(x + s * 0.5, y + s * 0.5);
    puzzleCtx.lineTo(x, y + s * 0.25);
    puzzleCtx.closePath();
    puzzleCtx.fill();

    // Lado derecho
    const gradRight = puzzleCtx.createLinearGradient(
        x + s, y + s * 0.25,
        x + s * 0.5, y + s * 0.75
    );
    const rightColor = shadeColor(color, -25);
    gradRight.addColorStop(0, shadeColor(rightColor, 5));
    gradRight.addColorStop(1, rightColor);
    puzzleCtx.fillStyle = gradRight;
    
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(x + s, y + s * 0.25);
    puzzleCtx.lineTo(x + s, y + s * 0.75);
    puzzleCtx.lineTo(x + s * 0.5, y + s);
    puzzleCtx.lineTo(x + s * 0.5, y + s * 0.5);
    puzzleCtx.closePath();
    puzzleCtx.fill();

    // Lado izquierdo
    const gradLeft = puzzleCtx.createLinearGradient(
        x, y + s * 0.25,
        x + s * 0.5, y + s * 0.75
    );
    const leftColor = shadeColor(color, -35);
    gradLeft.addColorStop(0, shadeColor(leftColor, 5));
    gradLeft.addColorStop(1, leftColor);
    puzzleCtx.fillStyle = gradLeft;
    
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(x, y + s * 0.25);
    puzzleCtx.lineTo(x, y + s * 0.75);
    puzzleCtx.lineTo(x + s * 0.5, y + s);
    puzzleCtx.lineTo(x + s * 0.5, y + s * 0.5);
    puzzleCtx.closePath();
    puzzleCtx.fill();

    puzzleCtx.shadowColor = 'transparent';
}

function drawIsometricCell(x, y, size, cellValue, pieceIdx, gaps = {}) {
    const s = size;
    const gap = 2;
    
    // Color base
    let color = '#e0e0e0';
    if (cellValue === 0) {
        color = '#333333';
    } else if (cellValue === -1) {
        color = '#f0f0f0';
    } else if (pieceIdx >= 0) {
        color = PIECE_COLORS[pieceIdx % PIECE_COLORS.length];
    }

    // Aplicar separación solo en los bordes indicados
    const adjustedX = x + (gaps.gapLeft ? gap / 2 : 0);
    const adjustedY = y + (gaps.gapTop ? gap / 2 : 0);
    
    // Calcular tamaño ajustado según separaciones
    let adjustedS = s;
    if (gaps.gapLeft) adjustedS -= gap / 2;
    if (gaps.gapRight) adjustedS -= gap / 2;

    // Sombra suave
    puzzleCtx.shadowColor = 'rgba(0,0,0,0.25)';
    puzzleCtx.shadowBlur = 6;
    puzzleCtx.shadowOffsetX = 1;
    puzzleCtx.shadowOffsetY = 1;

    // Cara superior con gradiente
    const gradTop = puzzleCtx.createLinearGradient(
        adjustedX + adjustedS * 0.25, adjustedY,
        adjustedX + adjustedS * 0.25, adjustedY + adjustedS * 0.25
    );
    gradTop.addColorStop(0, color);
    gradTop.addColorStop(1, shadeColor(color, -15));
    puzzleCtx.fillStyle = gradTop;
    
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(adjustedX + adjustedS * 0.5, adjustedY);
    puzzleCtx.lineTo(adjustedX + adjustedS, adjustedY + adjustedS * 0.25);
    puzzleCtx.lineTo(adjustedX + adjustedS * 0.5, adjustedY + adjustedS * 0.5);
    puzzleCtx.lineTo(adjustedX, adjustedY + adjustedS * 0.25);
    puzzleCtx.closePath();
    puzzleCtx.fill();
    
    // Borde sutil
    puzzleCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    puzzleCtx.lineWidth = 1;
    puzzleCtx.stroke();

    // Lado derecho con gradiente
    const gradRight = puzzleCtx.createLinearGradient(
        adjustedX + adjustedS, adjustedY + adjustedS * 0.25,
        adjustedX + adjustedS * 0.5, adjustedY + adjustedS * 0.75
    );
    const rightColor = shadeColor(color, -25);
    gradRight.addColorStop(0, shadeColor(rightColor, 10));
    gradRight.addColorStop(1, rightColor);
    puzzleCtx.fillStyle = gradRight;
    
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(adjustedX + adjustedS, adjustedY + adjustedS * 0.25);
    puzzleCtx.lineTo(adjustedX + adjustedS, adjustedY + adjustedS * 0.75);
    puzzleCtx.lineTo(adjustedX + adjustedS * 0.5, adjustedY + adjustedS);
    puzzleCtx.lineTo(adjustedX + adjustedS * 0.5, adjustedY + adjustedS * 0.5);
    puzzleCtx.closePath();
    puzzleCtx.fill();
    
    puzzleCtx.strokeStyle = 'rgba(0,0,0,0.15)';
    puzzleCtx.lineWidth = 0.8;
    puzzleCtx.stroke();

    // Lado izquierdo con gradiente
    const gradLeft = puzzleCtx.createLinearGradient(
        adjustedX, adjustedY + adjustedS * 0.25,
        adjustedX + adjustedS * 0.5, adjustedY + adjustedS * 0.75
    );
    const leftColor = shadeColor(color, -40);
    gradLeft.addColorStop(0, shadeColor(leftColor, 10));
    gradLeft.addColorStop(1, leftColor);
    puzzleCtx.fillStyle = gradLeft;
    
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(adjustedX, adjustedY + adjustedS * 0.25);
    puzzleCtx.lineTo(adjustedX, adjustedY + adjustedS * 0.75);
    puzzleCtx.lineTo(adjustedX + adjustedS * 0.5, adjustedY + adjustedS);
    puzzleCtx.lineTo(adjustedX + adjustedS * 0.5, adjustedY + adjustedS * 0.5);
    puzzleCtx.closePath();
    puzzleCtx.fill();
    
    puzzleCtx.strokeStyle = 'rgba(0,0,0,0.2)';
    puzzleCtx.lineWidth = 0.8;
    puzzleCtx.stroke();

    puzzleCtx.shadowColor = 'transparent';
    puzzleCtx.shadowOffsetX = 0;
    puzzleCtx.shadowOffsetY = 0;

    // Número de pieza (solo si es válido)
    if (cellValue > 0 && pieceIdx >= 0) {
        puzzleCtx.fillStyle = 'white';
        puzzleCtx.font = 'bold 12px Arial';
        puzzleCtx.textAlign = 'center';
        puzzleCtx.textBaseline = 'middle';
        puzzleCtx.shadowColor = 'rgba(0,0,0,0.5)';
        puzzleCtx.shadowBlur = 3;
        puzzleCtx.fillText(String(pieceIdx + 1), adjustedX + adjustedS * 0.5, adjustedY + adjustedS * 0.25);
        puzzleCtx.shadowColor = 'transparent';
    }
}

function shadeColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255))
        .toString(16).slice(1);
}

function drawGallery() {
    if (!puzzleData.pieces) return;

    const pieces = puzzleData.pieces;
    const w = galleryCanvas.width;
    const h = galleryCanvas.height;

    // Fondo con gradiente
    const gradientBg = galleryCtx.createLinearGradient(0, 0, w, h);
    gradientBg.addColorStop(0, '#f5f7fa');
    gradientBg.addColorStop(1, '#e9ecef');
    galleryCtx.fillStyle = gradientBg;
    galleryCtx.fillRect(0, 0, w, h);

    // Calcular mejor distribución: grid adaptativo
    const padding = 10;
    const usableW = w - padding * 2;
    const usableH = h - padding * 2;
    
    // Calcular tamaño de celda de la pieza
    let cellScale = 20; // escala de cada cuadrito pequeño
    let cols = Math.max(3, Math.floor(Math.sqrt(pieces.length)));
    
    // Ajustar si hay demasiadas columnas
    while (cols > 1) {
        const boxWidth = cellScale * 4 + 16; // espacio aprox por pieza
        if (cols * boxWidth <= usableW) break;
        cols--;
    }
    
    const boxSize = usableW / cols;
    const boxPadding = 8;
    const innerSize = boxSize - boxPadding * 2;

    for (let idx = 0; idx < pieces.length; idx++) {
        const piece = pieces[idx];
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        
        const boxX = padding + col * boxSize;
        const boxY = padding + row * boxSize;

        // Calcular dimensiones de la pieza
        const minR = Math.min(...piece.map(cell => cell[0]));
        const minC = Math.min(...piece.map(cell => cell[1]));
        const maxR = Math.max(...piece.map(cell => cell[0]));
        const maxC = Math.max(...piece.map(cell => cell[1]));
        
        const pieceHeight = maxR - minR + 1;
        const pieceWidth = maxC - minC + 1;
        
        // Escalar la pieza para que quepa en la caja
        const scaleToFit = Math.min(
            innerSize / (pieceWidth * cellScale + 4),
            innerSize / (pieceHeight * cellScale + 4)
        );
        const scaledCellSize = cellScale * scaleToFit;

        // Centro de la caja
        const totalPieceW = pieceWidth * scaledCellSize;
        const totalPieceH = pieceHeight * scaledCellSize;
        const offsetX = boxX + boxPadding + (innerSize - totalPieceW) / 2;
        const offsetY = boxY + boxPadding + (innerSize - totalPieceH) / 2;

        // Color de la pieza
        const color = PIECE_COLORS[idx % PIECE_COLORS.length];

        // Dibujar fondo redondeado de la pieza
        galleryCtx.fillStyle = 'rgba(255,255,255,0.7)';
        galleryCtx.shadowColor = 'rgba(0,0,0,0.2)';
        galleryCtx.shadowBlur = 6;
        galleryCtx.shadowOffsetX = 2;
        galleryCtx.shadowOffsetY = 2;
        drawRoundedRect(galleryCtx, boxX + 2, boxY + 2, boxSize - 4, boxSize - 4, 8, true);
        galleryCtx.shadowColor = 'transparent';
        galleryCtx.shadowOffsetX = 0;
        galleryCtx.shadowOffsetY = 0;

        // Dibujar celdas de la pieza con colores
        for (let cell of piece) {
            const r = cell[0] - minR;
            const c = cell[1] - minC;
            const x = offsetX + c * scaledCellSize;
            const y = offsetY + r * scaledCellSize;

            // Gradiente para cada celda
            const gradient = galleryCtx.createLinearGradient(x, y, x, y + scaledCellSize);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, shadeColor(color, -20));
            
            galleryCtx.fillStyle = gradient;
            drawRoundedRect(galleryCtx, x, y, scaledCellSize, scaledCellSize, 2, true);
            
            // Borde
            galleryCtx.strokeStyle = 'rgba(0,0,0,0.15)';
            galleryCtx.lineWidth = 0.8;
            drawRoundedRect(galleryCtx, x, y, scaledCellSize, scaledCellSize, 2, false, true);
        }

        // Número de pieza en esquina superior derecha
        galleryCtx.fillStyle = color;
        galleryCtx.font = 'bold 12px Arial';
        galleryCtx.textAlign = 'center';
        galleryCtx.textBaseline = 'middle';
        
        // Fondo circular para el número
        const numX = boxX + boxSize - 12;
        const numY = boxY + 12;
        galleryCtx.beginPath();
        galleryCtx.arc(numX, numY, 10, 0, Math.PI * 2);
        galleryCtx.fillStyle = color;
        galleryCtx.fill();
        
        galleryCtx.fillStyle = 'white';
        galleryCtx.font = 'bold 11px Arial';
        galleryCtx.fillText(String(idx + 1), numX, numY);
    }
}

function drawRoundedRect(ctx, x, y, width, height, radius, fill = false, stroke = false) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    
    if (fill !== false) ctx.fill();
    if (stroke) ctx.stroke();
}

function drawFlatCellWithGaps(x, y, size, gaps) {
    const gap = 2;
    let x1 = x + (gaps.gapLeft ? gap : 0);
    let y1 = y + (gaps.gapTop ? gap : 0);
    let w = size - (gaps.gapLeft ? gap : 0) - (gaps.gapRight ? gap : 0);
    let h = size - (gaps.gapTop ? gap : 0) - (gaps.gapBottom ? gap : 0);
    
    drawRoundedRect(puzzleCtx, x1, y1, w, h, 3, true);
}

function drawFlatCellPiece(x, y, cellSize, color, r, c, M, N, cellPieceMap, pieceIdx) {
    // Sombra
    puzzleCtx.shadowColor = 'rgba(0,0,0,0.2)';
    puzzleCtx.shadowBlur = 5;
    puzzleCtx.shadowOffsetX = 1;
    puzzleCtx.shadowOffsetY = 1;

    // Gradiente
    const gradient = puzzleCtx.createLinearGradient(x, y, x, y + cellSize);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, shadeColor(color, -15));
    puzzleCtx.fillStyle = gradient;
    
    puzzleCtx.fillRect(x, y, cellSize, cellSize);

    puzzleCtx.shadowColor = 'transparent';
}

function drawFlatCellPlain(x, y, cellSize, color) {
    // Sombra
    puzzleCtx.shadowColor = 'rgba(0,0,0,0.2)';
    puzzleCtx.shadowBlur = 5;
    puzzleCtx.shadowOffsetX = 1;
    puzzleCtx.shadowOffsetY = 1;

    // Gradiente
    const gradient = puzzleCtx.createLinearGradient(x, y, x, y + cellSize);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, shadeColor(color, -15));
    puzzleCtx.fillStyle = gradient;
    
    puzzleCtx.fillRect(x, y, cellSize, cellSize);

    puzzleCtx.shadowColor = 'transparent';
}

async function exportSTL() {
    if (!puzzleData.grid || !puzzleData.pieces) {
        showViewerStatus('⚠️ Primero genera un puzzle', 'error');
        return;
    }

    try {
        showViewerStatus('⏳ Generando STL (base + piezas)...', 'info');

        const payload = {
            cube_size: parseFloat(document.getElementById('stl_cube_size').value),
            height: parseFloat(document.getElementById('stl_height').value),
            gap_mm: parseFloat(document.getElementById('stl_gap').value),
            tolerance_mm: parseFloat(document.getElementById('stl_tolerance').value),
            border: parseFloat(document.getElementById('stl_border').value),
            base_thickness: parseFloat(document.getElementById('stl_base_thickness').value),
            wall_height: parseFloat(document.getElementById('stl_wall_height').value)
        };

        const response = await fetch('/api/export_stl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'puzzle_project.stl';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showViewerStatus('✅ STL descargado (base + piezas)', 'success');
        } else {
            const errorData = await response.json();
            showViewerStatus(`❌ Error: ${errorData.error}`, 'error');
        }
    } catch (error) {
        showViewerStatus(`❌ Error: ${error.message}`, 'error');
    }
}

async function viewSTL() {
    try {
        showViewerStatus('⏳ Generando y cargando STL en el visor...', 'info');
        const payload = {
            cube_size: parseFloat(document.getElementById('stl_cube_size').value),
            height: parseFloat(document.getElementById('stl_height').value),
            gap_mm: parseFloat(document.getElementById('stl_gap').value),
            tolerance_mm: parseFloat(document.getElementById('stl_tolerance').value),
            border: parseFloat(document.getElementById('stl_border').value),
            base_thickness: parseFloat(document.getElementById('stl_base_thickness').value),
            wall_height: parseFloat(document.getElementById('stl_wall_height').value)
        };

        const response = await fetch('/api/export_stl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            showViewerStatus(`❌ Error: ${errorData.error}`, 'error');
            return;
        }

        const blob = await response.blob();

        if (!threeScene) init3DViewer();
        if (!threeGroup) {
            showViewerStatus('❌ Visor 3D no inicializado', 'error');
            return;
        }

        if (typeof THREE.STLLoader !== 'function') {
            console.error('STLLoader no disponible');
            showViewerStatus('❌ STLLoader no disponible. Revisa scripts.', 'error');
            return;
        }

        const loader = new THREE.STLLoader();
        const url = window.URL.createObjectURL(blob);
        try {
            const geometry = await loader.loadAsync(url);
            // Centrar geometría en el origen
            try { geometry.center(); } catch (e) { /* r128 soporta center(); ignorar si no */ }
            try { geometry.computeVertexNormals(); } catch (e) {}
            window.URL.revokeObjectURL(url);
            // Guardar estado de cámara y target antes de reemplazar malla
            const prevCamPos = threeCamera ? threeCamera.position.clone() : null;
            const prevTarget = window._threeControls ? window._threeControls.target.clone() : null;

            while (threeGroup.children.length) threeGroup.remove(threeGroup.children[0]);
            const material = new THREE.MeshStandardMaterial({ color: 0x6699cc, metalness: 0.2, roughness: 0.7 });
            const mesh = new THREE.Mesh(geometry, material);
            // z-up conversion
            mesh.rotation.set(-Math.PI / 2, 0, 0);
            // Sin sombras para una iluminación más simple
            threeGroup.add(mesh);

            if (!viewerHasModel) {
                frameCameraTo(threeGroup);
                viewerHasModel = true;
            } else {
                // Restaurar cámara y target para mantener vista
                if (prevCamPos) threeCamera.position.copy(prevCamPos);
                if (prevTarget && window._threeControls) window._threeControls.target.copy(prevTarget);
            }
            showViewerStatus('✅ STL cargado en visor', 'success');
        } catch (err) {
            window.URL.revokeObjectURL(url);
            console.error('Error cargando STL:', err);
            showViewerStatus(`❌ Error cargando STL en visor: ${err}`, 'error');
        }
    } catch (error) {
        showViewerStatus(`❌ Error: ${error.message}`, 'error');
    }
}

// Cambiar modo de visualización
function switchView(event, mode) {
    event.preventDefault();
    puzzleData.viewMode = mode;
    
    // Actualizar botones
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Activar el botón clickeado
    event.target.classList.add('active');
    
    // Redibujar con la nueva vista
    if (mode === 'flat') {
        drawPuzzleFlat();
    } else {
        drawPuzzle();
    }
}

// Vista plana (original)
function drawPuzzleFlat() {
    if (!puzzleData.grid || !puzzleData.pieces) return;

    const grid = puzzleData.grid;
    const pieces = puzzleData.pieces;
    const M = grid.length;
    const N = grid[0].length;
    const w = puzzleCanvas.width;
    const h = puzzleCanvas.height;
    const cellSize = Math.min(w / N, h / M, 80);
    const offsetX = (w - cellSize * N) / 2;
    const offsetY = (h - cellSize * M) / 2;

    // Clear canvas
    const gradientBg = puzzleCtx.createLinearGradient(0, 0, w, h);
    gradientBg.addColorStop(0, '#f5f7fa');
    gradientBg.addColorStop(1, '#e9ecef');
    puzzleCtx.fillStyle = gradientBg;
    puzzleCtx.fillRect(0, 0, w, h);

    // Crear mapa de piezas
    let cellPieceMap = {};
    for (let r = 0; r < M; r++) {
        for (let c = 0; c < N; c++) {
            cellPieceMap[`${r},${c}`] = -1;
        }
    }

    for (let idx = 0; idx < pieces.length; idx++) {
        for (let cell of pieces[idx]) {
            cellPieceMap[`${cell[0]},${cell[1]}`] = idx;
        }
    }

    // Dibujar por piezas
    for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx++) {
        const piece = pieces[pieceIdx];
        const color = PIECE_COLORS[pieceIdx % PIECE_COLORS.length];
        
        for (let cell of piece) {
            const r = cell[0];
            const c = cell[1];
            
            const x = offsetX + c * cellSize;
            const y = offsetY + r * cellSize;

            drawFlatCellPiece(x, y, cellSize, color, r, c, M, N, cellPieceMap, pieceIdx);
        }
    }

    // Dibujar celdas especiales
    for (let r = 0; r < M; r++) {
        for (let c = 0; c < N; c++) {
            const val = grid[r][c];
            const pieceIdx = cellPieceMap[`${r},${c}`];
            
            if (val === 0 || val === -1 || pieceIdx === -1) {
                const x = offsetX + c * cellSize;
                const y = offsetY + r * cellSize;
                
                let color = '#EEEEEE';
                if (val === 0) color = '#555555';
                else if (val === -1) color = '#f0f0f0';

                drawFlatCellPlain(x, y, cellSize, color);
            }
        }
    }
}

// Initial state
updateSolutionInfo();

// -----------------------------
// 3D Viewer (Three.js)
// -----------------------------
let threeScene = null;
let threeRenderer = null;
let threeCamera = null;
let threeGroup = null;
let threeGrid = null;
let viewerHasModel = false;
let stlUpdateTimer = null;

// (enhanceNumberInputs eliminado)

function init3DViewer() {
    const container = document.getElementById('viewer-3d');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setSize(rect.width, rect.height);
    threeRenderer.setPixelRatio(window.devicePixelRatio || 1);
    threeRenderer.setClearColor(0xf5f7fa);
    container.innerHTML = '';
    container.appendChild(threeRenderer.domElement);

    threeScene = new THREE.Scene();
    threeCamera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 10000);
    // Ángulo original sencillo
    threeCamera.position.set(200, 200, 400);
    threeCamera.lookAt(0, 0, 0);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 1, 1);
    threeScene.add(dir);
    threeScene.add(new THREE.AmbientLight(0x666666));

    threeGroup = new THREE.Group();
    threeScene.add(threeGroup);

    // Iluminación simple, sin plano de suelo

    // Sin grid: vista limpia centrada en el modelo

    // Orbit controls for interaction
    try {
        const controls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 10;
        controls.maxDistance = 5000;
        window._threeControls = controls;
    } catch (e) {
        console.warn('OrbitControls no disponible:', e);
    }

    window.addEventListener('resize', () => {
        if (!threeRenderer) return;
        const r = container.getBoundingClientRect();
        threeRenderer.setSize(r.width, r.height);
        threeCamera.aspect = r.width / r.height;
        threeCamera.updateProjectionMatrix();
    });

    (function animate() {
        requestAnimationFrame(animate);
        if (window._threeControls) window._threeControls.update();
        threeRenderer.render(threeScene, threeCamera);
    })();

    showViewerStatus('🎥 Visor 3D inicializado', 'info');
}

function addAxesHelper(size = 100) {
    if (!threeGroup) return;
    const axes = new THREE.AxesHelper(size);
    threeGroup.add(axes);
}

function addTestCube() {
    if (!threeGroup) return;
    const geom = new THREE.BoxGeometry(50, 20, 50);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00aaee, metalness: 0.2, roughness: 0.7 });
    const cube = new THREE.Mesh(geom, mat);
    cube.position.set(0, -10, 0);
    threeGroup.add(cube);
}

function frameCameraTo(targetObject) {
    if (!targetObject || !threeCamera) return;
    const box = new THREE.Box3().setFromObject(targetObject);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0 || !isFinite(maxDim)) return;
    const fov = threeCamera.fov * Math.PI / 180;
    let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
    cameraZ *= 1.02; // más ajustado para llenar visor
    // Mantener ángulo original: dirección (200,200,400) normalizada
    const dir = new THREE.Vector3(200, 200, -200).normalize();
    const pos = center.clone().add(dir.multiplyScalar(cameraZ));
    threeCamera.position.copy(pos);
    threeCamera.lookAt(center);
    if (window._threeControls) window._threeControls.target.copy(center);
}

// Actualizar visor automáticamente cuando cambian parámetros STL
function scheduleViewerUpdate() {
    if (stlUpdateTimer) clearTimeout(stlUpdateTimer);
    stlUpdateTimer = setTimeout(() => {
        viewSTL();
    }, 300);
}

const cubeInput = document.getElementById('stl_cube_size');
const heightInput = document.getElementById('stl_height');
const gapInput = document.getElementById('stl_gap');
const tolInput = document.getElementById('stl_tolerance');
const borderInput = document.getElementById('stl_border');
const baseThkInput = document.getElementById('stl_base_thickness');
const wallHInput = document.getElementById('stl_wall_height');

[cubeInput, heightInput, gapInput, tolInput, borderInput, baseThkInput, wallHInput].forEach(inp => {
    if (inp) {
        inp.addEventListener('input', scheduleViewerUpdate);
        inp.addEventListener('change', scheduleViewerUpdate);
    }
});

// Inicializar al cargar
window.addEventListener('load', () => {
    setTimeout(() => {
        if (document.getElementById('viewer-3d')) init3DViewer();
    }, 200);
});

// Actualización automática tras generación de puzzle
const generateBtn = document.getElementById('generate-btn');
if (generateBtn) {
    generateBtn.addEventListener('click', () => {
        // Programar refresco del visor tras generar el puzzle
        setTimeout(scheduleViewerUpdate, 500);
    });
}
