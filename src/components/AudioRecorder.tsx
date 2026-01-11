import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Square, Pause, Play, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface AudioRecorderProps {
    onRecordingComplete: (audioBlob: Blob, filename: string) => void
    disabled?: boolean
    translations?: {
        startRecording: string
        stopAndTranscribe: string
        recording: string
        paused: string
        liveRecording: string
        clickToStartRecording: string
        selectMicrophone: string
        listenRecording: string
    }
}

interface AudioDevice {
    deviceId: string
    label: string
}

/**
 * Audio Recorder component for live recording and transcription
 * Supports mic selection and playback of recorded audio
 */
export function AudioRecorder({ onRecordingComplete, disabled, translations }: AudioRecorderProps) {
    const t = translations || {
        startRecording: 'Commencer l\'enregistrement',
        stopAndTranscribe: 'Arrêter et transcrire',
        recording: 'Enregistrement en cours...',
        paused: 'En pause',
        liveRecording: 'Enregistrement en direct',
        clickToStartRecording: 'Cliquez pour commencer l\'enregistrement',
        selectMicrophone: 'Sélectionner le microphone',
        listenRecording: 'Écouter l\'enregistrement',
        includeSystemAudio: 'Inclure le son système',
    }

    const [isRecording, setIsRecording] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const [includeSystemAudio, setIncludeSystemAudio] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const [audioLevel, setAudioLevel] = useState(0)
    const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
    const [selectedDevice, setSelectedDevice] = useState<string>('')
    const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animationFrameRef = useRef<number | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)

    // Load available audio devices on mount
    useEffect(() => {
        loadAudioDevices()
    }, [])

    const loadAudioDevices = async () => {
        try {
            // Request permission first to get device labels
            await navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => stream.getTracks().forEach(track => track.stop()))

            const devices = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = devices
                .filter(device => device.kind === 'audioinput')
                .map(device => ({
                    deviceId: device.deviceId,
                    label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`
                }))

            setAudioDevices(audioInputs)
            if (audioInputs.length > 0 && !selectedDevice) {
                setSelectedDevice(audioInputs[0].deviceId)
            }
        } catch (error) {
            console.error('Error loading audio devices:', error)
        }
    }

    // Format time as MM:SS
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    // Update audio level visualization
    const updateAudioLevel = useCallback(() => {
        if (analyserRef.current && isRecording && !isPaused) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
            analyserRef.current.getByteFrequencyData(dataArray)
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
            setAudioLevel(average / 255)
            animationFrameRef.current = requestAnimationFrame(updateAudioLevel)
        }
    }, [isRecording, isPaused])

    // Start recording
    const startRecording = async () => {
        try {
            // Clear previous recording
            if (recordedAudioUrl) {
                URL.revokeObjectURL(recordedAudioUrl)
                setRecordedAudioUrl(null)
            }

            const constraints: MediaStreamConstraints = {
                audio: selectedDevice ? {
                    deviceId: { exact: selectedDevice },
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                } : {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            }

            const stream = await navigator.mediaDevices.getUserMedia(constraints)
            streamRef.current = stream

            // Setup audio context for mixing and analysis
            const audioContext = new AudioContext()
            audioContextRef.current = audioContext
            const dest = audioContext.createMediaStreamDestination()

            // Connect microphone
            const micSource = audioContext.createMediaStreamSource(stream)
            micSource.connect(dest)

            // Connect analyser to microphone source (for visualization)
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            micSource.connect(analyser)
            analyserRef.current = analyser

            // Handle System Audio if requested
            let systemStream: MediaStream | null = null
            if (includeSystemAudio) {
                try {
                    // @ts-ignore - getDisplayMedia exists
                    systemStream = await navigator.mediaDevices.getDisplayMedia({
                        video: true, // Required to get audio on some platforms
                        audio: true
                    })

                    if (systemStream) {
                        // Check if we actually got an audio track
                        const audioTrack = systemStream.getAudioTracks()[0]
                        if (audioTrack) {
                            const sysSource = audioContext.createMediaStreamSource(systemStream)
                            sysSource.connect(dest)
                        } else {
                            console.warn("No system audio track obtained")
                        }
                        // Stop video track immediately as we don't need it
                        systemStream.getVideoTracks().forEach(track => track.stop())
                    }
                } catch (err) {
                    console.error("Could not get system audio:", err)
                }
            }

            // Use the mixed stream for recording
            const mixedStream = dest.stream
            const mediaRecorder = new MediaRecorder(mixedStream, {
                mimeType: 'audio/webm;codecs=opus'
            })

            mediaRecorderRef.current = mediaRecorder
            audioChunksRef.current = []

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data)
                }
            }

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                const filename = `recording_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`

                // Create URL for playback
                const url = URL.createObjectURL(audioBlob)
                setRecordedAudioUrl(url)

                // Send to parent
                onRecordingComplete(audioBlob, filename)

                // Cleanup stream
                stream.getTracks().forEach(track => track.stop())
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current)
                }
            }

            mediaRecorder.start(100) // Collect data every 100ms
            setIsRecording(true)
            setIsPaused(false)
            setRecordingTime(0)

            // Start timer
            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1)
            }, 1000)

            // Start audio level visualization
            updateAudioLevel()

        } catch (error) {
            console.error('Failed to start recording:', error)
        }
    }

    // Stop recording
    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (audioContextRef.current) {
            audioContextRef.current.close()
        }
        setIsRecording(false)
        setIsPaused(false)
        setAudioLevel(0)
    }

    // Pause/Resume recording
    const togglePause = () => {
        if (mediaRecorderRef.current) {
            if (isPaused) {
                mediaRecorderRef.current.resume()
                timerRef.current = setInterval(() => {
                    setRecordingTime(prev => prev + 1)
                }, 1000)
                animationFrameRef.current = requestAnimationFrame(updateAudioLevel)
            } else {
                mediaRecorderRef.current.pause()
                if (timerRef.current) {
                    clearInterval(timerRef.current)
                }
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current)
                }
            }
            setIsPaused(!isPaused)
        }
    }

    // Play recorded audio
    const playRecording = () => {
        if (audioPlayerRef.current && recordedAudioUrl) {
            if (isPlaying) {
                audioPlayerRef.current.pause()
                audioPlayerRef.current.currentTime = 0
                setIsPlaying(false)
            } else {
                audioPlayerRef.current.play()
                setIsPlaying(true)
            }
        }
    }

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current)
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current)
            }
            if (recordedAudioUrl) {
                URL.revokeObjectURL(recordedAudioUrl)
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
            }
        }
    }, [recordedAudioUrl])

    return (
        <div className={cn(
            "border-2 border-dashed rounded-xl p-6 text-center transition-all",
            isRecording ? "border-red-500 bg-red-500/5" : "border-muted-foreground/25 hover:border-primary/50",
            disabled && "opacity-50 pointer-events-none"
        )}>
            {/* Hidden audio player for playback */}
            <audio
                ref={audioPlayerRef}
                src={recordedAudioUrl || undefined}
                onEnded={() => setIsPlaying(false)}
            />

            {/* Microphone selection */}
            {!isRecording && audioDevices.length > 1 && (
                <div className="mb-4 space-y-4">
                    <Select
                        value={selectedDevice}
                        onChange={(e) => setSelectedDevice(e.target.value)}
                        className="w-full max-w-xs mx-auto"
                    >
                        {audioDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label}
                            </option>
                        ))}
                    </Select>

                    <div className="flex items-center justify-center space-x-2">
                        <Switch
                            id="system-audio"
                            checked={includeSystemAudio}
                            onCheckedChange={setIncludeSystemAudio}
                        />
                        <Label htmlFor="system-audio">{t.includeSystemAudio}</Label>
                    </div>
                </div>
            )}

            {!isRecording ? (
                <div className="space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Mic className="h-8 w-8 text-red-500" />
                    </div>
                    <div>
                        <p className="font-medium text-foreground">{t.liveRecording}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            {t.clickToStartRecording}
                        </p>
                    </div>

                    <div className="flex justify-center gap-2">
                        <Button
                            onClick={startRecording}
                            variant="destructive"
                            size="lg"
                            disabled={disabled}
                        >
                            <Mic className="h-4 w-4 mr-2" />
                            {t.startRecording}
                        </Button>

                        {/* Play button for previous recording */}
                        {recordedAudioUrl && (
                            <Button
                                onClick={playRecording}
                                variant="outline"
                                size="lg"
                            >
                                {isPlaying ? (
                                    <Square className="h-4 w-4 mr-2" />
                                ) : (
                                    <Volume2 className="h-4 w-4 mr-2" />
                                )}
                                {t.listenRecording}
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Audio level indicator */}
                    <div className="flex justify-center items-center gap-1 h-16">
                        {[...Array(20)].map((_, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "w-1.5 rounded-full transition-all duration-75",
                                    i / 20 < audioLevel ? "bg-red-500" : "bg-muted"
                                )}
                                style={{
                                    height: `${Math.max(8, (isPaused ? 30 : Math.random() * 50 + audioLevel * 50))}px`
                                }}
                            />
                        ))}
                    </div>

                    {/* Timer */}
                    <div className="flex items-center justify-center gap-2">
                        <span className={cn(
                            "inline-block w-3 h-3 rounded-full animate-pulse",
                            isPaused ? "bg-yellow-500" : "bg-red-500"
                        )} />
                        <span className="text-2xl font-mono font-bold">
                            {formatTime(recordingTime)}
                        </span>
                    </div>

                    <p className="text-sm text-muted-foreground">
                        {isPaused ? t.paused : t.recording}
                    </p>

                    {/* Controls */}
                    <div className="flex justify-center gap-3">
                        <Button
                            onClick={togglePause}
                            variant="outline"
                            size="icon"
                        >
                            {isPaused ? (
                                <Play className="h-4 w-4" />
                            ) : (
                                <Pause className="h-4 w-4" />
                            )}
                        </Button>
                        <Button
                            onClick={stopRecording}
                            variant="destructive"
                            size="lg"
                        >
                            <Square className="h-4 w-4 mr-2" />
                            {t.stopAndTranscribe}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AudioRecorder
