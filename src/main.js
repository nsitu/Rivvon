import './modules/polyfillMSTP.js';
import './style.css'
import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import { initThree } from './modules/threeSetup.js';
import { loadSvgPath, parseSvgContent, normalizePoints } from './modules/svgPathToPoints.js';
const { scene, camera, renderer, controls } = initThree();


// --- Canvas & 3D setup ---
const slitCanvas = document.getElementById('slitCanvas');
const slitCtx = slitCanvas.getContext('2d');
const drawCanvas = document.getElementById('drawCanvas');
const drawCtx = drawCanvas.getContext('2d');

// --- Welcome screen and app initialization ---
const welcomeScreen = document.getElementById('welcomeScreen');
const startAppBtn = document.getElementById('startAppBtn');

// Hide all app buttons initially until camera is started
document.getElementById('drawToggleBtn').style.display = 'none';
document.getElementById('saveBtn').style.display = 'none';
document.getElementById('importSvgBtn').style.display = 'none';

// Initialize app after user clicks start button
startAppBtn.addEventListener('click', async () => {
  startAppBtn.textContent = 'Starting camera...';
  startAppBtn.disabled = true;

  try {
    // Initialize camera
    await startSlitScan();

    // Hide welcome screen
    welcomeScreen.style.display = 'none';

    // Show app buttons
    document.getElementById('drawToggleBtn').style.display = 'block';
    document.getElementById('saveBtn').style.display = 'block';
    document.getElementById('importSvgBtn').style.display = 'block';

    // Initialize ribbon
    await initializeRibbon();
  } catch (error) {
    console.error('Error starting application:', error);
    startAppBtn.textContent = 'Failed to start camera. Try again?';
    startAppBtn.disabled = false;
  }
});

// --- UI toggle for drawing mode ---
const drawToggleBtn = document.getElementById('drawToggleBtn');
const checkerboardDiv = document.getElementById('checkerboard');
let isDrawingMode = false;

// Initially hide the checkerboard
checkerboardDiv.style.display = 'none';

function updateToggleBtn() {
  if (isDrawingMode) {
    drawToggleBtn.textContent = "Ok, Draw!";
    drawToggleBtn.style.background = "transparent";
    drawCanvas.style.pointerEvents = 'auto';

    // Show the checkerboard and draw canvas
    checkerboardDiv.style.display = 'block';


    // Hide 3D scene during drawing
    renderer.domElement.style.opacity = '0';

  } else {
    drawToggleBtn.textContent = "+";
    drawToggleBtn.style.background = "#333";
    drawCanvas.style.pointerEvents = 'none';

    // Hide the checkerboard
    checkerboardDiv.style.display = 'none';


    // Show 3D scene
    renderer.domElement.style.opacity = '1';

    // Clear drawing canvas
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
}

drawToggleBtn.addEventListener('click', () => {
  isDrawingMode = !isDrawingMode;
  controls.enabled = !isDrawingMode;
  updateToggleBtn();
});

updateToggleBtn();
drawCanvas.style.pointerEvents = 'none'; // Start with drawing OFF

let ribbonMesh = null;
let ribbonTexture = null;
let lastRibbonBuildPoints = [];
let lastRibbonBuildWidth = 1;

function screenToWorld(x, y, depthFromCamera = 5) {
  // Normalized Device Coordinates
  const ndc = new THREE.Vector2(
    (x / window.innerWidth) * 2 - 1,
    -(y / window.innerHeight) * 2 + 1
  );

  // Ray from camera through click/tap
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);

  // Find a point depthFromCamera units from camera, along the ray
  // (So, always in front of camera, no matter where it's pointed)
  const point = new THREE.Vector3();
  point.copy(camera.position).add(ray.ray.direction.multiplyScalar(depthFromCamera));
  return point;
}

