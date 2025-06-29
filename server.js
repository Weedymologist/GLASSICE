// server.js - v44.1 (Project AGENT - Merged & Formatted)
// Handles game logic, AI interactions (OpenAI), and image generation (Replicate).

// --- IMPORTS ---
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const Replicate = require('replicate');
const fetch = require('node-fetch'); // Required for downloading images from Replicate URLs
const { toFile } = require('openai/uploads');
const path = require('path');
const fs = require('fs');

// --- INITIALIZATION & CONFIGURATION ---
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for potential large base64 strings
app.use(express.static('public')); // Serve static files from the 'public' directory

// --- API CLIENTS & CONSTANTS ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const PORT = process.env.PORT || 3001;

// Game Mechanics Constants
const MEMORY_LIMIT = 5;
const ACTION_POINTS_PER_TURN = 3;

// --- DATA PERSISTENCE ---
const activeScenesFilePath = path.join(__dirname, 'active_scenes.json');
const artStylesFilePath = path.join(__dirname, 'art_styles.json');

let activeScenes = {};
let artStyles = { artStyles: [] }; // Default to empty array

function saveScenesToDisk() {
    try {
        fs.writeFileSync(activeScenesFilePath, JSON.stringify(activeScenes, null, 2));
        console.log("[SYSTEM] Active scenes saved to disk.");
    } catch (error) {
        console.error("[SYSTEM] FAILED to save scenes to disk:", error);
    }
}

function loadScenesFromDisk() {
    try {
        if (fs.existsSync(activeScenesFilePath)) {
            const data = fs.readFileSync(activeScenesFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("[SYSTEM] FAILED to load scenes from disk:", error);
    }
    return {}; // Return empty object if file doesn't exist or fails to parse
}

function loadArtStylesFromDisk() {
    try {
        if (fs.existsSync(artStylesFilePath)) {
            const data = fs.readFileSync(artStylesFilePath, 'utf8');
            console.log("[SYSTEM] Art styles loaded successfully.");
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("[SYSTEM] FAILED to load art styles:", error);
    }
    return { artStyles: [] }; // Return default if file doesn't exist or fails
}

// Load data on server start
activeScenes = loadScenesFromDisk();
artStyles = loadArtStylesFromDisk();


// --- CORE AI HELPER FUNCTIONS ---

/**
 * Determines the action point (AP) cost of a given action string.
 */
async function analyzeActionComplexity(action) {
    console.log(`[AI-TOOL-CALL] Analyzing complexity for action: "${action}"`);
    const system_prompt = `You are a tactical analyst AI. Your job is to determine the complexity and time cost of a described action. You must return a single JSON object.

CRITICAL RULES:
1.  A simple, direct action (e.g., "I shoot my pistol," "I raise my shield," "I punch him") has a cost of 1.
2.  A complex action involving multiple steps, significant movement, or intricate maneuvers (e.g., "I vault over the counter while firing two shots," "I chant a lengthy arcane spell," "I disarm the bomb") has a cost of 2.
3.  An extremely complex or time-consuming action (e.g., "I build a fortified barricade," "I perform a lengthy ritual to summon a demon") has a cost of 3.
4.  Your response MUST be ONLY a single, valid JSON object with ONE key: "cost" (a number from 1 to 3).`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: system_prompt }, { role: "user", content: action }],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        console.log(`[AI-TOOL-RESULT] Action cost assessed at: ${response.cost}`);
        return response;
    } catch (error) {
        console.error("[AI-TOOL-CALL ERROR]", error);
        return { cost: 1 }; // Default to lowest cost on error
    }
}

/**
 * Generates a sequence of actions for an AI opponent.
 */
