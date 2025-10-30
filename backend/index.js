import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import fetch from "node-fetch";
import OpenAI from "openai";
import path from "path";
import { promisify } from "util";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";

// Convert exec to use promises
const execPromise = promisify(exec);

dotenv.config();

// Initialize Qwen client using OpenAI-compatible API
const qwenClient = new OpenAI({
  baseURL: 'https://api.studio.nebius.ai/v1/',
  apiKey: process.env.NEBIUS_API_KEY,
});

// Initialize Google Cloud Text-to-Speech client
let googleTtsClient = null;
const initializeGoogleTTS = async () => {
  try {
    // Initialize with credentials from environment or file
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      googleTtsClient = new TextToSpeechClient();
      console.log("✅ Google Cloud TTS initialized with service account");
    } else if (process.env.GOOGLE_TTS_CREDENTIALS) {
      // Parse JSON credentials from environment variable
      const credentials = JSON.parse(process.env.GOOGLE_TTS_CREDENTIALS);
      googleTtsClient = new TextToSpeechClient({ credentials });
      console.log("✅ Google Cloud TTS initialized with JSON credentials");
    } else {
      console.warn("⚠️ Google Cloud TTS credentials not found. Please set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_TTS_CREDENTIALS");
    }
  } catch (error) {
    console.error("❌ Failed to initialize Google Cloud TTS:", error.message);
  }
};

// Initialize Google TTS on startup
initializeGoogleTTS();

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

// Function to generate speech and save to file using Google Cloud TTS
const generateSpeech = async (text, fileName) => {
  try {
    console.log(`Generating speech for: ${text}`);
    
    if (!googleTtsClient) {
      throw new Error("Google Cloud TTS client not initialized. Please check credentials.");
    }

    const request = {
      input: { text: text },
      voice: {
        languageCode: 'en-US',
        name: 'en-US-Wavenet-F', // Female voice, similar to previous setup
        ssmlGender: 'FEMALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
        volumeGainDb: 0.0,
      },
    };

    const [response] = await googleTtsClient.synthesizeSpeech(request);
    
    // Save to file
    await fs.writeFile(fileName, response.audioContent, 'binary');
    console.log(`Audio saved to ${fileName}`);
    return fileName;
  } catch (error) {
    console.error(`Error generating speech: ${error.message}`);
    throw error;
  }
};

// Helper to process a simple array of messages through the audio pipeline
// Generates TTS audio + lip-sync JSON for each message and attaches
// `audio` (base64) and `lipsync` fields to each message object.
const processMessages = async (messagesArray) => {
  try {
    // Ensure audios directory exists
    await fs.mkdir("audios", { recursive: true });

    for (let i = 0; i < messagesArray.length; i++) {
      const msg = messagesArray[i];
      // Prefer text/chatResponse/videoExplanation in that order
      const text = msg.text || msg.chatResponse || msg.videoExplanation || "(no text)";
      const fileName = `audios/message_${i}.mp3`;

      console.log(`processMessages: generating speech for fallback message ${i}`);
      await generateSpeech(text, fileName);

      // Generate lip-sync JSON for this audio
      try {
        await lipSyncMessage(i);
      } catch (lsErr) {
        console.warn(`processMessages: lip-sync failed for message ${i}:`, lsErr.message);
      }

      // Attach audio (base64) and lipsync JSON if present
      try {
        msg.audio = await audioFileToBase64(fileName);
      } catch (e) {
        console.warn(`processMessages: failed to read audio file ${fileName}:`, e.message);
      }

      try {
        msg.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
      } catch (e) {
        console.warn(`processMessages: failed to read lipsync for message ${i}:`, e.message);
      }
    }

    return messagesArray;
  } catch (error) {
    console.error("processMessages error:", error.message);
    throw error;
  }
};

