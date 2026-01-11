/**
 * EchoScribe - Preload Script
 * 
 * This script runs in the renderer process before the web page loads.
 * It exposes a secure API to the renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Open a file selection dialog
     */
    selectFile: () => ipcRenderer.invoke('file:select'),

    /**
     * Save content to a file
     */
    saveFile: (content, filename, format) => ipcRenderer.invoke('file:save', { content, filename, format }),

    /**
     * Start the transcription process
     */
    startTranscription: (config) => ipcRenderer.invoke('transcribe:start', config),

    /**
     * Cancel the current transcription
     */
    cancelTranscription: () => ipcRenderer.invoke('transcribe:cancel'),

    /**
     * List available models
     */
    listModels: () => ipcRenderer.invoke('models:list'),

    /**
   * Download a model
   */
    downloadModel: (modelName) => ipcRenderer.invoke('models:download', modelName),

    /**
     * Open the models folder in file explorer
     */
    openModelsFolder: () => ipcRenderer.invoke('models:openFolder'),

    /**
     * Select multiple files for batch processing
     */
    selectMultipleFiles: () => ipcRenderer.invoke('file:selectMultiple'),

    /**
     * Progress updates
     */
    onProgress: (callback) => {
        ipcRenderer.on('transcribe:progress', callback)
    },

    /**
     * Transcription completion
     */
    onComplete: (callback) => {
        ipcRenderer.on('transcribe:complete', callback)
    },

    /**
     * Error handling
     */
    onError: (callback) => {
        ipcRenderer.on('transcribe:error', callback)
    },

    /**
     * Model download progress
     */
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download:progress', callback)
    },

    /**
     * Model download complete
     */
    onDownloadComplete: (callback) => {
        ipcRenderer.on('download:complete', callback)
    },

    /**
     * Models list received
     */
    onModelsList: (callback) => {
        ipcRenderer.on('models:list', callback)
    },

    /**
     * Remove all IPC listeners
     */
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('transcribe:progress')
        ipcRenderer.removeAllListeners('transcribe:complete')
        ipcRenderer.removeAllListeners('transcribe:error')
        ipcRenderer.removeAllListeners('download:progress')
        ipcRenderer.removeAllListeners('download:complete')
        ipcRenderer.removeAllListeners('models:list')
    }
})
