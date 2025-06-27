// server.js - FINAL PRODUCTION VERSION

const express = require('express');
const cors = require('cors');
const dotenv =require('dotenv');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- THIS IS THE FINAL FIX ---
// This tells Express to look inside the 'public' folder for index.html.
app.use(express.static('public'));
// ----------------------------

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const PORT = process.env.PORT || 3001;

let activeScenes = {};

/**
 * AI #1: The Director/Storyteller
 * Generates the narrative text of the scene.
 * @param {string} prompt - The user's setup prompt.
 * @returns {Promise<string>} The narration text.
 */
async function fetchNarration(prompt) {
    const system_prompt = `You are a master storyteller and game master. Your response must be a single JSON object with one key: "narration".`;
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: system_prompt },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        return response.narration;
    } catch (error) {
        console.error("[AI-NARRATOR ERROR]", error);
        throw new Error("The AI Director failed to respond.");
    }
}

/**
 * AI #2: The Art Director/Cinematographer
 * Translates narrative text into a detailed image prompt.
 * @param {string} narration - The story text from the Director.
 * @returns {Promise<string>} A detailed shot description for the image AI.
 */
async function generateShotDescription(narration) {
    const system_prompt = `You are a master Art Director. You will receive a piece of narrative text. Your sole purpose is to convert this text into a single, vivid, and detailed 'shot_description' suitable for a text-to-image AI like Stable Diffusion. Focus on visual elements: subject, composition, lighting (e.g., 'cinematic lighting', 'rim lighting'), environment, mood, and art style (e.g., 'photorealistic', 'fantasy art'). Your response MUST be a single JSON object with one key: "shot_description".`;
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: system_prompt },
                { role: "user", content: narration }
            ],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        return response.shot_description;
    } catch (error) {
        console.error("[AI-ARTIST ERROR]", error);
        throw new Error("The AI Art Director failed to respond.");
    }
}

/**
 * The Image Generator
 * Takes a prompt and creates an image using Stability AI.
 * @param {string} shotDescription - The prompt from the Art Director.
 * @returns {Promise<string|null>} A base64 encoded image string, or null on failure.
 */
async function generateImage(shotDescription) {
    if (!shotDescription || !STABILITY_API_KEY) {
        console.warn("[IMAGE] Skipping image generation: No shot description or Stability API key provided.");
        return null;
    }
    console.log(`[IMAGE] Generating image for prompt: "${shotDescription}"`);
    const formData = new FormData();
    formData.append('prompt', shotDescription);
    formData.append('aspect_ratio', '16:9');
    try {
        const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
            method: 'POST',
            headers: { ...formData.getHeaders(), "authorization": `Bearer ${STABILITY_API_KEY}`, "accept": "image/*" },
            body: formData,
        });
        if (!response.ok) { throw new Error(`Stability AI Error: ${response.status} ${await response.text()}`); }
        const buffer = await response.buffer();
        return buffer.toString('base64');
    } catch (error) {
        console.error("[IMAGE] Stable Diffusion generation failed:", error.message);
        return null;
    }
}

// --- API Endpoints ---

app.get('/api/personas', (req, res) => {
    res.json([
        { actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm' },
        { actor_id: 'Tactician_GM', name: 'The Tactician', role: 'gm' }
    ]);
});

app.post('/api/dynamic-narrative/start', async (req, res) => {
    const { gameSettingPrompt, playerSideName, initialPlayerSidePrompt } = req.body;
    const sceneId = `scene_${Date.now()}`;
    const initialPrompt = `Game Setting: ${gameSettingPrompt}\nPlayer Side (${playerSideName}): ${initialPlayerSidePrompt}\n\nGenerate the opening scene narration.`;

    try {
        // Step 1: Get the narration from the AI Director
        const narration = await fetchNarration(initialPrompt);
        
        // Step 2: Get a detailed image prompt from the AI Art Director
        const shotDescription = await generateShotDescription(narration);
        
        // Step 3: Generate the image using the specialized prompt
        const imageB64 = await generateImage(shotDescription);
        
        // Store scene history
        activeScenes[sceneId] = {
            history: [{ role: 'user', content: initialPrompt }, { role: 'assistant', content: narration }],
            playerSideName: playerSideName
        };
        
        // Step 4: Send the complete package to the frontend
        res.status(201).json({
            currentSceneId: sceneId,
            response: {
                narration: narration,
                shot_description: shotDescription,
                image_b64: imageB64
            },
            playerSideName: playerSideName
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    // This would follow the same 3-step pipeline for subsequent turns
    res.status(501).json({ error: "Turn functionality not yet implemented." });
});

app.listen(PORT, () => {
    console.log(`GlassICE server running on port ${PORT}`);
    if (!process.env.OPENAI_API_KEY) console.warn("WARNING: OPENAI_API_KEY is not set in .env file.");
    if (!STABILITY_API_KEY) console.warn("WARNING: STABILITY_API_KEY is not set in .env file. Image generation will be disabled.");
});