async function generateAIOpponentActions(history, memoryContext, playerName, aiName, playerActions, aiEffects) {
    console.log(`[AI-OPPONENT] Generating actions for ${aiName} in response to ${playerName}'s actions.`);
    const system_prompt = `You are a tactical AI controlling the faction "${aiName}". Your goal is to act intelligently and defeat the player, "${playerName}".

RULES:
1.  Analyze the battle history, recent events, and your current status effects.
2.  CRITICALLY, analyze the player's declared actions for this turn to formulate a counter-strategy.
3.  You have a budget of ${ACTION_POINTS_PER_TURN} Action Points (AP) for this turn.
4.  Propose a sequence of 1 to 3 actions. For each action, you MUST use the 'analyze_action_complexity' tool to determine its AP cost.
5.  Your total AP cost for all actions MUST NOT exceed ${ACTION_POINTS_PER_TURN}.
6.  Your final response must be a single JSON object containing a key "actions" which is an array of the action strings you have decided on. Example: {"actions": ["Fire plasma rifle at the player", "Duck behind cover"]}`;

    const tools = [{
        type: "function",
        function: {
            name: "analyze_action_complexity",
            description: "Calculates the Action Point (AP) cost of a single proposed action.",
            parameters: {
                type: "object",
                properties: { action: { type: "string", description: "The action to be analyzed." } },
                required: ["action"],
            },
        },
    }];

    const context = `${memoryContext}
--- CURRENT TURN ---
Your Status (${aiName}): ${aiEffects.length > 0 ? aiEffects.map(e => e.name).join(', ') : 'Normal'}
Player's Declared Actions (${playerName}):\n- ${playerActions.join('\n- ')}

Now, decide your counter-actions. Use the provided tool to cost your actions and stay within your ${ACTION_POINTS_PER_TURN} AP budget.`;

    const messages = [
        { role: "system", content: system_prompt },
        ...history.slice(-6), // Include last 6 turns for context
        { role: "user", content: context }
    ];

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            tools: tools,
            tool_choice: "auto",
        });

        const responseMessage = response.choices[0].message;
        const toolCalls = responseMessage.tool_calls;

        if (toolCalls) {
            messages.push(responseMessage); // Add AI's message with tool calls
            for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;
                if (functionName === 'analyze_action_complexity') {
                    const functionArgs = JSON.parse(toolCall.function.arguments);
                    const functionResponse = await analyzeActionComplexity(functionArgs.action);
                    messages.push({
                        tool_call_id: toolCall.id,
                        role: "tool",
                        name: functionName,
                        content: JSON.stringify(functionResponse),
                    });
                }
            }

            // Get the final response after tools have been called
            const finalResponse = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: messages,
                response_format: { type: "json_object" },
            });

            const finalJson = JSON.parse(finalResponse.choices[0].message.content);
            console.log(`[AI-OPPONENT] Decided actions:`, finalJson.actions);
            return finalJson.actions;
        } else {
            console.error("[AI-OPPONENT] AI failed to use tools. Falling back to simple action.");
            return ["Takes a defensive stance."];
        }
    } catch (error) {
        console.error("[AI-OPPONENT ERROR]", error);
        return ["Hesitates, unsure of what to do."]; // Fallback action
    }
}

/**
 * Generates the initial setup for a quickplay game from a simple prompt.
 */
async function generateQuickplaySetup(prompt, gameMode) {
    console.log(`[AI-SETUP] Generating quickplay scenario for: "${prompt}"`);
    const system_prompt = `You are a creative world-building AI. A user will provide a simple concept. Your job is to flesh it out into a structured JSON object for a story engine.

CRITICAL INSTRUCTIONS:
1.  **Factions:** Based on the user's prompt and chosen Game Mode ('${gameMode}'), invent creative names for the protagonist (Faction 1) and, if competitive, the antagonist (Faction 2). For sandbox mode, Faction 2 should be named something neutral like "The World".
2.  **Visual Anchors:** For each faction, create a detailed visual description for image consistency.
3.  **Opening Narration:** Write an exciting, cinematic opening narration (2-3 paragraphs) that sets the scene. For competitive mode, it should introduce an imminent conflict. For sandbox, it should be more open-ended.
4.  **Output Format:** Your response MUST be ONLY a single, valid JSON object with keys: "faction1Name", "faction2Name", "faction1Visuals", "faction2Visuals", "openingNarration".`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: system_prompt }, { role: "user", content: prompt }],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        console.log(`[AI-SETUP] Generated factions: ${response.faction1Name} vs ${response.faction2Name}`);
        return response;
    } catch (error) {
        console.error("[AI-SETUP ERROR]", error);
        throw new Error("The AI Scenario Generator failed to respond.");
    }
}

/**
 * Converts a narrative text into a detailed, comma-separated image prompt.
 */
