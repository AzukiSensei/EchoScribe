#!/usr/bin/env python3
"""
EchoScribe - Python Transcription Backend

This script handles audio/video transcription using:
- FFmpeg for audio extraction from video files
- faster-whisper for local transcription
- OpenAI API for cloud transcription

Features:
- Multi-format export (TXT, SRT, VTT)
- Translation to English
- Language detection/selection
- Model download management
- Custom model support

Communication with Electron:
- Progress updates are sent as JSON objects to stdout
- Errors are sent as JSON objects to stdout
- The final result is sent as a JSON object to stdout

Usage:
    python transcriber.py --file <path> --mode <local|cloud> --model <model_name> [options]
    python transcriber.py --list-models
    python transcriber.py --download-model <model_name>

For distribution:
    Build with PyInstaller: pyinstaller --onefile transcriber.py
"""

import argparse
import json
import os
import sys
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
try:
    import pynvml
    HAS_NVML = True
except ImportError:
    HAS_NVML = False

# Fix for Windows symlink permission error in Hugging Face Hub
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
# Ensure we don't try to use symlinks if developer mode is not enabled
os.environ["HF_HUB_CACHE_SYMLINKS"] = "0"

# Add NVIDIA libraries from pip packages to PATH (for Windows)
if sys.platform == 'win32':
    import site
    import glob
    
    # Common locations for site-packages
    site_packages_dirs = site.getsitepackages()
    user_site = site.getusersitepackages()
    if isinstance(user_site, str):
        site_packages_dirs.append(user_site)
        
    for sp in site_packages_dirs:
        # Add nvidia-cublas and nvidia-cudnn bin directories if they exist
        nvidia_dirs = [
             os.path.join(sp, 'nvidia', 'cublas', 'bin'),
             os.path.join(sp, 'nvidia', 'cudnn', 'bin'),
             os.path.join(sp, 'nvidia', 'cuda_runtime', 'bin') 
        ]
        
        for p in nvidia_dirs:
            if os.path.exists(p) and p not in os.environ['PATH']:
                try:
                    os.environ['PATH'] = p + os.pathsep + os.environ['PATH']
                    # Also try to add via ctypes for immediate DLL loading awareness
                    if hasattr(os, 'add_dll_directory'):
                         os.add_dll_directory(p)
                except Exception:
                    pass

import subprocess
import tempfile
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Tuple

# Supported file formats
AUDIO_FORMATS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg']
VIDEO_FORMATS = ['.mp4', '.mkv', '.mov', '.avi', '.webm']
ALL_FORMATS = AUDIO_FORMATS + VIDEO_FORMATS

# Available Whisper models
WHISPER_MODELS = {
    'tiny': {'size': '~75 MB', 'vram': '~1 GB'},
    'base': {'size': '~145 MB', 'vram': '~1 GB'},
    'small': {'size': '~488 MB', 'vram': '~2 GB'},
    'medium': {'size': '~1.5 GB', 'vram': '~5 GB'},
    'large-v2': {'size': '~3.1 GB', 'vram': '~6 GB'},
    'large-v3': {'size': '~3.1 GB', 'vram': '~6 GB'},
    'large-v3-turbo': {'size': '~1.6 GB', 'vram': '~6 GB'},
}

# Custom model directory (User requested Documents/Models)
MODELS_DIR = os.path.join(os.path.expanduser('~'), 'Documents', 'Models')
os.makedirs(MODELS_DIR, exist_ok=True)

# Supported languages (ISO 639-1 codes)
SUPPORTED_LANGUAGES = {
    'auto': 'Auto-détection',
    'fr': 'Français',
    'en': 'English',
    'es': 'Español',
    'de': 'Deutsch',
    'it': 'Italiano',
    'pt': 'Português',
    'nl': 'Nederlands',
    'pl': 'Polski',
    'ru': 'Русский',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어',
    'ar': 'العربية',
}



def send_segment(segment: dict):
    """Send a single segment to Electron via stdout"""
    output = json.dumps({
        'type': 'segment',
        'segment': segment
    })
    print(output, flush=True)