// --- Ribbon builder with animated undulation ---
function buildRibbonFromPoints(points, width = 1, time = 0) {

  if (points.length < 2) return;

  // Store for animation loop
  lastRibbonBuildPoints = points.map(p => p.clone());
  lastRibbonBuildWidth = width;

  const curve = new THREE.Curve();
  curve.getPoint = t => {
    const i = t * (points.length - 1);
    const a = Math.floor(i);
    const b = Math.min(Math.ceil(i), points.length - 1);
    const p1 = points[a];
    const p2 = points[b];
    return new THREE.Vector3().lerpVectors(p1, p2, i - a);
  };
  curve.getTangent = t => {
    const delta = 0.001;
    const p1 = curve.getPoint(Math.max(t - delta, 0));
    const p2 = curve.getPoint(Math.min(t + delta, 1));
    return p2.clone().sub(p1).normalize();
  };

  const segments = 600;
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const indices = [];

  // --- Animation params ---
  const waveAmplitude = 0.2;
  const waveFrequency = 2;
  const waveSpeed = 2;


  let prevNormal = null;


  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPoint(t);

    const tangent = curve.getTangent(t).normalize();
    let normal = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();

    if (prevNormal) {
      // use lower lerp value for smoother transitions
      normal = prevNormal.clone().lerp(normal, 0.05).normalize();
    }
    prevNormal = normal.clone();

    // Animate phase:
    const phase = Math.sin(
      t * Math.PI * 2 * waveFrequency + time * waveSpeed
    ) * waveAmplitude;

    normal.applyAxisAngle(tangent, phase);

    const left = point.clone().addScaledVector(normal, -width / 2);
    const right = point.clone().addScaledVector(normal, width / 2);

    positions.push(left.x, left.y, left.z);
    positions.push(right.x, right.y, right.z);
    uvs.push(0, t);
    uvs.push(1, t);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  if (ribbonMesh) {
    // prevent memory leaks by removing old geometry and material
    if (ribbonMesh.geometry) ribbonMesh.geometry.dispose();
    if (ribbonMesh.material) ribbonMesh.material.dispose();
    scene.remove(ribbonMesh);
  }
  ribbonMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ map: ribbonTexture, side: THREE.DoubleSide })
  );
  scene.add(ribbonMesh);
}


async function initializeRibbon() {
  try {
    // Try to load the SVG path
    const svgPoints = await loadSvgPath('/R.svg', 80, 5, 0);

    if (svgPoints && svgPoints.length >= 2) {
      // Use the normalizePoints function to scale and center
      const normalizedPoints = normalizePoints(svgPoints);
      buildRibbonFromPoints(normalizedPoints, 1.2);
      lastRibbonBuildPoints = normalizedPoints.map(p => p.clone());
      lastRibbonBuildWidth = 1.2;
    } else {
      console.error("Could not extract points from the SVG file.");
    }
  } catch (error) {
    console.error("Error initializing ribbon from SVG:", error);
  }
}

function updateAnimatedRibbon(time) {
  if (lastRibbonBuildPoints.length >= 2) {
    // Only rebuild mesh if a valid path exists
    buildRibbonFromPoints(lastRibbonBuildPoints, lastRibbonBuildWidth, time);
  }
}

function resizeCanvas() {
  drawCanvas.width = window.innerWidth;
  drawCanvas.height = window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Drawing events (active only in draw mode) ---
const drawPoints = [];

function startDrawing(x, y) {
  drawPoints.length = 0;
  // Store 2D screen coordinates instead of 3D world points
  drawPoints.push({ x, y });
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function addDrawing(x, y) {
  drawPoints.push({ x, y });

  // Draw the line as visual feedback
  drawCtx.lineWidth = 2;
  drawCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  drawCtx.beginPath();
  for (let i = 0; i < drawPoints.length - 1; i++) {
    const a = drawPoints[i];
    const b = drawPoints[i + 1];
    drawCtx.moveTo(a.x, a.y);
    drawCtx.lineTo(b.x, b.y);
  }
  drawCtx.stroke();
}

function endDrawing() {
  if (drawPoints.length >= 2) {
    // Convert 2D screen points to normalized coordinates
    const normalizedPoints = normalizeDrawingPoints(drawPoints);

    // Create 3D points from normalized 2D points (all with same Z value)
    const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));

    // Apply same smoothing we use for SVG paths
    const smoothedPoints = smoothDrawnPoints(points3D, 150);

    // Build ribbon using the same approach as imported SVGs
    buildRibbonFromPoints(smoothedPoints);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }

  // Automatically exit drawing mode
  if (isDrawingMode) {
    isDrawingMode = false;
    controls.enabled = true;
    updateToggleBtn(); // This will handle hiding checkerboard and showing 3D scene
  }
}

