import './modules/polyfillMSTP.js';
import './style.css'
import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import { initThree } from './modules/threeSetup.js';
const { scene, camera, renderer, controls } = initThree();


// --- Canvas & 3D setup ---
const slitCanvas = document.getElementById('slitCanvas');
const slitCtx = slitCanvas.getContext('2d');
const drawCanvas = document.getElementById('drawCanvas');
const drawCtx = drawCanvas.getContext('2d');


// --- UI toggle for drawing mode ---
const drawToggleBtn = document.getElementById('drawToggleBtn');
let isDrawingMode = false;
let cameraStarted = false;

function updateToggleBtn() {
  if (isDrawingMode) {
    drawToggleBtn.textContent = "Ok, Draw!";
    drawToggleBtn.style.background = "transparent";
  } else {
    drawToggleBtn.textContent = "+";
    drawToggleBtn.style.background = "#333";
  }
}

drawToggleBtn.addEventListener('click', async () => {
  if (!cameraStarted) {
    drawToggleBtn.textContent = "Camera Starting...";
    // Wait for the first frame to be processed.
    await startSlitScan();
    cameraStarted = true;
    // Set drawing mode on after initializing camera
    isDrawingMode = true;
    controls.enabled = false;
    drawCanvas.style.pointerEvents = 'auto';
    updateToggleBtn(); // This will set textContent to "Ok, Draw!" (or your desired text)
    return;
  } else {
    // Toggle drawing mode normally.
    isDrawingMode = !isDrawingMode;
    controls.enabled = !isDrawingMode;
    drawCanvas.style.pointerEvents = isDrawingMode ? 'auto' : 'none';
    updateToggleBtn();
  }
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

// function screenToWorld(x, y) {
//   const ndc = new THREE.Vector2(
//     (x / window.innerWidth) * 2 - 1,
//     -(y / window.innerHeight) * 2 + 1
//   );
//   const ray = new THREE.Raycaster();
//   ray.setFromCamera(ndc, camera);
//   const point = new THREE.Vector3();
//   ray.ray.at(8, point); // fixed Z depth
//   return point;
// }

function makeInitialW(numPoints = 80, width = 8, height = 5, z = 0) {
  // Create a 'W' using two sine waves, joined in the middle
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    // x goes from -width/2 to width/2
    const x = (i / (numPoints - 1) - 0.5) * width;
    // W shape: two valleys, one peak, smooth
    const phase = (i / (numPoints - 1));
    // Use two joined sine waves for a W-like curve
    const y =
      (Math.sin(phase * Math.PI * 2 * 2) * 0.6 + // Main "W" dips
        Math.sin(phase * Math.PI * 2) * 0.4) * height * 0.5;
    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
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

const initialW = makeInitialW();
buildRibbonFromPoints(initialW, 1.2);
lastRibbonBuildPoints = initialW.map(p => p.clone());
lastRibbonBuildWidth = 1.2;


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
  drawPoints.push(screenToWorld(x, y));
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}
function addDrawing(x, y) {
  drawPoints.push(screenToWorld(x, y));
  drawCtx.lineWidth = 2;
  drawCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  drawCtx.beginPath();
  for (let i = 0; i < drawPoints.length - 1; i++) {
    const a = drawPoints[i];
    const b = drawPoints[i + 1];
    const ax = (a.x / 10 + 0.5) * drawCanvas.width;
    const ay = (1 - (a.y / 10 + 0.5)) * drawCanvas.height;
    const bx = (b.x / 10 + 0.5) * drawCanvas.width;
    const by = (1 - (b.y / 10 + 0.5)) * drawCanvas.height;
    drawCtx.moveTo(ax, ay);
    drawCtx.lineTo(bx, by);
  }
  drawCtx.stroke();
}

function endDrawing() {
  if (drawPoints.length >= 2) {
    const smoothedPoints = smoothDrawnPoints(drawPoints, 150);
    buildRibbonFromPoints(smoothedPoints);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
  // Automatically exit drawing mode
  if (isDrawingMode) {
    isDrawingMode = false;
    controls.enabled = true;
    drawCanvas.style.pointerEvents = 'none';
    updateToggleBtn();
  }
}

function smoothDrawnPoints(points, numSamples = 100) {
  if (points.length < 2) return points;
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  // false = not closed, you can change to true if you want loops
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
    alert("Could not access camera: " + e);
    return;
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


const saveBtn = document.getElementById('saveBtn'); // Make sure you have this button in your HTML

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
  // maybe use the user's IP address as the name?

  // you need to include "names" as a parameter in the request body
  // https://gist.github.com/jarvisluong/8371f07e284eec66de9987c9ccedec43

  const uploadResponse = await fetch(`https://api.pcloud.com/uploadtolink?code=${code}&names=rivvon`, {
    method: 'POST',
    body: formData,
  });

  const uploadResult = await uploadResponse.json();
  console.log('Upload result:', uploadResult);
}