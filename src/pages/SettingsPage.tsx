import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Save, FolderOpen } from 'lucide-react'
import { useToast } from '@/components/ui/toaster'
import { Translations } from '../i18n'

interface SettingsPageProps {
    t: Translations
    onBack: () => void
    settings: {
        apiKey: string
        setApiKey: (key: string) => void
        customModelPath: string
        setCustomModelPath: (path: string) => void
    }
}

export function SettingsPage({ t, onBack, settings }: SettingsPageProps) {
    const { toast } = useToast()
    const [localApiKey, setLocalApiKey] = useState(settings.apiKey)
    const [localCustomPath, setLocalCustomPath] = useState(settings.customModelPath)

    const handleSave = () => {
        settings.setApiKey(localApiKey)
        settings.setCustomModelPath(localCustomPath)
        toast({
            title: t.success || "Success",
            description: "Settings saved successfully",
        })
    }

    const openModelsFolder = async () => {
        if (window.electronAPI?.openModelsFolder) {
            await window.electronAPI.openModelsFolder()
        }
    }

    return (
        <div className="container mx-auto p-4 max-w-2xl space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <h1 className="text-2xl font-bold">Settings</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Generals</CardTitle>
                    <CardDescription>Configure general application settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Models Directory</Label>
                        <div className="flex gap-2">
                            <Input value={"Documents/Models"} disabled />
                            <Button variant="outline" onClick={openModelsFolder}>
                                <FolderOpen className="h-4 w-4 mr-2" />
                                Open
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Standard path for storing downloaded models</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>OpenAI Cloud Mode</CardTitle>
                    <CardDescription>Configure API key for cloud transcription</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        <Input
                            id="apiKey"
                            type="password"
                            value={localApiKey}
                            onChange={(e) => setLocalApiKey(e.target.value)}
                            placeholder="sk-..."
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Custom Models (Advanced)</CardTitle>
                    <CardDescription>Path to custom GGUF/bin models</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="customPath">Custom Model Path</Label>
                        <Input
                            id="customPath"
                            value={localCustomPath}
                            onChange={(e) => setLocalCustomPath(e.target.value)}
                            placeholder="C:/Path/To/Model"
                        />
                        <p className="text-xs text-muted-foreground">Full path to a specific model directory</p>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onBack}>Cancel</Button>
                <Button onClick={handleSave}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                </Button>
            </div>
        </div>
    )
}