// Convert screen space drawing points to normalized coordinates
function normalizeDrawingPoints(points) {
  if (points.length < 2) return points;

  // Find bounds of the drawing
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  points.forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  // Scale factor to normalize to [-4, 4] range (similar to imported SVGs)
  const maxDimension = Math.max(width, height);
  const scale = maxDimension > 0 ? 8 / maxDimension : 1;

  // Normalize points to center and scale
  return points.map(p => ({
    x: (p.x - centerX) * scale,
    y: (p.y - centerY) * scale * -1 // Flip Y axis to match THREE.js coordinates
  }));
}

// Modify smoothDrawnPoints to handle either 2D or 3D points
function smoothDrawnPoints(points, numSamples = 100) {
  if (points.length < 2) return points;

  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const smoothed = [];

  for (let i = 0; i < numSamples; i++) {
    smoothed.push(curve.getPoint(i / (numSamples - 1)));
  }

  return smoothed;
}

drawCanvas.addEventListener('pointerdown', e => {
  if (!isDrawingMode) return;
  startDrawing(e.clientX, e.clientY);
  drawCanvas.setPointerCapture(e.pointerId);
});
drawCanvas.addEventListener('pointermove', e => {
  if (!isDrawingMode) return;
  if (e.buttons === 1) addDrawing(e.clientX, e.clientY);
});
drawCanvas.addEventListener('pointerup', e => {
  if (!isDrawingMode) return;
  endDrawing();
});
drawCanvas.addEventListener('pointercancel', e => {
  if (!isDrawingMode) return;
  endDrawing();
});

// --- Slit-scan logic ---
const tryResolutions = async () => {
  const baseConstraints = { facingMode: { ideal: "environment" } };
  const resolutions = [
    { width: 160, height: 120 },
    { width: 320, height: 240 },
    { width: 640, height: 480 }
  ];
  for (const res of resolutions) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          ...baseConstraints,
          width: { exact: res.width },
          height: { exact: res.height }
        }
      });
    } catch { }
  }
  return navigator.mediaDevices.getUserMedia({ video: baseConstraints });
};

const startSlitScan = async () => {
  try {
    console.log("Starting slit-scan...");
    const stream = await tryResolutions();
    console.log("Camera stream started:", stream);
    const track = stream.getVideoTracks()[0];
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();

    const { value: firstFrame } = await reader.read();
    console.log("First frame received:", firstFrame);
    const videoWidth = firstFrame.displayWidth;
    const videoHeight = firstFrame.displayHeight;

    // Set canvas dimensions based on video and desired output.
    slitCanvas.width = videoWidth;
    slitCanvas.height = 512;

    // --- INITIAL GOLD GRADIENT ---
    const grad = slitCtx.createLinearGradient(0, 0, 0, slitCanvas.height);
    grad.addColorStop(0.0, "#ffe8a5");
    grad.addColorStop(0.4, "#ffd700");
    grad.addColorStop(0.6, "#c7a942");
    grad.addColorStop(1.0, "#7a6520");
    slitCtx.fillStyle = grad;
    slitCtx.fillRect(0, 0, slitCanvas.width, slitCanvas.height);

    let row = 0;

    const processFrame = async (frame) => {
      const bitmap = await createImageBitmap(frame);
      const tmp = new OffscreenCanvas(videoWidth, videoHeight);
      const tmpCtx = tmp.getContext('2d');
      tmpCtx.drawImage(bitmap, 0, 0);
      const midY = Math.floor(videoHeight / 2);
      const imageData = tmpCtx.getImageData(0, midY, videoWidth, 1);
      slitCtx.putImageData(imageData, 0, row);
      frame.close();
      row = (row + 1) % slitCanvas.height;
    };

    // Process the first frame and then immediately resolve so we know the camera is ready.
    await processFrame(firstFrame);

    // Setup texture and properties.
    ribbonTexture = new THREE.CanvasTexture(slitCanvas);
    ribbonTexture.wrapS = THREE.RepeatWrapping;
    ribbonTexture.wrapT = THREE.RepeatWrapping;
    ribbonTexture.minFilter = THREE.LinearFilter;
    ribbonTexture.center.set(0.5, 0.5);
    ribbonTexture.rotation = Math.PI;

    // Start processing subsequent frames (do not await so the promise can resolve).
    (async function animateSlit() {
      while (true) {
        const { done, value: frame } = await reader.read();
        if (done) break;
        await processFrame(frame);
        ribbonTexture.needsUpdate = true;
      }
    })();

    // Return once the first frame is ready.
    return;
  } catch (e) {
    console.error("Camera access error:", e);
    alert("Could not access camera: " + e);
    throw e; // Re-throw so we can handle in the welcome flow
  }
};

