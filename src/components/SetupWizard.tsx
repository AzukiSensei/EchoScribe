import { useState, useEffect } from 'react'
import { Check, X, Loader2, Download, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Translations } from '@/i18n'

interface DependencyStatus {
    python: { installed: boolean; version: string | null }
    pip: { installed: boolean; version: string | null }
    ffmpeg: { installed: boolean; version: string | null }
    fasterWhisper: { installed: boolean }
    pytorch: { installed: boolean; cuda: boolean }
}

interface SetupWizardProps {
    onComplete: () => void
    onSkip: () => void
    translations: Translations
}

/**
 * Setup wizard component to check and install dependencies
 */
export function SetupWizard({ onComplete, onSkip, translations: t }: SetupWizardProps) {
    const [checking, setChecking] = useState(true)
    const [deps, setDeps] = useState<DependencyStatus | null>(null)
    const [installing, setInstalling] = useState<string | null>(null)
    const [installProgress, setInstallProgress] = useState(0)

    useEffect(() => {
        checkDependencies()
    }, [])

    const checkDependencies = async () => {
        setChecking(true)
        try {
            if (window.electronAPI && 'checkDependencies' in window.electronAPI) {
                const result = await (window.electronAPI as { checkDependencies: () => Promise<DependencyStatus> }).checkDependencies()
                setDeps(result)
            }
        } catch (error) {
            console.error('Error checking dependencies:', error)
        }
        setChecking(false)
    }

    const installDependency = async (dep: string) => {
        setInstalling(dep)
        setInstallProgress(10)

        try {
            if (window.electronAPI && 'installDependency' in window.electronAPI) {
                const interval = setInterval(() => {
                    setInstallProgress(prev => Math.min(prev + 5, 90))
                }, 1000)

                await (window.electronAPI as { installDependency: (dep: string) => Promise<{ success: boolean }> }).installDependency(dep)

                clearInterval(interval)
                setInstallProgress(100)

                // Re-check after install
                setTimeout(() => {
                    setInstalling(null)
                    setInstallProgress(0)
                    checkDependencies()
                }, 1000)
            }
        } catch (error) {
            console.error('Error installing dependency:', error)
            setInstalling(null)
        }
    }

    const allInstalled = deps && deps.python.installed && deps.ffmpeg.installed && deps.fasterWhisper.installed

    if (checking) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <Card className="w-full max-w-lg">
                    <CardContent className="flex flex-col items-center justify-center p-12">
                        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                        <p className="text-lg font-medium">{t.checking}</p>
                        <p className="text-sm text-muted-foreground mt-2">
                            {t.checkingDescription}
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle className="text-2xl">{t.setupTitle}</CardTitle>
                    <CardDescription>
                        {t.setupDescription}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Python */}
                    <DependencyRow
                        name="Python 3.11+"
                        description={t.pythonEngine}
                        installed={deps?.python.installed || false}
                        version={deps?.python.version}
                        installing={installing === 'python'}
                        progress={installing === 'python' ? installProgress : 0}
                        onInstall={() => installDependency('python')}
                        translations={t}
                    />

                    {/* FFmpeg */}
                    <DependencyRow
                        name="FFmpeg"
                        description={t.audioExtraction}
                        installed={deps?.ffmpeg.installed || false}
                        version={deps?.ffmpeg.version}
                        installing={installing === 'ffmpeg'}
                        progress={installing === 'ffmpeg' ? installProgress : 0}
                        onInstall={() => installDependency('ffmpeg')}
                        disabled={!deps?.python.installed}
                        translations={t}
                    />

                    {/* faster-whisper */}
                    <DependencyRow
                        name="faster-whisper"
                        description={t.transcriptionModel}
                        installed={deps?.fasterWhisper.installed || false}
                        installing={installing === 'fasterWhisper'}
                        progress={installing === 'fasterWhisper' ? installProgress : 0}
                        onInstall={() => installDependency('fasterWhisper')}
                        disabled={!deps?.python.installed}
                        translations={t}
                    />

                    {/* PyTorch */}
                    <DependencyRow
                        name="PyTorch + CUDA"
                        description={deps?.pytorch.cuda ? t.gpuDetected : t.gpuAcceleration}
                        installed={deps?.pytorch.installed || false}
                        installing={installing === 'pytorch'}
                        progress={installing === 'pytorch' ? installProgress : 0}
                        onInstall={() => installDependency('pytorch')}
                        disabled={!deps?.python.installed}
                        optional
                        translations={t}
                    />

                    {/* Warning if not all installed */}
                    {!allInstalled && (
                        <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-yellow-500">{t.dependenciesMissing}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t.dependenciesMissingDesc}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-between pt-4 border-t">
                        <Button variant="ghost" onClick={onSkip}>
                            {t.skip}
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={checkDependencies}>
                                {t.recheck}
                            </Button>
                            <Button onClick={onComplete} disabled={!allInstalled && installing !== null}>
                                {allInstalled ? t.continue : t.continueAnyway}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

interface DependencyRowProps {
    name: string
    description: string
    installed: boolean
    version?: string | null
    installing?: boolean
    progress?: number
    onInstall: () => void
    disabled?: boolean
    optional?: boolean
    translations: Translations
}

function DependencyRow({
    name,
    description,
    installed,
    version,
    installing,
    progress = 0,
    onInstall,
    disabled,
    optional,
    translations: t
}: DependencyRowProps) {
    return (
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full ${installed
                    ? 'bg-green-500/20 text-green-500'
                    : optional
                        ? 'bg-yellow-500/20 text-yellow-500'
                        : 'bg-red-500/20 text-red-500'
                    }`}>
                    {installing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : installed ? (
                        <Check className="h-4 w-4" />
                    ) : (
                        <X className="h-4 w-4" />
                    )}
                </div>
                <div>
                    <p className="font-medium text-sm">
                        {name}
                        {optional && <span className="text-xs text-muted-foreground ml-2">({t.optional})</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {version || description}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {installing && (
                    <div className="w-24">
                        <Progress value={progress} className="h-2" />
                    </div>
                )}
                {!installed && !installing && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onInstall}
                        disabled={disabled}
                    >
                        <Download className="h-4 w-4 mr-1" />
                        {t.install}
                    </Button>
                )}
            </div>
        </div>
    )
}

export default SetupWizard
