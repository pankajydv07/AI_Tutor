import os
import sys
import json
import uuid
import shutil
import subprocess
import tempfile
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

class ManimRequest(BaseModel):
    manimCode: str
    messageId: str = None

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

# Global progress tracking
progress_tracker = {}

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
        "ffmpeg_available": FFMPEG_AVAILABLE
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
        progress_tracker[request_id] = "Writing Manim script..."
        # Write the Manim code to a temporary file
        script_file = temp_dir / "scene.py"
        
        # Ensure the code has proper structure
        manim_code = request.manimCode.strip()
        if not manim_code.startswith("from manim import"):
            manim_code = "from manim import *\nfrom math import *\n\n" + manim_code
        
        # Write the code to file
        with open(script_file, 'w', encoding='utf-8') as f:
            f.write(manim_code)
        
        print(f"📄 Script written to: {script_file}")
        
        progress_tracker[request_id] = "Rendering video with Manim..."
        
        # Run Manim to generate the video
        output_file = temp_dir / "media" / "videos" / "scene" / "1080p60" / "GenScene.mp4"
        
        # Execute Manim command
        cmd = [
            sys.executable, "-m", "manim",
            str(script_file),
            "GenScene",
            "-qh",  # High quality
            "--output_file", f"GenScene_{request_id}",
            "--media_dir", str(temp_dir / "media")
        ]
        
        print(f"🚀 Running command: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=temp_dir,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode != 0:
            progress_tracker[request_id] = "Failed: Manim rendering error"
            error_msg = f"Manim generation failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
            print(f"❌ {error_msg}")
            return ManimResponse(
                success=False,
                error=error_msg
            )
        
        progress_tracker[request_id] = "Saving video file..."
        
        # Find the generated video file
        video_files = list(temp_dir.rglob("*.mp4"))
        if not video_files:
            progress_tracker[request_id] = "Failed: No video file generated"
            return ManimResponse(
                success=False,
                error="No video file was generated"
            )
        
        generated_video = video_files[0]
        print(f"✅ Video generated: {generated_video}")
        
        # Copy to final output directory
        final_filename = f"video_{request_id}.mp4"
        final_path = OUTPUT_DIR / final_filename
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
        # Clean up temporary directory
        try:
            shutil.rmtree(temp_dir)
        except Exception as e:
            print(f"⚠️ Failed to clean up temp directory: {e}")

if __name__ == "__main__":
    print("🚀 Starting 3D Avatar Manim Worker...")
    print(f"📁 Output directory: {OUTPUT_DIR.absolute()}")
    print(f"🎬 FFmpeg available: {FFMPEG_AVAILABLE}")
    
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8001,
        log_level="info"
    )