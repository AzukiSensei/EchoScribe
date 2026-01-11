/**
 * EchoScribe - Preload Script
 * 
 * This script runs in the renderer process before the web page loads.
 * It exposes a secure API to the renderer via contextBridge.
 * 
 * Security notes:
 * - contextIsolation is enabled
 * - nodeIntegration is disabled
 * - Only specific IPC channels are exposed
 */

const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Open a file selection dialog
     * @returns {Promise<string|null>} Selected file path or null if cancelled
     */
    selectFile: () => ipcRenderer.invoke('file:select'),

    /**
     * Start the transcription process
     * @param {Object} config - Transcription configuration
     * @param {string} config.filePath - Path to the file to transcribe
     * @param {string} config.mode - 'local' or 'cloud'
     * @param {string} config.model - Whisper model name
     * @param {string} [config.apiKey] - OpenAI API key (for cloud mode)
     */
    startTranscription: (config) => ipcRenderer.invoke('transcribe:start', config),

    /**
     * Cancel the current transcription
     */
    cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),

    /**
     * Register a callback for progress updates
     * @param {Function} callback - Called with (event, data) where data contains progress info
     */
    onProgress: (callback) => {
        ipcRenderer.on('transcribe:progress', callback)
    },

    /**
     * Register a callback for transcription completion
     * @param {Function} callback - Called with (event, data) where data contains the transcription text
     */
    onComplete: (callback) => {
        ipcRenderer.on('transcribe:complete', callback)
    },

    /**
     * Register a callback for errors
     * @param {Function} callback - Called with (event, data) where data contains error information
     */
    onError: (callback) => {
        ipcRenderer.on('transcribe:error', callback)
    },

    /**
     * Remove all IPC listeners (cleanup)
     */
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('transcribe:progress')
        ipcRenderer.removeAllListeners('transcribe:complete')
        ipcRenderer.removeAllListeners('transcribe:error')
    }
})
