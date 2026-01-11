import { useState, useEffect, useCallback } from 'react'
import {
    FolderOpen, Mic, Info, FileText, Copy,
    Download, Layers, AlertCircle, Check, Loader2,
    Moon, Sun, Trash2, Settings, Cloud, Cpu, History
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Toaster, useToast } from '@/components/ui/toaster'
import { AudioRecorder } from '@/components/AudioRecorder'
import { DropZone } from '@/components/DropZone'
import SetupWizard from '@/components/SetupWizard'
import { getDefaultLanguage, getTranslations, Language, languageNames } from '@/i18n'

// Types
interface Segment {
    start: number
    end: number
    text: string
}

interface ModelInfo {
    name: string
    size: string
    vram?: string
    speed?: string
    type?: 'builtin' | 'custom'
    downloaded?: boolean
    path?: string
    sha?: string
    url?: string
}

interface HistoryItem {
    id: string
    fileName: string
    date: string
    text: string
    segments: Segment[]
    language: string
    mode: 'local' | 'cloud'
    model: string
}

// Transcription status types
type TranscriptionStatus = 'idle' | 'extracting' | 'transcribing' | 'complete' | 'error' | 'downloading'

interface ProgressInfo {
    status: TranscriptionStatus
    progress: number
    message: string
    model?: string
}

interface DownloadProgress {
    model: string
    progress: number
    message: string
}

const SUPPORTED_LANGUAGES = [
    { code: 'auto', name: 'Auto-détection' },
    { code: 'fr', name: 'Français' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'nl', name: 'Nederlands' },
    { code: 'pl', name: 'Polski' },
    { code: 'ru', name: 'Русский' },
    { code: 'zh', name: '中文' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'ar', name: 'العربية' },
]

// Export formats
const EXPORT_FORMATS = [
    { id: 'txt', name: 'Texte (.txt)', icon: FileText },
    { id: 'srt', name: 'Sous-titres (.srt)', icon: FileText },
    { id: 'vtt', name: 'WebVTT (.vtt)', icon: FileText },
]

/**
 * Format timestamp for SRT format
 */
function formatTimestampSRT(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const millis = Math.floor((seconds % 1) * 1000)
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')} `
}

/**
 * Format timestamp for VTT format
 */
function formatTimestampVTT(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const millis = Math.floor((seconds % 1) * 1000)
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')} `
}

/**
 * Convert segments to SRT format
 */
function segmentsToSRT(segments: Segment[]): string {
    return segments.map((seg, i) => {
        const start = formatTimestampSRT(seg.start)
        const end = formatTimestampSRT(seg.end)
        return `${i + 1} \n${start} --> ${end} \n${seg.text.trim()} \n`
    }).join('\n')
}

/**
 * Convert segments to VTT format
 */
function segmentsToVTT(segments: Segment[]): string {
    const lines = ['WEBVTT\n']
    segments.forEach(seg => {
        const start = formatTimestampVTT(seg.start)
        const end = formatTimestampVTT(seg.end)
        lines.push(`${start} --> ${end} \n${seg.text.trim()} \n`)
    })
    return lines.join('\n')
}

/**
 * Main application component for EchoScribe
 */