def send_progress(progress: int, message: str, stage: str = 'transcribing', speed: float = None, etr: float = None):
    """Send progress update to Electron via stdout"""
    output = json.dumps({
        'type': 'progress',
        'progress': progress,
        'message': message,
        'stage': stage
    })
    print(output, flush=True)


def get_system_stats():
    """Get current RAM and VRAM usage"""
    stats = {}
    
    # RAM (psutil is standard)
    if HAS_PSUTIL:
        try:
            mem = psutil.virtual_memory()
            stats['ram_used'] = round(mem.used / (1024**3), 1)
            stats['ram_total'] = round(mem.total / (1024**3), 1)
        except Exception:
            pass
        
    # VRAM (pynvml for NVIDIA)
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        stats['vram_used'] = round(info.used / (1024**3), 1)
        stats['vram_total'] = round(info.total / (1024**3), 1)
        # pynvml.nvmlShutdown() # Keep open?
    except Exception:
        pass
        
def get_system_stats():
    stats = {
        'ram_used': psutil.virtual_memory().used,
        'ram_total': psutil.virtual_memory().total,
        'vram_used': 0,
        'vram_total': 0
    }
    
    if HAS_NVML:
        try:
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            stats['vram_used'] = mem_info.used
            stats['vram_total'] = mem_info.total
        except:
            pass
            
    return stats


def send_progress(progress: int, message: str, stage: str = 'transcribing', speed: float = None, etr: float = None):
    """Send progress update to Electron via stdout"""
    data = {
        'type': 'progress',
        'progress': progress,
        'message': message,
        'stage': stage
    }
    
    if speed is not None:
        data['speed'] = speed
    if etr is not None:
        data['etr'] = etr
    
    try:
        stats = get_system_stats()
        if stats:
            data['system_stats'] = stats
    except Exception:
        pass
        
    output = json.dumps(data)
    print(output, flush=True)


def send_result(text: str, segments: List[dict] = None, detected_language: str = None, metrics: dict = None):
    """Send transcription result to Electron via stdout"""
    output = json.dumps({
        'type': 'result',
        'text': text,
        'segments': segments or [],
        'detected_language': detected_language,
        'metrics': metrics or {}
    })
    print(output, flush=True)


def send_error(message: str):
    """Send error message to Electron via stdout"""
    output = json.dumps({
        'type': 'error',
        'message': message
    })
    print(output, flush=True)
    sys.exit(1)


def send_models_list(models: dict):
    """Send available models list to Electron"""
    output = json.dumps({
        'type': 'models_list',
        'models': models
    })
    print(output, flush=True)


def send_download_progress(model: str, progress: int, message: str):
    """Send model download progress"""
    output = json.dumps({
        'type': 'download_progress',
        'model': model,
        'progress': progress,
        'message': message
    })
    print(output, flush=True)


def get_ffmpeg_path() -> str:
    """
    Get the path to FFmpeg executable.
    Checks for bundled FFmpeg first, then falls back to system PATH.
    """
    if getattr(sys, 'frozen', False):
        base_path = Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else Path(sys.executable).parent
        ffmpeg_path = base_path / 'ffmpeg' / 'ffmpeg.exe'
        if ffmpeg_path.exists():
            return str(ffmpeg_path)
    
    common_paths = [
        r'C:\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe',
    ]
    
    for path in common_paths:
        if os.path.exists(path):
            return path
    
    return 'ffmpeg'


def get_custom_models_dir() -> Path:
    """Get the directory for custom models"""
    app_data = Path(os.environ.get('APPDATA', Path.home()))
    models_dir = app_data / 'EchoScribe' / 'models'
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir


def list_available_models() -> dict:
    """List all available models including custom ones"""
    models = {}
    
    # Built-in models
    for name, info in WHISPER_MODELS.items():
        models[name] = {
            'name': name,
            'size': info['size'],
            'vram': info['vram'],
            'type': 'builtin',
            'downloaded': check_model_downloaded(name)
        }
    
    # Custom models
    custom_dir = get_custom_models_dir()
    for model_path in custom_dir.glob('*'):
        if model_path.is_dir():
            model_name = model_path.name
            if model_name not in models:
                size = sum(f.stat().st_size for f in model_path.rglob('*') if f.is_file())
                models[model_name] = {
                    'name': model_name,
                    'size': f'~{size / (1024*1024):.0f} MB',
                    'vram': 'Unknown',
                    'type': 'custom',
                    'path': str(model_path),
                    'downloaded': True
                }
    
    return models


