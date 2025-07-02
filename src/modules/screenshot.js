/**
 * Screenshot module for capturing and uploading images
 */

export class ScreenshotManager {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.uploadEndpoint = 'https://pcloud-upload-link.harold-b89.workers.dev/upload-link';
    }

    /**
     * Captures the current Three.js scene and returns a blob
     * @returns {Promise<Blob>} The screenshot as a PNG blob
     */
    captureScreenshot() {
        return new Promise((resolve, reject) => {
            try {
                // Ensure the scene is rendered before capturing
                this.renderer.render(this.scene, this.camera);

                this.renderer.domElement.toBlob((blob) => {
                    if (blob && blob.type && blob.type === 'image/png') {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create blob from canvas'));
                    }
                }, 'image/png');
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Uploads a file to pCloud using the worker endpoint
     * @param {File} file - The file to upload
     * @returns {Promise<Object>} The upload result
     */
    async uploadFileToPCloud(file) {
        try {
            // Step 1: Get upload link code
            const response = await fetch(this.uploadEndpoint);
            if (!response.ok) {
                throw new Error(`Failed to get upload link: ${response.status} ${response.statusText}`);
            }

            const { code } = await response.json();
            if (!code) {
                throw new Error('Invalid upload link response');
            }

            // Step 2: Upload the file
            const formData = new FormData();
            formData.append('file', file, file.name);

            const uploadResponse = await fetch(`https://api.pcloud.com/uploadtolink?code=${code}&names=rivvon`, {
                method: 'POST',
                body: formData,
            });

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
            }

            const uploadResult = await uploadResponse.json();

            if (uploadResult.result !== 0) {
                throw new Error(`pCloud API error: ${uploadResult.error}`);
            }

            return uploadResult;
        } catch (error) {
            console.error('Upload to pCloud failed:', error);
            throw error;
        }
    }

    /**
     * Captures and uploads the current scene as a screenshot
     * @returns {Promise<Object>} The upload result
     */
    async captureAndUpload() {
        try {
            // Capture screenshot
            const blob = await this.captureScreenshot();

            // Create file from blob
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const file = new File([blob], `rivvon-screenshot-${timestamp}.png`, { type: 'image/png' });

            // Upload to pCloud
            const result = await this.uploadFileToPCloud(file);

            return result;
        } catch (error) {
            console.error('Error capturing and uploading screenshot:', error);
            throw error;
        }
    }
}