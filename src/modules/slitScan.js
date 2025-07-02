import * as THREE from 'three';
import { slitCanvas } from './domElements.js';

export class SlitScanner {
    constructor() {

        this.canvas = slitCanvas;
        this.ctx = this.canvas.getContext('2d');
        this.row = 0;
        this.texture = null;
        this.isRunning = false;
        this.stream = null;
        this.reader = null;
    }

    async initialize() {
        try {
            console.log("Starting slit-scan...");
            this.stream = await this.tryResolutions();
            console.log("Camera stream started:", this.stream);

            const track = this.stream.getVideoTracks()[0];
            const processor = new MediaStreamTrackProcessor({ track });
            this.reader = processor.readable.getReader();

            const { value: firstFrame } = await this.reader.read();
            console.log("First frame received:", firstFrame);
            const videoWidth = firstFrame.displayWidth;
            const videoHeight = firstFrame.displayHeight;

            // Set canvas dimensions based on video and desired output.
            this.canvas.width = videoWidth;
            this.canvas.height = 512;

            // --- INITIAL GOLD GRADIENT ---
            const grad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
            grad.addColorStop(0.0, "#ffe8a5");
            grad.addColorStop(0.4, "#ffd700");
            grad.addColorStop(0.6, "#c7a942");
            grad.addColorStop(1.0, "#7a6520");
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            // Setup texture and properties.
            this.texture = new THREE.CanvasTexture(this.canvas);
            this.texture.wrapS = THREE.RepeatWrapping;
            this.texture.wrapT = THREE.RepeatWrapping;
            this.texture.minFilter = THREE.LinearFilter;
            this.texture.center.set(0.5, 0.5);
            this.texture.rotation = Math.PI;

            // Process the first frame
            await this.processFrame(firstFrame);

            // Start processing frames
            this.isRunning = true;
            this.startProcessing();

            return this.texture;
        } catch (e) {
            console.error("Camera access error:", e);
            throw e;
        }
    }

    async tryResolutions() {
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
    }

    async processFrame(frame) {
        const bitmap = await createImageBitmap(frame);
        const tmp = new OffscreenCanvas(this.canvas.width, bitmap.height);
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.drawImage(bitmap, 0, 0);
        const midY = Math.floor(bitmap.height / 2);
        const imageData = tmpCtx.getImageData(0, midY, this.canvas.width, 1);
        this.ctx.putImageData(imageData, 0, this.row);
        frame.close();
        this.row = (this.row + 1) % this.canvas.height;
    }

    async startProcessing() {
        while (this.isRunning) {
            try {
                const { done, value: frame } = await this.reader.read();
                if (done) break;
                await this.processFrame(frame);
                if (this.texture) {
                    this.texture.needsUpdate = true;
                }
            } catch (err) {
                console.error("Error processing frame:", err);
                this.isRunning = false;
                break;
            }
        }
    }

    stop() {
        this.isRunning = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.reader) {
            this.reader.releaseLock();
        }
    }

    getTexture() {
        return this.texture;
    }
}