def check_model_downloaded(model_name: str) -> bool:
    """Check if a model is already downloaded in cache"""
    try:
        from huggingface_hub import try_to_load_from_cache
        cache_path = try_to_load_from_cache(
            repo_id=f"Systran/faster-whisper-{model_name}",
            filename="model.bin"
        )
        return cache_path is not None
    except:
        return False


def download_model(model_name: str):
    """Download a Whisper model using huggingface_hub"""
    send_download_progress(model_name, 0, f'Préparation du téléchargement de {model_name}...')
    
    # Model name to repo mapping
    # large-v3-turbo uses openai repo, others use Systran faster-whisper repos
    MODEL_REPO_MAPPING = {
        'large-v3-turbo': ('openai', 'whisper-large-v3-turbo'),  # openai/whisper-large-v3-turbo
    }
    
    try:
        # Try to import huggingface_hub
        try:
            from huggingface_hub import snapshot_download
        except ImportError:
            send_error('huggingface_hub n\'est pas installé. Exécutez: pip install huggingface-hub')
            return
        
        # Get the correct repo
        if model_name in MODEL_REPO_MAPPING:
            org, repo_name = MODEL_REPO_MAPPING[model_name]
            repo_id = f"{org}/{repo_name}"
        else:
            # Default to Systran faster-whisper repos
            repo_id = f"Systran/faster-whisper-{model_name}"
        
        send_download_progress(model_name, 5, f'Connexion à Hugging Face ({repo_id})...')
        
        try:
            # Download the entire model repository
            send_download_progress(model_name, 10, f'Téléchargement des fichiers du modèle...')
            
            local_dir = snapshot_download(
                repo_id=repo_id,
                local_files_only=False
            )
            
            send_download_progress(model_name, 80, 'Téléchargement terminé, vérification...')
            
            # Verify the model can be loaded
            send_download_progress(model_name, 90, 'Vérification du modèle...')
            
            try:
                from faster_whisper import WhisperModel
                # Quick load test with CPU to verify
                _ = WhisperModel(model_name, device='cpu', compute_type='int8', download_root=MODELS_DIR)
                send_download_progress(model_name, 100, f'Modèle {model_name} prêt!')
            except Exception as verify_error:
                # Model downloaded but verification failed - still report success
                send_download_progress(model_name, 100, f'Modèle {model_name} téléchargé (vérification ignorée)')
            
            output = json.dumps({
                'type': 'download_complete',
                'model': model_name,
                'success': True,
                'path': local_dir
            })
            print(output, flush=True)
            
        except HfHubHTTPError as http_error:
            send_error(f'Erreur de téléchargement: {str(http_error)}')
        except Exception as download_error:
            send_error(f'Erreur lors du téléchargement: {str(download_error)}')
            
    except Exception as e:
        send_error(f'Erreur inattendue: {str(e)}')


def extract_audio(video_path: str, output_path: str) -> bool:
    """
    Extract audio from video file using FFmpeg.
    Converts to 16kHz mono WAV format for Whisper.
    """
    send_progress(5, 'Extraction audio en cours...', 'extracting')
    
    ffmpeg_path = get_ffmpeg_path()
    
    cmd = [
        ffmpeg_path,
        '-i', video_path,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        '-y',
        output_path
    ]
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )
        
        stdout, stderr = process.communicate()
        
        if process.returncode != 0:
            error_msg = stderr.decode('utf-8', errors='replace')
            if 'not recognized' in error_msg or 'not found' in error_msg.lower():
                send_error('FFmpeg n\'est pas installé. Veuillez l\'installer et l\'ajouter au PATH.')
            else:
                send_error(f'Erreur lors de l\'extraction audio: {error_msg[:200]}')
            return False
        
        send_progress(25, 'Extraction audio terminée', 'extracting')
        return True
        
    except FileNotFoundError:
        send_error('FFmpeg n\'est pas installé. Veuillez l\'installer et l\'ajouter au PATH.')
        return False
    except Exception as e:
        send_error(f'Erreur lors de l\'extraction audio: {str(e)}')
        return False


