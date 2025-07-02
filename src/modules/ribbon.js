import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';

export class Ribbon {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.texture = null;
        this.lastPoints = [];
        this.lastWidth = 1;

        // Animation parameters
        this.waveAmplitude = 0.2;
        this.waveFrequency = 2;
        this.waveSpeed = 2;
    }

    setTexture(texture) {
        this.texture = texture;
        if (this.mesh && this.mesh.material) {
            this.mesh.material.map = texture;
            this.mesh.material.needsUpdate = true;
        }
        return this;
    }

    buildFromPoints(points, width = 1, time = 0) {
        if (points.length < 2) return;

        // Store for animation updates
        this.lastPoints = points.map(p => p.clone());
        this.lastWidth = width;

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

        let prevNormal = null;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const point = curve.getPoint(t);

            const tangent = curve.getTangent(t).normalize();
            let normal = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();

            if (prevNormal) {
                // Use lower lerp value for smoother transitions
                normal = prevNormal.clone().lerp(normal, 0.05).normalize();
            }
            prevNormal = normal.clone();

            // Animate phase
            const phase = Math.sin(
                t * Math.PI * 2 * this.waveFrequency + time * this.waveSpeed
            ) * this.waveAmplitude;

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

        this.cleanupOldMesh();

        this.mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
                map: this.texture,
                side: THREE.DoubleSide
            })
        );
        this.scene.add(this.mesh);

        return this.mesh;
    }

    update(time) {
        if (this.lastPoints.length >= 2) {
            this.buildFromPoints(this.lastPoints, this.lastWidth, time);
        }
    }

    cleanupOldMesh() {
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
            this.scene.remove(this.mesh);
        }
    }

    dispose() {
        this.cleanupOldMesh();
        this.mesh = null;
        this.lastPoints = [];
    }

    // Utility methods for drawing-to-ribbon conversion
    normalizeDrawingPoints(points) {
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

        // Scale factor to normalize to [-4, 4] range
        const maxDimension = Math.max(width, height);
        const scale = maxDimension > 0 ? 8 / maxDimension : 1;

        // Normalize points to center and scale
        return points.map(p => ({
            x: (p.x - centerX) * scale,
            y: (p.y - centerY) * scale * -1 // Flip Y axis to match THREE.js coordinates
        }));
    }

    smoothPoints(points, numSamples = 100) {
        if (points.length < 2) return points;

        const curve = new CatmullRomCurve3(points, false, 'centripetal');
        const smoothed = [];

        for (let i = 0; i < numSamples; i++) {
            smoothed.push(curve.getPoint(i / (numSamples - 1)));
        }

        return smoothed;
    }

    createRibbonFromDrawing(drawPoints) {
        if (drawPoints.length < 2) return;

        // Convert 2D screen points to normalized coordinates
        const normalizedPoints = this.normalizeDrawingPoints(drawPoints);

        // Create 3D points from normalized 2D points (all with same Z value)
        const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));

        // Apply smoothing
        const smoothedPoints = this.smoothPoints(points3D, 150);

        // Build ribbon
        this.buildFromPoints(smoothedPoints, 1.2);

        return this.mesh;
    }
}