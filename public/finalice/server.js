// server.js - v45.0 (DIAMOND - Curation Loop Integration)

const express = require('express');
const cors = require('cors');
const dotenv =require('dotenv');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const { toFile } = require('openai/uploads');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); 
app.use(express.static('public'));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const PORT = process.env.PORT || 3001;
const MEMORY_LIMIT = 5;

const activeScenesFilePath = path.join(__dirname, 'active_scenes.json');

function saveScenesToDisk() { try { fs.writeFileSync(activeScenesFilePath, JSON.stringify(activeScenes, null, 2)); console.log("[SYSTEM] Active scenes saved to disk."); } catch (error) { console.error("[SYSTEM] FAILED to save scenes to disk:", error); } }
function loadScenesFromDisk() { try { if (fs.existsSync(activeScenesFilePath)) { return JSON.parse(fs.readFileSync(activeScenesFilePath, 'utf8')); } } catch (error) { console.error("[SYSTEM] FAILED to load scenes from disk:", error); } return {}; }

let activeScenes = loadScenesFromDisk();

const getStylePreset = (styleName) => { const styleMap = { "Cinematic Realism": "cinematic", "Epic Fantasy Painting": "fantasy-art", "Gritty Anime Style": "anime", "Cyberpunk Concept Art": "digital-art", "Vintage Comic Book": "comic-book", "Dark Film Noir": "photographic" }; return styleMap[styleName] || "cinematic"; };

// --- NEW: AI Prompt Burst Function ---
async function generatePromptVariations(narration, artStyle, faction1Visuals, faction2Visuals) {
    console.log(`[PROMPT-BURST] Generating variations for narration...`);
    const system_prompt = `You are an elite AI Art Director. Based on the provided narration and faction descriptions, generate an array of THREE distinct, highly-detailed, and professional image prompts. Each prompt must explore a different cinematic angle (e.g., a wide establishing shot, an intense character close-up, a dynamic action shot). The prompts must be comma-separated keywords. You MUST adhere to the visual descriptions. Your response must be ONLY a single JSON object with one key: "prompts" (an array of 3 strings).`;
    let context = `Art Style: "${artStyle}"\n\nFaction 1 Visuals: "${faction1Visuals}"\nFaction 2 Visuals: "${faction2Visuals}"\n\nNarration:\n"${narration}"`;
    try {
        const completion = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: system_prompt }, { role: "user", content: context }], response_format: { type: "json_object" } });
        const response = JSON.parse(completion.choices[0].message.content);
        return response.prompts;
    } catch (error) {
        console.error("[PROMPT-BURST ERROR]", error);
        return [`${artStyle}, ${narration}`]; // Fallback
    }
}

// --- NEW: AI Curation Function ---
async function curateBestImage(narration, imageB64s) {
    console.log(`[CURATOR] Curating from ${imageB64s.length} images...`);
    if (imageB64s.length <= 1) return imageB64s[0] || null;

    const system_prompt = `You are DIAMOND, a master Art Director with an impeccable eye for quality and relevance. You will be given a narrative description and several candidate images. Your task is to choose the single best image that most accurately and artistically represents the narration. Consider composition, accuracy to the text, and overall emotional impact. Your response MUST be a single JSON object with ONE key: "bestImageIndex" (the index number of the best image in the provided array).`;
    
    const messages = [
        { role: "system", content: system_prompt },
        {
            role: "user",
            content: [
                { type: "text", text: `Here is the narration: "${narration}". Which of the following images is the best fit?` },
                ...imageB64s.map(b64 => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }))
            ]
        }
    ];

    try {
        const completion = await openai.chat.completions.create({ model: "gpt-4o", messages: messages, response_format: { type: "json_object" } });
        const choice = JSON.parse(completion.choices[0].message.content);
        console.log(`[CURATOR] Chose image index: ${choice.bestImageIndex}`);
        return imageB64s[choice.bestImageIndex] || imageB64s[0];
    } catch (error) {
        console.error("[CURATOR ERROR]", error);
        return imageB64s[0]; // Default to the first image on error
    }
}

