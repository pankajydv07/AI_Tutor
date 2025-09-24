import os
import sys
import json
import uuid
import shutil
import subprocess
import tempfile
import re
from pathlib import Path
from typing import Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# Manim imports
try:
    from manim import *
    print("✅ Manim imported successfully")
except ImportError as e:
    print(f"❌ Failed to import Manim: {e}")
    print("📋 To install Manim, run: pip install manim")
    sys.exit(1)

app = FastAPI(title="3D Avatar Manim Worker", version="1.0.0")

# Configuration
OUTPUT_DIR = Path(__file__).parent.parent / "uploads" / "videos"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Debug settings - set to True to keep generated code files
DEBUG_MODE = True  
AUTO_FALLBACK_TO_TEXT = True  # Automatically replace LaTeX with Text when LaTeX unavailable

class ManimRequest(BaseModel):
    manimCode: str
    messageId: str = None
    narrationAudio: str = None  # Path to narration audio file

class CombineVideosRequest(BaseModel):
    videoPaths: list[str]
    messageId: str = None

class ManimResponse(BaseModel):
    success: bool
    videoPath: str = None
    videoUrl: str = None
    error: str = None
    progress: str = None

def check_ffmpeg():
    """Check if FFmpeg is available"""
    try:
        subprocess.run(["ffmpeg", "-version"], 
                      capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

FFMPEG_AVAILABLE = check_ffmpeg()
if not FFMPEG_AVAILABLE:
    print("⚠️ FFmpeg not found. Videos will be generated without proper encoding.")

def check_sox():
    """Check if SoX is available"""
    try:
        subprocess.run(["sox", "--version"], 
                      capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def check_and_install_dependencies():
    """Check for dependencies and install if missing"""
    print("🔍 Checking dependencies...")
    
    # Check for SoX
    sox_available = check_sox()
    if not sox_available:
        print("⚠️ SoX not found. Installing...")
        try:
            # Try to install SoX with pip first
            subprocess.run([sys.executable, "-m", "pip", "install", "sox"], check=True)
            print("✅ SoX installed via pip")
        except subprocess.CalledProcessError:
            # If pip install fails, try platform-specific methods
            if os.name == "nt":  # Windows
                print("⚠️ Installing SoX via chocolatey (may require admin)...")
                try:
                    subprocess.run(["choco", "install", "sox.portable", "-y"], check=True)
                    print("✅ SoX installed via chocolatey")
                except (subprocess.CalledProcessError, FileNotFoundError):
                    print("❌ SoX installation failed. Please install manually from:")
                    print("   http://sox.sourceforge.net/")
            else:  # Linux/Mac
                print("⚠️ Please install SoX using your package manager:")
                print("   Linux: sudo apt-get install sox")
                print("   Mac: brew install sox")
    
    print("✅ Dependency check completed")

# Global progress tracking
progress_tracker = {}

def is_latex_available():
    """Check if LaTeX is properly installed and working"""
    latex_bin = shutil.which("latex") or shutil.which("xelatex")
    if not latex_bin:
        return False
    
    # Test with minimal LaTeX document
    with tempfile.TemporaryDirectory() as tmp_dir:
        test_file = Path(tmp_dir) / "test.tex"
        test_file.write_text(r"\documentclass{minimal}\begin{document}Test\end{document}")
        try:
            subprocess.run(
                [latex_bin, "-interaction=nonstopmode", str(test_file)],
                cwd=tmp_dir, timeout=5, capture_output=True
            )
            return True
        except (subprocess.SubprocessError, OSError):
            return False

def analyze_manim_code(code):
    """Analyze Manim code for potential issues"""
    issues = []
    
    # Check for LaTeX-dependent objects
    latex_objects = {
        "MathTex": re.findall(r'MathTex\([^)]*\)', code),
        "Tex": re.findall(r'Tex\([^)]*\)', code),
        "TexTemplate": re.findall(r'TexTemplate', code),
        "LaTeX": re.findall(r'LaTeX', code),
    }
    
    latex_usage = sum(len(matches) for matches in latex_objects.values())
    
    if latex_usage > 0 and not is_latex_available():
        issues.append({
            "type": "latex_missing",
            "count": latex_usage,
            "details": {k: v for k, v in latex_objects.items() if v}
        })
    
    return {
        "latex_usage": latex_usage > 0,
        "issues": issues
    }

def modify_code_for_latex_fallback(code):
    """Modify code to use Text instead of MathTex when LaTeX is unavailable"""
    def clean_latex_text(match):
        text = match.group(1)
        # Remove special LaTeX characters
        text = text.replace("^", " pow ")
        text = text.replace("{", "")
        text = text.replace("}", "")
        text = text.replace("\\\\", "")
        text = text.replace("\\", "")
        return f'Text("{text}")'
    
    # Replace MathTex with Text, removing special LaTeX characters
    modified = re.sub(r'MathTex\(r?"([^"]+)"', clean_latex_text, code)
    
    # Replace single-argument Tex with Text
    modified = re.sub(r'Tex\(r?"([^"]+)"', clean_latex_text, modified)
    
    # Add comment explaining the modification
    modified = "# AUTO-MODIFIED: LaTeX objects replaced with Text due to missing LaTeX\n" + modified
    
    return modified

def extract_latex_error(stderr_output):
    """Extract useful LaTeX error information from stderr output"""
    # Common LaTeX error patterns
    latex_error_patterns = [
        r'! LaTeX Error: (.*?)\n',
        r'! Package (.*?) Error: (.*?)\n',
        r'! Undefined control sequence.\n\\[^ ]* ',
    ]
    
    for pattern in latex_error_patterns:
        matches = re.findall(pattern, stderr_output)
        if matches:
            return str(matches[0])
    
    # If no specific error found, return a general message
    if "LaTeX" in stderr_output and "error" in stderr_output.lower():
        return "LaTeX processing failed. Please check your LaTeX syntax or install LaTeX."

def fix_latex_escaping(manim_code):
    """Fix common LaTeX escaping issues in Manim code - MINIMAL VERSION"""
    
    print(f"🔧 [DEBUG] Input code:\n{manim_code}")
    
    # ONLY fix the specific corrupted approx issue that we know about
    # Don't touch other words that might be Python keywords
    latex_fixes = {
        r'pprox': r'\\approx',  # Fix the specific "pprox" corruption we've seen
    }
    
    fixed_code = manim_code
    
    # Only fix obvious LaTeX corruption within MathTex/Tex contexts
    for broken, correct in latex_fixes.items():
        # Only replace in MathTex/Tex string contexts to avoid Python syntax corruption
        pattern = rf'(MathTex|Tex)\s*\(\s*["\']([^"\']*){broken}([^"\']*)["\']'
        matches = re.finditer(pattern, fixed_code)
        for match in matches:
            full_match = match.group(0)
            tex_type = match.group(1)
            before_text = match.group(2)
            after_text = match.group(3)
            
            print(f"🔧 [DEBUG] Found '{broken}' in LaTeX context - replacing with '{correct}'")
            new_content = f'{tex_type}("{before_text}{correct}{after_text}"'
            fixed_code = fixed_code.replace(full_match, new_content)
    
    print(f"🔧 [DEBUG] Output code:\n{fixed_code}")
    return fixed_code

@app.get("/progress/{request_id}")
async def get_progress(request_id: str):
    """Get progress for a specific request"""
    return {"progress": progress_tracker.get(request_id, "Unknown request")}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "manim_available": True,
        "ffmpeg_available": FFMPEG_AVAILABLE,
        "sox_available": check_sox()
    }

@app.get("/check-latex")
async def check_latex():
    """Endpoint to check if LaTeX is available and working"""
    latex_available = is_latex_available()
    latex_bin = shutil.which("latex") or shutil.which("xelatex")
    
    return {
        "latex_available": latex_available,
        "latex_path": latex_bin,
        "fallback_enabled": AUTO_FALLBACK_TO_TEXT,
        "recommended_action": "none" if latex_available else "install_latex"
    }

@app.post("/combine-videos", response_model=ManimResponse)
async def combine_videos(request: CombineVideosRequest):
    """Combine multiple video files into one final video"""
    print(f"🎬 Received video combination request")
    print(f"📝 Number of videos to combine: {len(request.videoPaths)}")
    
    # Generate unique identifier for this request
    request_id = request.messageId or str(uuid.uuid4())
    
    # Track progress
    progress_tracker[request_id] = "Preparing video combination..."
    
    # Create temporary directory for this combination
    temp_dir = Path(tempfile.mkdtemp(prefix=f"combine_videos_{request_id}_"))
    
    try:
        progress_tracker[request_id] = "Verifying input videos..."
        # Verify all input videos exist
        for i, video_path in enumerate(request.videoPaths):
            if not Path(video_path).exists():
                progress_tracker[request_id] = f"Failed: Video {i+1} not found"
                return ManimResponse(
                    success=False,
                    error=f"Video file not found: {video_path}"
                )
        
        progress_tracker[request_id] = "Creating FFmpeg concat list..."
        
        # Create file list for FFmpeg concat
        concat_file = temp_dir / "concat_list.txt"
        with open(concat_file, 'w') as f:
            for video_path in request.videoPaths:
                # Use absolute paths for FFmpeg
                abs_path = Path(video_path).resolve()
                f.write(f"file '{abs_path}'\n")
        
        print(f"📄 Concat list created: {concat_file}")
        
        progress_tracker[request_id] = "Combining videos with FFmpeg..."
        
        # Output file path - use absolute path
        final_filename = f"combined_video_{request_id}.mp4"
        final_path = OUTPUT_DIR / final_filename
        
        # Ensure output directory exists
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        
        # FFmpeg command to concatenate videos
        # First try with copy (fastest), if it fails, fallback to re-encoding
        cmd = [
            "ffmpeg",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",  # Copy streams without re-encoding for speed
            "-y",  # Overwrite output file
            str(final_path)  # Use absolute path
        ]
        
        print(f"🚀 Running FFmpeg command: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=temp_dir,
            timeout=300  # 5 minute timeout
        )
        
        # If copy mode fails, try with re-encoding
        if result.returncode != 0:
            print("⚠️ Copy mode failed, trying with re-encoding...")
            cmd_reencode = [
                "ffmpeg",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_file),
                "-c:v", "libx264",  # Re-encode video
                "-c:a", "aac",      # Re-encode audio
                "-preset", "fast",   # Fast encoding
                "-crf", "23",        # Good quality
                "-y",  # Overwrite output file
                str(final_path)
            ]
            
            print(f"🔄 Running FFmpeg with re-encoding: {' '.join(cmd_reencode)}")
            
            result = subprocess.run(
                cmd_reencode,
                capture_output=True,
                text=True,
                cwd=temp_dir,
                timeout=300  # 5 minute timeout
            )
        
        if result.returncode != 0:
            error_msg = f"Video combination failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            print(f"❌ {error_msg}")
            return ManimResponse(
                success=False,
                error=error_msg
            )
        
        # Verify the combined video was created
        if not final_path.exists():
            return ManimResponse(
                success=False,
                error="Combined video file was not created"
            )
        
        print(f"✅ Videos combined successfully: {final_path}")
        
        # Generate URL for accessing the video
        video_url = f"http://localhost:3001/videos/{final_filename}"
        
        print(f"🎬 Combined video saved to: {final_path}")
        print(f"🔗 Combined video URL: {video_url}")
        
        return ManimResponse(
            success=True,
            videoPath=str(final_path),
            videoUrl=video_url
        )
        
    except subprocess.TimeoutExpired:
        return ManimResponse(
            success=False,
            error="Video combination timed out (5 minutes)"
        )
    except Exception as e:
        error_msg = f"Unexpected error during video combination: {str(e)}"
        print(f"❌ {error_msg}")
        return ManimResponse(
            success=False,
            error=error_msg
        )
    finally:
        # Clean up temporary directory
        try:
            shutil.rmtree(temp_dir)
        except Exception as e:
            print(f"⚠️ Failed to clean up temp directory: {e}")

