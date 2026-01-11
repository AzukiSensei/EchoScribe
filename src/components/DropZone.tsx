import React, { useCallback, useState } from 'react'
import { Upload, FileAudio, FileVideo, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Supported file formats for transcription
const ACCEPTED_FORMATS = ['.mp3', '.wav', '.mp4', '.mkv', '.mov']
const VIDEO_FORMATS = ['.mp4', '.mkv', '.mov']

interface DropZoneProps {
    onFileSelect: (file: File) => void
    selectedFile: File | null
    onClear: () => void
    disabled?: boolean
}

/**
 * Drag & Drop zone for media files
 * Supports audio (.mp3, .wav) and video (.mp4, .mkv, .mov) formats
 */
export function DropZone({ onFileSelect, selectedFile, onClear, disabled }: DropZoneProps) {
    const [isDragging, setIsDragging] = useState(false)

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        if (!disabled) {
            setIsDragging(true)
        }
    }, [disabled])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        if (disabled) return

        const file = e.dataTransfer.files[0]
        if (file && isValidFile(file)) {
            onFileSelect(file)
        }
    }, [onFileSelect, disabled])

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file && isValidFile(file)) {
            onFileSelect(file)
        }
        // Reset input value to allow selecting the same file again
        e.target.value = ''
    }, [onFileSelect])

    const isValidFile = (file: File): boolean => {
        const extension = '.' + file.name.split('.').pop()?.toLowerCase()
        return ACCEPTED_FORMATS.includes(extension)
    }

    const isVideoFile = (file: File): boolean => {
        const extension = '.' + file.name.split('.').pop()?.toLowerCase()
        return VIDEO_FORMATS.includes(extension)
    }

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    }

    return (
        <div
            className={cn(
                "drop-zone relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer",
                isDragging && "active border-primary bg-primary/10",
                !isDragging && !selectedFile && "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
                selectedFile && "border-primary/50 bg-primary/5",
                disabled && "opacity-50 cursor-not-allowed"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !disabled && !selectedFile && document.getElementById('file-input')?.click()}
        >
            <input
                id="file-input"
                type="file"
                className="hidden"
                accept={ACCEPTED_FORMATS.join(',')}
                onChange={handleFileInput}
                disabled={disabled}
            />

            {selectedFile ? (
                <div className="flex items-center justify-center gap-4">
                    <div className="flex items-center gap-3">
                        {isVideoFile(selectedFile) ? (
                            <FileVideo className="h-10 w-10 text-primary" />
                        ) : (
                            <FileAudio className="h-10 w-10 text-primary" />
                        )}
                        <div className="text-left">
                            <p className="font-medium text-foreground truncate max-w-[300px]">
                                {selectedFile.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {formatFileSize(selectedFile.size)}
                                {isVideoFile(selectedFile) && (
                                    <span className="ml-2 text-xs bg-secondary px-2 py-0.5 rounded">
                                        Vidéo → Audio
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    {!disabled && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onClear()
                            }}
                            className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <Upload className={cn(
                            "h-8 w-8 transition-transform",
                            isDragging ? "text-primary scale-110" : "text-muted-foreground"
                        )} />
                    </div>
                    <div>
                        <p className="font-medium text-foreground">
                            Glissez-déposez votre fichier ici
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                            ou cliquez pour sélectionner
                        </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                        {ACCEPTED_FORMATS.map((format) => (
                            <span
                                key={format}
                                className="px-2 py-1 rounded bg-muted"
                            >
                                {format}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
