import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Square, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AudioRecorderProps {
    onRecordingComplete: (audioBlob: Blob, filename: string) => void
    disabled?: boolean
}

/**
 * Audio Recorder component for live recording and transcription
 */
export function AudioRecorder({ onRecordingComplete, disabled }: AudioRecorderProps) {
    const [isRecording, setIsRecording] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const [audioLevel, setAudioLevel] = useState(0)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animationFrameRef = useRef<number | null>(null)

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
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            })

            // Setup audio analyser for visualization
            const audioContext = new AudioContext()
            const source = audioContext.createMediaStreamSource(stream)
            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)
            analyserRef.current = analyser

            // Setup media recorder
            const mediaRecorder = new MediaRecorder(stream, {
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
                onRecordingComplete(audioBlob, filename)

                // Cleanup
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
            } else {
                mediaRecorderRef.current.pause()
                if (timerRef.current) {
                    clearInterval(timerRef.current)
                }
            }
            setIsPaused(!isPaused)
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
        }
    }, [])

    return (
        <div className={cn(
            "border-2 border-dashed rounded-xl p-6 text-center transition-all",
            isRecording ? "border-red-500 bg-red-500/5" : "border-muted-foreground/25 hover:border-primary/50",
            disabled && "opacity-50 pointer-events-none"
        )}>
            {!isRecording ? (
                <div className="space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Mic className="h-8 w-8 text-red-500" />
                    </div>
                    <div>
                        <p className="font-medium text-foreground">Enregistrement en direct</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Cliquez pour commencer l'enregistrement
                        </p>
                    </div>
                    <Button
                        onClick={startRecording}
                        variant="destructive"
                        size="lg"
                        disabled={disabled}
                    >
                        <Mic className="h-4 w-4 mr-2" />
                        Commencer l'enregistrement
                    </Button>
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
                        {isPaused ? "En pause" : "Enregistrement en cours..."}
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
                            Arrêter et transcrire
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AudioRecorder