def format_timestamp(seconds: float, format_type: str = 'srt') -> str:
    """Format timestamp for SRT or VTT format"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    
    if format_type == 'vtt':
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"
    else:  # srt
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def segments_to_srt(segments: List[dict]) -> str:
    """Convert segments to SRT format"""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = format_timestamp(seg['start'], 'srt')
        end = format_timestamp(seg['end'], 'srt')
        text = seg['text'].strip()
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return '\n'.join(lines)


def segments_to_vtt(segments: List[dict]) -> str:
    """Convert segments to VTT format"""
    lines = ["WEBVTT", ""]
    for seg in segments:
        start = format_timestamp(seg['start'], 'vtt')
        end = format_timestamp(seg['end'], 'vtt')
        text = seg['text'].strip()
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return '\n'.join(lines)


def transcribe_local(
    audio_path: str,
    model_name: str,
    language: Optional[str] = None,
    translate: bool = False,
    custom_model_path: Optional[str] = None,
    device_mode: str = 'performance'
) -> Tuple[str, List[dict], str, dict]:
    """
    Transcribe audio using faster-whisper (local mode).
    
    Returns:
        Tuple of (text, segments, detected_language, metrics)
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        send_error('faster-whisper n\'est pas installé. Exécutez: pip install faster-whisper')
        return '', [], '', {}
    
    send_progress(30, f'Chargement du modèle {model_name}...', 'transcribing')
    
    # Determine device and compute type based on mode
    if device_mode == 'performance':
        device = 'cuda'
        compute_type = 'float16'
    elif device_mode == 'stable':
        device = 'cuda'
        compute_type = 'int8_float16'
    else: # compatibility
        device = 'cpu'
        compute_type = 'int8'
    
    try:
        import torch
        if device == 'cuda' and not torch.cuda.is_available():
            device = 'cpu'
            compute_type = 'int8'
            send_progress(32, 'GPU non disponible, bascule vers mode compatibilité (CPU)...', 'transcribing')
    except ImportError:
        pass
        
    try:
        # Determine model path
        os.environ["KMP_DUPLICATE_LIB_OK"]="TRUE" # Fix for some Intel CPU issues
        print(f"Initializing model on {device} with {compute_type} (mode: {device_mode})...", file=sys.stderr)
        
        if custom_model_path:
            model = WhisperModel(custom_model_path, device=device, compute_type=compute_type)
        else:
            model = WhisperModel(model_name, device=device, compute_type=compute_type, download_root=MODELS_DIR)
            
    except Exception as e:
        # Robust fallback
        error_str = str(e).lower()
        print(f"Model initialization error on {device}: {e}", file=sys.stderr)
        
        if device == 'cuda':
            send_progress(35, 'Erreur GPU détectée, bascule vers CPU...', 'transcribing')
            device = 'cpu'
            compute_type = 'int8'
            
            try:
                if custom_model_path:
                    model = WhisperModel(custom_model_path, device=device, compute_type=compute_type)
                else:
                    model = WhisperModel(model_name, device=device, compute_type=compute_type, download_root=MODELS_DIR)
            except Exception as e2:
                # Force GPU/CPU visibility hidden if all else fails
                os.environ["CUDA_VISIBLE_DEVICES"] = ""
                if custom_model_path:
                    model = WhisperModel(custom_model_path, device='cpu', compute_type='int8')
                else:
                    model = WhisperModel(model_name, device='cpu', compute_type='int8', download_root=MODELS_DIR)
        else:
            raise e
    
    send_progress(40, 'Transcription en cours...', 'transcribing')
    
    # Prepare transcription options
    transcribe_options = {
        'beam_size': 5,
        'word_timestamps': True,
    }
    
    if language and language != 'auto':
        transcribe_options['language'] = language
    
    if translate:
        transcribe_options['task'] = 'translate'
    
    # Transcribe with metrics
    import time
    transcription_start = time.time()
    
    segments_gen, info = model.transcribe(audio_path, **transcribe_options)
    
    detected_lang = info.language
    total_duration = info.duration if info.duration else 1
    
    # Don't collect anything - just count and stream
    segment_count = 0
    
    for segment in segments_gen:
        seg_dict = {
            'id': segment_count,
            'start': segment.start,
            'end': segment.end,
            'text': segment.text
        }
        # Stream segment immediately instead of accumulating
        send_segment(seg_dict)
        segment_count += 1
        
        # Calculate process
        progress = 40 + int((segment.end / total_duration) * 55)
        progress = min(progress, 95)
        
        # Calculate stats
        current_time = time.time()
        elapsed = current_time - transcription_start
        if elapsed > 0:
            # Speed factor (x realtime)
            speed_factor = segment.end / elapsed
            
            # Estimated time remaining
            remaining_duration = total_duration - segment.end
            etr = remaining_duration / speed_factor if speed_factor > 0 else 0
        else:
            speed_factor = 0
            etr = 0
            
        send_progress(
            progress,
            f'Transcription: {int(segment.end)}s / {int(total_duration)}s',
            'transcribing',
            speed=round(speed_factor, 2),
            etr=round(etr, 0)
        )
    
    # Don't accumulate full_text - frontend has all segments already
    # For 1h+ files, joining all text causes stack overflow on Windows
    
    # Final metrics
    total_elapsed = time.time() - transcription_start
    avg_speed = total_duration / total_elapsed if total_elapsed > 0 else 0
    
    metrics = {
        'duration': round(total_duration, 2),
        'processing_time': round(total_elapsed, 2),
        'speed_factor': round(avg_speed, 2)
    }
    
    # Send empty text - frontend reconstructs from streamed segments
    return "", [], detected_lang, metrics


