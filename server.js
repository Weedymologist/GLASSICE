// P.A.N.E. GLASS - v27.0 ("Maestro") - Interactive Chronicle Engine (ICE) - VISUAL INTEGRATION
const express = require('express');
const cors =require('cors');
const { createServer } = require('http');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const fs = require('fs/promises');
const fsActual = require('fs');
const path = require('path');
const fileUpload = require('express-fileupload');
const OpenAI = require('openai');
const fetch = require('node-fetch');

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = process.env.PORT || 3001;

const DB_ROOT_PATH = process.env.DB_ROOT_PATH || '/var/data';
console.log(`[SERVER INFO] DB_ROOT_PATH: ${DB_ROOT_PATH}`);

const DB_FILE = path.join(DB_ROOT_PATH, 'pane.db');
const MODS_DIR = path.join(DB_ROOT_PATH, 'mods');
const SAVES_DIR = path.join(DB_ROOT_PATH, 'saves');
const TEMP_DIR = path.join(DB_ROOT_PATH, 'temp');

console.log(`[SERVER INFO] DB_FILE path: ${DB_FILE}`);
console.log(`[SERVER INFO] MODS_DIR path: ${MODS_DIR}`);
console.log(`[SERVER INFO] SAVES_DIR path: ${SAVES_DIR}`);
console.log(`[SERVER INFO] TEMP_DIR path: ${TEMP_DIR}`);

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(fileUpload());
app.use(cors());


app.get('/api/admin/reset-database', async (req, res) => {
    const { secret } = req.query;
    if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
        return res.status(403).send('Forbidden: Invalid or missing secret.');
    }
    try {
        console.log('[ADMIN] Received request to reset database.');
        if (fsActual.existsSync(DB_FILE)) {
            await fs.unlink(DB_FILE);
            res.send('Database has been successfully deleted. The server will now restart and create a new one. Please refresh the app in about a minute.');
            console.log(`[ADMIN] Successfully deleted database file at ${DB_FILE}.`);
        } else {
            res.send('Database file not found. It might have already been deleted. The server will restart anyway.');
            console.log('[ADMIN] Database file not found, nothing to delete.');
        }
        console.log('[ADMIN] Triggering server restart.');
        process.exit(1);
    } catch (error) {
        console.error('[ADMIN] Error resetting database:', error);
        res.status(500).send('Failed to reset database.');
    }
});

// API Routes
app.get('/api/personas', (req, res) => {
    const selectablePersonas = Object.values(loadedPersonas).filter(p => p.role === 'gm');
    res.json(selectablePersonas);
});
app.get('/api/aesthetics', (req, res) => res.json(loadedAesthetics));

