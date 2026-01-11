/**
 * EchoScribe - Electron Main Process
 * 
 * This file handles:
 * - Window creation and management
 * - IPC communication with the renderer process
 * - Spawning Python process for transcription
 * - FFmpeg audio extraction management
 * - Model download and management
 * - File export functionality
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

// Disable GPU cache to avoid Windows permission errors
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-gpu-program-cache')

// Keep a global reference of the window object
let mainWindow = null

// Track the current Python process for cancellation
let currentProcess = null

// Determine if we're in development or production
const isDev = !app.isPackaged

/**
 * Get the path to the Python executable/script
 */
function getPythonPath() {
    if (isDev) {
        return 'python'
    } else {
        const basePath = process.resourcesPath
        const exePath = path.join(basePath, 'python', 'transcriber.exe')

        if (fs.existsSync(exePath)) {
            return exePath
        }

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
    return null
}

/**
 * Create the main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        title: 'EchoScribe',
        backgroundColor: '#0a0a0f',
        autoHideMenuBar: true, // Hide menu bar by default
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        }
    })

    // Remove the menu bar completely
    mainWindow.setMenuBarVisibility(false)
    mainWindow.setMenu(null)

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173')
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    }

    mainWindow.on('closed', () => {
        mainWindow = null
    })
}

// App lifecycle events
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
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
            { name: 'Media Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'mov', 'avi', 'webm'] }
        ]
    })

    if (result.canceled || result.filePaths.length === 0) {
        return null
    }

    return result.filePaths[0]
})

/**
 * Save file dialog
 */
ipcMain.handle('file:save', async (event, { content, filename, format }) => {
    const filters = {
        'txt': { name: 'Text Files', extensions: ['txt'] },
        'srt': { name: 'SubRip Subtitle', extensions: ['srt'] },
        'vtt': { name: 'WebVTT', extensions: ['vtt'] }
    }

    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: filename,
        filters: [filters[format] || filters['txt']]
    })

    if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, content, 'utf-8')
        return true
    }
    return false
})

/**
 * Start the transcription process
 */
ipcMain.handle('transcribe:start', async (event, config) => {
    const { filePath, mode, model, apiKey, language, translate, customModelPath } = config

    if (!fs.existsSync(filePath)) {
        mainWindow.webContents.send('transcribe:error', {
            error: 'Le fichier sélectionné n\'existe pas.'
        })
        return
    }

    const pythonPath = getPythonPath()
    const scriptPath = getScriptPath()

    const args = []

    if (scriptPath) {
        args.push(scriptPath)
    }

    args.push('--file', filePath)
    args.push('--mode', mode)
    args.push('--model', model)

    if (language && language !== 'auto') {
        args.push('--language', language)
    }

    if (translate) {
        args.push('--translate')
    }

    if (customModelPath) {
        args.push('--custom-model-path', customModelPath)
    }

    if (mode === 'cloud' && apiKey) {
        args.push('--api-key', apiKey)
    }

    console.log('Starting transcription:', pythonPath, args.join(' '))

    try {
        currentProcess = spawn(pythonPath, args, {
            cwd: isDev ? path.join(__dirname, '..', 'python') : undefined
        })

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
                            text: parsed.text,
                            segments: parsed.segments || [],
                            detected_language: parsed.detected_language
                        })
                        currentProcess = null
                    } else if (parsed.type === 'error') {
                        mainWindow.webContents.send('transcribe:error', {
                            error: parsed.message
                        })
                        currentProcess = null
                    } else if (parsed.type === 'download_progress') {
                        mainWindow.webContents.send('download:progress', {
                            model: parsed.model,
                            progress: parsed.progress,
                            message: parsed.message
                        })
                    } else if (parsed.type === 'download_complete') {
                        mainWindow.webContents.send('download:complete', {
                            model: parsed.model,
                            success: parsed.success
                        })
                    } else if (parsed.type === 'models_list') {
                        mainWindow.webContents.send('models:list', {
                            models: parsed.models
                        })
                    }
                } catch (e) {
                    console.log('Python output:', line)
                }
            }
        })

        currentProcess.stderr.on('data', (data) => {
            const message = data.toString()
            console.error('Python stderr:', message)

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

        currentProcess.on('close', (code) => {
            console.log('Python process exited with code:', code)
            if (code !== 0 && currentProcess) {
                mainWindow.webContents.send('transcribe:error', {
                    error: `Le processus de transcription a échoué (code: ${code})`
                })
            }
            currentProcess = null
        })

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

/**
 * List available models
 */
ipcMain.handle('models:list', () => {
    const pythonPath = getPythonPath()
    const scriptPath = getScriptPath()

    const args = []
    if (scriptPath) {
        args.push(scriptPath)
    }
    args.push('--list-models')

    const process = spawn(pythonPath, args, {
        cwd: isDev ? path.join(__dirname, '..', 'python') : undefined
    })

    process.stdout.on('data', (data) => {
        try {
            const parsed = JSON.parse(data.toString())
            if (parsed.type === 'models_list') {
                mainWindow.webContents.send('models:list', {
                    models: parsed.models
                })
            }
        } catch (e) {
            console.log('Models list output:', data.toString())
        }
    })
})

/**
 * Download a model
 */
ipcMain.handle('models:download', (event, modelName) => {
    const pythonPath = getPythonPath()
    const scriptPath = getScriptPath()

    const args = []
    if (scriptPath) {
        args.push(scriptPath)
    }
    args.push('--download-model', modelName)

    const process = spawn(pythonPath, args, {
        cwd: isDev ? path.join(__dirname, '..', 'python') : undefined
    })

    process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim())

        for (const line of lines) {
            try {
                const parsed = JSON.parse(line)

                if (parsed.type === 'download_progress') {
                    mainWindow.webContents.send('download:progress', {
                        model: parsed.model,
                        progress: parsed.progress,
                        message: parsed.message
                    })
                } else if (parsed.type === 'download_complete') {
                    mainWindow.webContents.send('download:complete', {
                        model: parsed.model,
                        success: parsed.success
                    })
                } else if (parsed.type === 'error') {
                    mainWindow.webContents.send('download:complete', {
                        model: modelName,
                        success: false,
                        error: parsed.message
                    })
                }
            } catch (e) {
                console.log('Download output:', line)
            }
        }
    })

    process.stderr.on('data', (data) => {
        console.error('Download stderr:', data.toString())
    })
})