async function generateShotDescription(narration, artStyle, faction1Visuals, faction2Visuals) {
    const system_prompt = `You are a master Art Director and Prompt Engineer. Your purpose is to convert narrative text into a detailed 'shot_description' for an image AI. Your prompts MUST be a comma-separated list of keywords.

CRITICAL INSTRUCTIONS:
1.  **Visual Consistency:** You MUST adhere to the Faction Visual Descriptions provided. This is the highest priority.
2.  **Adhere to Art Style:** The final image MUST conform to the user-selected Art Style.
3.  **Analyze Narration:** Extract key visual elements.
4.  **Output Format:** You MUST output a single JSON object with ONE key: "shot_description".`;

    let context = `User-Selected Art Style: "${artStyle}"\n\n`;
    if (faction1Visuals) context += `Faction 1 Visuals (MUST FOLLOW): "${faction1Visuals}"\n`;
    if (faction2Visuals) context += `Faction 2 Visuals (MUST FOLLOW): "${faction2Visuals}"\n`;
    context += `\nNarration to convert: "${narration}"`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: system_prompt }, { role: "user", content: context }],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        console.log(`[AI-ARTIST] Generated Prompt: ${response.shot_description}`);
        return response.shot_description;
    } catch (error) {
        console.error("[AI-ARTIST ERROR]", error);
        throw new Error("The AI Art Director failed to respond.");
    }
}

/**
 * Generates an image using the Replicate SDK.
 */
async function generateImage(shotDescription, artStyle) {
    if (!shotDescription || !process.env.REPLICATE_API_TOKEN) {
        console.error("[IMAGE] Replicate API token or shot description is missing.");
        return null;
    }
    console.log(`[IMAGE] Generating image with Replicate SDK and style: ${artStyle}`);

    try {
        const output = await replicate.run(
            "playgroundai/playground-v2.5-1024px-aesthetic:a45f82a1382bed5c7aeb861dac7c7d191b0fdf74d8d57c4a0e6ed7d4d0bf7d24",
            {
                input: {
                    prompt: `${shotDescription}, in the art style of ${artStyle}`,
                    negative_prompt: 'ugly, deformed, disfigured, blurry, low quality, duplicate, bad anatomy, text, watermark, signature',
                    width: 1024,
                    height: 576,
                    guidance_scale: 3,
                }
            }
        );

        if (!output || !Array.isArray(output) || output.length === 0) {
            throw new Error("Replicate SDK did not return an image URL.");
        }

        const imageUrl = output[0];
        console.log(`[IMAGE] Image generated, URL: ${imageUrl}`);
        
        // Fetch the image from the URL and convert it to a base64 string
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download image from Replicate: ${imageResponse.statusText}`);
        }
        const imageBuffer = await imageResponse.buffer();
        return imageBuffer.toString('base64');

    } catch (error) {
        console.error("[IMAGE] Replicate SDK generation failed:", error.message);
        return null; // Return null on failure so the front-end can handle it
    }
}

/**
 * Resolves a turn where two factions act simultaneously.
 */
async function resolveSimultaneousTurn(history, actions1, faction1Name, actions2, faction2Name, faction1Effects, faction2Effects, memoryContext) {
    const system_prompt = `You are a master Wargame Referee and Storyteller AI. You are impartial, creative, and tactical. Your task is to resolve a turn where two opposing factions have submitted a sequence of actions simultaneously.

CORE LOGIC:
1.  **Synthesize Action Sequences & Memory:** Read the provided memory context and both factions' action sequences to understand the current tactical situation. The actions for each faction should be considered in the order they are provided.
2.  **Narrate the Clash:** Write a single, cinematic, third-person narration describing the combined result of all actions. Describe how the sequences interact, intercept, or play out simultaneously.
3.  **Assign Consequences:** Based on the narrative outcome, assign HP damage and status effects. You MUST respond with a single JSON object with the following keys: "narration", "turn_summary", "faction1_hp_change", "faction2_hp_change", "game_over", "status_effects_applied".`;

    const actions1String = actions1.map(a => `- ${a}`).join('\n');
    const actions2String = actions2.map(a => `- ${a}`).join('\n');
    const turnPrompt = `${memoryContext}\nBATTLE STATE:\n- Faction 1 (${faction1Name}) Status: ${faction1Effects.length > 0 ? faction1Effects.map(e => e.name).join(', ') : 'Normal'}\n- Faction 2 (${faction2Name}) Status: ${faction2Effects.length > 0 ? faction2Effects.map(e => e.name).join(', ') : 'Normal'}\n\nSIMULTANEOUS ACTION SEQUENCES:\n\nFaction 1's Actions:\n${actions1String}\n\nFaction 2's Actions:\n${actions2String}\n\nResolve the turn.`;
    
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { "role": "system", content: system_prompt },
                ...history,
                { "role": "user", content: turnPrompt }
            ],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        if (!response.narration || response.faction1_hp_change === undefined || response.faction2_hp_change === undefined) {
            throw new Error("AI Referee response was malformed.");
        }
        return response;
    } catch (error) {
        console.error("[AI-REFEREE ERROR]", error);
        throw new Error("The AI Referee failed to resolve the turn.");
    }
}

/**
 * Checks a narrative for keywords or events that would trigger a conflict state.
 */
async function checkForConflict(narration) {
    const system_prompt = `You are an impartial Event Arbiter. Read the text and determine if a direct, unavoidable conflict has just begun. Respond ONLY with a JSON object: { "is_conflict": (boolean), "opponent_name": (string), "reason": (string) }`;
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ "role": "system", content: system_prompt }, { "role": "user", content: narration }],
            response_format: { type: "json_object" },
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("[AI-ARBITER ERROR]", error);
        return { is_conflict: false, opponent_name: "", reason: "Arbiter AI failed." };
    }
}

/**
 * Generates the next part of the story in sandbox mode.
 */
async function fetchNarration(prompt, history = [], memoryContext) {
    const system_prompt = `You are a master storyteller and game master. Use the provided memory to continue the story based on the user's action. Your response must be a single JSON object with one key: "narration".`;
    const fullPrompt = `${memoryContext}\n\nUser Action: ${prompt}`;
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: system_prompt }, ...history, { role: "user", content: fullPrompt }],
            response_format: { type: "json_object" },
        });
        return JSON.parse(completion.choices[0].message.content).narration;
    } catch (error) {
        console.error("[AI-NARRATOR ERROR]", error);
        throw new Error("The AI Director failed to respond.");
    }
}

