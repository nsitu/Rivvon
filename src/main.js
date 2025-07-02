import './modules/polyfillMSTP.js';
import './style.css'
import { initThree } from './modules/threeSetup.js';
import {
  importSvgBtn, drawToggleBtn, viewToggleBtn, saveBtn, startAppBtn,
  fileInput,
  checkerboardDiv,
  welcomeScreen, drawCanvas
} from './modules/domElements.js';
import { loadSvgPath, parseSvgContent, normalizePoints } from './modules/svgPathToPoints.js';
import { SlitScanner } from './modules/slitScan.js';
import { Ribbon } from './modules/ribbon.js';
import { ScreenshotManager } from './modules/screenshot.js';
import { DrawingManager } from './modules/drawing.js';

const { scene, camera, renderer, controls, resetCamera } = initThree();

// Create screenshot manager instance
let screenshotManager;
let isDrawingMode = false;
let ribbonTexture = null;
let ribbon = null;
let drawingManager;

// Initialize app after user clicks start button
startAppBtn.addEventListener('click', async () => {
  startAppBtn.textContent = 'Starting camera...';
  startAppBtn.disabled = true;

  try {
    // Initialize camera
    await startSlitScan();
    // Hide welcome screen
    welcomeScreen.style.display = 'none';
    // Show app buttons by adding a class to body
    document.body.classList.add('app-active');
    // Initialize ribbon
    await initializeRibbon();
    // Initialize screenshot manager
    screenshotManager = new ScreenshotManager(renderer, scene, camera);
    // Initialize drawing manager
    drawingManager = new DrawingManager(drawCanvas, handleDrawingComplete);
  } catch (error) {
    console.error('Error starting application:', error);
    startAppBtn.textContent = 'Failed to start camera. Try again?';
    startAppBtn.disabled = false;
  }
});

// --- UI toggle for drawing mode ---
function setDrawingMode(enableDrawing) {
  // Update the mode state
  isDrawingMode = enableDrawing;
  // Enable/disable orbit controls
  controls.enabled = !enableDrawing;
  // Configure drawing canvas interaction
  drawingManager?.setActive(enableDrawing);
  // Show/hide UI elements
  checkerboardDiv.style.display = enableDrawing ? 'block' : 'none';
  renderer.domElement.style.opacity = enableDrawing ? '0' : '1';
  // Update button styles
  drawToggleBtn.classList.toggle('active-mode', enableDrawing);
  viewToggleBtn.classList.toggle('active-mode', !enableDrawing);
}

drawToggleBtn.addEventListener('click', () => setDrawingMode(true));
viewToggleBtn.addEventListener('click', () => setDrawingMode(false));

// Set initial state to view mode
setDrawingMode(false);

// --- Ribbon builder with animated undulation ---
function updateAnimatedRibbon(time) {
  if (ribbon) {
    ribbon.update(time);
  }
}

async function initializeRibbon() {
  try {
    // Create the ribbon instance
    ribbon = new Ribbon(scene);
    // Set the texture from slit scan
    ribbon.setTexture(ribbonTexture);
    // Try to load the SVG path
    const svgPoints = await loadSvgPath('/R.svg', 80, 5, 0);
    if (svgPoints && svgPoints.length >= 2) {
      // Use the normalizePoints function to scale and center
      const normalizedPoints = normalizePoints(svgPoints);
      // Reset camera before building the initial ribbon
      resetCamera();
      ribbon.buildFromPoints(normalizedPoints, 1.2);
    } else {
      console.error("Could not extract points from the SVG file.");
    }
  } catch (error) {
    console.error("Error initializing ribbon from SVG:", error);
  }
}

function resizeCanvas() {
  if (drawingManager) {
    drawingManager.resize(window.innerWidth, window.innerHeight);
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Drawing callback ---
function handleDrawingComplete(points) {
  if (points.length >= 2) {
    // Reset camera before building the new ribbon
    resetCamera();

    // Use the ribbon module to create from drawing points
    ribbon.createRibbonFromDrawing(points);
  }

  // Automatically exit drawing mode
  if (isDrawingMode) {
    setDrawingMode(false);
  }
}

// Create a reference to hold the scanner
let slitScanner = null;

// Replace the startSlitScan function with this:
const startSlitScan = async () => {
  try {
    slitScanner = new SlitScanner();
    ribbonTexture = await slitScanner.initialize();
    return ribbonTexture;
  } catch (e) {
    console.error("Camera access error:", e);
    alert("Could not access camera: " + e);
    throw e;
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
  if (slitScanner) {
    slitScanner.stop();
  }
  if (drawingManager) {
    drawingManager.dispose();
  }
});

if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    if (!screenshotManager) {
      console.error('Screenshot manager not initialized');
      alert('Cannot save screenshot at this time.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      await screenshotManager.captureAndSave();
      console.log('Image saved to pCloud.');
    } catch (error) {
      console.error('Error saving image:', error);
      alert('Failed to save image: ' + error.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

if (importSvgBtn && fileInput) {
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
          const normalizedPoints = normalizePoints(svgPoints);
          resetCamera();
          ribbon.buildFromPoints(normalizedPoints, 1.2);
        } else {
          alert('Could not extract points from the SVG file.');
        }
      } catch (error) {
        console.error('Error processing SVG file:', error);
        alert('Error processing SVG file: ' + error.message);
      }

      // Reset file input so the same file can be selected again if needed
      fileInput.value = '';
    }
  });
}