// --- Render Loop with animated ribbon ---
function renderLoop() {
  requestAnimationFrame(renderLoop);
  const time = performance.now() / 1000;
  updateAnimatedRibbon(time);
  controls.update();
  renderer.render(scene, camera);
}
renderLoop();

// Resource Cleanup
window.addEventListener('beforeunload', () => {
  const tracks = slitCanvas.srcObject?.getTracks?.();
  if (tracks) tracks.forEach(track => track.stop());
});


const saveBtn = document.getElementById('saveBtn');

if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    // Ensure the scene is rendered before capturing
    renderer.render(scene, camera);

    renderer.domElement.toBlob(async (blob) => {
      if (blob && blob.type && blob.type == 'image/png') {
        const file = new File([blob], `screenshot.png`, { type: 'image/png' });
        try {
          await uploadFileToPCloud(file);
          alert('Screenshot uploaded successfully!');
        } catch (error) {
          console.error('Error uploading screenshot:', error);
          alert('Failed to upload screenshot.');
        }
      } else {
        console.error('Failed to create blob from canvas.');
        alert('Failed to capture screenshot.');
      }
    }, 'image/png');
  });
}

async function uploadFileToPCloud(file) {
  console.log('Uploading file:', file);
  // Step 1: Get upload link code
  const response = await fetch('https://pcloud-upload-link.harold-b89.workers.dev/upload-link');
  const { code } = await response.json();

  console.log('Upload link code:', code);

  const formData = new FormData();
  formData.append('file', file, 'screenshot.png');

  const uploadResponse = await fetch(`https://api.pcloud.com/uploadtolink?code=${code}&names=rivvon`, {
    method: 'POST',
    body: formData,
  });

  const uploadResult = await uploadResponse.json();
  console.log('Upload result:', uploadResult);
}


// Add SVG import functionality
const importSvgBtn = document.getElementById('importSvgBtn');

if (importSvgBtn) {
  // Create a hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.svg';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  // Handle import button click
  importSvgBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // Handle file selection
  fileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      try {
        // Read the SVG file content
        const svgText = await file.text();

        // Use our shared parsing function
        const svgPoints = parseSvgContent(svgText, 80, 5, 0);

        if (svgPoints && svgPoints.length >= 2) {
          // Use the normalizePoints function to scale and center
          const normalizedPoints = normalizePoints(svgPoints);

          buildRibbonFromPoints(normalizedPoints, 1.2);
          lastRibbonBuildPoints = normalizedPoints.map(p => p.clone());
          lastRibbonBuildWidth = 1.2;
        } else {
          alert('Could not extract points from the SVG file.');
        }
      } catch (error) {
        console.error('Error processing SVG file:', error);
        alert('Error processing SVG file: ' + error.message);
      }
    }
  });
}