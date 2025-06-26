// P.A.N.E. GLASS - v27.0 ("Maestro") - Interactive Chronicle Engine (ICE) - STABLE DIFFUSION INTEGRATION
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
const FormData = require('form-data');

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const PORT = process.env.PORT || 3001;

const DB_ROOT_PATH = process.env.DB_ROOT_PATH || path.join(__dirname, 'data'); // Defaulting to a local 'data' folder for robustness
const DB_FILE = path.join(DB_ROOT_PATH, 'pane.db');
const MODS_DIR = path.join(DB_ROOT_PATH, 'mods');
const SAVES_DIR = path.join(DB_ROOT_PATH, 'saves');
const TEMP_DIR = path.join(DB_ROOT_PATH, 'temp');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(fileUpload());
app.use(cors());

// --- THIS IS THE FIX: Define these variables in the global scope ---
let loadedPersonas = {};
let loadedAesthetics = {};
// ------------------------------------------------------------------

app.get('/api/personas', (req, res) => {
    const selectablePersonas = Object.values(loadedPersonas).filter(p => p.role === 'gm');
    res.json(selectablePersonas);
});
app.get('/api/aesthetics', (req, res) => res.json(loadedAesthetics));

// All other API routes are correct and do not need changes.
// They have been omitted for brevity.

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res) => {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
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

async function loadMods() {
    try {
        const personaDir = path.join(MODS_DIR, 'personas');
        await fs.mkdir(personaDir, { recursive: true });
        const personaFiles = await fs.readdir(personaDir);
        for (const file of personaFiles) {
            if (path.extname(file) === '.json') {
                const filePath = path.join(personaDir, file);
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const persona = JSON.parse(fileContent);
                if (!persona.role) { persona.role = 'gm'; }
                loadedPersonas[persona.actor_id] = persona;
                console.log(`[PANE GLASS] Loaded Persona: ${persona.name}`);
            }
        }
    } catch (error) {
        console.error('[PANE GLASS] Failed to load mods:', error);
    }
}
async function loadAesthetics() {
    try {
        const aestheticDir = path.join(__dirname, 'public', 'aesthetics');
        await fs.mkdir(aestheticDir, { recursive: true });
        const aestheticDirs = await fs.readdir(aestheticDir, { withFileTypes: true });
        for (const dirent of aestheticDirs) {
            if (dirent.isDirectory()) {
                const aestheticId = dirent.name;
                const manifestPath = path.join(aestheticDir, aestheticId, 'aesthetic.json');
                try {
                    const fileContent = await fs.readFile(manifestPath, 'utf-8');
                    loadedAesthetics[aestheticId] = JSON.parse(fileContent);
                    console.log(`[PANE GLASS] Loaded Aesthetic: ${loadedAesthetics[aestheticId].name}`);
                } catch (e) {
                    console.error(`[PANE GLASS] Failed to load aesthetic for ${aestheticId}:`, e.message);
                }
            }
        }
    } catch (error) {
        console.error('[PANE GLASS] Failed to load aesthetics:', error);
    }
}

// All helper functions (generateSpeech, generateImage, etc.) are correct
// and do not need changes. They have been omitted for brevity.

async function startServer() {
    console.log("[SERVER] Starting server initialization...");
    await fs.mkdir(SAVES_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(path.join(MODS_DIR, 'personas'), { recursive: true }).catch(console.error);

    loadedPersonas['Tactician_GM'] = { actor_id: 'Tactician_GM', name: 'The Grand Tactician', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Grand Tactician,' an AI Game Master. You follow instructions precisely. Your responses are always in JSON format.`, voice: 'onyx' };
    loadedPersonas['The_Conductor'] = { actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Conductor,' an AI Game Master crafting dramatic narratives. You follow instructions precisely. Your responses are always in JSON format.`, voice: 'nova' };
    
    await loadMods();
    await loadAesthetics();

    if (!process.env.OPENAI_API_KEY) console.warn("[SERVER WARNING] OPENAI_API_KEY is not set. Speech generation will fail.");
    if (!process.env.STABILITY_API_KEY) console.warn("[SERVER WARNING] STABILITY_API_KEY is not set. Image generation will be skipped.");

    server.listen(PORT, () => console.log(`GlassICE v27.0 (Maestro - Stable Diffusion) running at http://localhost:${PORT}`));
}

startServer();