def transcribe_cloud(
    audio_path: str,
    api_key: str,
    language: Optional[str] = None,
    translate: bool = False
) -> Tuple[str, List[dict], str]:
    """
    Transcribe audio using OpenAI Whisper API (cloud mode).
    
    Returns:
        Tuple of (text, segments, detected_language)
    """
    try:
        from openai import OpenAI
    except ImportError:
        send_error('openai n\'est pas installé. Exécutez: pip install openai')
        return '', [], ''
    
    send_progress(30, 'Connexion à l\'API OpenAI...', 'transcribing')
    
    try:
        client = OpenAI(api_key=api_key)
        
        send_progress(40, 'Envoi du fichier audio...', 'transcribing')
        
        with open(audio_path, 'rb') as audio_file:
            file_size = os.path.getsize(audio_path)
            if file_size > 25 * 1024 * 1024:
                send_error('Le fichier est trop volumineux pour l\'API (max 25 MB). Utilisez le mode local.')
                return '', [], ''
            
            send_progress(60, 'Transcription en cours sur le cloud...', 'transcribing')
            
            # Prepare options
            options = {
                'model': 'whisper-1',
                'file': audio_file,
                'response_format': 'verbose_json',
            }
            
            if language and language != 'auto':
                options['language'] = language
            
            if translate:
                # Use translation endpoint
                transcript = client.audio.translations.create(**options)
            else:
                transcript = client.audio.transcriptions.create(**options)
        
        # Extract segments
        segments = []
        if hasattr(transcript, 'segments'):
            for seg in transcript.segments:
                segments.append({
                    'start': seg.get('start', 0),
                    'end': seg.get('end', 0),
                    'text': seg.get('text', '')
                })
        
        detected_lang = getattr(transcript, 'language', 'unknown')
        
        send_progress(95, 'Transcription terminée', 'transcribing')
        return transcript.text, segments, detected_lang
        
    except Exception as e:
        error_msg = str(e)
        
        if 'Invalid API key' in error_msg or 'Incorrect API key' in error_msg:
            send_error('Clé API OpenAI invalide. Vérifiez votre clé.')
        elif 'Rate limit' in error_msg:
            send_error('Limite de requêtes atteinte. Réessayez plus tard.')
        elif 'insufficient_quota' in error_msg:
            send_error('Quota OpenAI insuffisant. Vérifiez votre compte.')
        else:
            send_error(f'Erreur API OpenAI: {error_msg}')
        
        return '', [], ''