function App() {
    // Setup state - check if first launch
    const [setupComplete, setSetupComplete] = useState(() => {
        return localStorage.getItem('echoscribe_setup_complete') === 'true'
    })

    // Language state
    const [language, setLanguage] = useState<Language>(() => {
        const saved = localStorage.getItem('echoscribe_language')
        return (saved as Language) || getDefaultLanguage()
    })

    // Get current translations
    const t = getTranslations(language)

    // Update title and description when language changes
    useEffect(() => {
        document.title = t.appName
    }, [language, t])

    // Theme state
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const saved = localStorage.getItem('echoscribe_theme')
        return saved ? saved === 'dark' : true
    })

    // File state
    const [selectedFile, setSelectedFile] = useState<File | null>(null)

    // Input mode: 'file' or 'record'
    const [inputMode, setInputMode] = useState<'file' | 'record'>('file')

    // Batch mode
    const [batchMode, setBatchMode] = useState(false)
    const [batchFiles, setBatchFiles] = useState<File[]>([])
    const [_currentBatchIndex, setCurrentBatchIndex] = useState(0)

    // Transcription mode
    const [useCloudMode, setUseCloudMode] = useState(() => {
        return localStorage.getItem('echoscribe_cloud_mode') === 'true'
    })
    const [apiKey, setApiKey] = useState(() => {
        return localStorage.getItem('echoscribe_api_key') || ''
    })
    const [selectedModel, setSelectedModel] = useState(() => {
        return localStorage.getItem('echoscribe_model') || 'large-v3-turbo'
    })
    const [customModelPath, setCustomModelPath] = useState('')

    // Language and translation
    const [sourceLanguage, setSourceLanguage] = useState(() => {
        return localStorage.getItem('echoscribe_language_source') || 'auto' // Fix key
    })
    const [translateToEnglish, setTranslateToEnglish] = useState(() => {
        return localStorage.getItem('echoscribe_translate') === 'true'
    })
    const [exportFormat, setExportFormat] = useState('txt')

    // Progress state
    const [progressInfo, setProgressInfo] = useState<ProgressInfo>({
        status: 'idle',
        progress: 0,
        message: ''
    })

    // Result state
    const [transcriptionResult, setTranscriptionResult] = useState('')
    const [segments, setSegments] = useState<Segment[]>([])
    const [detectedLanguage, setDetectedLanguage] = useState('')
    const [copied, setCopied] = useState(false)

    // Model management
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]) // Changed to array
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null) // Changed to object
    const [downloadedModels, setDownloadedModels] = useState<Set<string>>(new Set())

    // History
    const [history, setHistory] = useState<HistoryItem[]>([])
    const [showHistory, setShowHistory] = useState(false)

    // Settings panel visibility
    const [showAdvanced, setShowAdvanced] = useState(false)

    const { toast } = useToast()

    // Apply theme class to document
    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode)
    }, [isDarkMode])

    // Load saved history from localStorage
    useEffect(() => {
        const savedHistory = localStorage.getItem('echoscribe_history')
        if (savedHistory) {
            try {
                setHistory(JSON.parse(savedHistory))
            } catch (e) {
                console.error('Failed to parse history:', e)
            }
        }
    }, [])

    // Save all settings to localStorage
    useEffect(() => {
        localStorage.setItem('echoscribe_api_key', apiKey)
    }, [apiKey])

    useEffect(() => {
        localStorage.setItem('echoscribe_theme', isDarkMode ? 'dark' : 'light')
    }, [isDarkMode])

    useEffect(() => {
        localStorage.setItem('echoscribe_cloud_mode', useCloudMode ? 'true' : 'false')
    }, [useCloudMode])

    useEffect(() => {
        localStorage.setItem('echoscribe_model', selectedModel)
    }, [selectedModel])

    useEffect(() => {
        localStorage.setItem('echoscribe_language', sourceLanguage)
    }, [sourceLanguage])

    useEffect(() => {
        localStorage.setItem('echoscribe_translate', translateToEnglish ? 'true' : 'false')
    }, [translateToEnglish])

    // Save history
    useEffect(() => {
        localStorage.setItem('echoscribe_history', JSON.stringify(history.slice(0, 50)))
    }, [history])

    // Setup IPC listeners - run only once on mount
    useEffect(() => {
        if (!window.electronAPI) return

        // Progress updates
        const handleProgress = (_event: unknown, data: { progress: number; message: string; stage: string }) => {
            setProgressInfo({
                status: data.stage === 'extracting' ? 'extracting' : 'transcribing',
                progress: data.progress,
                message: data.message
            })
        }

        // Transcription complete
        const handleComplete = (_event: unknown, data: { text: string; segments?: Segment[]; detected_language?: string }) => {
            setTranscriptionResult(data.text)
            setSegments(data.segments || [])
            setDetectedLanguage(data.detected_language || '')
            setProgressInfo({
                status: 'complete',
                progress: 100,
                message: 'Transcription terminée !'
            })
        }

        // Error handling
        const handleError = (_event: unknown, data: { error: string }) => {
            setProgressInfo({
                status: 'error',
                progress: 0,
                message: data.error
            })
        }

        // Download progress
        const handleDownloadProgress = (_event: unknown, data: { model: string; progress: number; message: string }) => {
            setDownloadProgress({ model: data.model, progress: data.progress, message: data.message })
        }

        // Download complete
        const handleDownloadComplete = (_event: unknown, data: { model: string; success: boolean }) => {
            setDownloadProgress(null)
            if (data.success) {
                setDownloadedModels(prev => new Set([...prev, data.model]))
            }
        }

        // Models list received
        // Models list received
        const handleModelsList = (_event: unknown, data: { models: Record<string, unknown> }) => {
            const modelsArray = Object.values(data.models) as ModelInfo[]
            setAvailableModels(modelsArray)
            // Update downloadedModels from the list
            const downloaded = modelsArray
                .filter(m => m.downloaded)
                .map(m => m.name)
            setDownloadedModels(prev => new Set([...prev, ...downloaded]))
        }

        // Register listeners
        window.electronAPI.onProgress(handleProgress)
        window.electronAPI.onComplete(handleComplete)
        window.electronAPI.onError(handleError)
        window.electronAPI.onDownloadProgress?.(handleDownloadProgress)
        window.electronAPI.onDownloadComplete?.(handleDownloadComplete)
        window.electronAPI.onModelsList?.(handleModelsList)

        // Initial models list fetch
        if (window.electronAPI.listModels) {
            window.electronAPI.listModels()
        }

        // Cleanup on unmount - Note: listeners are cleaned by Electron on window close
        return () => {
            // Listeners will be automatically cleaned when electron API is destroyed
        }
    }, []) // Empty deps - only run once

    // Start transcription
    const handleStartTranscription = useCallback(async () => {
        if (!selectedFile) return

        if (useCloudMode && !apiKey.trim()) {
            toast({
                title: 'Clé API requise',
                description: 'Veuillez entrer votre clé API OpenAI pour utiliser le mode cloud.',
                variant: 'destructive'
            })
            return
        }

        setTranscriptionResult('')
        setSegments([])
        setDetectedLanguage('')
        setProgressInfo({
            status: 'extracting',
            progress: 0,
            message: 'Préparation du fichier...'
        })

        try {
            if (window.electronAPI) {
                const filePath = (selectedFile as File & { path: string }).path
                await window.electronAPI.startTranscription({
                    filePath,
                    mode: useCloudMode ? 'cloud' : 'local',
                    model: selectedModel,
                    apiKey: useCloudMode ? apiKey : undefined,
                    language: sourceLanguage,
                    translate: translateToEnglish,
                    customModelPath: customModelPath || undefined
                })
            } else {
                simulateTranscription()
            }
        } catch (error) {
            console.error('Transcription error:', error)
            setProgressInfo({
                status: 'error',
                progress: 0,
                message: error instanceof Error ? error.message : 'Une erreur est survenue'
            })
        }
    }, [selectedFile, useCloudMode, apiKey, selectedModel, sourceLanguage, translateToEnglish, customModelPath, toast])

    // Simulate transcription for development
    const simulateTranscription = () => {
        let progress = 0
        const interval = setInterval(() => {
            progress += 5
            if (progress <= 30) {
                setProgressInfo({
                    status: 'extracting',
                    progress,
                    message: 'Extraction audio avec FFmpeg...'
                })
            } else if (progress <= 95) {
                setProgressInfo({
                    status: 'transcribing',
                    progress,
                    message: `Transcription en cours... ${progress}% `
                })
            } else {
                clearInterval(interval)
                const mockSegments: Segment[] = [
                    { start: 0, end: 5.5, text: "Bonjour et bienvenue dans EchoScribe." },
                    { start: 5.5, end: 12.3, text: "Cette application vous permet de transcrire vos fichiers audio et vidéo." },
                    { start: 12.3, end: 20.0, text: "Vous pouvez exporter les résultats en format texte, SRT ou VTT." }
                ]
                setSegments(mockSegments)
                setDetectedLanguage('fr')
                setProgressInfo({
                    status: 'complete',
                    progress: 100,
                    message: 'Transcription terminée !'
                })
                setTranscriptionResult(mockSegments.map(s => s.text).join(' '))

                if (selectedFile) {
                    const historyItem: HistoryItem = {
                        id: Date.now().toString(),
                        fileName: selectedFile.name,
                        date: new Date().toISOString(),
                        text: mockSegments.map(s => s.text).join(' '),
                        segments: mockSegments,
                        language: 'fr',
                        mode: useCloudMode ? 'cloud' : 'local',
                        model: selectedModel
                    }
                    setHistory(prev => [historyItem, ...prev])
                }

                toast({
                    title: 'Succès (Simulation)',
                    description: 'La transcription simulée est terminée.',
                    variant: 'success'
                })
            }
        }, 200)
    }

    // Cancel transcription
    const handleCancel = useCallback(() => {
        if (window.electronAPI) {
            window.electronAPI.cancelTranscription()
        }
        setProgressInfo({
            status: 'idle',
            progress: 0,
            message: ''
        })
    }, [])

    // Download model
    const handleDownloadModel = useCallback((modelName: string) => {
        console.log('Attempting to download model:', modelName)

        if (window.electronAPI?.downloadModel) {
            console.log('Calling electronAPI.downloadModel')
            setDownloadProgress({ model: modelName, progress: 0, message: t.downloadingModel })
            window.electronAPI.downloadModel(modelName)

            toast({
                title: 'Téléchargement démarré',
                description: `Téléchargement du modèle ${modelName} en cours...`,
            })
        } else {
            console.log('electronAPI.downloadModel not available')
            // Simulate download for development
            setDownloadProgress({ model: modelName, progress: 0, message: t.downloadingModel })

            toast({
                title: 'Mode développement',
                description: `Simulation du téléchargement de ${modelName}...`,
            })

            // Simulate progress
            let progress = 0
            const interval = setInterval(() => {
                progress += 10
                setDownloadProgress({ model: modelName, progress, message: 'Downloading (simulated)...' })
                if (progress >= 100) {
                    clearInterval(interval)
                    toast({
                        title: 'Téléchargé (simulé)',
                        description: `${modelName} est prêt.`,
                        variant: 'success'
                    })
                }
            }, 300)
        }
    }, [toast])

    // Open models folder
    const handleOpenModelsFolder = useCallback(async () => {
        if (window.electronAPI?.openModelsFolder) {
            const success = await window.electronAPI.openModelsFolder()
            if (!success) {
                toast({
                    title: t.error,
                    description: t.openFolderError,
                    variant: 'destructive'
                })
            }
        }
    }, [toast, t])

    // Export transcription
    const handleExport = useCallback(async (format: 'txt' | 'srt' | 'vtt') => {
        if (!transcriptionResult && segments.length === 0) return

        let content: string
        let filename: string
        let mimeType: string

        const baseName = selectedFile?.name.replace(/\.[^/.]+$/, '') || 'transcription'

        switch (format) {
            case 'srt':
                content = segmentsToSRT(segments)
                filename = `${baseName}.srt`
                mimeType = 'text/plain'
                break
            case 'vtt':
                content = segmentsToVTT(segments)
                filename = `${baseName}.vtt`
                mimeType = 'text/vtt'
                break
            default:
                content = transcriptionResult
                filename = `${baseName}.txt`
                mimeType = 'text/plain'
        }

        if (window.electronAPI?.saveFile) {
            await window.electronAPI.saveFile(content, filename, format)
        } else {
            // Browser fallback
            const blob = new Blob([content], { type: mimeType })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        }

        toast({
            title: 'Export réussi',
            description: `Fichier ${filename} exporté.`,
        })
    }, [transcriptionResult, segments, selectedFile, toast])

    // Copy to clipboard
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(transcriptionResult)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
            toast({
                title: 'Copié !',
                description: 'Le texte a été copié dans le presse-papier.',
            })
        } catch {
            toast({
                title: 'Erreur',
                description: 'Impossible de copier le texte.',
                variant: 'destructive'
            })
        }
    }, [transcriptionResult, toast])

    // Load from history
    const handleLoadFromHistory = useCallback((item: HistoryItem) => {
        setTranscriptionResult(item.text)
        setSegments(item.segments)
        setDetectedLanguage(item.language)
        setShowHistory(false)
        toast({
            title: 'Chargé',
            description: `Transcription de "${item.fileName}" chargée.`,
        })
    }, [toast])

    // Delete from history
    const handleDeleteFromHistory = useCallback((id: string) => {
        setHistory(prev => prev.filter(item => item.id !== id))
    }, [])

    // Clear history
    const handleClearHistory = useCallback(() => {
        setHistory([])
        toast({
            title: 'Historique effacé',
            description: 'Toutes les transcriptions ont été supprimées.',
        })
    }, [toast])

    // Clear file
    const handleClearFile = useCallback(() => {
        setSelectedFile(null)
        setTranscriptionResult('')
        setSegments([])
        setDetectedLanguage('')
        setProgressInfo({
            status: 'idle',
            progress: 0,
            message: ''
        })
    }, [])

    const isProcessing = progressInfo.status === 'extracting' || progressInfo.status === 'transcribing'

    // Handle setup complete
    const handleSetupComplete = useCallback(() => {
        setSetupComplete(true)
        localStorage.setItem('echoscribe_setup_complete', 'true')
    }, [])

    // Handle batch file selection from DropZone
    const handleBatchFilesSelect = useCallback((files: File[]) => {
        setBatchFiles(files)
        setBatchMode(true)
        setCurrentBatchIndex(0)
    }, [])

    // Handle recording complete
    const handleRecordingComplete = useCallback((audioBlob: Blob, filename: string) => {
        // Create a File from the Blob
        const file = new File([audioBlob], filename, { type: 'audio/webm' })
        setSelectedFile(file)
        setInputMode('file') // Switch back to file mode to show the file
    }, [])

    // Show setup wizard on first launch
    if (!setupComplete) {
        return (
            <SetupWizard
                onComplete={handleSetupComplete}
                onSkip={handleSetupComplete}
                translations={t}
            />
        )
    }

    return (
        <div className={`min - h - screen bg - background transition - colors ${isDarkMode ? 'dark' : ''} `}>
            <div className="container mx-auto py-8 px-4 max-w-4xl">
                {/* Header */}
                <header className="text-center mb-8">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-primary/10">
                                <Mic className="h-8 w-8 text-primary" />
                            </div>
                            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                                {t.appName}
                            </h1>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Language Selector */}
                            <Select
                                value={language}
                                onChange={(e) => {
                                    const newLang = e.target.value as Language
                                    setLanguage(newLang)
                                    localStorage.setItem('echoscribe_language', newLang)
                                }}
                                className="w-32"
                            >
                                {Object.entries(languageNames).map(([code, name]) => (
                                    <option key={code} value={code}>
                                        {name}
                                    </option>
                                ))}
                            </Select>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowHistory(!showHistory)}
                                className="relative"
                                title={t.history}
                            >
                                <History className="h-5 w-5" />
                                {history.length > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                                        {history.length > 9 ? '9+' : history.length}
                                    </span>
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsDarkMode(!isDarkMode)}
                                title={isDarkMode ? t.lightMode : t.darkMode}
                            >
                                {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                            </Button>
                        </div>
                    </div>
                    <p className="text-xl text-muted-foreground">
                        {t.appDescription}
                    </p>
                </header>

                {showHistory && (
                    <Card className="mb-6">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <History className="h-5 w-5" />
                                    {t.transcriptionHistory}
                                </CardTitle>
                                {history.length > 0 && (
                                    <Button variant="ghost" size="sm" onClick={handleClearHistory}>
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        {t.clearAllHistory}
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {history.length === 0 ? (
                                <p className="text-muted-foreground text-center py-4">
                                    {t.noHistory}
                                </p>
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {history.map(item => (
                                        <div
                                            key={item.id}
                                            className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                                        >
                                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleLoadFromHistory(item)}>
                                                <p className="font-medium truncate">{item.fileName}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {new Date(item.date).toLocaleDateString(language, {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                    {' • '}
                                                    {item.mode === 'cloud' ? 'Cloud' : item.model}
                                                    {item.language && ` • ${item.language.toUpperCase()} `}
                                                </p>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDeleteFromHistory(item.id)
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )
                }

                <div className="space-y-6">
                    {/* Settings Card */}
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Settings className="h-5 w-5 text-muted-foreground" />
                                    <CardTitle className="text-lg">{t.configuration}</CardTitle>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                >
                                    {showAdvanced ? t.lessOptions : t.moreOptions}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Mode Toggle */}
                            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                                <div className="flex items-center gap-3">
                                    {useCloudMode ? (
                                        <Cloud className="h-5 w-5 text-primary" />
                                    ) : (
                                        <Cpu className="h-5 w-5 text-primary" />
                                    )}
                                    <div>
                                        <Label className="text-base font-medium">
                                            {useCloudMode ? t.cloudMode : t.localMode}
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            {useCloudMode
                                                ? t.cloudDescription
                                                : t.localDescription}
                                        </p>
                                    </div>
                                </div>
                                <Switch
                                    checked={useCloudMode}
                                    onCheckedChange={setUseCloudMode}
                                    disabled={isProcessing}
                                />
                            </div>

                            {/* Model Selection (Local mode only) */}
                            {!useCloudMode && (
                                <div className="space-y-4 pt-2">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>{t.whisperModel}</Label>
                                            <div className="flex gap-2">
                                                <Select
                                                    value={selectedModel}
                                                    onChange={(e) => setSelectedModel(e.target.value)}
                                                    disabled={isProcessing}
                                                    className="flex-1"
                                                >
                                                    {availableModels.map(model => (
                                                        <option key={model.name} value={model.name}>
                                                            {model.name} ({model.size})
                                                        </option>
                                                    ))}
                                                </Select>
                                                {!downloadedModels.has(selectedModel) ? (
                                                    <Button
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => handleDownloadModel(selectedModel)}
                                                        disabled={downloadProgress !== null}
                                                        title={t.downloadModel}
                                                    >
                                                        {downloadProgress !== null && downloadProgress.model === selectedModel ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Download className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                ) : (
                                                    <div className="flex items-center justify-center w-10 h-10 rounded-md border bg-muted/50" title={t.modelDownloaded}>
                                                        <Check className="h-5 w-5 text-green-500" />
                                                    </div>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={handleOpenModelsFolder}
                                                    title={t.openModelsFolder}
                                                >
                                                    <FolderOpen className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            {downloadProgress && (
                                                <div className="space-y-1 mt-2">
                                                    <div className="flex justify-between text-xs text-muted-foreground">
                                                        <span>{downloadProgress.message}</span>
                                                        <span>{Math.round(downloadProgress.progress)}%</span>
                                                    </div>
                                                    <Progress value={downloadProgress.progress} className="h-1" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center text-sm text-muted-foreground">
                                            <Info className="h-4 w-4 mr-2 flex-shrink-0" />
                                            {t.largerModelsBetter}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* API Key Input (Cloud mode only) */}
                            {useCloudMode && (
                                <div className="space-y-2 pt-2">
                                    <Label>{t.apiKey}</Label>
                                    <Input
                                        type="password"
                                        placeholder={t.apiKeyPlaceholder}
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        disabled={isProcessing}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t.apiKeyDescription}
                                    </p>
                                </div>
                            )}

                            {/* Language Selection */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                <div className="space-y-2">
                                    <Label>{t.sourceLanguage}</Label>
                                    <Select
                                        value={sourceLanguage}
                                        onChange={(e) => setSourceLanguage(e.target.value)}
                                        disabled={isProcessing}
                                    >
                                        <option value="auto">{t.autoDetect}</option>
                                        {SUPPORTED_LANGUAGES.map(lang => (
                                            <option key={lang.code} value={lang.code}>
                                                {lang.name}
                                            </option>
                                        ))}
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>{t.exportFormat}</Label>
                                    <Select
                                        value={exportFormat}
                                        onChange={(e) => setExportFormat(e.target.value)}
                                        disabled={isProcessing}
                                    >
                                        <option value="txt">Texte (.txt)</option>
                                        <option value="srt">Sous-titres (.srt)</option>
                                        <option value="vtt">WebVTT (.vtt)</option>
                                        <option value="json">JSON (.json)</option>
                                        <option value="tsv">TSV (.tsv)</option>
                                    </Select>
                                </div>
                            </div>

                            {/* Translation Toggle */}
                            <div className="flex items-center gap-2 pt-2">
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="translate-mode"
                                        checked={translateToEnglish}
                                        onCheckedChange={setTranslateToEnglish}
                                        disabled={isProcessing}
                                    />
                                    <Label htmlFor="translate-mode">{t.translateToEnglish}</Label>
                                </div>
                            </div>

                            {/* Advanced Options */}
                            {showAdvanced && !useCloudMode && (
                                <div className="space-y-2 p-4 rounded-lg border border-dashed">
                                    <Label htmlFor="custom-model" className="flex items-center gap-2">
                                        <FolderOpen className="h-4 w-4" />
                                        Modèle personnalisé (optionnel)
                                    </Label>
                                    <Input
                                        id="custom-model"
                                        type="text"
                                        placeholder="Chemin vers le dossier du modèle..."
                                        value={customModelPath}
                                        onChange={(e) => setCustomModelPath(e.target.value)}
                                        disabled={isProcessing}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Chemin vers un modèle Whisper personnalisé (faster-whisper format)
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Drop Zone / Recording Card */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg">
                                        {inputMode === 'record' ? t.audioRecording : t.fileToTranscribe}
                                    </CardTitle>
                                    <CardDescription>
                                        {inputMode === 'record'
                                            ? t.recordFromMicrophone
                                            : batchMode ? t.batchModeMultiple : t.dragMultipleForBatch}
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    {batchMode && (
                                        <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full">
                                            <Layers className="h-4 w-4 text-primary" />
                                            <span className="text-sm font-medium">{batchFiles.length} {t.filesSelected}</span>
                                        </div>
                                    )}
                                    {/* Recording Mode Toggle in DropZone Header */}
                                    <Button
                                        variant={inputMode === 'record' ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setInputMode(inputMode === 'record' ? 'file' : 'record')}
                                        className="gap-2"
                                    >
                                        <Mic className="h-4 w-4" />
                                        {inputMode === 'record' ? t.audioRecording : "REC"}
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {inputMode === 'record' ? (
                                <AudioRecorder
                                    onRecordingComplete={handleRecordingComplete}
                                    disabled={isProcessing}
                                    translations={t}
                                />
                            ) : (
                                <DropZone
                                    onFileSelect={setSelectedFile}
                                    onBatchSelect={handleBatchFilesSelect}
                                    selectedFile={selectedFile}
                                    batchFiles={batchFiles}
                                    onClear={handleClearFile}
                                    disabled={isProcessing}
                                    batchMode={batchMode}
                                    translations={t}
                                />
                            )}

                            {selectedFile && (
                                <div className="mt-4 flex gap-3">
                                    <Button
                                        onClick={handleStartTranscription}
                                        disabled={isProcessing}
                                        className="flex-1"
                                    >
                                        {isProcessing ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Traitement en cours...
                                            </>
                                        ) : (
                                            <>
                                                <Mic className="mr-2 h-4 w-4" />
                                                Transcrire
                                            </>
                                        )}
                                    </Button>
                                    {isProcessing && (
                                        <Button variant="outline" onClick={handleCancel}>
                                            Annuler
                                        </Button>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Progress Card */}
                    {progressInfo.status !== 'idle' && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    {progressInfo.status === 'error' ? (
                                        <AlertCircle className="h-5 w-5 text-destructive" />
                                    ) : progressInfo.status === 'complete' ? (
                                        <Check className="h-5 w-5 text-green-500" />
                                    ) : (
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    )}
                                    Progression
                                    {detectedLanguage && progressInfo.status === 'complete' && (
                                        <span className="text-sm font-normal text-muted-foreground ml-2">
                                            (Langue détectée : {detectedLanguage.toUpperCase()})
                                        </span>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Progress value={progressInfo.progress} className="h-2" />
                                <p className={`text - sm ${progressInfo.status === 'error' ? 'text-destructive' : 'text-muted-foreground'} `}>
                                    {progressInfo.message}
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Result Card */}
                    {transcriptionResult && (
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <CardTitle className="text-lg">Résultat</CardTitle>
                                    <div className="flex gap-2 flex-wrap">
                                        {/* Export buttons */}
                                        {EXPORT_FORMATS.map(format => (
                                            <Button
                                                key={format.id}
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleExport(format.id as 'txt' | 'srt' | 'vtt')}
                                                disabled={format.id !== 'txt' && segments.length === 0}
                                            >
                                                <FileText className="mr-2 h-4 w-4" />
                                                {format.id.toUpperCase()}
                                            </Button>
                                        ))}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCopy}
                                        >
                                            {copied ? (
                                                <>
                                                    <Check className="mr-2 h-4 w-4" />
                                                    Copié !
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="mr-2 h-4 w-4" />
                                                    Copier
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    value={transcriptionResult}
                                    onChange={(e) => setTranscriptionResult(e.target.value)}
                                    className="min-h-[200px] font-mono text-sm"
                                    placeholder="Le texte transcrit apparaîtra ici..."
                                />
                                {segments.length > 0 && (
                                    <p className="text-xs text-muted-foreground mt-2">
                                        {segments.length} segment(s) détecté(s) - Export SRT/VTT disponible
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Footer */}
                <footer className="mt-8 text-center text-sm text-muted-foreground">
                    <p>EchoScribe v1.1.0 • Powered by Whisper</p>
                </footer>
            </div >

            <Toaster />
        </div >
    )
}

// Extend Window interface for Electron API
declare global {
    interface Window {
        electronAPI?: {
            selectFile: () => Promise<string | null>
            startTranscription: (config: {
                filePath: string
                mode: 'local' | 'cloud'
                model: string
                apiKey?: string
                language?: string
                translate?: boolean
                customModelPath?: string
            }) => Promise<void>
            cancelTranscription: () => void
            listModels: () => void
            downloadModel: (modelName: string) => void
            saveFile: (content: string, filename: string, format: string) => Promise<void>
            onProgress: (callback: (event: unknown, data: { progress: number; message: string; stage: string }) => void) => void
            onComplete: (callback: (event: unknown, data: { text: string; segments?: Array<{ start: number; end: number; text: string }>; detected_language?: string }) => void) => void
            onError: (callback: (event: unknown, data: { error: string }) => void) => void
            onDownloadProgress?: (callback: (event: unknown, data: { model: string; progress: number; message: string }) => void) => void
            onDownloadComplete?: (callback: (event: unknown, data: { model: string; success: boolean }) => void) => void
            onModelsList?: (callback: (event: unknown, data: { models: Record<string, unknown> }) => void) => void
            openModelsFolder?: () => Promise<boolean>
        }
    }
}

export default App
