/**
 * EchoScribe - Electron Main Process
 * 
 * This file handles:
 * - Window creation and management
 * - IPC communication with the renderer process
 * - Spawning Python process for transcription
 * - FFmpeg audio extraction management
 * 
 * For distribution:
 * - Python should be bundled using PyInstaller: pyinstaller --onefile transcriber.py
 * - The compiled binary should be placed in the 'python' directory
 * - FFmpeg binaries should be included in the 'ffmpeg' directory or available in PATH
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

// Keep a global reference of the window object
let mainWindow = null

// Track the current Python process for cancellation
let currentProcess = null

// Determine if we're in development or production
const isDev = !app.isPackaged

/**
 * Get the path to the Python executable/script
 * In development: uses python from PATH
 * In production: uses bundled PyInstaller executable
 */
function getPythonPath() {
    if (isDev) {
        // Development mode: use system Python
        return 'python'
    } else {
        // Production mode: use bundled executable
        const basePath = process.resourcesPath
        const exePath = path.join(basePath, 'python', 'transcriber.exe')

        if (fs.existsSync(exePath)) {
            return exePath
        }

        // Fallback to system Python if bundled version not found
        console.warn('Bundled Python executable not found, falling back to system Python')
        return 'python'
    }
}

/**
 * Get the path to the Python script (for development mode)
 */
function getScriptPath() {
    if (isDev) {
        return path.join(__dirname, '..', 'python', 'transcriber.py')
    }
    return null // Not needed in production with bundled executable
}

/**
 * Create the main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'EchoScribe',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        }
    })

    // Load the app
    if (isDev) {
        // Development: load from Vite dev server
        mainWindow.loadURL('http://localhost:5173')
        // Open DevTools in development
        mainWindow.webContents.openDevTools()
    } else {
        // Production: load from built files
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    }

    mainWindow.on('closed', () => {
        mainWindow = null
    })
}

// App lifecycle events
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    // Kill any running Python process
    if (currentProcess) {
        currentProcess.kill()
        currentProcess = null
    }

    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

// IPC Handlers

/**
 * Handle file selection dialog
 */
ipcMain.handle('file:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Media Files', extensions: ['mp3', 'wav', 'mp4', 'mkv', 'mov'] }
        ]
    })

    if (result.canceled || result.filePaths.length === 0) {
        return null
    }

    return result.filePaths[0]
})

/**
 * Start the transcription process
 * Spawns Python script with appropriate arguments
 */
ipcMain.handle('transcribe:start', async (event, config) => {
    const { filePath, mode, model, apiKey } = config

    // Validate file exists
    if (!fs.existsSync(filePath)) {
        mainWindow.webContents.send('transcribe:error', {
            error: 'Le fichier sélectionné n\'existe pas.'
        })
        return
    }

    // Build command arguments
    const pythonPath = getPythonPath()
    const scriptPath = getScriptPath()

    const args = []

    // In development, we need to specify the script path
    if (scriptPath) {
        args.push(scriptPath)
    }

    args.push('--file', filePath)
    args.push('--mode', mode)
    args.push('--model', model)

    if (mode === 'cloud' && apiKey) {
        args.push('--api-key', apiKey)
    }

    console.log('Starting transcription:', pythonPath, args.join(' '))

    try {
        // Spawn the Python process
        currentProcess = spawn(pythonPath, args, {
            cwd: isDev ? path.join(__dirname, '..', 'python') : undefined
        })

        // Handle stdout - progress updates are sent as JSON lines
        currentProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim())

            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line)

                    if (parsed.type === 'progress') {
                        mainWindow.webContents.send('transcribe:progress', {
                            progress: parsed.progress,
                            message: parsed.message,
                            stage: parsed.stage
                        })
                    } else if (parsed.type === 'result') {
                        mainWindow.webContents.send('transcribe:complete', {
                            text: parsed.text
                        })
                        currentProcess = null
                    } else if (parsed.type === 'error') {
                        mainWindow.webContents.send('transcribe:error', {
                            error: parsed.message
                        })
                        currentProcess = null
                    }
                } catch (e) {
                    // Non-JSON output, might be debug info
                    console.log('Python output:', line)
                }
            }
        })

        // Handle stderr - errors and warnings
        currentProcess.stderr.on('data', (data) => {
            const message = data.toString()
            console.error('Python stderr:', message)

            // Check for common errors
            if (message.includes('CUDA out of memory') || message.includes('OutOfMemoryError')) {
                mainWindow.webContents.send('transcribe:error', {
                    error: 'Mémoire GPU insuffisante. Essayez un modèle plus petit.'
                })
            } else if (message.includes('Could not load model')) {
                mainWindow.webContents.send('transcribe:error', {
                    error: 'Impossible de charger le modèle. Vérifiez votre installation.'
                })
            } else if (message.includes('Invalid API key') || message.includes('Incorrect API key')) {
                mainWindow.webContents.send('transcribe:error', {
                    error: 'Clé API OpenAI invalide.'
                })
            }
        })

        // Handle process exit
        currentProcess.on('close', (code) => {
            console.log('Python process exited with code:', code)
            if (code !== 0 && currentProcess) {
                mainWindow.webContents.send('transcribe:error', {
                    error: `Le processus de transcription a échoué (code: ${code})`
                })
            }
            currentProcess = null
        })

        // Handle process errors
        currentProcess.on('error', (err) => {
            console.error('Failed to start Python process:', err)

            let errorMessage = 'Impossible de démarrer le processus de transcription.'

            if (err.code === 'ENOENT') {
                errorMessage = 'Python n\'est pas installé ou n\'est pas dans le PATH.'
            }

            mainWindow.webContents.send('transcribe:error', {
                error: errorMessage
            })
            currentProcess = null
        })

    } catch (error) {
        console.error('Error starting transcription:', error)
        mainWindow.webContents.send('transcribe:error', {
            error: error.message || 'Une erreur est survenue lors du démarrage de la transcription.'
        })
    }
})

/**
 * Cancel the current transcription
 */
ipcMain.handle('transcribe:cancel', () => {
    if (currentProcess) {
        currentProcess.kill('SIGTERM')
        currentProcess = null
        console.log('Transcription cancelled')
    }
})
