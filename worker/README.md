# 3D Avatar Manim Worker

This worker handles video generation using Manim for the 3D Avatar system.

## Setup

1. **Install Python Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Install Manim System Dependencies:**
   - Windows: Install [MiKTeX](https://miktex.org/) or [TeX Live](https://www.tug.org/texlive/)
   - FFmpeg (optional, for better video encoding)

## Running the Worker

### Option 1: Python Script
```bash
python start_worker.py
```

### Option 2: Direct
```bash
python manim_worker.py
```

### Option 3: Batch File (Windows)
```bash
start_worker.bat
```

## API Endpoints

### Health Check
- **GET** `/health`
- Returns worker status and available features

### Generate Video
- **POST** `/generate-video`
- **Body:** 
  ```json
  {
    "manimCode": "from manim import *\n\nclass GenScene(Scene):\n    def construct(self):\n        c = Circle(color=BLUE)\n        self.play(Create(c))",
    "messageId": "optional-unique-id"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "videoPath": "/path/to/video.mp4",
    "videoUrl": "http://localhost:3001/videos/video_123.mp4"
  }
  ```

## Manim Code Requirements

The worker expects Manim code that follows these rules:

1. **Always use `GenScene` as the class name**
2. **Always use `self.play()` for animations**
3. **Include proper imports:** `from manim import *` and `from math import *`
4. **No explanatory text, only code**

### Example Valid Code:
```python
from manim import *
from math import *

class GenScene(Scene):
    def construct(self):
        # Create a circle
        circle = Circle(color=BLUE)
        self.play(Create(circle))
        
        # Add text
        text = Text("Hello Manim!")
        self.play(Write(text))
        
        # Transform
        self.play(Transform(circle, Square(color=RED)))
        self.wait(1)
```

## Output

- Videos are saved to: `../uploads/videos/`
- Accessible via: `http://localhost:3001/videos/filename.mp4`
- Worker runs on: `http://localhost:8001`

## Troubleshooting

1. **Import errors:** Make sure all dependencies are installed
2. **Video not generating:** Check console output for Manim errors
3. **FFmpeg warnings:** Videos will generate without audio (install FFmpeg for audio support)
4. **Port conflicts:** Make sure port 8001 is available