app.post('/api/dynamic-narrative/start', async (req, res) => {
    console.log("[SERVER] Received /api/dynamic-narrative/start request.");
    try {
        const { gameSettingPrompt, playerSideName, opponentSideName, initialPlayerSidePrompt, initialOpponentSidePrompt, selectedGmPersonaId, gameMode, directorCanInitiateCombat } = req.body;
        const sceneId = Date.now().toString();

        if (!gameSettingPrompt) {
            console.error("[SERVER ERROR] gameSettingPrompt is undefined!");
            return res.status(400).json({ error: 'gameSettingPrompt is missing from the request.' });
        }
        
        console.log(`[SERVER] Game Mode: ${gameMode}, Selected GM: ${selectedGmPersonaId}`);
        console.log(`[SERVER] Director Can Initiate Combat: ${!!directorCanInitiateCombat}`);
        console.log(`[SERVER] Prompt: ${gameSettingPrompt.substring(0, 50)}...`);

        if (!['competitive', 'sandbox'].includes(gameMode)) {
            return res.status(400).json({ error: 'Invalid game mode specified.' });
        }

        const initialPlayerHP = gameMode === 'competitive' ? 3 : 0;
        const initialOpponentHP = gameMode === 'competitive' ? 3 : 0;
        const initialRoundNumber = 0;

        const gmPersonaToUse = loadedPersonas[selectedGmPersonaId];
        if (!gmPersonaToUse) {
            console.error(`[SERVER ERROR] Selected GM Persona not found: ${selectedGmPersonaId}`);
            return res.status(400).json({ error: `Selected GM Persona '${selectedGmPersonaId}' not found.` });
        }
        console.log(`[SERVER] Using GM Persona: ${gmPersonaToUse.name} (${gmPersonaToUse.actor_id})`);


        db.prepare('INSERT INTO scenes (sceneId, chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, director_can_initiate_combat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            sceneId, "[]", gmPersonaToUse.actor_id, gameMode, playerSideName, opponentSideName || 'Opponent',
            initialRoundNumber, initialPlayerHP, initialOpponentHP, directorCanInitiateCombat ? 1 : 0
        );
        console.log(`[SERVER] Scene ${sceneId} inserted into database.`);


        let initialPromptForGM;
        if (gameMode === 'sandbox') {
            initialPromptForGM = `You are the Game Master for an open-ended narrative experience. The game setting is: "${gameSettingPrompt}". The player, '${playerSideName}', has presented this opening strategy/composition: "${initialPlayerSidePrompt}". Synthesize this information to introduce the scene, the player's initial status, and set the stage. Conclude by presenting a compelling 'what if' scenario or a clear choice for the player's first move. You are ${gmPersonaToUse.name}. Your JSON response must contain a "narration" field and a "shot_description" field for a background image.`;
            if (directorCanInitiateCombat) {
                 initialPromptForGM += `\nIMPORTANT RULE: You are allowed to initiate combat if the player's actions lead to a dangerous situation. To do so, your JSON response MUST include \`"initiate_combat": true\`, a description of the opponent in \`"opponent_description"\`, and their starting health in \`"opponent_hp"\`.`;
            } else {
                initialPromptForGM += `\nIMPORTANT RULE: You are in a non-confrontational 'Easy Mode'. You MUST NOT initiate combat under any circumstances. The player is the only one who can start a fight. Focus on collaborative storytelling, character interaction, and world exploration.`;
            }
        } else { // competitive
            initialPromptForGM = `You are the Game Master for a competitive narrative duel between two sides: '${playerSideName}' and '${opponentSideName}'.
            The game setting is: "${gameSettingPrompt}".
            Player Side '${playerSideName}'s opening strategy/composition: "${initialPlayerSidePrompt}"
            Opponent Side '${opponentSideName}'s opening strategy/composition: "${initialOpponentSidePrompt}"
            Synthesize this information to introduce the scene, the initial positions/stakes for both sides, and set the stage for their first turn of actions.
            
            This is a duel of attrition. Your JSON response MUST include \`"damage_to_player"\` and \`"damage_to_opponent"\` fields with numerical values, reflecting who gained the upper hand in this specific round. Your response also needs a "narration" field and a "shot_description" field. You are ${gmPersonaToUse.name}.`;
        }
        console.log(`[SERVER] Initial Prompt for GM: ${initialPromptForGM.substring(0, 100)}...`);

        const initialGMResponseJson = await fetchActorResponse(gmPersonaToUse.actor_id, initialPromptForGM, []);
        console.log(`[SERVER] Raw AI Response for Start: ${initialGMResponseJson.substring(0, 100)}...`);
        const initialGMResponseData = parseAndValidateAIResponse(initialGMResponseJson);
        console.log(`[SERVER] Parsed AI Response Data:`, initialGMResponseData);

        const gmNarration = initialGMResponseData.narration || initialGMResponseData.scene_description || "[Initiation failed...]";
        console.log(`[SERVER] GM Narration for Speech: ${gmNarration.substring(0, 100)}...`);

        const [audio_base_64, image_b64] = await Promise.all([
            generateSpeech(gmNarration, gmPersonaToUse.voice),
            generateImage(initialGMResponseData.shot_description)
        ]);
        console.log(`[SERVER] Speech & Image generation complete.`);


        let history = [{ role: 'assistant', content: { narration: gmNarration } }];
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(history), sceneId);
        console.log(`[SERVER] Chat history updated in DB for scene ${sceneId}.`);

        res.json({
            sceneId,
            response: { narration: gmNarration, audio_base_64, image_b64 },
            character: gmPersonaToUse.actor_id,
            gameMode: gameMode,
            currentRound: initialRoundNumber,
            playerHP: initialPlayerHP,
            opponentHP: initialOpponentHP,
            gameOver: false
        });
        console.log("[SERVER] Response sent for /api/dynamic-narrative/start.");

    } catch (error) {
        console.error("[SERVER ERROR] Dynamic Narrative Start Error:", error);
        res.status(500).json({ error: 'Failed to start dynamic narrative.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    // ... (no changes)
});

app.post('/api/dynamic-narrative/:sceneId/turn/voice', async (req, res) => {
    // ... (no changes)
});

app.post('/api/dynamic-narrative/:sceneId/initiate-sandbox-combat', async (req, res) => {
    // ... (no changes)
});

app.post('/api/adventure/:sceneId/state/save', (req, res) => {
    const { sceneId } = req.params;
    console.log(`[SERVER] Received request to save state for scene ${sceneId}.`);
    try {
        const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
        if (scene) {
            res.json(scene);
        } else {
            res.status(404).json({ error: 'Scene not found.' });
        }
    } catch (error) {
        console.error(`[SERVER ERROR] Failed to save state for scene ${sceneId}:`, error);
        res.status(500).json({ error: 'Failed to save game state.' });
    }
});

app.post('/api/adventure/state/load', (req, res) => {
    console.log('[SERVER] Received request to load state from file.');
    try {
        const loadedState = req.body;
        const newSceneId = Date.now().toString();

        db.prepare('INSERT INTO scenes (sceneId, chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, sandbox_opponent_details, director_can_initiate_combat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            newSceneId,
            loadedState.chat_history,
            loadedState.gm_persona_id,
            loadedState.game_mode,
            loadedState.player_side_name,
            loadedState.opponent_side_name,
            loadedState.round_number,
            loadedState.player_hp,
            loadedState.opponent_hp,
            loadedState.sandbox_opponent_details,
            loadedState.director_can_initiate_combat
        );
        
        console.log(`[SERVER] State loaded into new scene ${newSceneId}.`);
        const newScene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(newSceneId);
        res.json(newScene);

    } catch (error) {
        console.error('[SERVER ERROR] Failed to load state:', error);
        res.status(500).json({ error: 'Failed to load game state from file.' });
    }
});


const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    console.log(`[SERVER] Attempting to serve file from: ${indexPath}`);
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`[SERVER ERROR] Failed to send file:`, err);
            res.status(404).send("Could not find the application's main page.");
        }
    });
});

