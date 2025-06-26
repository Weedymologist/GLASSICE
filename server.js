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

const DB_ROOT_PATH = process.env.DB_ROOT_PATH || '/var/data';
const DB_FILE = path.join(DB_ROOT_PATH, 'pane.db');
const MODS_DIR = path.join(DB_ROOT_PATH, 'mods');
const SAVES_DIR = path.join(DB_ROOT_PATH, 'saves');
const TEMP_DIR = path.join(DB_ROOT_PATH, 'temp');

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
            return res.status(400).json({ error: 'gameSettingPrompt is missing from the request.' });
        }
        
        const gmPersonaToUse = loadedPersonas[selectedGmPersonaId];
        if (!gmPersonaToUse) {
            return res.status(400).json({ error: `Selected GM Persona '${selectedGmPersonaId}' not found.` });
        }
        
        db.prepare('INSERT INTO scenes (sceneId, chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, director_can_initiate_combat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            sceneId, "[]", gmPersonaToUse.actor_id, gameMode, playerSideName, opponentSideName || 'Opponent', 0, gameMode === 'competitive' ? 3 : 0, gameMode === 'competitive' ? 3 : 0, directorCanInitiateCombat ? 1 : 0
        );

        let initialPromptForGM;
        if (gameMode === 'sandbox') {
            initialPromptForGM = `You are a Game Master. The setting is: "${gameSettingPrompt}". The player's side, named '${playerSideName}', is defined by: "${initialPlayerSidePrompt}".
            1. **Narration**: Write an introduction that establishes the scene and the player's situation.
            2. **Shot Description**: Create a cinematic "establishing shot" prompt that visually depicts the player's side/character(s) *within* the described setting. Do not use a first-person perspective. For example: "A lone warrior stands on a cliff overlooking a stormy sea."`;
            if (directorCanInitiateCombat) {
                 initialPromptForGM += `\n3. **Combat**: You are allowed to initiate combat if narratively appropriate. If so, include \`"initiate_combat": true\`, \`"opponent_description"\`, and \`"opponent_hp"\`.`;
            }
        } else { // competitive
            initialPromptForGM = `You are a Game Master for a duel between '${playerSideName}' and '${opponentSideName}'. The setting: "${gameSettingPrompt}".
            - '${playerSideName}'s composition: "${initialPlayerSidePrompt}"
            - '${opponentSideName}'s composition: "${initialOpponentSidePrompt}"
            1. **Narration**: Introduce the scene and the initial stakes for both sides.
            2. **Shot Description**: Create a cinematic "face-off" prompt showing both sides preparing for battle within the setting.
            3. **Damage**: Your response MUST include \`"damage_to_player": 0\` and \`"damage_to_opponent": 0\` for this opening round.`;
        }

        const initialGMResponseJson = await fetchActorResponse(gmPersonaToUse.actor_id, initialPromptForGM, []);
        const initialGMResponseData = parseAndValidateAIResponse(initialGMResponseJson);
        const gmNarration = initialGMResponseData.narration || "[The chronicle begins...]";
        
        const [audio_base_64, image_b64] = await Promise.all([
            generateSpeech(gmNarration, gmPersonaToUse.voice),
            generateImage(initialGMResponseData.shot_description)
        ]);

        let history = [{ role: 'assistant', content: { narration: gmNarration } }];
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(history), sceneId);

        res.json({
            sceneId,
            response: { narration: gmNarration, audio_base_64, image_b64 },
            character: gmPersonaToUse.actor_id,
            gameMode: gameMode,
            currentRound: 0,
            playerHP: gameMode === 'competitive' ? 3 : 0,
            opponentHP: gameMode === 'competitive' ? 3 : 0,
            gameOver: false
        });

    } catch (error) {
        console.error("[SERVER ERROR] Dynamic Narrative Start Error:", error);
        res.status(500).json({ error: 'Failed to start dynamic narrative.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    try {
        const { playerSideMessage, opponentSideMessage } = req.body;
        const { sceneId } = req.params;
        const result = await handleDynamicTurnLogic({ sceneId, playerSideMessage, opponentSideMessage });
        res.json(result);
    } catch (error) {
        console.error("[SERVER ERROR] Dynamic Turn Error:", error);
        res.status(500).json({ error: 'Dynamic turn failed.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn/voice', async (req, res) => {
    if (!req.files || !req.files.audio) return res.status(400).json({ error: 'No audio file uploaded.' });
    const { sceneId } = req.params;
    const audioFile = req.files.audio;
    const tempPath = path.join(TEMP_DIR, `${Date.now()}_audio.webm`);
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        await audioFile.mv(tempPath);
        const transcription = await openai.audio.transcriptions.create({ model: "whisper-1", file: fsActual.createReadStream(tempPath) });
        const transcribedMessage = transcription.text || "[Silent line]";
        await fs.unlink(tempPath);
        const result = await handleDynamicTurnLogic({ sceneId, playerSideMessage: transcribedMessage, transcribedMessage });
        res.json(result);
    } catch (error) {
        console.error("[SERVER ERROR] Voice Turn Error:", error);
        if (fsActual.existsSync(tempPath)) await fs.unlink(tempPath).catch(console.error);
        res.status(500).json({ error: 'Voice turn failed.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/initiate-sandbox-combat', async (req, res) => {
    try {
        const { sceneId } = req.params;
        const { opponentDescription } = req.body;
        const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
        if (!scene || scene.game_mode !== 'sandbox') return res.status(400).json({ error: 'Scene not found or not in sandbox mode.' });
        if (!opponentDescription) return res.status(400).json({ error: 'Opponent description is required.' });

        let { chat_history, gm_persona_id, player_side_name } = scene;
        chat_history = JSON.parse(chat_history);
        const gmPersona = loadedPersonas[gm_persona_id];
        
        db.prepare(`UPDATE scenes SET game_mode = ?, round_number = ?, player_hp = ?, opponent_hp = ?, sandbox_opponent_details = ? WHERE sceneId = ?`).run('sandbox_combat', 0, 3, 3, opponentDescription, sceneId);
        
        const prompt = `The player, '${player_side_name}', now confronts '${opponentDescription}'. Describe the start of combat. Your JSON response requires "narration", "shot_description", "damage_to_player": 0, and "damage_to_opponent": 0.`;
        const responseJson = await fetchActorResponse(gm_persona_id, prompt, chat_history);
        const responseData = parseAndValidateAIResponse(responseJson);
        const gmNarration = responseData.narration || "[Combat begins!]";
        
        const [audio_base_64, image_b64] = await Promise.all([
            generateSpeech(gmNarration, gmPersona.voice),
            generateImage(responseData.shot_description)
        ]);

        chat_history.push({ role: 'assistant', content: { narration: gmNarration } });
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(chat_history), sceneId);

        res.json({
            response: { narration: gmNarration, audio_base_64, image_b64 },
            character: gm_persona_id,
            gameMode: 'sandbox_combat',
            currentRound: 0,
            playerHP: 3,
            opponentHP: 3,
            gameOver: false,
            sandboxOpponentName: opponentDescription
        });

    } catch (error) {
        console.error("[SERVER ERROR] Initiate Sandbox Combat Error:", error);
        res.status(500).json({ error: 'Failed to initiate sandbox combat.' });
    }
});

app.post('/api/adventure/:sceneId/state/save', (req, res) => {
    const { sceneId } = req.params;
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
    try {
        const loadedState = req.body;
        const newSceneId = Date.now().toString();
        db.prepare('INSERT INTO scenes (sceneId, chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, sandbox_opponent_details, director_can_initiate_combat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            newSceneId, loadedState.chat_history, loadedState.gm_persona_id, loadedState.game_mode, loadedState.player_side_name, loadedState.opponent_side_name, loadedState.round_number, loadedState.player_hp, loadedState.opponent_hp, loadedState.sandbox_opponent_details, loadedState.director_can_initiate_combat
        );
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
async function generateSpeech(text, voice = "shimmer") {
    if (!text || !process.env.OPENAI_API_KEY) return null;
    try {
        const cleanText = text.replace(/<[^>]*>/g, '');
        const ttsResponse = await openai.audio.speech.create({ model: "tts-1-hd", voice: voice, input: cleanText });
        const buffer = Buffer.from(await ttsResponse.arrayBuffer());
        return buffer.toString('base64');
    } catch (error) {
        console.error("[AI-TTS ERROR] Speech Generation Error:", error);
        return null;
    }
}
async function generateImage(shotDescription) {
    if (!shotDescription || !STABILITY_API_KEY) {
        console.log("[AI-IMAGE] Skipping image generation due to missing description or API key.");
        return null;
    }
    const formData = new FormData();
    formData.append('prompt', shotDescription);
    formData.append('aspect_ratio', '16:9');
    try {
        const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
            method: 'POST',
            headers: { ...formData.getHeaders(), "authorization": `Bearer ${STABILITY_API_KEY}` },
            body: formData,
        });
        if (!response.ok) throw new Error(`Non-200 response from Stability AI: ${response.statusText}`);
        const buffer = await response.buffer();
        return buffer.toString('base64');
    } catch (error) {
        console.error("[AI-IMAGE ERROR] Stable Diffusion Generation Failed:", error.message);
        return null;
    }
}

async function fetchActorResponse(actorId, userPrompt, history = []) {
    const actor = loadedPersonas[actorId];
    if (!actor) { throw new Error(`Unknown actor: ${actorId}`); }
    const messages = history.slice(-8).map(msg => ({ role: msg.role, content: (typeof msg.content === 'object' && msg.content !== null && 'narration' in msg.content) ? msg.content.narration : msg.content }));
    const finalMessages = [{ role: "system", content: actor.system_prompt }, ...messages, { role: "user", content: userPrompt }];
    try {
        const completion = await openai.chat.completions.create({ model: actor.model_name || "gpt-4o", messages: finalMessages, response_format: { type: "json_object" } });
        return completion.choices[0].message?.content || '{"narration":"[AI returned an empty response]"}';
    } catch (error) {
        console.error(`[AI-CHAT ERROR] Error from OpenAI for ${actorId}:`, error);
        throw new Error(`AI persona '${actorId}' failed to respond: ${error.message}`);
    }
}
function parseAndValidateAIResponse(responseText) {
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    try {
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error("[PARSING ERROR] Failed to parse AI response JSON:", error, "Raw response:", cleanedText.substring(0, 500));
        return { narration: `[Parsing Error]`, damage_to_player: 0, damage_to_opponent: 0 };
    }
}

async function handleDynamicTurnLogic({ sceneId, playerSideMessage, opponentSideMessage, transcribedMessage = null }) {
    const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
    if (!scene) throw new Error('Scene not found for turn.');

    let { chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, sandbox_opponent_details } = scene;
    chat_history = JSON.parse(chat_history);
    const gmPersona = loadedPersonas[gm_persona_id];

    let promptForGM, gmNarration, gameOver = false, finalReason = null, damageDealtToPlayer = 0, damageDealtToOpponent = 0;
    const actualPlayerSideMessage = transcribedMessage || playerSideMessage;
    chat_history.push({ role: 'user', content: `${player_side_name.toUpperCase()} ACTION: "${actualPlayerSideMessage}"` });

    let gmResponseData;
    if (game_mode === 'sandbox') {
        promptForGM = `The player's action is: "${actualPlayerSideMessage}". Narrate the outcome. Your JSON needs "narration" and "shot_description". If the situation calls for combat and the Director is allowed to initiate, also include "initiate_combat": true, "opponent_description", and "opponent_hp".`;
        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || "[The Director is contemplating...]";
        if (scene.director_can_initiate_combat && gmResponseData.initiate_combat) {
            game_mode = 'sandbox_combat';
            sandbox_opponent_details = gmResponseData.opponent_description;
            player_hp = 3; opponent_hp = gmResponseData.opponent_hp || 3; round_number = 1;
        }
    } else { // competitive or sandbox_combat
        round_number++;
        const effectiveOpponentName = sandbox_opponent_details || opponent_side_name;
        if (game_mode === 'sandbox_combat') {
            promptForGM = `Adjudicate a duel turn. Player '${player_side_name}' (HP: ${player_hp}) action: "${actualPlayerSideMessage}". Generate the opponent '${effectiveOpponentName}' (HP: ${opponent_hp})'s counter-action, then narrate the clash. JSON needs "narration", "shot_description", "damage_to_player", and "damage_to_opponent".`;
        } else { // competitive
            chat_history.push({ role: 'user', content: `${opponent_side_name.toUpperCase()} ACTIONS: "${opponentSideMessage}"` });
            promptForGM = `Adjudicate a duel turn. Player '${player_side_name}' (HP: ${player_hp}) action: "${actualPlayerSideMessage}". Opponent '${opponent_side_name}' (HP: ${opponent_hp}) action: "${opponentSideMessage}". Narrate the clash. JSON needs "narration", "shot_description", "damage_to_player", and "damage_to_opponent".`;
        }
        
        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || "[The clash of actions echoes...]";
        
        damageDealtToPlayer = gmResponseData.damage_to_player || 0;
        damageDealtToOpponent = gmResponseData.damage_to_opponent || 0;
        player_hp -= damageDealtToPlayer;
        opponent_hp -= damageDealtToOpponent;

        if (player_hp <= 0 || opponent_hp <= 0) {
            if (game_mode === 'sandbox_combat') {
                finalReason = player_hp <= 0 ? `${player_side_name} was defeated, but the adventure continues.` : `${effectiveOpponentName} was vanquished!`;
                const combatEndPrompt = `The combat has ended. ${finalReason} Narrate this outcome and transition back to exploration. JSON needs "narration" and "shot_description".`;
                const finalResponseJson = await fetchActorResponse(gm_persona_id, combatEndPrompt, chat_history);
                gmResponseData = parseAndValidateAIResponse(finalResponseJson);
                gmNarration = gmResponseData.narration;
                db.prepare(`UPDATE scenes SET game_mode = 'sandbox', sandbox_opponent_details = NULL, player_hp = 0, opponent_hp = 0, round_number = 0 WHERE sceneId = ?`).run(sceneId);
                game_mode = 'sandbox'; // Update local state
                gameOver = false; // Adventure continues
            } else { // competitive
                gameOver = true;
                finalReason = player_hp <= 0 ? `${player_side_name} was defeated.` : `${effectiveOpponentName} was vanquished.`;
                const victoryOrDefeatPrompt = `The duel has ended. ${finalReason} Narrate the conclusive end of this conflict. JSON needs "narration" and "shot_description".`;
                const finalResponseJson = await fetchActorResponse(gm_persona_id, victoryOrDefeatPrompt, chat_history);
                gmResponseData = parseAndValidateAIResponse(finalResponseJson);
                gmNarration = gmResponseData.narration;
            }
        }
    }
    
    const [audio_base_64, image_b64] = await Promise.all([
        generateSpeech(gmNarration, gmPersona.voice),
        generateImage(gmResponseData.shot_description)
    ]);
    
    chat_history.push({ role: 'assistant', content: { narration: gmNarration } });
    db.prepare(`UPDATE scenes SET chat_history = ?, game_mode = ?, round_number = ?, player_hp = ?, opponent_hp = ?, sandbox_opponent_details = ? WHERE sceneId = ?`).run(
        JSON.stringify(chat_history), game_mode, round_number, player_hp, opponent_hp, sandbox_opponent_details, sceneId
    );

    return {
        response: { narration: gmNarration, audio_base_64, image_b64 }, character: gm_persona_id, transcribedMessage: transcribedMessage, currentRound: round_number,
        playerHP: player_hp, opponentHP: opponent_hp, gameOver, finalReason, gameMode: game_mode, sandboxOpponentName: sandbox_opponent_details,
        damageDealtToPlayer, damageDealtToOpponent
    };
}

async function startServer() {
    console.log("[SERVER] Starting server initialization...");
    await fs.mkdir(SAVES_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(path.join(MODS_DIR, 'personas'), { recursive: true }).catch(console.error);

    loadedPersonas['Tactician_GM'] = { actor_id: 'Tactician_GM', name: 'The Grand Tactician', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Grand Tactician,' an AI Game Master. You follow instructions precisely. Your responses are always in JSON format.`, voice: 'onyx' };
    loadedPersonas['The_Conductor'] = { actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Conductor,' an AI Game Master. You follow instructions precisely. Your responses are always in JSON format.`, voice: 'nova' };
    
    await loadMods();
    await loadAesthetics();

    if (!process.env.OPENAI_API_KEY) console.warn("[SERVER WARNING] OPENAI_API_KEY is not set. Speech generation will fail.");
    if (!STABILITY_API_KEY) console.warn("[SERVER WARNING] STABILITY_API_KEY is not set. Image generation will be skipped.");

    server.listen(PORT, () => console.log(`GlassICE v27.0 (Maestro - Stable Diffusion) running at http://localhost:${PORT}`));
}

startServer();
