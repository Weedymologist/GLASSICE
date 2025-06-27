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

app.use(express.static('public'));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const PORT = process.env.PORT || 3001;

let activeScenes = {}; // --- MODIFIED: Will now store HP and other competitive data.

// --- NEW: Combat Referee AI ---
/**
 * AI #4: The Combat Referee
 * Resolves a turn-based tactical action between two sides.
 * @param {Array} history - The chat history of the scene.
 * @param {string} playerAction - The action taken by the player this turn.
 * @param {string} playerName - The name of the player's side.
 * @param {string} opponentName - The name of the opponent's side.
 * @returns {Promise<object>} An object containing the turn's narration, hp changes, and summary.
 */
async function resolveCombatTurn(history, playerAction, playerName, opponentName) {
    const system_prompt = `You are a "Combat Referee" AI for a turn-based narrative wargame. You are impartial, tactical, and decisive.
Your task is to resolve the outcome of a turn based on the provided history and the player's latest action.
The opponent's action should be inferred from the narrative context and their established strategy.

You MUST respond with a single JSON object with the following keys:
- "narration": (string) A vivid, third-person narration of the entire turn's events: the player's action, the opponent's reaction/action, and the immediate result. This should be exciting and cinematic.
- "turn_summary": (string) A brief, clinical summary of the tactical outcome. (e.g., "${playerName} gained a positional advantage," or "${opponentName}'s vanguard was broken.").
- "player_hp_change": (number) The amount of damage dealt to the player. Must be a negative integer or 0.
- "opponent_hp_change": (number) The amount of damage dealt to the opponent. Must be a negative integer or 0.
- "game_over": (boolean) Set to true only if one side's HP is decisively reduced to zero or below, otherwise false.

Analyze the player's action for effectiveness. A clever or well-described action should be more effective. A foolish or reckless action should be punished. Base the damage on the logical outcome of the clash. For example, a successful flanking maneuver might deal -25 damage, while a frontal assault against a fortified position might deal -10 damage to the opponent but also -5 to the player (recoil damage).`;

    const turnPrompt = `Current Turn Action by ${playerName}: "${playerAction}"`;
    const fullHistory = [...history, { role: "user", content: turnPrompt }];

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: fullHistory,
            // Pre-fill the assistant's response to guide the model
            // This is a powerful technique to ensure the structure is always correct.
            "messages": [
              { "role": "system", "content": system_prompt},
              ...history,
              { "role": "user", "content": turnPrompt }
            ],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);

        // Basic validation of the response structure
        if (response.narration === undefined || response.player_hp_change === undefined || response.opponent_hp_change === undefined) {
            throw new Error("AI Referee response was malformed.");
        }
        return response;

    } catch (error) {
        console.error("[AI-REFEREE ERROR]", error);
        throw new Error("The AI Referee failed to resolve the turn.");
    }
}


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

/**
 * AI #3: The Voice Actor
 * Converts narration text to speech using OpenAI TTS.
 * @param {string} text - The narration text.
 * @returns {Promise<string|null>} A base64 encoded audio string, or null on failure.
 */
