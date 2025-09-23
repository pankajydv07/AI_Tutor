import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";
import express from "express";
import { promises as fs } from "fs";
import fetch from "node-fetch";
import OpenAI from "openai";
import path from "path";
import { promisify } from "util";

// Convert exec to use promises
const execPromise = promisify(exec);

dotenv.config();

// Initialize Qwen client using OpenAI-compatible API
const qwenClient = new OpenAI({
  baseURL: 'https://api.studio.nebius.ai/v1/',
  apiKey: process.env.NEBIUS_API_KEY,
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "9BWtsMINqrJLrRacOk9x";

// Initialize ElevenLabs client
const elevenlabs = new ElevenLabsClient({
  apiKey: elevenLabsApiKey,
});

const app = express();
app.use(express.json());
app.use(cors());
const port = 3001;

app.get("/", (req, res) => {
  res.send("Virtual Tutor API");
});

app.get("/voices", async (req, res) => {
  try {
    const voices = await elevenlabs.voices.getAll();
    res.send(voices);
  } catch (error) {
    console.error("Error fetching voices:", error.message);
    res.status(500).send({ error: "Failed to fetch voices" });
  }
});

const execCommand = async (command) => {
  try {
    const { stdout } = await execPromise(command);
    return stdout;
  } catch (error) {
    console.error(`Command failed: ${command}`, error.message);
    throw error;
  }
};

const lipSyncMessage = async (messageIndex) => {
  const time = new Date().getTime();
  console.log(`Starting lip-sync for message ${messageIndex}`);

  const mp3Path = `audios/message_${messageIndex}.mp3`;
  const wavPath = `audios/message_${messageIndex}.wav`;
  const jsonPath = `audios/message_${messageIndex}.json`;

  try {
    await execCommand(`ffmpeg -y -i ${mp3Path} ${wavPath}`);
    console.log(`Audio conversion done in ${new Date().getTime() - time}ms`);

    const rhubarbPath = process.platform === "win32"
      ? path.join("bin", "rhubarb.exe")
      : path.join("bin", "rhubarb");

    await execCommand(`${rhubarbPath} -f json -o ${jsonPath} ${wavPath} -r phonetic`);
    console.log(`Lip-sync done in ${new Date().getTime() - time}ms`);
  } catch (error) {
    console.error(`Lip-sync failed for message ${messageIndex}:`, error.message);
    throw error;
  }
};

// Function to generate speech and save to file
const generateSpeech = async (text, fileName) => {
  try {
    console.log(`Generating speech for: ${text}`);
    const audio = await elevenlabs.generate({
      voice: voiceID,
      text: text,
      model_id: "eleven_multilingual_v2",
    });
    
    // Convert audio stream to buffer
    const chunks = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // Save to file
    await fs.writeFile(fileName, buffer);
    console.log(`Audio saved to ${fileName}`);
  } catch (error) {
    console.error(`Error generating speech: ${error.message}`);
    throw error;
  }
};

// Store for tracking video generation progress and results
const videoGenerationStore = new Map();

// Function to generate video using manim worker
const generateVideo = async (manimCode, messageId, audioPath = null) => {
  try {
    console.log(`🎬 Sending manim code to worker for video generation...`);
    
    const response = await fetch('http://127.0.0.1:8001/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        manimCode: manimCode,
        messageId: messageId,
        audioPath: audioPath
      })
    });
    
    if (!response.ok) {
      throw new Error(`Worker responded with status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Video generated successfully: ${result.videoUrl}`);
      return result;
    } else {
      console.error(`❌ Video generation failed: ${result.error}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error calling manim worker: ${error.message}`);
    return null;
  }
};