// Function to generate combined narration audio for video synchronization
const generateVideoNarrationAudio = async (videoExplanationText, sessionId) => {
  try {
    const fileName = `audios/video_narration_${sessionId}.mp3`;
    console.log(`🎵 Generating video narration audio: ${fileName}`);
    
    // Use the same generateSpeech function which now uses Google Cloud TTS
    await generateSpeech(videoExplanationText, fileName);
    console.log(`✅ Video narration audio saved: ${fileName}`);
    
    // Generate lip-sync data for avatar
    const wavFileName = `audios/video_narration_${sessionId}.wav`;
    const jsonFileName = `audios/video_narration_${sessionId}.json`;
    
    // Convert to WAV for lip-sync processing
    await execCommand(`ffmpeg -y -i ${fileName} ${wavFileName}`);
    
    // Generate lip-sync JSON
    const rhubarbPath = process.platform === "win32"
      ? path.join("bin", "rhubarb.exe")
      : path.join("bin", "rhubarb");
    
    await execCommand(`${rhubarbPath} -f json -o ${jsonFileName} ${wavFileName} -r phonetic`);
    
    return {
      audioFile: fileName,
      wavFile: wavFileName,
      lipsyncFile: jsonFileName
    };
  } catch (error) {
    console.error(`❌ Error generating video narration audio: ${error.message}`);
    throw error;
  }
};

// Store for tracking video generation progress and results
const videoGenerationStore = new Map();

