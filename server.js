// P.A.N.E. GLASS - v27.0 ("Maestro") - Interactive Chronicle Engine (ICE) - VISUAL INTEGRATION
const express = require('express');
const cors = require('cors');
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
    // ... (This function is correct, no changes needed)
});

// API Routes
app.get('/api/personas', (req, res) => {
    const selectablePersonas = Object.values(loadedPersonas).filter(p => p.role === 'gm');
    res.json(selectablePersonas);
});
app.get('/api/aesthetics', (req, res) => res.json(loadedAesthetics));

app.post('/api/dynamic-narrative/start', async (req, res) => {
    // ... (This function is correct, no changes needed)
});

app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    // ... (This function is correct, no changes needed)
});

app.post('/api/dynamic-narrative/:sceneId/turn/voice', async (req, res) => {
    // ... (This function is correct, no changes needed)
});

app.post('/api/dynamic-narrative/:sceneId/initiate-sandbox-combat', async (req, res) => {
    // ... (This function is correct, no changes needed)
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
            newSceneId, loadedState.chat_history, loadedState.gm_persona_id, loadedState.game_mode, loadedState.player_side_name, loadedState.opponent_side_name, loadedState.round_number, loadedState.player_hp, loadedState.opponent_hp, loadedState.sandbox_opponent_details, loadedState.director_can_initiate_combat
        );
        
        console.log(`[SERVER] State loaded into new scene ${newSceneId}.`);
        const newScene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(newSceneId);
        res.json(newScene);

    } catch (error) {
        console.error('[SERVER ERROR] Failed to load state:', error);
        res.status(500).json({ error: 'Failed to load game state from file.' });
    }
});


// Corrected Path Logic
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
    // Looks for the standardized, all-lowercase 'index.html'
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

async function loadMods() { /* ... no changes */ }
async function loadAesthetics() { /* ... no changes */ }
async function generateSpeech(text, voice = "shimmer") { /* ... no changes */ }

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

async function fetchActorResponse(actorId, userPrompt, history = []) { /* ... no changes */ }
function parseAndValidateAIResponse(responseText) { /* ... no changes */ }
async function handleDynamicTurnLogic({ sceneId, playerSideMessage, opponentSideMessage, transcribedMessage = null }) { /* ... no changes */ }

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