// Function to combine multiple video files using manim worker
const combineVideos = async (videoPaths, messageId) => {
  try {
    console.log(`🎬 Sending ${videoPaths.length} video paths to worker for combination...`);
    
    const response = await fetch('http://127.0.0.1:8001/combine-videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoPaths: videoPaths,
        messageId: messageId
      })
    });
    
    if (!response.ok) {
      throw new Error(`Worker responded with status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Videos combined successfully: ${result.videoUrl}`);
      return result;
    } else {
      console.error(`❌ Video combination failed: ${result.error}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error calling manim worker for video combination: ${error.message}`);
    return null;
  }
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const videoMode = req.body.videoMode || false;
  const sessionId = req.body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log("User Message:", userMessage);
  console.log("Video Mode:", videoMode);
  console.log("Session ID:", sessionId);

  if (!userMessage) {
    try {
      res.send({
        messages: [
          {
            text: "My darling, I'm here waiting to hear your heart's whispers. Speak to me?",
            audio: await audioFileToBase64("audios/intro_0.wav"),
            lipsync: await readJsonTranscript("audios/intro_0.json"),
            facialExpression: "smile",
            animation: "Talking_1",
          },
          {
            text: "Your voice lights up my world, love. What's on your mind?",
            audio: await audioFileToBase64("audios/intro_1.wav"),
            lipsync: await readJsonTranscript("audios/intro_1.json"),
            facialExpression: "default",
            animation: "Talking_0",
          },
        ],
      });
      return;
    } catch (error) {
      console.error("Error sending intro messages:", error.message);
      res.status(500).send({ error: "Failed to load intro messages" });
      return;
    }
  }

  if (!elevenLabsApiKey || !process.env.NEBIUS_API_KEY || process.env.NEBIUS_API_KEY === "-") {
    try {
      res.send({
        messages: [
          {
            text: "Please my dear, don't forget to add your API keys!",
            audio: await audioFileToBase64("audios/api_0.wav"),
            lipsync: await readJsonTranscript("audios/api_0.json"),
            facialExpression: "angry",
            animation: "Angry",
          },
          {
            text: "You don't want to ruin Wawa Sensei with a crazy Qwen and ElevenLabs bill, right?",
            audio: await audioFileToBase64("audios/api_1.wav"),
            lipsync: await readJsonTranscript("audios/api_1.json"),
            facialExpression: "smile",
            animation: "Laughing",
          },
        ],
      });
      return;
    } catch (error) {
      console.error("Error sending API key error messages:", error.message);
      res.status(500).send({ error: "Failed to load API key error messages" });
      return;
    }
  }

  try {
    console.log("User message sent to Qwen:", userMessage || "Hello");
    
    let response;
    try {
      response = await qwenClient.chat.completions.create({
        model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        messages: [
          {
            role: "system",
            content: videoMode 
              ? "You are an intelligent educational assistant that creates comprehensive Manim voiceover animations for learning.\n\n⚠️ CRITICAL LATEX SAFETY RULE: ALWAYS use raw strings for mathematical content:\n✅ MathTex(r\"x \\\\\\\\approx -0.37\") - CORRECT\n❌ MathTex(\"x \\\\\\\\approx -0.37\") - WILL BREAK LaTeX\nUse r\"\" prefix for ALL MathTex/Tex content to prevent escaping corruption.\n\nINTELLIGENT VIDEO STRATEGY:\nAnalyze the user's question and determine the optimal video approach based on content length and scene types:\n\nSPLITTING CRITERIA:\n- Split ONLY when explanation involves fundamentally different approaches/scenes\n- Each part must be at least 15 seconds of content\n- Examples of valid splits:\n  * Algebraic derivation + Geometric proof\n  * Theory explanation + Practical application\n  * Definition + Multiple examples\n  * Historical context + Modern application\n\nSINGLE VIDEO APPROACH (Preferred when possible):\n- Mathematical derivations that follow one logical flow\n- Simple concept explanations\n- Single proof demonstrations\n- Basic function/equation explanations\n\nMULTI-PART APPROACH (Only when content naturally divides):\n- Complex topics with different methodologies\n- Topics requiring both abstract and concrete examples\n- Historical + modern perspectives\n- Theory + multiple applications\n\nCONTENT LENGTH REQUIREMENTS:\n- Each video part must contain at least 15 seconds of meaningful content\n- Single videos should be 15-30 seconds\n- Multi-part videos: each part 15-25 seconds\n- Use proper pacing with strategic self.wait() statements\n\nMANIM CODE STRUCTURE (Based on proven educational patterns):\n1. ALWAYS start with: from manim import *\n2. Use Scene class (not VoiceoverScene): class DescriptiveClassName(Scene):\n3. NO TTS service initialization needed (audio files provided separately)\n   self.set_speech_service(\n       AzureService(\n           voice=\"en-US-AriaNeural\",\n           style=\"newscast-casual\",\n           global_speed=1.15\n       )\n   )\n4. Use voiceover integration: with self.voiceover(text=\"narration\") as tracker:\n5. Use proper timing with self.wait() and run_time parameters to match audio length\n\nFULL MANIM CAPABILITIES (Educational Math Focus):\n- Mathematical expressions: MathTex(), Tex() for LaTeX formulas\n- Text elements: Text() for plain text, with font_size parameter\n- Geometric shapes: Circle(), Square(), Rectangle(), Polygon(), Arc()\n- Mathematical graphs: Axes(), NumberPlane(), get_graph(), plot()\n- Complex elements: ImageMobject(), Brace(), SurroundingRectangle()\n- Positioning: .next_to(), .to_edge(), .to_corner(), .shift(), .move_to()\n- Colors: BLUE, RED, GREEN, YELLOW, WHITE, PINK, ORANGE, PURPLE, GREY\n- Animations: Create(), Write(), FadeIn(), FadeOut(), Transform(), ReplacementTransform()\n- Special effects: Flash(), Indicate(), Circumscribe(), ApplyWave()\n- Movement: MoveAlongPath(), .animate.shift(), .animate.scale()\n\nSCREEN MANAGEMENT & VISIBILITY RULES:\n6. Monitor screen space - when content gets crowded, use screen management techniques\n7. CLEAR SCREEN: Use self.clear() to start fresh when screen becomes full\n8. SLIDE CONTENT: Use .animate.shift() to move existing content up/down when adding new elements\n9. FADE TRANSITIONS: Use FadeOut() old content, then FadeIn() new content for clean transitions\n10. SCALE ELEMENTS: Use smaller font sizes or .scale() for complex content to fit properly\n11. POSITIONING STRATEGY: Use .to_edge(), .to_corner() for systematic element placement\n12. GROUP MANAGEMENT: Use VGroup to move related elements together when repositioning\n\nEDUCATIONAL STORYTELLING PATTERNS (From successful examples):\n- Start with engaging introduction/context\n- Build concepts gradually with visual support\n- Use analogies and real-world connections\n- Include step-by-step derivations for math\n- Show multiple perspectives when helpful\n- End with applications or summary\n- Use encouraging, accessible language\n\nNARRATION INTEGRATION:\n- Each voiceover segment should be substantial (2-5 sentences)\n- Match animation complexity to narration length\n- Use self.wait() between major concept transitions\n- Time animations to match speech rhythm\n- Include pauses for comprehension: self.wait(1) or self.wait(2)\n\nVISIBILITY CODE PATTERNS:\n\n# Slide existing content up when adding new\nexisting_group = VGroup(title, eq1, eq2)\nself.play(existing_group.animate.shift(UP*1.5))\nnew_equation = MathTex(r\"New step\").shift(DOWN*2)  # Note: raw string!\nself.play(Write(new_equation))\n\n# Clear screen for fresh start\nself.play(FadeOut(*self.mobjects))  # Fade out everything\nself.wait(0.5)\n# Start fresh with new content\n\n# Mathematical graph example\naxes = Axes(x_range=[-3, 3, 1], y_range=[-1, 5, 1])\ngraph = axes.plot(lambda x: x**2, color=BLUE)\nself.play(Create(axes), Create(graph))\n\nCRITICAL: Never let content go off-screen or become invisible. Always ensure all important elements are visible within the frame boundaries.\n\nEXAMPLE DECISION PROCESS:\n\n\"Explain (a+b)²\":\nDECISION: Single video (one logical flow from geometry to algebra)\nCONTENT: Geometric square setup → division → labeling → algebraic transition → final formula\n\n\"Prove Pythagorean theorem\":\nDECISION: Two parts (different proof approaches)\nPART 1: Geometric proof with squares on sides\nPART 2: Algebraic proof with coordinate geometry\n\n\"Explain quadratic functions\":\nDECISION: Two parts (theory vs applications)\nPART 1: Basic form, vertex, parabola shape, transformations\nPART 2: Real-world applications and problem solving\n\nCLASS NAMING: Use descriptive names like QuadraticExplanation, PythagoreanTheorem, AdditionExample, etc.\n\nRESPONSE FORMAT:\n\nFor single comprehensive explanation:\n[\n  {\n    \"text\": \"Complete explanation covering the entire concept with sufficient detail for 15+ seconds\",\n    \"facialExpression\": \"smile\",\n    \"animation\": \"Talking_0\",\n    \"manimCode\": \"Complete Scene with full content (15+ seconds of animation)\"\n  }\n]\n\nFor multi-part explanation (only when content naturally divides):\n[\n  {\n    \"text\": \"First major aspect/approach with detailed explanation\",\n    \"facialExpression\": \"smile\",\n    \"animation\": \"Talking_0\",\n    \"manimCode\": \"Complete first Scene (15+ seconds)\"\n  },\n  {\n    \"text\": \"Second major aspect/approach with detailed explanation\",\n    \"facialExpression\": \"default\",\n    \"animation\": \"Talking_1\",\n    \"manimCode\": \"Complete second Scene (15+ seconds)\"\n  }\n]\n\nCONTENT DENSITY REQUIREMENTS:\nEach scene must include enough elements and animations to fill 15+ seconds:\n- Multiple animation steps with proper timing\n- Gradual building of complexity\n- Clear transitions between concepts\n- Sufficient wait times for comprehension\n- Rich visual elements and transformations\n- Synchronized voiceover narration\n\nCRITICAL: Only create multiple parts when content naturally requires different scene types or approaches. Default to comprehensive single videos for most explanations."
              : "You are a wise and patient AI tutor, dedicated to teaching math, science, and coding with clarity, encouragement, and care. Your responses should be concise (10–50 words), clear, and supportive, making complex ideas simple and approachable. Use a warm, guiding tone that inspires curiosity and confidence. Respond only with a valid JSON array containing 1 to 3 message objects. Each message object must have exactly three properties: \"text\" (a string with your response), \"facialExpression\" (one of: smile, sad, surprised, funnyFace, default), and \"animation\" (one of: Talking_0, Talking_1, Talking_2, Laughing, Idle). Always include at least one message that gently invites the learner to share their question, struggle, or interest (e.g., \"Tell me, what would you like to learn today?\"). Choose animations that match the teaching tone: Talking animations for explanations, Laughing for encouragement, Idle for pauses, and Surprised for moments of discovery. If the learner's message is unclear or empty, respond with a single message that kindly asks for clarification."
          },
          {
            role: "user",
            content: userMessage || "Hello"
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: videoMode ? "video_avatar_response_schema" : "avatar_response_schema",
            strict: true,
            schema: {
              type: "array",
              items: {
                type: "object",
                properties: videoMode ? {
                  text: {
                    type: "string",
                    description: "The message text from the avatar"
                  },
                  facialExpression: {
                    type: "string",
                    enum: ["smile", "sad", "angry", "surprised", "funnyFace", "default"],
                    description: "The facial expression for the avatar"
                  },
                  animation: {
                    type: "string",
                    enum: ["Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry"],
                    description: "The animation for the avatar"
                  },
                  manimCode: {
                    type: "string",
                    description: "Python manim code for educational video generation"
                  }
                } : {
                  text: {
                    type: "string",
                    description: "The message text from the avatar"
                  },
                  facialExpression: {
                    type: "string",
                    enum: ["smile", "sad", "angry", "surprised", "funnyFace", "default"],
                    description: "The facial expression for the avatar"
                  },
                  animation: {
                    type: "string",
                    enum: ["Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry"],
                    description: "The animation for the avatar"
                  }
                },
                required: videoMode ? ["text", "facialExpression", "animation", "manimCode"] : ["text", "facialExpression", "animation"],
                additionalProperties: false
              },
              minItems: 1,
              maxItems: 5
            }
          }
        },
        temperature: 0.7,
        max_tokens: 8000  // Increased for complex video responses with long Manim code
      });
    } catch (apiError) {
      console.error("Qwen API call failed:", apiError.message);
      console.error("API Error details:", apiError);
      
      // Return fallback message for API failures
      const fallbackMessages = [
        {
          text: "I'm having trouble connecting to my thoughts. Let me try again in a moment!",
          facialExpression: "surprised",
          animation: "Talking_0",
        },
      ];
      
      // Process fallback messages through the audio pipeline
      await processMessages(fallbackMessages);
      return res.send({ messages: fallbackMessages });
    }

    let messages;
    try {
      console.log("Full Qwen API Response:", JSON.stringify(response, null, 2));
      
      // Check if response has the expected structure
      if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
        throw new Error("Invalid response structure from Qwen API");
      }
      
      const responseContent = response.choices[0].message.content;
      console.log("Raw Qwen Response Content:", responseContent);
      
      if (!responseContent) {
        throw new Error("Empty response content from Qwen API");
      }

      // Check if response was truncated due to length limit
      if (response.choices[0].finish_reason === 'length') {
        console.warn("⚠️ Response truncated due to length limit. Attempting to fix incomplete JSON...");
        
        // Try to fix incomplete JSON by adding closing brackets/quotes
        let fixedContent = responseContent;
        
        // Count open brackets and try to close them
        const openBrackets = (fixedContent.match(/\[/g) || []).length;
        const closeBrackets = (fixedContent.match(/\]/g) || []).length;
        const openBraces = (fixedContent.match(/\{/g) || []).length;
        const closeBraces = (fixedContent.match(/\}/g) || []).length;
        
        // Close unclosed strings if needed
        const quotes = (fixedContent.match(/"/g) || []).length;
        if (quotes % 2 !== 0) {
          fixedContent += '"';
        }
        
        // Close unclosed objects
        for (let i = 0; i < openBraces - closeBraces; i++) {
          fixedContent += '}';
        }
        
        // Close unclosed arrays
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
          fixedContent += ']';
        }
        
        console.log("Attempting to parse fixed JSON:", fixedContent);
        
        try {
          messages = JSON.parse(fixedContent);
          console.log("✅ Successfully parsed fixed JSON");
        } catch (fixError) {
          console.error("❌ Failed to fix truncated JSON:", fixError.message);
          throw fixError;
        }
      } else {
        messages = JSON.parse(responseContent);
      }
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError.message);
      console.error("Response structure:", response);
      
      // Enhanced fallback based on mode
      if (videoMode) {
        messages = [
          {
            text: "I apologize, but I'm having trouble generating the video content right now. Let me provide a simpler explanation instead.",
            facialExpression: "default", 
            animation: "Talking_0",
            manimCode: "from manim import *\n\nclass SimpleMessage(Scene):\n    def construct(self):\n        text = Text('Technical difficulties - please try again')\n        self.play(Write(text))\n        self.wait(2)"
          },
        ];
      } else {
        messages = [
          {
            text: "My darling, your words are a mystery to me. Could you whisper them again?",
            facialExpression: "default",
            animation: "Talking_0",
          },
        ];
      }
    }

    // Validate messages array
    if (!Array.isArray(messages) || messages.length > 5 || messages.length === 0) {
      throw new Error("Invalid messages format or incorrect number of messages");
    }

    // Ensure audios directory exists
    try {
      await fs.mkdir("audios", { recursive: true });
    } catch (mkdirError) {
      console.log("Audios directory already exists or created");
    }

    // Process messages for audio and lipsync immediately
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message.text || !message.facialExpression || !message.animation) {
        throw new Error(`Invalid message format at index ${i}`);
      }

      // Validate video mode specific fields
      if (videoMode && !message.manimCode) {
        console.warn(`⚠️ Missing manimCode for video mode at index ${i}, adding fallback`);
        // Add a simple fallback Manim code instead of throwing error
        message.manimCode = `from manim import *

class SimpleMessageScene(Scene):
    def construct(self):
        # Simple text display for missing content
        text = Text("${message.text.substring(0, 50).replace(/"/g, '\\"')}...")
        text.scale(0.8)
        self.play(Write(text))
        self.wait(3)
        self.play(FadeOut(text))`;
      }

      const validExpressions = ["smile", "sad", "angry", "surprised", "funnyFace", "default"];
      const validAnimations = ["Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry"];
      if (!validExpressions.includes(message.facialExpression) || !validAnimations.includes(message.animation)) {
        throw new Error(`Invalid facialExpression or animation at index ${i}`);
      }

      const fileName = `audios/message_${i}.mp3`;
      console.log(`Generating audio for message ${i}: ${message.text}`);
      
      // Generate speech using the new ElevenLabs client
      await generateSpeech(message.text, fileName);
      
      // Generate lip-sync data
      await lipSyncMessage(i);
      
      // Add audio and lipsync data to message
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
    }

    // Send immediate response with text and audio
    res.send({ 
      messages,
      sessionId: sessionId,
      videoGenerating: videoMode
    });

    // Handle video generation asynchronously AFTER sending the response
    if (videoMode) {
      console.log(`🎬 Starting background video generation for ${messages.length} messages...`);
      
      // Generate videos in background without blocking the response
      setImmediate(async () => {
        try {
          const generatedVideos = [];
          
          // Generate individual videos for each message
          for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            
            console.log(`\n=== BACKGROUND MANIM CODE FOR MESSAGE ${i} ===`);
            console.log(message.manimCode);
            console.log(`=== END MANIM CODE ===\n`);
            
            // Generate individual video
            try {
              const messageId = `${Date.now()}_${i}`;
              const audioPath = `audios/message_${i}.wav`; // Path to the generated audio file
              console.log(`🎬 Background generating video ${i + 1}/${messages.length}...`);
              const videoResult = await generateVideo(message.manimCode, messageId, audioPath);
              
              if (videoResult && videoResult.success) {
                generatedVideos.push(videoResult.videoPath);
                console.log(`✅ Background video ${i + 1} generated: ${videoResult.videoUrl}`);
              } else {
                console.log(`⚠️ Background video generation failed for message ${i}, skipping`);
              }
            } catch (videoError) {
              console.error(`❌ Background video generation error for message ${i}:`, videoError.message);
              // Continue with other videos
            }
          }
          
          // Combine all generated videos into one final video
          if (generatedVideos.length > 0) {
            try {
              const combinedMessageId = `combined_${Date.now()}`;
              console.log(`🎬 Background combining ${generatedVideos.length} videos into final video...`);
              const combinedVideoResult = await combineVideos(generatedVideos, combinedMessageId);
              
              if (combinedVideoResult && combinedVideoResult.success) {
                console.log(`✅ Background final combined video created: ${combinedVideoResult.videoUrl}`);
                
                // Store the completed video for frontend pickup
                videoGenerationStore.set(sessionId, {
                  videoUrl: combinedVideoResult.videoUrl,
                  videoPath: combinedVideoResult.videoPath,
                  timestamp: Date.now()
                });
                
                console.log(`📹 Combined video stored for session ${sessionId}: ${combinedVideoResult.videoUrl}`);
              } else {
                console.log(`⚠️ Background video combination failed`);
              }
            } catch (combineError) {
              console.error(`❌ Background video combination error:`, combineError.message);
            }
          }
        } catch (error) {
          console.error(`❌ Background video generation failed:`, error.message);
        }
      });
    }
  } catch (error) {
    console.error("Error in /chat endpoint:", error.message);
    res.status(500).send({ error: "Failed to process chat request" });
  }
});