// Function to generate video using manim worker
const generateVideo = async (manimCode, messageId, narrationAudioPath = null) => {
  try {
    console.log(`🎬 Sending manim code to worker for video generation...`);
    
    const requestBody = {
      manimCode: manimCode,
      messageId: messageId
    };
    
    // Include narration audio if provided
    if (narrationAudioPath) {
      const absoluteAudioPath = path.resolve(narrationAudioPath);
      console.log(`🎵 Including narration audio: ${narrationAudioPath} -> ${absoluteAudioPath}`);
      requestBody.narrationAudio = absoluteAudioPath;
    }
    
    const response = await fetch('http://127.0.0.1:8001/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
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

  const hasGoogleTTSCredentials = googleTtsClient !== null;
  const hasNebius = process.env.NEBIUS_API_KEY && process.env.NEBIUS_API_KEY !== "-";
  
  if (!hasGoogleTTSCredentials || !hasNebius) {
    console.error("❌ Missing API Keys/Credentials:");
    console.error("  Google Cloud TTS:", hasGoogleTTSCredentials ? "✅ Configured" : "❌ Missing");
    console.error("  NEBIUS_API_KEY:", hasNebius ? "✅ Set" : "❌ Missing");
    
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
            text: "You need Google Cloud TTS credentials and Nebius API key configured properly!",
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
      res.status(500).send({ 
        error: "Missing credentials. Please check Google Cloud TTS credentials and NEBIUS_API_KEY configuration." 
      });
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
              ? "You are an intelligent educational assistant that creates comprehensive Manim voiceover animations for learning. You have access to chat history from previous conversations to provide contextually aware and personalized educational content.\n\nCHAT HISTORY INTEGRATION:\n- Analyze previous conversations to understand the user's learning progress, preferences, and areas of difficulty\n- Reference prior explanations to build upon previously covered concepts\n- Adapt complexity level based on user's demonstrated understanding from chat history\n- Maintain continuity in teaching approach and terminology used in previous sessions\n- If user asks follow-up questions, connect them to previously explained concepts\n- For returning topics, acknowledge prior coverage and offer deeper exploration or alternative perspectives\n\nYou MUST generate TWO types of content:\n1. CHAT RESPONSE: A concise, friendly text response for the chat history (10-50 words)\n2. VIDEO EXPLANATION: A detailed narration script that explains what happens in the video\n\n⚠️ CRITICAL LATEX SAFETY RULE: ALWAYS use raw strings for mathematical content:\n✅ MathTex(r\"x \\\\approx -0.37\") - CORRECT\n❌ MathTex(\"x \\\\approx -0.37\") - WILL BREAK LaTeX. Use r\"\" prefix for ALL MathTex/Tex content to prevent escaping corruption.\n\nIMPORTANT: The chat response and video explanation serve different purposes:\n- Chat response: Shows in chat history, answers the user's question directly, references prior learning when relevant\n- Video explanation: Narrates and describes the visual content in the generated video\n\nINTELLIGENT VIDEO STRATEGY:\nAnalyze the user's question and determine the optimal video approach based on content length and scene types.\n\nSPLITTING CRITERIA:\n- Split ONLY when explanation involves fundamentally different approaches/scenes\n- Each part must be at least 15 seconds of content\n- Examples of valid splits:\n  * Algebraic derivation + Geometric proof\n  * Theory explanation + Practical application\n  * Definition + Multiple examples\n  * Historical context + Modern application\n\nSINGLE VIDEO APPROACH (Preferred when possible):\n- Mathematical derivations that follow one logical flow\n- Simple concept explanations\n- Single proof demonstrations\n- Basic function/equation explanations\n\nMULTI-PART APPROACH (Only when content naturally divides):\n- Complex topics with different methodologies\n- Topics requiring both abstract and concrete examples\n- Historical + modern perspectives\n- Theory + multiple applications\n\nCONTENT LENGTH REQUIREMENTS:\n- Each video part must contain at least 15 seconds of meaningful content\n- Single videos should be 15-30 seconds\n- Multi-part videos: each part 15-25 seconds\n- Use proper pacing with strategic self.wait() statements\n\nMANIM CODE STRUCTURE (Based on proven educational patterns):\n1. ALWAYS start with: from manim import *\n2. Use Scene class (not VoiceoverScene): class DescriptiveClassName(Scene):\n3. NO voiceover methods - audio handled separately by backend system\n4. DO NOT use self.voiceover() or VoiceoverScene - will cause errors\n5. Use proper timing with self.wait() and run_time parameters for pacing\n\nFULL MANIM CAPABILITIES (Educational Math Focus):\n- Mathematical expressions: MathTex(), Tex() for LaTeX formulas\n- Text elements: Text() for plain text, with font_size parameter\n- Geometric shapes: Circle(), Square(), Rectangle(), Polygon(), Arc()\n- Mathematical graphs: Axes(), NumberPlane(), get_graph(), plot()\n- Complex elements: ImageMobject(), Brace(), SurroundingRectangle()\n- Positioning: .next_to(), .to_edge(), .to_corner(), .shift(), .move_to()\n- Colors: BLUE, RED, GREEN, YELLOW, WHITE, PINK, ORANGE, PURPLE, GREY\n- Animations: Create(), Write(), FadeIn(), FadeOut(), Transform(), ReplacementTransform()\n- Special effects: Flash(), Indicate(), Circumscribe(), ApplyWave()\n- Movement: MoveAlongPath(), .animate.shift(), .animate.scale()\n\nSCREEN MANAGEMENT & VISIBILITY RULES:\n6. Monitor screen space - when content gets crowded, use screen management techniques\n7. CLEAR SCREEN: Use self.clear() to start fresh when screen becomes full\n8. SLIDE CONTENT: Use .animate.shift() to move existing content up/down when adding new elements\n9. FADE TRANSITIONS: Use FadeOut() old content, then FadeIn() new content for clean transitions\n10. SCALE ELEMENTS: Use smaller font sizes or .scale() for complex content to fit properly\n11. POSITIONING STRATEGY: Use .to_edge(), .to_corner() for systematic element placement\n12. GROUP MANAGEMENT: Use VGroup to move related elements together when repositioning\n\nEDUCATIONAL STORYTELLING PATTERNS:\n- Start with engaging introduction/context\n- Build concepts gradually with visual support\n- Use analogies and real-world connections\n- Include step-by-step derivations for math\n- Show multiple perspectives when helpful\n- End with applications or summary\n- Use encouraging, accessible language\n- Reference previous learning when building on prior concepts\n\nTIMING AND PACING GUIDELINES:\n- Each animation sequence should be substantial (15+ seconds)\n- Use self.wait() between major concept transitions\n- Time animations appropriately with run_time parameters\n- Include pauses for comprehension: self.wait(1) or self.wait(2)\n- Audio narration will be added automatically by the system\n\nVISIBILITY CODE PATTERNS:\n# Slide existing content up when adding new\nexisting_group = VGroup(title, eq1, eq2)\nself.play(existing_group.animate.shift(UP*1.5))\nnew_equation = MathTex(r\"New step\").shift(DOWN*2)\nself.play(Write(new_equation))\n\n# Clear screen for fresh start\nself.play(FadeOut(*self.mobjects))\nself.wait(0.5)\n# Start fresh with new content\n\n# Mathematical graph example\naxes = Axes(x_range=[-3, 3, 1], y_range=[-1, 5, 1])\ngraph = axes.plot(lambda x: x**2, color=BLUE)\nself.play(Create(axes), Create(graph))\nself.wait(2)\n\nEXAMPLE DECISION PROCESS:\n\"Explain (a+b)²\":\nDECISION: Single video (one logical flow from geometry to algebra)\nCONTENT: Geometric square setup → division → labeling → algebraic transition → final formula\n\n\"Prove Pythagorean theorem\":\nDECISION: Two parts (different proof approaches)\nPART 1: Geometric proof with squares on sides\nPART 2: Algebraic proof with coordinate geometry\n\n\"Explain quadratic functions\":\nDECISION: Two parts (theory vs applications)\nPART 1: Basic form, vertex, parabola shape, transformations\nPART 2: Real-world applications and problem solving\n\nCLASS NAMING: Use descriptive names like QuadraticExplanation, PythagoreanTheorem, AdditionExample, etc.\n\nRESPONSE FORMAT:\n\nFor single comprehensive explanation:\n[\n  {\n    \"chatResponse\": \"Brief, friendly answer for chat history (10-50 words)\",\n    \"videoExplanation\": \"Detailed narration explaining what the viewer sees in the video\",\n    \"facialExpression\": \"smile\",\n    \"animation\": \"Talking_0\",\n    \"manimCode\": \"Complete scene with full content (15+ seconds of animation)\"\n  }\n]\n\nFor multi-part explanation (only when content naturally divides):\n[\n  {\n    \"chatResponse\": \"Brief, friendly answer covering the topic (10-50 words)\",\n    \"videoExplanation\": \"Detailed narration for the first part of the video\",\n    \"facialExpression\": \"smile\",\n    \"animation\": \"Talking_0\",\n    \"manimCode\": \"Complete first scene (15+ seconds)\"\n  },\n  {\n    \"chatResponse\": \"\",\n    \"videoExplanation\": \"Detailed narration for the second part of the video\",\n    \"facialExpression\": \"default\",\n    \"animation\": \"Talking_1\",\n    \"manimCode\": \"Complete second scene (15+ seconds)\"\n  }\n]\n\nCONTENT DENSITY REQUIREMENTS:\nEach scene must include enough elements and animations to fill 15+ seconds:\n- Multiple animation steps with proper timing\n- Gradual building of complexity\n- Clear transitions between concepts\n- Sufficient wait times for comprehension\n- Rich visual elements and transformations\n- Well-paced educational content\n\nCRITICAL: Only create multiple parts when content naturally requires different scene types or approaches. Default to comprehensive single videos for most explanations."
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
                  chatResponse: {
                    type: "string",
                    description: "Brief, friendly text response for chat history (10-50 words)"
                  },
                  videoExplanation: {
                    type: "string",
                    description: "Detailed narration script that explains what happens in the video"
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
                    enum: ["smile", "sad", "angry", "surprised", "default"],
                    description: "The facial expression for the avatar"
                  },
                  animation: {
                    type: "string",
                    enum: ["Talking_0", "Talking_1", "Talking_2", "Idle"],
                    description: "The animation for the avatar"
                  },
                  animationTimeline: {
                    type: "array",
                    description: "Timeline of animation changes during speech for dynamic avatar behavior",
                    items: {
                      type: "object",
                      properties: {
                        time: {
                          type: "number",
                          description: "Time in seconds when this animation change occurs"
                        },
                        action: {
                          type: "string",
                          description: "Description of what the avatar is doing (e.g., greeting, explanation, encouragement)"
                        },
                        animation: {
                          type: "string",
                          enum: ["Talking_0", "Talking_1", "Talking_2", "Idle"],
                          description: "The animation for this timeline point"
                        },
                        expression: {
                          type: "string",
                          enum: ["smile", "sad", "angry", "surprised", "default"],
                          description: "The facial expression for this timeline point"
                        }
                      },
                      required: ["time", "action", "animation", "expression"],
                      additionalProperties: false
                    }
                  }
                },
                required: videoMode ? ["chatResponse", "videoExplanation", "facialExpression", "animation", "manimCode"] : ["text", "facialExpression", "animation", "animationTimeline"],
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
      
      // Check if it's an authentication error
      if (apiError.status === 401) {
        console.error("❌ Qwen API Authentication Error - Check NEBIUS_API_KEY in .env file");
        return res.status(500).send({ 
          error: "AI service authentication failed. Please check NEBIUS_API_KEY configuration." 
        });
      }
      
      // Return fallback message for other API failures
      const fallbackMessages = [
        {
          text: "I'm having trouble connecting to my thoughts. Let me try again in a moment!",
          facialExpression: "surprised",
          animation: "Talking_0",
        },
      ];
      
      // Try to process fallback messages, but handle TTS errors gracefully
      try {
        await processMessages(fallbackMessages);
      } catch (processError) {
        console.error("❌ Fallback message processing failed:", processError.message);
        if (processError.message.includes("not initialized") || processError.message.includes("credentials")) {
          console.error("❌ Google Cloud TTS Authentication Error - Check credentials configuration");
          return res.status(500).send({ 
            error: "Text-to-speech service authentication failed. Please check Google Cloud TTS credentials configuration." 
          });
        }
        // Return message without audio if TTS fails
        return res.send({ messages: fallbackMessages });
      }
      
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
      console.log("Parsed messages from AI:", JSON.stringify(messages, null, 2));
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
      console.log("Invalid messages array:", {
        isArray: Array.isArray(messages),
        length: messages ? messages.length : 'undefined',
        messages: messages
      });
      throw new Error("Invalid messages format or incorrect number of messages");
    }
    
    console.log(`📝 Processing ${messages.length} message(s) in ${videoMode ? 'video' : 'chat'} mode`);

    // Ensure audios directory exists
    try {
      await fs.mkdir("audios", { recursive: true });
    } catch (mkdirError) {
      console.log("Audios directory already exists or created");
    }

    // Process messages for audio and lipsync immediately
    // For multipart video mode, we need both:
    // 1. Individual audio files for each video part (to avoid repetition in combined video)
    // 2. Combined audio file for avatar lipsync (to sync with combined video)
    
    let combinedVideoNarrationAudio = null;
    
    // Generate combined narration audio for avatar lipsync in video mode
    if (videoMode && messages.length > 0) {
      const combinedVideoExplanation = messages.map(msg => msg.videoExplanation).join(' ');
      console.log(`🎵 Generating combined video narration audio for avatar sync...`);
      combinedVideoNarrationAudio = await generateVideoNarrationAudio(combinedVideoExplanation, sessionId);
    }
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      // Handle video mode vs regular mode structure
      let textForAudio, textForChat;
      if (videoMode) {
        // Validate and fix missing fields for video mode
        const missingFields = [];
        
        if (message.chatResponse === undefined || message.chatResponse === null) {
          missingFields.push('chatResponse');
          message.chatResponse = i === 0 ? "Here's your video explanation!" : ""; // Default for first message
        }
        
        if (message.videoExplanation === undefined || message.videoExplanation === null) {
          missingFields.push('videoExplanation');
          message.videoExplanation = "Let me explain this concept step by step."; // Default explanation
        }
        
        if (!message.facialExpression) {
          missingFields.push('facialExpression');
          message.facialExpression = "smile"; // Default expression
        }
        
        if (!message.animation) {
          missingFields.push('animation');
          message.animation = "Talking_0"; // Default animation
        }
        
        if (!message.manimCode || message.manimCode.trim() === '') {
          missingFields.push('manimCode');
          console.log(`Message at index ${i}:`, JSON.stringify(message, null, 2));
          console.log(`Missing/empty manimCode - this is critical for video generation`);
          throw new Error(`Missing or empty manimCode for video mode at index ${i}`);
        }
        
        if (missingFields.length > 0) {
          console.log(`⚠️ Fixed missing fields at index ${i}:`, missingFields);
          console.log(`Original message:`, JSON.stringify(message, null, 2));
        }
        textForAudio = message.videoExplanation; // Use video explanation for speech synthesis
        textForChat = message.chatResponse || `Part ${i + 1} of video explanation`; // Fallback for empty chat response
        message.text = textForChat; // Add text field for compatibility
      } else {
        if (!message.text || !message.facialExpression || !message.animation) {
          throw new Error(`Invalid message format at index ${i}`);
        }
        textForAudio = message.text;
        textForChat = message.text;
      }

      const validExpressions = ["smile", "sad", "angry", "surprised", "default"];
      const validAnimations = ["Talking_0", "Talking_1", "Talking_2", "Idle"];
      if (!validExpressions.includes(message.facialExpression) || !validAnimations.includes(message.animation)) {
        throw new Error(`Invalid facialExpression or animation at index ${i}`);
      }

      // Validate animation timeline for chat mode
      if (!videoMode && message.animationTimeline) {
        if (!Array.isArray(message.animationTimeline)) {
          throw new Error(`Invalid animationTimeline format at index ${i}: must be an array`);
        }
        for (const timelineItem of message.animationTimeline) {
          if (typeof timelineItem.time !== 'number' || !timelineItem.action || !timelineItem.animation || !timelineItem.expression) {
            throw new Error(`Invalid animationTimeline item at index ${i}: missing required fields`);
          }
          if (!validExpressions.includes(timelineItem.expression) || !validAnimations.includes(timelineItem.animation)) {
            throw new Error(`Invalid animationTimeline item at index ${i}: invalid expression or animation`);
          }
        }
      }

      if (videoMode) {
        // Generate individual narration audio for this video part (for video generation)
        console.log(`🎵 Generating individual video narration audio for part ${i+1}:`, message.videoExplanation);
        const partNarrationAudio = await generateVideoNarrationAudio(
          message.videoExplanation, 
          `${sessionId}_part${i}`
        );
        
        // Store individual audio file for video generation (to avoid repetition)
        message.narrationAudioFile = partNarrationAudio.audioFile;
        
        // For avatar sync, use the combined narration audio (so avatar syncs with combined video)
        if (combinedVideoNarrationAudio) {
          message.audioUrl = `http://localhost:3001/audio/${path.basename(combinedVideoNarrationAudio.audioFile)}`;
          message.lipsync = await readJsonTranscript(combinedVideoNarrationAudio.lipsyncFile);
        }
        
        // Add flag to indicate this uses video audio (no separate avatar audio)
        message.useVideoAudio = true;
      } else {
        // Regular mode - generate individual message audio
        const fileName = `audios/message_${i}.mp3`;
        console.log(`Generating audio for message ${i}: ${textForAudio}`);
        
        // Generate speech using the video explanation text (for avatar narration)
        await generateSpeech(textForAudio, fileName);
        
        // Generate lip-sync data
        await lipSyncMessage(i);
        
        // Add audio and lipsync data to message
        message.audio = await audioFileToBase64(fileName);
        message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
      }
      
      // In video mode, add additional fields for frontend processing
      if (videoMode) {
        message.sessionId = sessionId;
      }
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
              console.log(`🎬 Background generating video ${i + 1}/${messages.length}...`);
              
              // Pass the narration audio file to video generation
              const narrationAudioPath = message.narrationAudioFile || null;
              const videoResult = await generateVideo(message.manimCode, messageId, narrationAudioPath);
              
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

// Serve audio files for avatar synchronization
app.use('/audio', express.static(path.join(process.cwd(), 'audios')));

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