async function generateAudio(text) {
    if (!text || !process.env.OPENAI_API_KEY) {
        console.warn("[AUDIO] Skipping audio generation: No text or OpenAI API key provided.");
        return null;
    }
    console.log(`[AUDIO] Generating speech for text: "${text.substring(0, 50)}..."`);
    try {
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: text,
        });
        const buffer = Buffer.from(await mp3.arrayBuffer());
        return buffer.toString('base64');
    } catch (error) {
        console.error("[AUDIO] OpenAI TTS generation failed:", error);
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

// --- MODIFIED: Start endpoint now handles competitive mode setup ---
app.post('/api/dynamic-narrative/start', async (req, res) => {
    const { 
        gameSettingPrompt, 
        playerSideName, 
        initialPlayerSidePrompt, 
        opponentSideName, 
        initialOpponentSidePrompt, 
        gameMode 
    } = req.body;

    const sceneId = `scene_${Date.now()}`;
    
    let initialPrompt;
    if (gameMode === 'competitive') {
        initialPrompt = `This is a competitive wargame.
        Game Setting: ${gameSettingPrompt}
        Player Side (${playerSideName}): ${initialPlayerSidePrompt}
        Opponent Side (${opponentSideName}): ${initialOpponentSidePrompt}
        
        Generate the opening scene narration that describes the two forces arrayed for battle, just before the first action begins.`;
    } else { // Sandbox mode
        initialPrompt = `Game Setting: ${gameSettingPrompt}\nPlayer Side (${playerSideName}): ${initialPlayerSidePrompt}\n\nGenerate the opening scene narration.`;
    }

    try {
        const narration = await fetchNarration(initialPrompt);
        
        const [shotDescription, audioB64] = await Promise.all([
            generateShotDescription(narration),
            generateAudio(narration)
        ]);
        
        const imageB64 = await generateImage(shotDescription);
        
        // --- MODIFIED: Storing full competitive state ---
        activeScenes[sceneId] = {
            history: [{ role: 'user', content: initialPrompt }, { role: 'assistant', content: narration }],
            playerSideName: playerSideName,
            opponentSideName: opponentSideName || 'The Environment',
            gameMode: gameMode,
            playerHP: 100,
            opponentHP: 100
        };
        
        res.status(201).json({
            currentSceneId: sceneId,
            response: {
                narration: narration,
                shot_description: shotDescription,
                image_b64: imageB64,
                audio_base_64: audioB64
            },
            playerSideName: playerSideName,
            opponentSideName: opponentSideName,
            playerHP: 100,
            opponentHP: 100,
            gameMode: gameMode
        });

    } catch (error) {
        console.error("[START ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});


// --- NEW: Full implementation of the turn endpoint ---
app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    const { sceneId } = req.params;
    const { playerAction } = req.body;
    const scene = activeScenes[sceneId];

    if (!scene) {
        return res.status(404).json({ error: "Scene not found. The game may have timed out." });
    }
    if (!playerAction) {
        return res.status(400).json({ error: "Player action is required." });
    }

    try {
        // Step 1: Resolve combat using the Referee AI
        const combatResult = await resolveCombatTurn(
            scene.history,
            playerAction,
            scene.playerSideName,
            scene.opponentSideName
        );

        // Step 2: Update game state (HP and history)
        scene.playerHP += combatResult.player_hp_change || 0;
        scene.opponentHP += combatResult.opponent_hp_change || 0;
        scene.playerHP = Math.max(0, scene.playerHP); // Don't go below zero
        scene.opponentHP = Math.max(0, scene.opponentHP); // Don't go below zero
        
        // Add this turn's events to the history to maintain context
        scene.history.push({ role: 'user', content: `Action from ${scene.playerSideName}: ${playerAction}` });
        scene.history.push({ role: 'assistant', content: combatResult.narration });
        
        // Step 3: Generate visuals and audio for the new narration
        const newNarration = combatResult.narration;
        const [shotDescription, audioB64] = await Promise.all([
            generateShotDescription(newNarration),
            generateAudio(newNarration)
        ]);
        const imageB64 = await generateImage(shotDescription);

        // Step 4: Check for a game over condition
        let gameOver = combatResult.game_over || false;
        let finalNarration = newNarration;

        if (!gameOver && (scene.playerHP <= 0 || scene.opponentHP <= 0)) {
            gameOver = true;
            const winner = scene.playerHP <= 0 ? scene.opponentSideName : scene.playerSideName;
            const loser = scene.playerHP <= 0 ? scene.playerSideName : scene.opponentSideName;
            finalNarration += `\n\n**The battle is decided. With their forces broken, ${loser} can no longer continue the fight. VICTORY for ${winner}!**`;
        }

        // Step 5: Send the complete turn result to the frontend
        res.json({
            response: {
                narration: finalNarration,
                turn_summary: combatResult.turn_summary,
                shot_description: shotDescription,
                image_b64: imageB64,
                audio_base_64: audioB64
            },
            playerHP: scene.playerHP,
            opponentHP: scene.opponentHP,
            gameOver: gameOver
        });

    } catch (error) {
        console.error("[TURN ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`GlassICE server running on port ${PORT}`);
    if (!process.env.OPENAI_API_KEY) console.warn("WARNING: OPENAI_API_KEY is not set in .env file.");
    if (!STABILITY_API_KEY) console.warn("WARNING: STABILITY_API_KEY is not set in .env file. Image generation will be disabled.");
});