/**
 * Save temporary file (e.g. for recordings)
 */
ipcMain.handle('file:saveTemp', async (event, { buffer, filename }) => {
    try {
        const tempDir = app.getPath('temp')
        // Create a unique folder for our app if it doesn't exist
        const appTempDir = path.join(tempDir, 'echoscribe_recordings')
        if (!fs.existsSync(appTempDir)) {
            fs.mkdirSync(appTempDir, { recursive: true })
        }

        const filePath = path.join(appTempDir, filename)

        // Convert array buffer to buffer
        const data = Buffer.from(buffer)
        fs.writeFileSync(filePath, data)

        return { success: true, path: filePath }
    } catch (error) {
        console.error('Error saving temp file:', error)
        return { success: false, error: error.message }
    }
})

/**
 * Open the models folder in file explorer
 */
    }
})

/**
 * Install Python dependencies
 */
ipcMain.handle('python:install-deps', async () => {
    return new Promise((resolve) => {
        const pythonPath = getPythonPath()
        const requirementsPath = path.join(getScriptPath(), 'requirements.txt')

        console.log(`Installing dependencies from ${requirementsPath}...`)

        const process = spawn(pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath])

        process.stdout.on('data', (data) => {
            console.log(`Pip output: ${data.toString()}`)
        })

        process.stderr.on('data', (data) => {
            console.error(`Pip error: ${data.toString()}`)
        })

        process.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true })
            } else {
                resolve({ success: false, error: `Pip exited with code ${code}` })
            }
        })
    })
})
/**
 * Check system dependencies
 */
ipcMain.handle('system:checkDependencies', async () => {
    const { exec } = require('child_process')
    const util = require('util')
    const execPromise = util.promisify(exec)

    const deps = {
        python: { installed: false, version: null },
        pip: { installed: false, version: null },
        ffmpeg: { installed: false, version: null },
        fasterWhisper: { installed: false },
        pytorch: { installed: false, cuda: false }
    }

    try {
        // Check Python
        const pythonResult = await execPromise('python --version').catch(() => null)
        if (pythonResult) {
            deps.python.installed = true
            deps.python.version = pythonResult.stdout.trim() || pythonResult.stderr.trim()
        }

        // Check pip
        const pipResult = await execPromise('pip --version').catch(() => null)
        if (pipResult) {
            deps.pip.installed = true
            deps.pip.version = pipResult.stdout.trim().split(' ').slice(0, 2).join(' ')
        }

        // Check FFmpeg
        const ffmpegResult = await execPromise('ffmpeg -version').catch(() => null)
        if (ffmpegResult) {
            deps.ffmpeg.installed = true
            deps.ffmpeg.version = ffmpegResult.stdout.split('\n')[0]
        }

        // Check faster-whisper
        const fwResult = await execPromise('pip show faster-whisper').catch(() => null)
        if (fwResult && fwResult.stdout.includes('Name: faster-whisper')) {
            deps.fasterWhisper.installed = true
        }

        // Check PyTorch with CUDA
        const torchResult = await execPromise('python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"').catch(() => null)
        if (torchResult) {
            deps.pytorch.installed = true
            const lines = torchResult.stdout.trim().split('\n')
            deps.pytorch.cuda = lines[1] === 'True'
        }
    } catch (e) {
        console.error('Error checking dependencies:', e)
    }

    return deps
})

/**
 * Install dependencies
 */
ipcMain.handle('system:installDependency', async (event, dependency) => {
    const { exec } = require('child_process')
    const util = require('util')
    const execPromise = util.promisify(exec)

    const commands = {
        python: 'winget install Python.Python.3.11 --accept-source-agreements --accept-package-agreements',
        ffmpeg: 'winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements',
        fasterWhisper: 'pip install faster-whisper huggingface-hub openai',
        pytorch: 'pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121',
        pytorchCpu: 'pip install torch torchvision torchaudio'
    }

    const cmd = commands[dependency]
    if (!cmd) {
        return { success: false, error: 'Unknown dependency' }
    }

    try {
        mainWindow.webContents.send('install:progress', { dependency, status: 'installing' })
        await execPromise(cmd, { timeout: 600000 }) // 10 min timeout
        mainWindow.webContents.send('install:progress', { dependency, status: 'complete' })
        return { success: true }
    } catch (e) {
        mainWindow.webContents.send('install:progress', { dependency, status: 'error', error: e.message })
        return { success: false, error: e.message }
    }
})

/**
 * Select multiple files for batch processing
 */
ipcMain.handle('file:selectMultiple', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Media Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'mov', 'avi', 'webm'] }
        ]
    })

    if (result.canceled || result.filePaths.length === 0) {
        return []
    }

    return result.filePaths
})
