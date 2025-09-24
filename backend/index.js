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
  res.send("Virtual Girlfriend API");
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
    return fileName;
  } catch (error) {
    console.error(`Error generating speech: ${error.message}`);
    throw error;
  }
};

// Function to generate combined narration audio for video synchronization
const generateVideoNarrationAudio = async (videoExplanationText, sessionId) => {
  try {
    const fileName = `audios/video_narration_${sessionId}.mp3`;
    console.log(`🎵 Generating video narration audio: ${fileName}`);
    
    const audio = await elevenlabs.generate({
      voice: voiceID,
      text: videoExplanationText,
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
const generateVideo = async (manimCode, messageId, audioFile = null) => {
  try {
    console.log(`🎬 Sending manim code to worker for video generation...`);
    
    const requestBody = {
      manimCode: manimCode,
      messageId: messageId
    };
    
    // Include audio file for synchronization if provided
    if (audioFile) {
      // Convert relative path to absolute path for worker
      const absoluteAudioPath = path.resolve(audioFile);
      console.log(`🎵 Including narration audio: ${audioFile} -> ${absoluteAudioPath}`);
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
  const chatHistory = req.body.chatHistory || []; // Get chat history for context
  
  console.log("User Message:", userMessage);
  console.log("Video Mode:", videoMode);
  console.log("Session ID:", sessionId);
  console.log("Chat History Length:", chatHistory.length);

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
              ? "You are an intelligent educational assistant that creates comprehensive Manim animations for learning.\n\nIMPORTANT: Use the conversation history to provide contextual, relevant responses. If the user is asking follow-up questions, refer to previous topics discussed.\n\nYou MUST generate TWO types of content:\n1. CHAT RESPONSE: A concise, friendly text response for the chat history (10-50 words)\n2. VIDEO EXPLANATION: A detailed narration script that explains what happens in the video\n\nIMPORTANT: The chat response and video explanation serve different purposes:\n- Chat response: Shows in chat history, answers the user's question directly\n- Video explanation: Narrates and describes the visual content in the generated video\n\nINTELLIGENT VIDEO STRATEGY:\nAnalyze the user's question and determine the optimal video approach based on content length and scene types:\n\nSPLITTING CRITERIA:\n- Split ONLY when explanation involves fundamentally different approaches/scenes\n- Each part must be at least 15 seconds of content\n- Examples of valid splits:\n  * Algebraic derivation + Geometric proof\n  * Theory explanation + Practical application\n  * Definition + Multiple examples\n  * Historical context + Modern application\n\nSINGLE VIDEO APPROACH (Preferred when possible):\n- Mathematical derivations that follow one logical flow\n- Simple concept explanations\n- Single proof demonstrations\n- Basic function/equation explanations\n\nMULTI-PART APPROACH (Only when content naturally divides):\n- Complex topics with different methodologies\n- Topics requiring both abstract and concrete examples\n- Historical + modern perspectives\n- Theory + multiple applications\n\nCONTENT LENGTH REQUIREMENTS:\n- Each video part must contain at least 15 seconds of meaningful content\n- Single videos should be 15-30 seconds\n- Multi-part videos: each part 15-25 seconds\n- Use proper pacing with strategic self.wait() statements\n\nMANIM CODE REQUIREMENTS:\n1. Always use GenScene as class name\n2. NO IMPORTS NEEDED - manim, math, random, numpy are automatically imported\n3. NO MathTex, NO Tex, NO LaTeX - use Text() for ALL text including math notation\n4. Safe elements: Text(), Circle, Square, Rectangle, Arrow, Line, VGroup\n5. Safe colors: RED, BLUE, GREEN, YELLOW, WHITE, PINK, ORANGE, PURPLE\n6. Safe animations: Create(), Write(), GrowArrow(), FadeIn(), FadeOut(), Transform(), .animate\n7. Include sufficient content for 15+ seconds per part\n8. Use self.wait() strategically between major steps (total wait time ~3-5 seconds per part)\n9. You can use random.uniform(), random.choice(), np.array() without importing\n\nSCREEN MANAGEMENT & VISIBILITY RULES:\n8. Monitor screen space - when content gets crowded, use screen management techniques\n9. CLEAR SCREEN: Use self.clear() to start fresh when screen becomes full\n10. SLIDE CONTENT: Use .animate.shift() to move existing content up/down when adding new elements\n11. FADE TRANSITIONS: Use FadeOut() old content, then FadeIn() new content for clean transitions\n12. SCALE ELEMENTS: Use smaller font sizes or .scale() for complex content to fit properly\n13. POSITIONING STRATEGY: Use .to_edge(), .to_corner() for systematic element placement\n14. GROUP MANAGEMENT: Use VGroup to move related elements together when repositioning\n\nSCREEN SPACE EXAMPLES:\n\nFor long derivations:\n- Start with title at top\n- Add initial elements in center\n- When adding more content: slide existing content UP, add new content at bottom\n- If still crowded: use self.clear() and start fresh screen with summary\n\nFor multiple equations:\n- Position first equation at UP*2\n- Second equation at UP*0.5\n- Third equation at DOWN*1\n- If need fourth: slide all equations UP by 1.5 units, add new at bottom\n\nVISIBILITY CODE PATTERNS:\n\n# Slide existing content up when adding new\nexisting_group = VGroup(title, eq1, eq2)\nself.play(existing_group.animate.shift(UP*1.5))\nnew_equation = Text('New step', font_size=20).shift(DOWN*2)\nself.play(Write(new_equation))\n\n# Clear screen for fresh start\nself.play(FadeOut(*self.mobjects))  # Fade out everything\nself.wait(0.5)\n# Start fresh with new content\n\n# Scale content to fit more\nlarge_group = VGroup(elem1, elem2, elem3)\nself.play(large_group.animate.scale(0.8))  # Make 20% smaller\n\nCRITICAL: Never let content go off-screen or become invisible. Always ensure all important elements are visible within the frame boundaries.\n\nEXAMPLE DECISION PROCESS:\n\n\"Explain (a+b)²\":\nDECISION: Single video (one logical flow from geometry to algebra)\nCONTENT: Geometric square setup → division → labeling → algebraic transition → final formula\n\n\"Prove Pythagorean theorem\":\nDECISION: Two parts (different proof approaches)\nPART 1: Geometric proof with squares on sides\nPART 2: Algebraic proof with coordinate geometry\n\n\"Explain quadratic functions\":\nDECISION: Two parts (theory vs applications)\nPART 1: Basic form, vertex, parabola shape, transformations\nPART 2: Real-world applications and problem solving\n\nRESPONSE FORMAT:\n\nFor single comprehensive explanation:\n[\n  {\n    \"chatResponse\": \"Brief, friendly answer for chat history (10-50 words)\",\n    \"videoExplanation\": \"Detailed narration explaining what the viewer sees in the video\",\n    \"facialExpression\": \"smile\",\n    \"animation\": \"Talking_0\",\n    \"manimCode\": \"Complete scene with full content (15+ seconds of animation)\"\n  }\n]\n\nFor multi-part explanation (only when content naturally divides):\n[\n  {\n    \"chatResponse\": \"Brief, friendly answer covering the topic (10-50 words)\",\n    \"videoExplanation\": \"Detailed narration for the first part of the video\",\n    \"facialExpression\": \"smile\",\n    \"animation\": \"Talking_0\",\n    \"manimCode\": \"Complete first scene (15+ seconds)\"\n  },\n  {\n    \"chatResponse\": \"\",\n    \"videoExplanation\": \"Detailed narration for the second part of the video\",\n    \"facialExpression\": \"default\",\n    \"animation\": \"Talking_1\",\n    \"manimCode\": \"Complete second scene (15+ seconds)\"\n  }\n]\n\nCONTENT DENSITY REQUIREMENTS:\nEach scene must include enough elements and animations to fill 15+ seconds:\n- Multiple animation steps with proper timing\n- Gradual building of complexity\n- Clear transitions between concepts\n- Sufficient wait times for comprehension\n- Rich visual elements and transformations\n\nCRITICAL: Only create multiple parts when content naturally requires different scene types or approaches. Default to comprehensive single videos for most explanations."
              : "You are a wise and patient AI tutor, dedicated to teaching math, science, and coding with clarity, encouragement, and care. Your responses should be concise (10–50 words), clear, and supportive, making complex ideas simple and approachable. Use a warm, guiding tone that inspires curiosity and confidence.\n\nIMPORTANT: Use the conversation history to provide contextual, relevant follow-up responses. If the user is asking follow-up questions, refer to previous topics discussed and build upon them.\n\nCRITICAL: You MUST include an 'animationTimeline' for every response to create dynamic, engaging avatar animations during speech. The animation timeline should have 3-5 timed animation changes that occur during the avatar's speech to make the interaction more lively and natural.\n\nANIMATION TIMELINE REQUIREMENTS:\n1. Create 3-5 timeline entries with different timings (0s, 1.5s, 3s, 4.5s, etc.)\n2. Use ONLY tutor-appropriate animations: Talking_0, Talking_1, Talking_2, Idle (DO NOT use Laughing, Crying, Terrified, Angry, Rumba unless contextually appropriate for educational content)\n3. Use appropriate expressions: smile, default, surprised (avoid funnyFace unless for light educational humor)\n4. Include descriptive 'action' field (greeting, explanation, encouragement, emphasis, closing)\n5. Time the changes to match natural speech rhythm and emphasis points\n6. Make animations contextually appropriate (Laughing for humor, surprised for discoveries, smile for encouragement)\n\nEXAMPLE ANIMATION TIMELINE:\n\"animationTimeline\": [\n  { \"time\": 0, \"action\": \"greeting\", \"animation\": \"Talking_0\", \"expression\": \"smile\" },\n  { \"time\": 1.5, \"action\": \"explanation\", \"animation\": \"Talking_1\", \"expression\": \"default\" },\n  { \"time\": 3.5, \"action\": \"encouragement\", \"animation\": \"Talking_2\", \"expression\": \"smile\" },\n  { \"time\": 5, \"action\": \"closing\", \"animation\": \"Talking_0\", \"expression\": \"funnyFace\" }\n]\n\nRESPONSE GUIDELINES:\nRespond only with a valid JSON array containing 1 to 3 message objects. Each message object must have exactly four properties: \"text\" (a string with your response), \"facialExpression\" (one of: smile, sad, surprised, funnyFace, default), \"animation\" (one of: Talking_0, Talking_1, Talking_2, Laughing, Idle), and \"animationTimeline\" (array of timed animation changes). Always include at least one message that gently invites the learner to share their question, struggle, or interest. Choose initial animations that match the teaching tone, but ensure the timeline creates dynamic variety throughout the speech. If the learner's message is unclear or empty, respond with a single message that kindly asks for clarification with an engaging animation timeline."
          },
          // Include recent chat history for context
          ...chatHistory,
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
        max_tokens: 3000
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
      
      messages = JSON.parse(responseContent);
      console.log("Parsed messages from AI:", JSON.stringify(messages, null, 2));
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError.message);
      console.error("Response structure:", response);
      
      messages = [
        {
          text: "My darling, your words are a mystery to me. Could you whisper them again?",
          facialExpression: "default",
          animation: "Talking_0",
        },
      ];
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
    let videoNarrationAudioFiles = null;
    
    if (videoMode && messages.length > 0) {
      // For video mode, generate unified narration audio from all video explanations
      const combinedVideoExplanation = messages.map(msg => msg.videoExplanation).join(' ');
      console.log(`🎵 Generating unified video narration audio...`);
      videoNarrationAudioFiles = await generateVideoNarrationAudio(combinedVideoExplanation, sessionId);
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

      if (videoMode && videoNarrationAudioFiles) {
        // For video mode, provide the video's audio URL for direct avatar synchronization
        console.log(`🎵 Using unified narration audio for avatar sync`);
        
        // Don't send base64 audio - instead provide the audio URL for direct access
        message.audioUrl = `http://localhost:3001/audio/${path.basename(videoNarrationAudioFiles.audioFile)}`;
        message.lipsync = await readJsonTranscript(videoNarrationAudioFiles.lipsyncFile);
        message.narrationAudioFile = videoNarrationAudioFiles.audioFile; // For video generation
        
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
              
              // Pass narration audio file if available
              const narrationAudio = message.narrationAudioFile || null;
              const videoResult = await generateVideo(message.manimCode, messageId, narrationAudio);
              
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