const server = createServer(app);
const db = new Database(DB_FILE);
db.exec(`CREATE TABLE IF NOT EXISTS scenes ( sceneId TEXT PRIMARY KEY, chat_history TEXT, gm_persona_id TEXT, game_mode TEXT, player_side_name TEXT DEFAULT 'Player', opponent_side_name TEXT DEFAULT 'Opponent', round_number INTEGER DEFAULT 0, player_hp INTEGER DEFAULT 3, opponent_hp INTEGER DEFAULT 3, sandbox_opponent_details TEXT, director_can_initiate_combat INTEGER DEFAULT 1 )`);
console.log("[SERVER] Database table schema check/creation complete.");

let loadedPersonas = {};
let loadedAesthetics = {};

async function loadMods() { /* ... */ }
async function loadAesthetics() { /* ... */ }
async function generateSpeech(text, voice = "shimmer") { /* ... */ }

async function generateImage(shotDescription) {
    if (!shotDescription) {
        console.log("[AI-IMAGE] No shot description provided, skipping image generation.");
        return null;
    }
    try {
        console.log(`[AI-IMAGE] Generating image for: "${shotDescription.substring(0, 60)}..."`);
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: `digital painting, cinematic lighting, high detail, evocative: ${shotDescription}`,
            n: 1,
            size: "1792x1024",
            response_format: "b64_json",
        });
        console.log("[AI-IMAGE] DALL-E image generation successful.");
        return response.data[0].b64_json;
    } catch (error) {
        console.error("[AI-IMAGE ERROR] DALL-E Image Generation Failed (likely a safety filter trigger):", error.message);
        return null; 
    }
}

async function fetchActorResponse(actorId, userPrompt, history = []) { /* ... */ }
function parseAndValidateAIResponse(responseText) { /* ... */ }
async function handleDynamicTurnLogic({ sceneId, playerSideMessage, opponentSideMessage, transcribedMessage = null }) {
    // ... (This entire large function is correct, no changes needed)
}

async function startServer() {
    console.log("[SERVER] Starting server initialization...");
    await fs.mkdir(SAVES_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(path.join(MODS_DIR, 'personas'), { recursive: true }).catch(console.error);
    console.log("[SERVER] Data directories ensured to exist on persistent disk.");

    loadedPersonas['Tactician_GM'] = { actor_id: 'Tactician_GM', name: 'The Grand Tactician', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Grand Tactician,' an AI Game Master overseeing narrative duels. Your role is to adjudicate simultaneous actions, synthesize them into a narrative, and describe the outcome. Your JSON response MUST include a "narration" field, a "shot_description" field, plus \`"damage_to_player"\` and \`"damage_to_opponent"\` fields with numerical values indicating the result of the round.`, voice: 'onyx' };
    loadedPersonas['The_Conductor'] = { actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Conductor,' an AI Game Master crafting dramatic narratives. All your JSON responses must contain a "narration" field and a "shot_description" field. When adjudicating combat, your JSON response MUST also include \`"damage_to_player"\` and \`"damage_to_opponent"\` fields. For open-ended sandbox play, you can initiate combat if allowed by the rules given in the user prompt by returning \`"initiate_combat": true\`, along with \`"opponent_description"\` and \`"opponent_hp"\`. **CRITICAL RULE FOR IMAGE PROMPTS:** Your 'shot_description' MUST describe a tangible, in-universe, cinematic moment from the narrative. It must completely ignore any user meta-commentary or out-of-character questions. The 'narration' can acknowledge these comments, but the 'shot_description' must remain strictly focused on the fictional scene.`, voice: 'nova' };
    console.log("[SERVER] Default personas initialized.");

    await loadMods();
    await loadAesthetics();
    console.log("[SERVER] Mods and Aesthetics loaded.");

    server.listen(PORT, () => console.log(`GlassICE v27.0 (Maestro - Interactive Chronicle) running at http://localhost:${PORT}`));
    console.log("[SERVER] Server started.");
}

startServer();