/**
 * Converts text to speech using OpenAI TTS.
 */
async function generateAudio(text) {
    if (!text || !process.env.OPENAI_API_KEY) {
        console.warn("[AUDIO] Text or API key is missing. Skipping audio generation.");
        return null;
    }
    try {
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy", // Can be 'alloy', 'echo', 'fable', 'onyx', 'nova', or 'shimmer'
            input: text,
        });
        const buffer = Buffer.from(await mp3.arrayBuffer());
        return buffer.toString('base64');
    } catch (error) {
        console.error("[AUDIO] OpenAI TTS generation failed:", error);
        return null;
    }
}

// --- API ENDPOINTS ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * GET /api/art-styles
 * Retrieves the list of available art styles from the JSON file.
 */
app.get('/api/art-styles', (req, res) => {
    if (!artStyles || !artStyles.artStyles || !artStyles.artStyles.length) {
        return res.status(500).json({ error: "Art styles are not available or failed to load." });
    }
    res.json(artStyles);
});

/**
 * POST /api/quickplay/start
 * Starts a new game using a simple prompt, with AI generating the scenario.
 */
app.post('/api/quickplay/start', async (req, res) => {
    const { prompt, artStyle, gameMode } = req.body;
    const sceneId = `scene_${Date.now()}`;
    try {
        const setup = await generateQuickplaySetup(prompt, gameMode);
        const { faction1Name, faction2Name, faction1Visuals, faction2Visuals, openingNarration } = setup;
        
        const shotDescription = await generateShotDescription(openingNarration, artStyle, faction1Visuals, faction2Visuals);
        const [imageB64, audioB64] = await Promise.all([
            generateImage(shotDescription, artStyle),
            generateAudio(openingNarration)
        ]);

        activeScenes[sceneId] = {
            history: [{ role: 'system', content: 'The scene begins.' }, { role: 'assistant', content: openingNarration }],
            short_term_memory: [],
            playerSideName: faction1Name,
            opponentSideName: faction2Name,
            gameMode: gameMode,
            artStyle: artStyle,
            faction1Visuals: faction1Visuals,
            faction2Visuals: faction2Visuals,
            playerHP: 100,
            opponentHP: 100,
            playerEffects: [],
            opponentEffects: []
        };
        
        saveScenesToDisk();

        res.status(201).json({
            currentSceneId: sceneId,
            response: {
                narration: openingNarration,
                shot_description: shotDescription,
                image_b_64: imageB64,
                audio_base_64: audioB64
            },
            ...activeScenes[sceneId]
        });
    } catch (error) {
        console.error("[QUICKPLAY START ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/dynamic-narrative/:sceneId/turn
 * Processes a single turn for a given scene.
 */
app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    const { sceneId } = req.params;
    const scene = activeScenes[sceneId];
    if (!scene) {
        return res.status(404).json({ error: "Scene not found." });
    }

    try {
        let responsePayload = {};
        const { artStyle, faction1Visuals, faction2Visuals } = scene;
        const memoryContext = scene.short_term_memory.length > 0 ? `\n\n--- RECENT EVENTS (Memory) ---\n${scene.short_term_memory.join('\n')}\n` : '';

        // --- Competitive Mode Logic ---
        if (scene.gameMode === 'competitive') {
            const { playerActions } = req.body;
            let { opponentActions } = req.body;

            if (!playerActions || !Array.isArray(playerActions)) {
                return res.status(400).json({ error: "Player actions array is required." });
            }

            // Validate Player AP
            let playerTotalCost = 0;
            for (const action of playerActions) {
                playerTotalCost += (await analyzeActionComplexity(action)).cost;
            }
            if (playerTotalCost > ACTION_POINTS_PER_TURN) {
                return res.status(400).json({ error: `Player actions exceed AP limit. Cost: ${playerTotalCost}/${ACTION_POINTS_PER_TURN}` });
            }

            // Handle AI or Player opponent
            if (!opponentActions) {
                console.log("[SYSTEM] Player vs. AI turn detected. Generating AI actions.");
                opponentActions = await generateAIOpponentActions(scene.history, memoryContext, scene.playerSideName, scene.opponentSideName, playerActions, scene.opponentEffects);
            } else {
                console.log("[SYSTEM] Player vs. Player turn detected.");
                if (!Array.isArray(opponentActions)) return res.status(400).json({ error: "Opponent actions must be an array." });
                let opponentTotalCost = 0;
                for (const action of opponentActions) {
                    opponentTotalCost += (await analyzeActionComplexity(action)).cost;
                }
                if (opponentTotalCost > ACTION_POINTS_PER_TURN) {
                    return res.status(400).json({ error: `Opponent actions exceed AP limit. Cost: ${opponentTotalCost}/${ACTION_POINTS_PER_TURN}` });
                }
            }

            // Resolve combat and update state
            const combatResult = await resolveSimultaneousTurn(scene.history, playerActions, scene.playerSideName, opponentActions, scene.opponentSideName, scene.playerEffects, scene.opponentEffects, memoryContext);
            
            const playerActionSummary = playerActions.join(', ');
            const opponentActionSummary = opponentActions.join(', ');
            
            const memoryEntry = `[Turn Outcome] ${scene.playerSideName} did "${playerActionSummary}" and ${scene.opponentSideName} did "${opponentActionSummary}", resulting in: ${combatResult.turn_summary}`;
            scene.short_term_memory.push(memoryEntry);
            if (scene.short_term_memory.length > MEMORY_LIMIT) scene.short_term_memory.shift();

            scene.playerHP = Math.max(0, scene.playerHP + (combatResult.faction1_hp_change || 0));
            scene.opponentHP = Math.max(0, scene.opponentHP + (combatResult.faction2_hp_change || 0));

            // Update status effects
            if (combatResult.status_effects_applied) {
                combatResult.status_effects_applied.forEach(effect => {
                    (effect.target === 'faction1' ? scene.playerEffects : scene.opponentEffects).push(effect);
                });
            }
            scene.playerEffects.forEach(e => e.duration--);
            scene.opponentEffects.forEach(e => e.duration--);
            scene.playerEffects = scene.playerEffects.filter(e => e.duration > 0);
            scene.opponentEffects = scene.opponentEffects.filter(e => e.duration > 0);

            const turnSummaryForHistory = `Actions-> ${scene.playerSideName}: ${playerActionSummary} | ${scene.opponentSideName}: ${opponentActionSummary}`;
            scene.history.push({ role: 'user', content: turnSummaryForHistory }, { role: 'assistant', content: combatResult.narration });
            
            const shot = await generateShotDescription(combatResult.narration, artStyle, faction1Visuals, faction2Visuals);
            const [image, audio] = await Promise.all([
                generateImage(shot, artStyle), 
                generateAudio(combatResult.narration)
            ]);
            let gameOver = combatResult.game_over || scene.playerHP <= 0 || scene.opponentHP <= 0;
            responsePayload = { 
                response: { 
                    narration: combatResult.narration, 
                    turn_summary: combatResult.turn_summary, 
                    shot_description: shot, 
                    image_b_64: image, 
                    audio_base_64: audio 
                }, 
                ...scene, 
                gameOver 
            };

        // --- Sandbox Mode Logic ---
        } else { 
            const { playerAction } = req.body;
            if (!playerAction) {
                return res.status(400).json({ error: "Player action is required." });
            }
            const newNarration = await fetchNarration(playerAction, scene.history, memoryContext);

            const memoryEntry = `I took the action "${playerAction}", and the outcome was: "${newNarration.substring(0, 150)}..."`;
            scene.short_term_memory.push(memoryEntry);
            if (scene.short_term_memory.length > MEMORY_LIMIT) scene.short_term_memory.shift();
            scene.history.push({ role: 'user', content: playerAction }, { role: 'assistant', content: newNarration });

            const arbiterResult = await checkForConflict(newNarration);
            let finalNarration = newNarration;
            let switchedToVsAI = false;
            if (arbiterResult.is_conflict) {
                scene.gameMode = 'competitive';
                scene.opponentSideName = arbiterResult.opponent_name || "A New Challenger";
                finalNarration += `\n\n**Conflict! You are now facing ${scene.opponentSideName}.**`;
                switchedToVsAI = true;
            }

            const shot = await generateShotDescription(finalNarration, artStyle, faction1Visuals, faction2Visuals);
            const [image, audio] = await Promise.all([
                generateImage(shot, artStyle), 
                generateAudio(finalNarration)
            ]);
            responsePayload = { 
                response: { 
                    narration: finalNarration, 
                    shot_description: shot, 
                    image_b_64: image, 
                    audio_base_64: audio 
                }, 
                ...scene, 
                switchedToVsAI 
            };
        }
        
        saveScenesToDisk();
        res.json(responsePayload);

    } catch (error) {
        console.error(`[TURN ERROR] for scene ${sceneId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/chronicles
 * Returns a summary list of all active games.
 */
app.get('/api/chronicles', (req, res) => {
    const summary = Object.keys(activeScenes).map(sceneId => {
        const scene = activeScenes[sceneId];
        return {
            sceneId,
            playerSideName: scene.playerSideName,
            opponentSideName: scene.opponentSideName,
            gameMode: scene.gameMode
        };
    });
    res.json(summary);
});

/**
 * GET /api/chronicles/:sceneId
 * Loads the current state of a specific game.
 */
app.get('/api/chronicles/:sceneId', async (req, res) => {
    const { sceneId } = req.params;
    const sceneData = activeScenes[sceneId];
    if (!sceneData) {
        return res.status(404).json({ error: 'Chronicle not found.' });
    }
    
    try {
        const lastNarrationEntry = sceneData.history.slice().reverse().find(h => h.role === 'assistant');
        const lastNarration = lastNarrationEntry ? lastNarrationEntry.content : "The story begins.";

        const shotDescription = await generateShotDescription(lastNarration, sceneData.artStyle, sceneData.faction1Visuals, sceneData.faction2Visuals);
        const imageB64 = await generateImage(shotDescription, sceneData.artStyle);

        const responsePayload = {
            ...sceneData,
            response: {
                narration: lastNarration,
                shot_description: shotDescription,
                image_b_64: imageB64,
                audio_base_64: null // No audio on load to save tokens/time
            }
        };
        res.json(responsePayload);
    } catch (error) {
        console.error(`[LOAD GAME ERROR] for scene ${sceneId}:`, error);
        res.status(500).json({ error: "Failed to fully load and render the chronicle." });
    }
});

/**
 * POST /api/transcribe-audio
 * Transcribes audio from a base64 string using Whisper.
 */
app.post('/api/transcribe-audio', async (req, res) => {
    const { audioB64 } = req.body;
    if (!audioB64) {
        return res.status(400).json({ error: "No audio data provided." });
    }
    try {
        const base64Data = audioB64.split(',')[1];
        const audioBuffer = Buffer.from(base64Data, 'base64');
        const file = await toFile(audioBuffer, 'speech.webm');
        const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: file,
        });
        res.json({ transcription: transcription.text });
    } catch (error) {
        console.error("[TRANSCRIBE ERROR]", error);
        res.status(500).json({ error: "Failed to transcribe audio." });
    }
});

/**
 * POST /api/analyze-action
 * Utility endpoint to get the AP cost of an action.
 */
app.post('/api/analyze-action', async (req, res) => {
    const { action } = req.body;
    if (!action) {
        return res.status(400).json({ error: "Action text is required." });
    }
    try {
        const result = await analyzeActionComplexity(action);
        res.json(result);
    } catch (error) {
        console.error("[ANALYZE ACTION ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});


// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`GlassICE server running on port ${PORT}`);
    console.log("-----------------------------------------");
});