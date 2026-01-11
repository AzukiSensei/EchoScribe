import React, { useCallback, useState } from 'react'
import { Upload, FileAudio, FileVideo, X, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Translations } from '@/i18n'

// Supported file formats for transcription
const ACCEPTED_FORMATS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mkv', '.mov', '.avi', '.webm']
const VIDEO_FORMATS = ['.mp4', '.mkv', '.mov', '.avi', '.webm']

interface DropZoneProps {
    onFileSelect: (file: File) => void
    onBatchSelect?: (files: File[]) => void
    selectedFile: File | null
    batchFiles?: File[]
    onClear: () => void
    disabled?: boolean
    batchMode?: boolean
    translations: Translations
}

/**
 * Drag & Drop zone for media files
 * Supports single file and batch mode with multiple files
 */
export function DropZone({
    onFileSelect,
    onBatchSelect,
    selectedFile,
    batchFiles = [],
    onClear,
    disabled,
    batchMode = false,
    translations: t
}: DropZoneProps) {
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

        const files = Array.from(e.dataTransfer.files).filter(isValidFile)

        if (files.length > 1 && onBatchSelect) {
            // Multiple files dropped - switch to batch mode
            onBatchSelect(files)
        } else if (files.length === 1) {
            onFileSelect(files[0])
        }
    }, [onFileSelect, onBatchSelect, disabled])

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files).filter(isValidFile) : []

        if (files.length > 1 && onBatchSelect) {
            onBatchSelect(files)
        } else if (files.length === 1) {
            onFileSelect(files[0])
        }
        // Reset input value to allow selecting the same file again
        e.target.value = ''
    }, [onFileSelect, onBatchSelect])

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

    // Render batch files list
    if (batchMode && batchFiles.length > 0) {
        return (
            <div className="border-2 border-dashed rounded-xl p-4 border-primary/50 bg-primary/5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Layers className="h-5 w-5 text-primary" />
                        <span className="font-medium">{t.batchModeMultiple} - {batchFiles.length} {t.filesSelected}</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClear}
                        disabled={disabled}
                    >
                        <X className="h-4 w-4 mr-1" />
                        {t.clearAll}
                    </Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2">
                    {batchFiles.map((file, index) => (
                        <div
                            key={`${file.name}-${index}`}
                            className="flex items-center gap-2 p-2 rounded bg-muted/50"
                        >
                            {isVideoFile(file) ? (
                                <FileVideo className="h-4 w-4 text-primary flex-shrink-0" />
                            ) : (
                                <FileAudio className="h-4 w-4 text-primary flex-shrink-0" />
                            )}
                            <span className="text-sm truncate flex-1">{file.name}</span>
                            <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3 text-center">
                    {t.dragMoreToAdd}
                </p>
            </div>
        )
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
                multiple // Enable multiple file selection
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
                                        {t.audioExtraction}
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
                            {t.dragDropFiles}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                            {t.clickToSelect} • <span className="text-primary">{t.batchModeMultiple}</span>
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
