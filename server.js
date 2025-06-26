const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

dotenv.config();

let geminiModel;
if (process.env.GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
  console.log("[NIGHTFALL] Gemini AI Initialized for Visual Analysis.");
} else {
    console.warn("[NIGHTFALL] GEMINI_API_KEY not found. Visual analysis will be disabled.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (process.env.OPENAI_API_KEY) {
    console.log("[NIGHTFALL] OpenAI Initialized for Transcription and TTS.");
} else {
    console.warn("[NIGHTFALL] OPENAI_API_KEY not found. Transcription and TTS will be disabled.");
}

let loadedPersonas = {};
let mainWindow;

async function loadPersonas() {
    const personasPath = path.join(__dirname, 'personas');
    const personas = {};
    try {
        await fs.mkdir(personasPath, { recursive: true });
        const files = await fs.readdir(personasPath);
        for (const file of files) {
            if (path.extname(file) === '.json') {
                const filePath = path.join(personasPath, file);
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const persona = JSON.parse(content);
                    personas[persona.actor_id] = persona;
                    console.log(`[NIGHTFALL] Loaded Persona: ${persona.name}`);
                } catch (parseError) {
                    console.error(`[NIGHTFALL] Error parsing ${file}:`, parseError);
                }
            }
        }
    } catch (error) {
        console.error("[NIGHTFALL] Error reading personas directory:", error);
    }
    return personas;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Project NIGHTFALL Operator Link",
    backgroundColor: '#1b1d2a',
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('get-personas', async () => {
    if (Object.keys(loadedPersonas).length === 0) {
      console.log("[NIGHTFALL] Renderer requested personas. Loading from disk...");
      loadedPersonas = await loadPersonas();
    }
    return loadedPersonas;
  });

  ipcMain.handle('get-screen-sources', async () => {
      return await desktopCapturer.getSources({ types: ['window', 'screen'] });
  });

  // --- MODIFIED: The handler now accepts a full 'persona' object ---
  ipcMain.on('analyze-interaction', async (event, { imageB64, pilotTranscript, persona }) => {
    if (!geminiModel) return event.sender.send('analysis-error', { message: "Gemini AI Model is not initialized. Check GEMINI_API_KEY." });
    // The persona object is now sent directly from the renderer. No lookup needed.
    if (!persona) return event.sender.send('analysis-error', { message: `No persona object provided for analysis.` });
    
    const pilotCommsPrompt = pilotTranscript 
      ? `PILOT'S COMMS: "${pilotTranscript}"`
      : `PILOT'S COMMS: "No speech detected. Provide a brief, passive observation *only if* there is a new critical threat, objective update, or a significant change in the environment. Otherwise, for the 'responseText' key, you MUST return an empty string "". Your primary job on a silent scan is to be silent unless something is wrong."`;

    const fullPrompt = `
      You are an AI assistant analyzing a video feed from a first-person combat game.
      The user is the pilot. 
      IGNORE any UI elements of the application itself. Focus ONLY on the central gameplay content in the image.
      
      Your primary instruction is to respond in character based on this persona:
      --- PERSONA START ---
      ${persona.system_prompt}
      --- PERSONA END ---

      Your response MUST be ONLY a single, valid JSON object.
      The JSON object must have TWO keys:
      1. "responseText": Your in-character verbal response as a string. If instructed to be silent, this MUST be an empty string "".
      2. "drawingInstructions": An array of objects to draw on a tactical canvas. If no guidance is needed, return an empty array [].
      
      Valid drawing instructions are:
      - {"type": "arrow", "from": [x1, y1], "to": [x2, y2], "color": "#ff4136"}
      - {"type": "circle", "center": [x, y], "radius": 0.05, "color": "#00c3ff"}
      - {"type": "rect", "start": [x, y], "size": [width, height], "color": "#e0e1f0"}
      - {"type": "text", "pos": [x, y], "color": "#e0e1f0", "text": "DANGER"}
      Coordinates are normalized (from 0.0 to 1.0). (0,0) is the top-left corner.
      
      ${pilotCommsPrompt}

      Now, provide the complete JSON object as your response.
    `;
    
    try {
      const imagePart = { inlineData: { data: imageB64, mimeType: "image/jpeg" } };
      const result = await geminiModel.generateContent([imagePart, { text: fullPrompt }]);
      const responseText = result.response.text();

      console.log("[NIGHTFALL] Raw Gemini Response:", responseText);

      let parsedResponse;
      try {
        const jsonMatch = responseText.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error("No JSON object found in the response.");
        parsedResponse = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
          console.error("Gemini response was not valid JSON:", parseError.message);
          event.sender.send('analysis-error', { message: `Gemini response was not valid JSON: ${responseText}` });
          return;
      }
      
      if (parsedResponse.responseText && parsedResponse.responseText.trim().length > 0 && openai.apiKey) {
        try {
            console.log(`[NIGHTFALL] Generating speech for: "${parsedResponse.responseText}"`);
            const mp3 = await openai.audio.speech.create({ model: "tts-1", voice: persona.voice || 'echo', input: parsedResponse.responseText });
            const buffer = Buffer.from(await mp3.arrayBuffer());
            parsedResponse.spokenResponse = buffer.toString('base64');
            console.log("[NIGHTFALL] Speech generated successfully.");
        } catch(ttsError) {
            console.error("[NIGHTFALL] OpenAI TTS Error:", ttsError);
            parsedResponse.spokenResponse = "";
        }
      } else {
        parsedResponse.spokenResponse = "";
      }
      
      event.sender.send('analysis-chunk', { response: parsedResponse });
      event.sender.send('analysis-complete');

    } catch (error) {
      console.error("Gemini API Error:", error);
      event.sender.send('analysis-error', { message: `Gemini Error: ${error.message}` });
    }
  });

  ipcMain.handle('transcribe-audio', async (event, audioBuffer) => {
    if (!openai.apiKey) return "[Transcription offline]";
    try {
        const file = await toFile(Buffer.from(audioBuffer), 'speech.webm');
        const transcription = await openai.audio.transcriptions.create({ model: 'whisper-1', file: file });
        return transcription.text;
    } catch (error) {
        console.error("Whisper Transcription Error:", error);
        return `[Transcription Failed]`;
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