@app.post("/generate-video", response_model=ManimResponse)
async def generate_video(request: ManimRequest):
    """Generate video from Manim code"""
    print(f"📹 Received video generation request")
    print(f"🔧 Manim Code:\n{request.manimCode}")
    
    # Generate unique identifier for this request
    request_id = request.messageId or str(uuid.uuid4())
    
    # Track progress
    progress_tracker[request_id] = "Starting video generation..."
    
    # Create temporary directory for this generation
    temp_dir = Path(tempfile.mkdtemp(prefix=f"manim_{request_id}_"))
    
    try:
        progress_tracker[request_id] = "Preparing Manim script..."
        # Write the Manim code to a temporary file
        script_file = temp_dir / "scene.py"

        raw_code = request.manimCode or ""
        manim_code = raw_code.strip()
        
        print(f"🎬 [DEBUG] Original manim code received:\n{manim_code}")
        
        # Fix LaTeX escaping issues first
        manim_code = fix_latex_escaping(manim_code)
        
        print(f"🎬 [DEBUG] Fixed manim code after escaping:\n{manim_code}")

        # Ensure import header present
        if "from manim import" not in manim_code.splitlines()[0]:
            manim_code = "from manim import *\nfrom math import *\n\n" + manim_code

        # Detect scene class name (first class that subclasses Scene)
        scene_class = None
        class_match = re.search(r'^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*Scene\s*\)\s*:', manim_code, re.MULTILINE)
        if class_match:
            scene_class = class_match.group(1)
        else:
            # Wrap code in a GenScene class if no class found (treat code as body)
            scene_class = "GenScene"
            indented_body = "\n".join(["        " + line for line in manim_code.splitlines()])
            manim_code = (
                "from manim import *\nfrom math import *\n\n"
                "class GenScene(Scene):\n"
                "    def construct(self):\n" + indented_body + "\n"
            )

        print(f"🧪 Detected scene class: {scene_class}")

        # Analyze code for potential issues and apply fixes
        analysis = analyze_manim_code(manim_code)
        if analysis["issues"]:
            print(f"⚠️ Issues detected in Manim code:")
            for issue in analysis["issues"]:
                if issue["type"] == "latex_missing":
                    print(f"  • Missing LaTeX with {issue['count']} LaTeX objects detected")
                    if AUTO_FALLBACK_TO_TEXT:
                        print(f"  • Auto-replacing LaTeX elements with Text")
                        manim_code = modify_code_for_latex_fallback(manim_code)
                        
                        # Also save a copy for debugging
                        modified_file = temp_dir / "modified_scene.py"
                        with open(modified_file, 'w', encoding='utf-8') as f:
                            f.write(manim_code)
                        print(f"📄 Modified code saved to: {modified_file}")

        # Write the code to file
        with open(script_file, 'w', encoding='utf-8') as f:
            f.write(manim_code)

        print(f"📄 Script written to: {script_file}")
        print(f"🎬 [DEBUG] Final script content being written:\n{manim_code}")

        progress_tracker[request_id] = f"Rendering {scene_class} with Manim..."

        # -------------------- RENDER PHASE --------------------
        try:
            scene_class_for_cmd = scene_class
            cmd = [
                sys.executable, "-m", "manim",
                str(script_file),
                scene_class_for_cmd,
                "-qh",
                "--output_file", f"{scene_class_for_cmd}_{request_id}",
                "--media_dir", str(temp_dir / "media")
            ]
            print(f"🚀 Running command: {' '.join(cmd)}")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=temp_dir,
                timeout=300
            )
            if result.returncode != 0:
                progress_tracker[request_id] = "Failed: Manim rendering error"
                
                # Check for specific LaTeX errors
                latex_error = extract_latex_error(result.stderr)
                if latex_error:
                    error_msg = f"LaTeX error: {latex_error}"
                    if not is_latex_available():
                        error_msg += "\nLaTeX not found. Please install MiKTeX or TeX Live."
                else:
                    error_msg = f"Manim generation failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
                
                print(f"❌ {error_msg}")
                return ManimResponse(success=False, error=error_msg)
        except subprocess.TimeoutExpired:
            progress_tracker[request_id] = "Failed: Manim render timeout"
            return ManimResponse(success=False, error="Manim rendering timed out (5 minutes)")
        except Exception as e:
            error_msg = f"Error during Manim rendering: {str(e)}"
            
            # Check for specific LaTeX errors if stderr is available
            latex_error = None
            if hasattr(e, "stderr") and e.stderr:
                latex_error = extract_latex_error(e.stderr)
            
            if latex_error:
                error_msg = f"LaTeX error: {latex_error}"
                if not is_latex_available():
                    error_msg += "\nLaTeX not found. Please install MiKTeX or TeX Live."
            
            progress_tracker[request_id] = f"Failed: {error_msg}"
            return ManimResponse(success=False, error=error_msg)

        progress_tracker[request_id] = "Locating output video..."
        video_files = list(temp_dir.rglob(f"{scene_class_for_cmd}_*.mp4")) or list(temp_dir.rglob("*.mp4"))
        if not video_files:
            progress_tracker[request_id] = "Failed: No video file generated"
            return ManimResponse(success=False, error="No video file was generated")

        generated_video = video_files[0]
        print(f"✅ Video generated: {generated_video}")
        
        # Handle narration audio embedding if provided
        final_filename = f"video_{request_id}.mp4"
        final_path = OUTPUT_DIR / final_filename
        
        if request.narrationAudio and FFMPEG_AVAILABLE:
            print(f"🎵 Embedding narration audio: {request.narrationAudio}")
            progress_tracker[request_id] = "Embedding narration audio..."
            
            # Copy narration audio to temp directory for processing
            narration_path = Path(request.narrationAudio)
            if narration_path.exists():
                temp_audio = temp_dir / "narration.mp3"
                shutil.copy2(narration_path, temp_audio)
                
                # Use FFmpeg to combine video with narration audio
                cmd_audio = [
                    "ffmpeg", "-y",
                    "-i", str(generated_video),  # Video input
                    "-i", str(temp_audio),       # Audio input
                    "-c:v", "copy",              # Copy video stream
                    "-c:a", "aac",               # Encode audio as AAC
                    "-map", "0:v:0",             # Map video from first input
                    "-map", "1:a:0",             # Map audio from second input
                    "-shortest",                 # End when shortest stream ends
                    str(final_path)
                ]
                
                print(f"🔄 Embedding audio: {' '.join(cmd_audio)}")
                
                audio_result = subprocess.run(
                    cmd_audio,
                    capture_output=True,
                    text=True,
                    timeout=60  # 1 minute timeout for audio embedding
                )
                
                if audio_result.returncode != 0:
                    print(f"⚠️ Audio embedding failed: {audio_result.stderr}")
                    # Fall back to video without audio
                    shutil.copy2(generated_video, final_path)
                else:
                    print(f"✅ Successfully embedded narration audio")
            else:
                print(f"⚠️ Narration audio file not found: {request.narrationAudio}")
                # Fall back to video without audio
                shutil.copy2(generated_video, final_path)
        else:
            # No audio to embed or FFmpeg not available
            shutil.copy2(generated_video, final_path)
        
        # Generate URL for accessing the video
        video_url = f"http://localhost:3001/videos/{final_filename}"
        
        print(f"🎬 Video saved to: {final_path}")
        print(f"🔗 Video URL: {video_url}")
        
        progress_tracker[request_id] = "Completed successfully"
        
        return ManimResponse(
            success=True,
            videoPath=str(final_path),
            videoUrl=video_url
        )
        
    except subprocess.TimeoutExpired:
        return ManimResponse(
            success=False,
            error="Video generation timed out (5 minutes)"
        )
    except Exception as e:
        error_msg = f"Unexpected error during video generation: {str(e)}"
        print(f"❌ {error_msg}")
        return ManimResponse(
            success=False,
            error=error_msg
        )
    finally:
        # In debug mode, save the script file before cleanup
        if DEBUG_MODE:
            debug_dir = Path(__file__).parent / "debug" / request_id
            debug_dir.mkdir(parents=True, exist_ok=True)
            
            # Save the original script
            if script_file.exists():
                shutil.copy2(script_file, debug_dir / "scene.py")
            
            # Save modified script if it exists
            modified_file = temp_dir / "modified_scene.py"
            if modified_file.exists():
                shutil.copy2(modified_file, debug_dir / "modified_scene.py")
            
            # Save logs if available
            log_file = temp_dir / "manim.log"
            if log_file.exists():
                shutil.copy2(log_file, debug_dir / "manim.log")
                
            print(f"🐛 Debug files saved to {debug_dir}")
        
        # Clean up temporary directory
        if not DEBUG_MODE:
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                print(f"⚠️ Failed to clean up temp directory: {e}")
        else:
            print(f"🔍 Debug mode: Temporary directory preserved at {temp_dir}")

if __name__ == "__main__":
    print("🚀 Starting 3D Avatar Manim Worker...")
    print(f"📁 Output directory: {OUTPUT_DIR.absolute()}")
    
    # Check and install dependencies
    check_and_install_dependencies()
    
    print(f"🎬 FFmpeg available: {FFMPEG_AVAILABLE}")
    print(f"🎵 SoX available: {check_sox()}")
    
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8001,
        log_level="info"
    )