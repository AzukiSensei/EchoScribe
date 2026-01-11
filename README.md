# EchoScribe 🎙️

Application desktop de transcription audio/vidéo locale utilisant Whisper.

![EchoScribe](https://img.shields.io/badge/Electron-React-blue)
![Python](https://img.shields.io/badge/Python-3.10+-yellow)
![Whisper](https://img.shields.io/badge/Whisper-faster--whisper-green)

## 🚀 Fonctionnalités

- **Transcription locale** avec faster-whisper (GPU/CPU)
- **Transcription cloud** via l'API OpenAI Whisper
- **Support multi-format** : MP3, WAV, MP4, MKV, MOV
- **Extraction audio automatique** des vidéos avec FFmpeg
- **Interface moderne** avec ShadCN UI et Tailwind CSS
- **Sélection de modèles** : tiny, base, small, medium, large-v3, large-v3-turbo

## 📋 Prérequis

### Système
- **Node.js** 18+ et npm
- **Python** 3.10+
- **FFmpeg** (dans le PATH ou installé dans `C:\ffmpeg\bin`)

### Pour le mode local (GPU recommandé)
- **CUDA Toolkit** 11.8+ (pour l'accélération GPU)
- **cuDNN** compatible

## 🛠️ Installation

### 1. Cloner le projet

```bash
git clone https://github.com/votre-repo/echoscribe.git
cd echoscribe
```

### 2. Installer les dépendances Node.js

```bash
npm install
```

### 3. Installer les dépendances Python

```bash
cd python
pip install -r requirements.txt

# Pour l'accélération GPU (CUDA 11.8) :
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# OU pour CPU uniquement :
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
```

### 4. Installer FFmpeg

#### Windows
Téléchargez FFmpeg depuis [ffmpeg.org](https://ffmpeg.org/download.html) et ajoutez-le au PATH :

```powershell
# Vérifier l'installation
ffmpeg -version
```

#### Ou installez via Chocolatey
```powershell
choco install ffmpeg
```

## 🎮 Utilisation

### Mode développement

```bash
# Lancer Vite + Electron
npm run electron:dev
```

### Build de production

```bash
npm run electron:build
```

L'application sera générée dans le dossier `release/`.

## 🏗️ Structure du projet

```
echoscribe/
├── electron/
│   ├── main.js         # Process principal Electron
│   └── preload.js      # Bridge sécurisé IPC
├── src/
│   ├── components/
│   │   ├── ui/         # Composants ShadCN
│   │   └── DropZone.tsx
│   ├── lib/
│   │   └── utils.ts
│   ├── App.tsx         # Application principale
│   ├── main.tsx        # Point d'entrée React
│   └── index.css       # Styles Tailwind
├── python/
│   ├── transcriber.py  # Backend de transcription
│   └── requirements.txt
├── package.json
├── tailwind.config.js
└── vite.config.ts
```

## 🔧 Configuration

### Modèles Whisper disponibles

| Modèle | VRAM | Vitesse | Précision |
|--------|------|---------|-----------|
| tiny | ~1 GB | ⚡⚡⚡⚡⚡ | ⭐ |
| base | ~1 GB | ⚡⚡⚡⚡ | ⭐⭐ |
| small | ~2 GB | ⚡⚡⚡ | ⭐⭐⭐ |
| medium | ~5 GB | ⚡⚡ | ⭐⭐⭐⭐ |
| large-v3 | ~6 GB | ⚡ | ⭐⭐⭐⭐⭐ |
| large-v3-turbo | ~6 GB | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ |

### Mode Cloud (API OpenAI)

1. Obtenez une clé API sur [platform.openai.com](https://platform.openai.com)
2. Activez le switch "Mode Cloud" dans l'application
3. Entrez votre clé API (stockée localement)

## 📦 Distribution

### Créer un exécutable Python autonome

```bash
cd python
pip install pyinstaller
pyinstaller --onefile transcriber.py
```

Le fichier `transcriber.exe` sera dans `python/dist/`. Copiez-le dans le dossier `python/` avant le build Electron.

### Build Windows

```bash
npm run electron:build
```

L'installateur NSIS sera généré dans `release/`.

## 🐛 Dépannage

### "Python n'est pas installé"
- Vérifiez que Python est dans le PATH : `python --version`

### "FFmpeg n'est pas installé"
- Vérifiez que FFmpeg est dans le PATH : `ffmpeg -version`

### "Mémoire GPU insuffisante"
- Utilisez un modèle plus petit (small, base, tiny)
- Ou utilisez le mode CPU (plus lent)

### "Clé API invalide"
- Vérifiez votre clé sur [platform.openai.com](https://platform.openai.com)
- Assurez-vous d'avoir des crédits disponibles

## 📄 Licence

MIT License - Voir [LICENSE](LICENSE) pour plus de détails.

## 🙏 Crédits

- [faster-whisper](https://github.com/guillaumekln/faster-whisper) - Implémentation optimisée de Whisper
- [OpenAI Whisper](https://github.com/openai/whisper) - Modèle de transcription
- [Electron](https://www.electronjs.org/) - Framework desktop
- [ShadCN UI](https://ui.shadcn.com/) - Composants React
- [Lucide](https://lucide.dev/) - Icônes
