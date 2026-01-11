#!/usr/bin/env python3
"""
EchoScribe - Python Transcription Backend

This script handles audio/video transcription using:
- FFmpeg for audio extraction from video files
- faster-whisper for local transcription
- OpenAI API for cloud transcription

Communication with Electron:
- Progress updates are sent as JSON objects to stdout
- Errors are sent as JSON objects to stdout
- The final result is sent as a JSON object to stdout

Usage:
    python transcriber.py --file <path> --mode <local|cloud> --model <model_name> [--api-key <key>]

For distribution:
    Build with PyInstaller: pyinstaller --onefile transcriber.py
"""

import argparse
import json
import os
import sys
import subprocess
import tempfile
from pathlib import Path

# Supported file formats
AUDIO_FORMATS = ['.mp3', '.wav']
VIDEO_FORMATS = ['.mp4', '.mkv', '.mov']
ALL_FORMATS = AUDIO_FORMATS + VIDEO_FORMATS


def send_progress(progress: int, message: str, stage: str = 'transcribing'):
    """Send progress update to Electron via stdout"""
    output = json.dumps({
        'type': 'progress',
        'progress': progress,
        'message': message,
        'stage': stage
    })
    print(output, flush=True)


def send_result(text: str):
    """Send transcription result to Electron via stdout"""
    output = json.dumps({
        'type': 'result',
        'text': text
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


def get_ffmpeg_path() -> str:
    """
    Get the path to FFmpeg executable.
    Checks for bundled FFmpeg first, then falls back to system PATH.
    """
    # Check for bundled FFmpeg (for distribution)
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        base_path = Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else Path(sys.executable).parent
        ffmpeg_path = base_path / 'ffmpeg' / 'ffmpeg.exe'
        if ffmpeg_path.exists():
            return str(ffmpeg_path)
    
    # Check common installation paths on Windows
    common_paths = [
        r'C:\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
        r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe',
    ]
    
    for path in common_paths:
        if os.path.exists(path):
            return path
    
    # Fall back to system PATH
    return 'ffmpeg'


def extract_audio(video_path: str, output_path: str) -> bool:
    """
    Extract audio from video file using FFmpeg.
    Converts to 16kHz mono WAV format for Whisper.
    
    Args:
        video_path: Path to the input video file
        output_path: Path for the output WAV file
        
    Returns:
        True if extraction succeeded, False otherwise
    """
    send_progress(5, 'Extraction audio en cours...', 'extracting')
    
    ffmpeg_path = get_ffmpeg_path()
    
    # FFmpeg command to extract audio as 16kHz mono WAV
    cmd = [
        ffmpeg_path,
        '-i', video_path,
        '-vn',                    # No video
        '-acodec', 'pcm_s16le',   # PCM 16-bit little-endian
        '-ar', '16000',           # 16kHz sample rate
        '-ac', '1',               # Mono
        '-y',                     # Overwrite output file
        output_path
    ]
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )
        
        # Wait for the process to complete
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


def transcribe_local(audio_path: str, model_name: str) -> str:
    """
    Transcribe audio using faster-whisper (local mode).
    
    Args:
        audio_path: Path to the audio file
        model_name: Name of the Whisper model to use
        
    Returns:
        Transcribed text
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        send_error('faster-whisper n\'est pas installé. Exécutez: pip install faster-whisper')
        return ''
    
    send_progress(30, f'Chargement du modèle {model_name}...', 'transcribing')
    
    try:
        # Determine device and compute type
        # Try CUDA first, fall back to CPU
        device = 'cuda'
        compute_type = 'float16'
        
        try:
            import torch
            if not torch.cuda.is_available():
                device = 'cpu'
                compute_type = 'int8'
                send_progress(32, 'GPU non disponible, utilisation du CPU...', 'transcribing')
        except ImportError:
            device = 'cpu'
            compute_type = 'int8'
        
        # Load the model
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        
        send_progress(40, 'Transcription en cours...', 'transcribing')
        
        # Transcribe
        segments, info = model.transcribe(audio_path, beam_size=5)
        
        # Collect segments with progress updates
        text_parts = []
        total_duration = info.duration if info.duration else 1
        
        for segment in segments:
            text_parts.append(segment.text)
            
            # Calculate progress (40-95%)
            progress = 40 + int((segment.end / total_duration) * 55)
            progress = min(progress, 95)
            
            send_progress(
                progress,
                f'Transcription: {int(segment.end)}s / {int(total_duration)}s',
                'transcribing'
            )
        
        return ' '.join(text_parts).strip()
        
    except Exception as e:
        error_msg = str(e)
        
        if 'CUDA out of memory' in error_msg or 'OutOfMemoryError' in error_msg:
            send_error('Mémoire GPU insuffisante. Essayez un modèle plus petit.')
        elif 'Could not load' in error_msg:
            send_error(f'Impossible de charger le modèle {model_name}. Vérifiez votre installation.')
        else:
            send_error(f'Erreur lors de la transcription: {error_msg}')
        
        return ''


def transcribe_cloud(audio_path: str, api_key: str) -> str:
    """
    Transcribe audio using OpenAI Whisper API (cloud mode).
    
    Args:
        audio_path: Path to the audio file
        api_key: OpenAI API key
        
    Returns:
        Transcribed text
    """
    try:
        from openai import OpenAI
    except ImportError:
        send_error('openai n\'est pas installé. Exécutez: pip install openai')
        return ''
    
    send_progress(30, 'Connexion à l\'API OpenAI...', 'transcribing')
    
    try:
        client = OpenAI(api_key=api_key)
        
        send_progress(40, 'Envoi du fichier audio...', 'transcribing')
        
        with open(audio_path, 'rb') as audio_file:
            # The API supports files up to 25 MB
            file_size = os.path.getsize(audio_path)
            if file_size > 25 * 1024 * 1024:
                send_error('Le fichier est trop volumineux pour l\'API (max 25 MB). Utilisez le mode local.')
                return ''
            
            send_progress(60, 'Transcription en cours sur le cloud...', 'transcribing')
            
            transcript = client.audio.transcriptions.create(
                model='whisper-1',
                file=audio_file,
                response_format='text'
            )
        
        send_progress(95, 'Transcription terminée', 'transcribing')
        return transcript
        
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
        
        return ''


def main():
    """Main entry point for the transcription script"""
    parser = argparse.ArgumentParser(description='EchoScribe Transcription Backend')
    parser.add_argument('--file', required=True, help='Path to the audio/video file')
    parser.add_argument('--mode', required=True, choices=['local', 'cloud'], 
                        help='Transcription mode: local (faster-whisper) or cloud (OpenAI API)')
    parser.add_argument('--model', default='large-v3-turbo',
                        help='Whisper model name (for local mode)')
    parser.add_argument('--api-key', default=None,
                        help='OpenAI API key (required for cloud mode)')
    parser.add_argument('--language', default=None,
                        help='Language code (e.g., fr, en). Auto-detect if not specified.')
    
    args = parser.parse_args()
    
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
        # Create temporary file for extracted audio
        temp_dir = tempfile.gettempdir()
        temp_audio = os.path.join(temp_dir, 'echoscribe_temp_audio.wav')
        
        if not extract_audio(args.file, temp_audio):
            return
        
        audio_path = temp_audio
    
    # Transcribe
    try:
        if args.mode == 'local':
            result = transcribe_local(audio_path, args.model)
        else:
            result = transcribe_cloud(audio_path, args.api_key)
        
        if result:
            send_progress(100, 'Transcription terminée!', 'transcribing')
            send_result(result)
    
    finally:
        # Clean up temporary audio file
        if temp_audio and os.path.exists(temp_audio):
            try:
                os.remove(temp_audio)
            except:
                pass


if __name__ == '__main__':
    main()
