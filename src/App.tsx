import { useState, useEffect, useCallback } from 'react'
import {
    Mic,
    Cloud,
    Settings,
    Copy,
    Check,
    Loader2,
    AlertCircle,
    Cpu,
    Zap
} from 'lucide-react'

import { DropZone } from '@/components/DropZone'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Toaster, useToast } from '@/components/ui/toaster'

// Available Whisper models with their VRAM requirements
const WHISPER_MODELS = [
    { id: 'tiny', name: 'Tiny', vram: '~1 GB', speed: 'Très rapide' },
    { id: 'base', name: 'Base', vram: '~1 GB', speed: 'Rapide' },
    { id: 'small', name: 'Small', vram: '~2 GB', speed: 'Moyen' },
    { id: 'medium', name: 'Medium', vram: '~5 GB', speed: 'Lent' },
    { id: 'large-v3', name: 'Large V3', vram: '~6 GB', speed: 'Très lent' },
    { id: 'large-v3-turbo', name: 'Large V3 Turbo', vram: '~6 GB', speed: 'Rapide (optimisé)' },
]

// Transcription status types
type TranscriptionStatus = 'idle' | 'extracting' | 'transcribing' | 'complete' | 'error'

interface ProgressInfo {
    status: TranscriptionStatus
    progress: number
    message: string
}

/**
 * Main application component for EchoScribe
 * Handles file selection, transcription mode, and result display
 */