async function generateImage(shotDescription, artStyle) { /* ... no changes ... */ }
async function resolveSimultaneousTurn(history, action1, faction1Name, action2, faction2Name, faction1Effects, faction2Effects, memoryContext) { /* ... no changes ... */ }
async function checkForConflict(narration) { /* ... no changes ... */ }
async function fetchNarration(prompt, history = [], memoryContext) { /* ... no changes ... */ }
async function generateAudio(text) { /* ... no changes ... */ }
app.post('/api/transcribe-audio', async (req, res) => { /* ... no changes ... */ });
app.post('/api/dynamic-narrative/start', async (req, res) => { /* ... no changes ... */ });
app.post('/api/quickplay/start', async (req, res) => { /* ... no changes ... */ });

// --- MODIFIED: The core turn logic now uses the full Curation Loop ---
app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    const { sceneId } = req.params;
    const scene = activeScenes[sceneId];
    if (!scene) return res.status(404).json({ error: "Scene not found." });

    try {
        // Step 1: Resolve the narrative part of the turn
        let turnResult = {};
        const memoryContext = scene.short_term_memory.length > 0 ? `\n\n--- RECENT EVENTS (Memory) ---\n${scene.short_term_memory.join('\n')}\n` : '';
        if (scene.gameMode === 'competitive') {
            const { playerAction, opponentAction } = req.body;
            turnResult = await resolveSimultaneousTurn(scene.history, playerAction, scene.playerSideName, opponentAction, scene.opponentSideName, scene.playerEffects, scene.opponentEffects, memoryContext);
            const memoryEntry = `[Turn Outcome] ${scene.playerSideName} did "${playerAction}" and ${scene.opponentSideName} did "${opponentAction}", resulting in: ${turnResult.turn_summary}`;
            scene.short_term_memory.push(memoryEntry);
        } else {
            const { playerAction } = req.body;
            const newNarration = await fetchNarration(playerAction, scene.history, memoryContext);
            const memoryEntry = `I took the action "${playerAction}", and the outcome was: "${newNarration.substring(0, 150)}..."`;
            scene.short_term_memory.push(memoryEntry);
            turnResult.narration = newNarration;
        }

        // Common logic after narrative is resolved
        if(scene.short_term_memory.length > MEMORY_LIMIT) scene.short_term_memory.shift();
        scene.history.push({ role: 'user', content: req.body.playerAction }, { role: 'assistant', content: turnResult.narration });
        
        // Step 2: Begin the DIAMOND Visual Pipeline
        const { artStyle, faction1Visuals, faction2Visuals } = scene;
        const [promptVariations, audioB64] = await Promise.all([
            generatePromptVariations(turnResult.narration, artStyle, faction1Visuals, faction2Visuals),
            generateAudio(turnResult.narration)
        ]);
        const imageGenerationPromises = promptVariations.map(prompt => generateImage(prompt, artStyle));
        const generatedImages = await Promise.all(imageGenerationPromises);
        const bestImageB64 = await curateBestImage(turnResult.narration, generatedImages.filter(img => img));
        
        // Step 3: Package and send the final response
        const responsePayload = { 
            response: { 
                narration: turnResult.narration, 
                turn_summary: turnResult.turn_summary, 
                image_b_64: bestImageB64, 
                audio_base_64: audioB64 
            }, 
            ...scene 
        };
        res.json(responsePayload);
        saveScenesToDisk();

    } catch (error) {
        console.error("[TURN ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});

// Other endpoints like /api/chronicles remain the same
app.get('/api/chronicles', (req, res) => { /* ... */ });
app.get('/api/chronicles/:sceneId', async (req, res) => { /* ... */ });
app.listen(PORT, () => { console.log(`GlassICE server running on port ${PORT}`); });