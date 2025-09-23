#!/usr/bin/env python3
"""
Startup script for 3D Avatar Manim Worker
"""
import subprocess
import sys
import os
from pathlib import Path

def main():
    print("🚀 Starting 3D Avatar Manim Worker...")
    
    # Change to worker directory
    worker_dir = Path(__file__).parent
    os.chdir(worker_dir)
    
    try:
        # Start the worker
        subprocess.run([sys.executable, "manim_worker.py"], check=True)
    except KeyboardInterrupt:
        print("\n⏹️ Worker stopped by user")
    except subprocess.CalledProcessError as e:
        print(f"❌ Worker failed with exit code: {e.returncode}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()