function App() {
    // File state
    const [selectedFile, setSelectedFile] = useState<File | null>(null)

    // Transcription mode: false = local, true = cloud
    const [useCloudMode, setUseCloudMode] = useState(false)
    const [apiKey, setApiKey] = useState('')
    const [selectedModel, setSelectedModel] = useState('large-v3-turbo')

    // Progress state
    const [progressInfo, setProgressInfo] = useState<ProgressInfo>({
        status: 'idle',
        progress: 0,
        message: ''
    })

    // Result state
    const [transcriptionResult, setTranscriptionResult] = useState('')
    const [copied, setCopied] = useState(false)

    const { toast } = useToast()

    // Load saved API key from localStorage
    useEffect(() => {
        const savedApiKey = localStorage.getItem('echoscribe_api_key')
        if (savedApiKey) {
            setApiKey(savedApiKey)
        }
    }, [])

    // Save API key to localStorage when it changes
    useEffect(() => {
        if (apiKey) {
            localStorage.setItem('echoscribe_api_key', apiKey)
        }
    }, [apiKey])

    // Setup IPC listeners for progress updates from Electron main process
    useEffect(() => {
        // Check if we're running in Electron
        if (window.electronAPI) {
            // Progress updates during transcription
            window.electronAPI.onProgress((_event: unknown, data: { progress: number; message: string; stage: string }) => {
                setProgressInfo({
                    status: data.stage === 'extracting' ? 'extracting' : 'transcribing',
                    progress: data.progress,
                    message: data.message
                })
            })

            // Transcription completed
            window.electronAPI.onComplete((_event: unknown, data: { text: string }) => {
                setTranscriptionResult(data.text)
                setProgressInfo({
                    status: 'complete',
                    progress: 100,
                    message: 'Transcription terminée !'
                })
                toast({
                    title: 'Succès',
                    description: 'La transcription est terminée.',
                    variant: 'success'
                })
            })

            // Error handling
            window.electronAPI.onError((_event: unknown, data: { error: string }) => {
                setProgressInfo({
                    status: 'error',
                    progress: 0,
                    message: data.error
                })
                toast({
                    title: 'Erreur',
                    description: data.error,
                    variant: 'destructive'
                })
            })
        }
    }, [toast])

    // Start transcription
    const handleStartTranscription = useCallback(async () => {
        if (!selectedFile) return

        // Validate API key for cloud mode
        if (useCloudMode && !apiKey.trim()) {
            toast({
                title: 'Clé API requise',
                description: 'Veuillez entrer votre clé API OpenAI pour utiliser le mode cloud.',
                variant: 'destructive'
            })
            return
        }

        setTranscriptionResult('')
        setProgressInfo({
            status: 'extracting',
            progress: 0,
            message: 'Préparation du fichier...'
        })

        try {
            if (window.electronAPI) {
                // Running in Electron - use IPC
                // In Electron, File objects have a 'path' property
                const filePath = (selectedFile as File & { path: string }).path
                await window.electronAPI.startTranscription({
                    filePath,
                    mode: useCloudMode ? 'cloud' : 'local',
                    model: selectedModel,
                    apiKey: useCloudMode ? apiKey : undefined
                })
            } else {
                // Development mode - simulate transcription
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
    }, [selectedFile, useCloudMode, apiKey, selectedModel, toast])

    // Simulate transcription for development without Electron
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
                    message: `Transcription en cours... ${progress}%`
                })
            } else {
                clearInterval(interval)
                setProgressInfo({
                    status: 'complete',
                    progress: 100,
                    message: 'Transcription terminée !'
                })
                setTranscriptionResult(
                    "Ceci est un exemple de transcription simulée pour le mode développement.\n\n" +
                    "L'application EchoScribe utilise Whisper pour transcrire vos fichiers audio et vidéo avec une grande précision.\n\n" +
                    "En mode production, le texte transcrit de votre fichier apparaîtra ici."
                )
                toast({
                    title: 'Succès (Simulation)',
                    description: 'La transcription simulée est terminée.',
                    variant: 'success'
                })
            }
        }, 200)
    }

    // Cancel ongoing transcription
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

    // Copy result to clipboard
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(transcriptionResult)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
            toast({
                title: 'Copié !',
                description: 'Le texte a été copié dans le presse-papier.',
            })
        } catch (error) {
            toast({
                title: 'Erreur',
                description: 'Impossible de copier le texte.',
                variant: 'destructive'
            })
        }
    }, [transcriptionResult, toast])

    // Clear file selection
    const handleClearFile = useCallback(() => {
        setSelectedFile(null)
        setTranscriptionResult('')
        setProgressInfo({
            status: 'idle',
            progress: 0,
            message: ''
        })
    }, [])

    const isProcessing = progressInfo.status === 'extracting' || progressInfo.status === 'transcribing'

    return (
        <div className="min-h-screen bg-background dark">
            <div className="container mx-auto py-8 px-4 max-w-4xl">
                {/* Header */}
                <header className="text-center mb-8">
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <div className="p-3 rounded-xl bg-primary/10">
                            <Mic className="h-8 w-8 text-primary" />
                        </div>
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                            EchoScribe
                        </h1>
                    </div>
                    <p className="text-muted-foreground">
                        Transcription audio et vidéo avec Whisper
                    </p>
                </header>

                <div className="space-y-6">
                    {/* Settings Card */}
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Settings className="h-5 w-5 text-muted-foreground" />
                                    <CardTitle className="text-lg">Configuration</CardTitle>
                                </div>
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
                                            {useCloudMode ? 'Mode Cloud (API OpenAI)' : 'Mode Local (faster-whisper)'}
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            {useCloudMode
                                                ? 'Utilise les serveurs OpenAI pour la transcription'
                                                : 'Transcription sur votre machine avec GPU'}
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
                                <div className="space-y-2">
                                    <Label htmlFor="model-select" className="flex items-center gap-2">
                                        <Zap className="h-4 w-4" />
                                        Modèle Whisper
                                    </Label>
                                    <Select
                                        id="model-select"
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                        disabled={isProcessing}
                                    >
                                        {WHISPER_MODELS.map((model) => (
                                            <option key={model.id} value={model.id}>
                                                {model.name} - {model.vram} - {model.speed}
                                            </option>
                                        ))}
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        Les modèles plus grands offrent une meilleure précision mais nécessitent plus de VRAM
                                    </p>
                                </div>
                            )}

                            {/* API Key Input (Cloud mode only) */}
                            {useCloudMode && (
                                <div className="space-y-2">
                                    <Label htmlFor="api-key">Clé API OpenAI</Label>
                                    <Input
                                        id="api-key"
                                        type="password"
                                        placeholder="sk-..."
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        disabled={isProcessing}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Votre clé est stockée localement et n'est jamais partagée
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Drop Zone Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Fichier à transcrire</CardTitle>
                            <CardDescription>
                                Formats supportés : MP3, WAV, MP4, MKV, MOV
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DropZone
                                onFileSelect={setSelectedFile}
                                selectedFile={selectedFile}
                                onClear={handleClearFile}
                                disabled={isProcessing}
                            />

                            {/* Action Buttons */}
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
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Progress value={progressInfo.progress} className="h-2" />
                                <p className={`text-sm ${progressInfo.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {progressInfo.message}
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Result Card */}
                    {transcriptionResult && (
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg">Résultat</CardTitle>
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
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    value={transcriptionResult}
                                    onChange={(e) => setTranscriptionResult(e.target.value)}
                                    className="min-h-[200px] font-mono text-sm"
                                    placeholder="Le texte transcrit apparaîtra ici..."
                                />
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Footer */}
                <footer className="mt-8 text-center text-sm text-muted-foreground">
                    <p>EchoScribe v1.0.0 • Powered by Whisper</p>
                </footer>
            </div>

            <Toaster />
        </div>
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
            }) => Promise<void>
            cancelTranscription: () => void
            onProgress: (callback: (event: unknown, data: { progress: number; message: string; stage: string }) => void) => void
            onComplete: (callback: (event: unknown, data: { text: string }) => void) => void
            onError: (callback: (event: unknown, data: { error: string }) => void) => void
        }
    }
}

export default App