def main():
    """Main entry point for the transcription script"""
    parser = argparse.ArgumentParser(description='EchoScribe Transcription Backend')
    parser.add_argument('--file', help='Path to the audio/video file')
    parser.add_argument('--mode', choices=['local', 'cloud'], 
                        help='Transcription mode: local (faster-whisper) or cloud (OpenAI API)')
    parser.add_argument('--model', default='large-v3-turbo',
                        help='Whisper model name (for local mode)')
    parser.add_argument('--custom-model-path', default=None,
                        help='Path to custom model directory')
    parser.add_argument('--api-key', default=None,
                        help='OpenAI API key (required for cloud mode)')
    parser.add_argument('--language', default='auto',
                        help='Source language code (e.g., fr, en). Use "auto" for auto-detection.')
    parser.add_argument('--translate', action='store_true',
                        help='Translate to English')
    parser.add_argument('--list-models', action='store_true',
                        help='List available models')
    parser.add_argument('--download-model', metavar='MODEL',
                        help='Download a specific model')
    parser.add_argument('--device-mode', choices=['performance', 'stable', 'compatibility'], default='performance',
                        help='Device mode: performance (CUDA/float16), stable (CUDA/int8), compatibility (CPU)')
    
    args = parser.parse_args()
    
    # Handle model listing
    if args.list_models:
        models = list_available_models()
        # send_models_list is handled inside list_available_models now? 
        # No, list_available_models returns dict, need to check its impl.
        # Step 1311 showed list_available_models returns dict.
        # But previous code had send_models_list(models).
        send_models_list(models)
        return
    
    # Handle model download
    if args.download_model:
        download_model(args.download_model)
        return
    
    # Validate required arguments for transcription
    if not args.file:
        send_error('Aucun fichier spécifié. Utilisez --file <path>')
        return
    
    if not args.mode:
        send_error('Aucun mode spécifié. Utilisez --mode local ou --mode cloud')
        return
    
    # Validate file exists
    if not os.path.exists(args.file):
        send_error(f'Le fichier n\'existe pas: {args.file}')
        return
    
    # Validate file format
    file_ext = Path(args.file).suffix.lower()
    if file_ext not in ALL_FORMATS:
        send_error(f'Format non supporté: {file_ext}. Formats acceptés: {", ".join(ALL_FORMATS)}')
        return
    
    # Validate API key for cloud mode
    if args.mode == 'cloud' and not args.api_key:
        send_error('Une clé API OpenAI est requise pour le mode cloud.')
        return
    
    send_progress(0, 'Démarrage de la transcription...', 'extracting')
    
    # Determine if we need to extract audio
    audio_path = args.file
    temp_audio = None
    
    if file_ext in VIDEO_FORMATS:
        temp_dir = tempfile.gettempdir()
        temp_audio = os.path.join(temp_dir, 'echoscribe_temp_audio.wav')
        
        if not extract_audio(args.file, temp_audio):
            return
        
        audio_path = temp_audio
    
    # Transcribe
    try:
        language = args.language if args.language != 'auto' else None
        
        if args.mode == 'local':
            text, segments, detected_lang, metrics = transcribe_local(
                audio_path,
                args.model,
                language=language,
                translate=args.translate,
                custom_model_path=args.custom_model_path,
                device_mode=args.device_mode
            )
        else:
            text, segments, detected_lang, metrics = transcribe_cloud(
                audio_path,
                args.api_key,
                language=language,
                translate=args.translate
            )
        
        if text:
            send_progress(100, 'Transcription terminée!', 'transcribing')
            send_result(text, segments, detected_lang, metrics)
    
    finally:
        # Clean up temporary audio file
        if temp_audio and os.path.exists(temp_audio):
            try:
                os.remove(temp_audio)
            except:
                pass


if __name__ == '__main__':
    main()
