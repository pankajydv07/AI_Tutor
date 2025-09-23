import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";
import express from "express";
import { promises as fs } from "fs";
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
const port = 3000;

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

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  console.log("User Message:", userMessage);

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

  const prompt = `
You are a wise and patient AI tutor, dedicated to teaching math, science, and coding with clarity, encouragement, and care. Your responses should be concise (10–50 words), clear, and supportive, making complex ideas simple and approachable. Use a warm, guiding tone that inspires curiosity and confidence. Respond only with a valid JSON array containing 1 to 3 message objects. Each message object must have exactly three properties: "text" (a string with your response), "facialExpression" (one of: smile, sad, surprised, funnyFace, default), and "animation" (one of: Talking_0, Talking_1, Talking_2, Laughing, Idle). Always include at least one message that gently invites the learner to share their question, struggle, or interest (e.g., "Tell me, what would you like to learn today?"). Choose animations that match the teaching tone: Talking animations for explanations, Laughing for encouragement, Idle for pauses, and Surprised for moments of discovery. If the learner’s message is unclear or empty, respond with a single message that kindly asks for clarification.
User message: ${userMessage || "Hello"}
`;

  try {
    console.log("User message sent to Qwen:", userMessage || "Hello");
    
    const response = await qwenClient.chat.completions.create({
      model: "Qwen/Qwen2.5-Coder-32B-Instruct",
      messages: [
        {
          role: "system",
          content: "You are a wise and patient AI tutor, dedicated to teaching math, science, and coding with clarity, encouragement, and care. Your responses should be concise (10–50 words), clear, and supportive, making complex ideas simple and approachable. Use a warm, guiding tone that inspires curiosity and confidence. Respond only with a valid JSON array containing 1 to 3 message objects. Each message object must have exactly three properties: \"text\" (a string with your response), \"facialExpression\" (one of: smile, sad, surprised, funnyFace, default), and \"animation\" (one of: Talking_0, Talking_1, Talking_2, Laughing, Idle). Always include at least one message that gently invites the learner to share their question, struggle, or interest (e.g., \"Tell me, what would you like to learn today?\"). Choose animations that match the teaching tone: Talking animations for explanations, Laughing for encouragement, Idle for pauses, and Surprised for moments of discovery. If the learner's message is unclear or empty, respond with a single message that kindly asks for clarification."
        },
        {
          role: "user",
          content: userMessage || "Hello"
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "avatar_response_schema",
          strict: true,
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
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
              required: ["text", "facialExpression", "animation"],
              additionalProperties: false
            },
            minItems: 1,
            maxItems: 3
          }
        }
      },
      temperature: 0.7,
      max_tokens: 1000
    });

    let messages;
    try {
      const responseContent = response.choices[0].message.content;
      console.log("Raw Qwen Response:", responseContent);
      messages = JSON.parse(responseContent);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError.message, "Response:", response.choices[0].message.content);
      messages = [
        {
          text: "My darling, your words are a mystery to me. Could you whisper them again?",
          facialExpression: "default",
          animation: "Talking_0",
        },
      ];
    }

    // Validate messages array
    if (!Array.isArray(messages) || messages.length > 3 || messages.length === 0) {
      throw new Error("Invalid messages format or incorrect number of messages");
    }

    // Ensure audios directory exists
    try {
      await fs.mkdir("audios", { recursive: true });
    } catch (mkdirError) {
      console.log("Audios directory already exists or created");
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message.text || !message.facialExpression || !message.animation) {
        throw new Error(`Invalid message format at index ${i}`);
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

    res.send({ messages });
  } catch (error) {
    console.error("Error in /chat endpoint:", error.message);
    res.status(500).send({ error: "Failed to process chat request" });
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