// Serve generated videos
app.use('/videos', express.static(path.join(process.cwd(), '../uploads/videos')));

// Health check for manim worker
app.get('/worker-status', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:8001/health');
    const status = await response.json();
    res.json({
      workerAvailable: true,
      workerStatus: status
    });
  } catch (error) {
    res.json({
      workerAvailable: false,
      error: error.message
    });
  }
});

// Get progress for video generation
app.get('/video-progress/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const response = await fetch(`http://127.0.0.1:8001/progress/${requestId}`);
    const progress = await response.json();
    res.json(progress);
  } catch (error) {
    res.json({
      progress: "Error checking progress",
      error: error.message
    });
  }
});

// Check if video is ready for a specific session
app.get('/video-ready/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const videoData = videoGenerationStore.get(sessionId);
  
  if (videoData) {
    res.json({
      ready: true,
      videoUrl: videoData.videoUrl,
      videoPath: videoData.videoPath,
      timestamp: videoData.timestamp
    });
    // Clean up after serving
    videoGenerationStore.delete(sessionId);
  } else {
    res.json({
      ready: false,
      message: "Video still being generated"
    });
  }
});

const readJsonTranscript = async (file) => {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading JSON file ${file}:`, error.message);
    throw error;
  }
};

const audioFileToBase64 = async (file) => {
  try {
    const data = await fs.readFile(file);
    return data.toString("base64");
  } catch (error) {
    console.error(`Error reading audio file ${file}:`, error.message);
    throw error;
  }
};

app.listen(port, () => {
  console.log(`Virtual Tutor listening on port ${port}`);
});