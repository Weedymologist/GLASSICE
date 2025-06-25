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

        // --- NEW: Generate image and audio in parallel ---
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
            response: { narration: gmNarration, audio_base_64, image_b64 }, // Added image_b64
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
    console.log(`[SERVER] Received /api/dynamic-narrative/${req.params.sceneId}/turn request (text).`);
    try {
        const { playerSideMessage, opponentSideMessage } = req.body;
        const { sceneId } = req.params;

        const result = await handleDynamicTurnLogic({
            sceneId: sceneId,
            playerSideMessage,
            opponentSideMessage,
            transcribedMessage: null
        });
        res.json(result);
        console.log(`[SERVER] Response sent for turn for scene ${sceneId}.`);
    }
    catch (error) {
        console.error("[SERVER ERROR] Dynamic Turn Error:", error);
        res.status(500).json({ error: 'Dynamic turn failed.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn/voice', async (req, res) => {
    console.log(`[SERVER] Received /api/dynamic-narrative/${req.params.sceneId}/turn/voice request.`);
    if (!req.files || !req.files.audio) {
        console.error("[SERVER ERROR] No audio file uploaded.");
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    const { sceneId } = req.params;
    const audioFile = req.files.audio;
    const tempPath = path.join(TEMP_DIR, `${Date.now()}_audio.webm`);

    try {
        await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
        await audioFile.mv(tempPath);
        console.log(`[SERVER] Audio saved temporarily to ${tempPath}.`);

        console.log("[SERVER] Sending audio to Whisper ASR...");
        const transcription = await openai.audio.transcriptions.create({
            model: "whisper-1",
            file: fsActual.createReadStream(tempPath),
        });
        const transcribedMessage = transcription.text || "[Silent line]";
        console.log(`[SERVER] Transcription complete: "${transcribedMessage.substring(0, 50)}..."`);

        await fs.unlink(tempPath);
        console.log(`[SERVER] Temporary audio file ${tempPath} deleted.`);

        const result = await handleDynamicTurnLogic({
            sceneId: sceneId,
            playerSideMessage: transcribedMessage,
            opponentSideMessage: '',
            transcribedMessage: transcribedMessage
        });
        res.json(result);
        console.log(`[SERVER] Response sent for voice turn for scene ${sceneId}.`);

    } catch (error) {
        console.error("[SERVER ERROR] Voice Turn Error:", error);
        if (fsActual.existsSync(tempPath)) {
            await fs.unlink(tempPath).catch(err => console.error("Failed to delete temp file during error handling:", err));
        }
        res.status(500).json({ error: 'Voice turn failed.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/initiate-sandbox-combat', async (req, res) => {
    console.log(`[SERVER] Received /api/dynamic-narrative/${req.params.sceneId}/initiate-sandbox-combat request.`);
    try {
        const { sceneId } = req.params;
        const { opponentDescription } = req.body;

        const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
        if (!scene || scene.game_mode !== 'sandbox') {
            return res.status(400).json({ error: 'Scene not found or not in open-ended sandbox mode to initiate combat.' });
        }
        if (!opponentDescription || opponentDescription.trim() === '') {
            return res.status(400).json({ error: 'Please describe the opponent for combat.' });
        }
        console.log(`[SERVER] Initiating combat in scene ${sceneId} with opponent: ${opponentDescription}.`);

        let { chat_history, gm_persona_id, player_side_name } = scene;
        chat_history = JSON.parse(chat_history);

        const combatPlayerHP = 3; 
        const combatOpponentHP = 3;

        db.prepare(`UPDATE scenes SET game_mode = ?, round_number = ?, player_hp = ?, opponent_hp = ?, sandbox_opponent_details = ? WHERE sceneId = ?`).run(
            'sandbox_combat', 0, combatPlayerHP, combatOpponentHP, opponentDescription, sceneId
        );
        console.log(`[SERVER] Scene ${sceneId} updated to 'sandbox_combat' mode.`);

        const gmPersona = loadedPersonas[gm_persona_id];
        if (!gmPersona) {
             return res.status(400).json({ error: `GM Persona '${gm_persona_id}' not found.` });
        }

        const initialCombatPrompt = `You are the Game Master. The player, '${player_side_name}', has chosen to engage in combat with '${opponentDescription}'. Describe the immediate confrontation, setting the stage for tactical actions. Your next response should be in the style of adjudicating simultaneous actions and will require \`"damage_to_player"\` and \`"damage_to_opponent"\` fields, a "narration" field, and a "shot_description" field. Remember, you are still ${gmPersona.name}.`;
        console.log(`[SERVER] Initial Combat Prompt for GM: ${initialCombatPrompt.substring(0, 100)}...`);

        const initialCombatResponseJson = await fetchActorResponse(gm_persona_id, initialCombatPrompt, chat_history);
        const initialCombatResponseData = parseAndValidateAIResponse(initialCombatResponseJson);
        const gmNarration = initialCombatResponseData.narration || "[Combat initiated...]";
        
        const [audio_base_64, image_b64] = await Promise.all([
            generateSpeech(gmNarration, gmPersona.voice),
            generateImage(initialCombatResponseData.shot_description)
        ]);

        chat_history.push({ role: 'assistant', content: { narration: gmNarration } });
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(chat_history), sceneId);

        res.json({
            response: { narration: gmNarration, audio_base_64, image_b64 },
            character: gm_persona_id,
            gameMode: 'sandbox_combat',
            currentRound: 0,
            playerHP: combatPlayerHP,
            opponentHP: combatOpponentHP,
            gameOver: false,
            sandboxOpponentName: opponentDescription
        });
        console.log("[SERVER] Response sent for /api/dynamic-narrative/:sceneId/initiate-sandbox-combat.");

    } catch (error) {
        console.error("[SERVER ERROR] Initiate Sandbox Combat Error:", error);
        res.status(500).json({ error: 'Failed to initiate sandbox combat.' });
    }
});

app.post('/api/adventure/:sceneId/chronicle/save', async (req, res) => {
    // This function remains the same.
});

app.post('/api/adventure/:sceneId/state/save', async (req, res) => {
    // This function remains the same.
});

app.post('/api/adventure/state/load', async (req, res) => {
    // This function remains the same.
});


const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html')); 
});

const server = createServer(app);
const db = new Database(DB_FILE);

db.exec(`CREATE TABLE IF NOT EXISTS scenes (
    sceneId TEXT PRIMARY KEY,
    chat_history TEXT,
    gm_persona_id TEXT,
    game_mode TEXT, 
    player_side_name TEXT DEFAULT 'Player',
    opponent_side_name TEXT DEFAULT 'Opponent',
    round_number INTEGER DEFAULT 0,
    player_hp INTEGER DEFAULT 3,
    opponent_hp INTEGER DEFAULT 3,
    sandbox_opponent_details TEXT,
    director_can_initiate_combat INTEGER DEFAULT 1
)`);
console.log("[SERVER] Database table schema check/creation complete.");

let loadedPersonas = {};
let loadedAesthetics = {};

async function loadMods() {
    try {
        const personaDir = path.join(MODS_DIR, 'personas');
        await fs.mkdir(personaDir, { recursive: true }).catch(console.error);
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
        await fs.mkdir(aestheticDir, { recursive: true }).catch(console.error);
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
    if (!text) return null;
    try {
        const cleanText = text.replace(/<[^>]*>/g, '');
        const ttsResponse = await openai.audio.speech.create({ model: "tts-1-hd", voice: voice, input: cleanText });
        const buffer = Buffer.from(await ttsResponse.arrayBuffer());
        return buffer.toString('base64');
    } catch (error) {
        console.error("[AI-TTS ERROR] Speech Generation Error:", error);
        return null; // Return null instead of throwing to not break the turn
    }
}
// --- NEW FUNCTION TO GENERATE IMAGES ---
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
            size: "1024x1024",
            response_format: "b64_json",
        });
        console.log("[AI-IMAGE] DALL-E image generation successful.");
        return response.data[0].b64_json;
    } catch (error) {
        console.error("[AI-IMAGE ERROR] DALL-E Image Generation Error:", error);
        return null; // Return null on error so the game can continue
    }
}

async function fetchActorResponse(actorId, userPrompt, history = []) {
    const actor = loadedPersonas[actorId];
    if (!actor) { throw new Error(`Unknown actor: ${actorId}`); }
    const messages = history.slice(-8).map(msg => ({ role: msg.role, content: (typeof msg.content === 'object' && msg.content !== null && 'narration' in msg.content) ? msg.content.narration : msg.content }));
    const finalMessages = [ { role: "system", content: actor.system_prompt }, ...messages, { role: "user", content: userPrompt } ];
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
        const parsed = JSON.parse(cleanedText);
        return parsed;
    } catch (error) {
        console.error("[PARSING ERROR] Failed to parse AI response JSON:", error, "Raw response (first 500 chars):", cleanedText.substring(0, 500));
        return { narration: `[Parsing Error] Malformed JSON from AI: ${cleanedText.substring(0, 100)}...`, damage_to_player: 0, damage_to_opponent: 0 };
    }
}

async function handleDynamicTurnLogic({ sceneId, playerSideMessage, opponentSideMessage, transcribedMessage = null }) {
    console.log(`[SERVER] Handling dynamic turn logic for scene ${sceneId}.`);
    const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
    if (!scene) { throw new Error('Scene not found for turn.'); }

    let { chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, sandbox_opponent_details, director_can_initiate_combat } = scene;
    chat_history = JSON.parse(chat_history);
    console.log(`[SERVER] Current scene state: mode=${game_mode}, round=${round_number}, P_HP=${player_hp}, O_HP=${opponent_hp}`);

    const gmPersona = loadedPersonas[gm_persona_id];
    if (!gmPersona) { throw new Error(`GM Persona '${gm_persona_id}' not found.`); }

    let promptForGM, gmNarration, gameOver = false, finalReason = null, damageDealtToPlayer = 0, damageDealtToOpponent = 0;
    let effectiveOpponentName = opponent_side_name, actualOpponentMessage = opponentSideMessage;

    const actualPlayerSideMessage = transcribedMessage || playerSideMessage;
    chat_history.push({ role: 'user', content: `${player_side_name.toUpperCase()} ACTION: "${actualPlayerSideMessage}"` });

    let gmResponseData;
    if (game_mode === 'sandbox') {
        promptForGM = `You are the Game Master. The player's action is: "${actualPlayerSideMessage}". Narrate the outcome in a "narration" field and provide a "shot_description".`;
        if (director_can_initiate_combat) { promptForGM += `\nRemember, you can initiate combat if narratively appropriate.`; }
        else { promptForGM += `\nRemember, you MUST NOT initiate combat.`; }
        
        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || gmResponseData.scene_description || "[The Director is contemplating...]";

        if (director_can_initiate_combat && gmResponseData.initiate_combat === true && gmResponseData.opponent_description) {
            console.log('[SERVER] Director has initiated combat!');
            const newOpponentName = gmResponseData.opponent_description;
            const newOpponentHP = gmResponseData.opponent_hp || 3;
            const newPlayerHP = gmResponseData.player_hp || 3;
            game_mode = 'sandbox_combat';
            sandbox_opponent_details = newOpponentName;
            player_hp = newPlayerHP;
            opponent_hp = newOpponentHP;
            round_number = 1;
            console.log(`[SERVER] New combat: ${player_side_name} (${player_hp} HP) vs ${newOpponentName} (${opponent_hp} HP)`);
        }
    } else if (game_mode === 'competitive' || game_mode === 'sandbox_combat') {
        round_number++;
        effectiveOpponentName = sandbox_opponent_details || opponent_side_name;

        if (game_mode === 'sandbox_combat') {
            promptForGM = `You are the Game Master for a narrative duel between '${player_side_name}' (HP: ${player_hp}) and '${effectiveOpponentName}' (HP: ${opponent_hp}). Player's action: "${actualPlayerSideMessage}". Generate '${effectiveOpponentName}'s counter-action, then adjudicate. Your JSON response MUST include a "narration" field, a "shot_description", plus \`"damage_to_player"\` and \`"damage_to_opponent"\` fields. You are ${gmPersona.name}.`;
            actualOpponentMessage = "";
        } else {
            promptForGM = `You are the Game Master for a duel between '${player_side_name}' (HP: ${player_hp}) and '${opponent_side_name}' (HP: ${opponent_hp}). Player actions: "${actualPlayerSideMessage}". Opponent actions: "${opponentSideMessage}". Adjudicate the turn. Your JSON response MUST include a "narration" field, a "shot_description", plus \`"damage_to_player"\` and \`"damage_to_opponent"\` fields. You are ${gmPersona.name}.`;
        }

        if (actualOpponentMessage) { chat_history.push({ role: 'user', content: `${effectiveOpponentName.toUpperCase()} ACTIONS: "${actualOpponentMessage}"` }); }

        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || gmResponseData.scene_description || "[The clash of actions echoes...]";
        
        damageDealtToPlayer = gmResponseData.damage_to_player || 0;
        damageDealtToOpponent = gmResponseData.damage_to_opponent || 0;
        player_hp -= damageDealtToPlayer;
        opponent_hp -= damageDealtToOpponent;
        console.log(`[SERVER] Damage: Player <- ${damageDealtToPlayer}, Opponent <- ${damageDealtToOpponent}. New HP: P=${player_hp}, O=${opponent_hp}`);

        if (player_hp <= 0 || opponent_hp <= 0) {
            if (game_mode === 'sandbox_combat') {
                finalReason = player_hp <= 0 ? `${player_side_name} was defeated, but the adventure continues.` : `${effectiveOpponentName} was vanquished! The journey continues.`;
                const combatEndPrompt = `The combat has ended. ${finalReason} Narrate this outcome and smoothly transition back to open-ended exploration. Do not include damage fields. Your "narration" and "shot_description" fields should be conclusive for the fight but open for the story. You are ${gmPersona.name}.`;
                const finalGmResponseJson = await fetchActorResponse(gm_persona_id, combatEndPrompt, chat_history);
                gmResponseData = parseAndValidateAIResponse(finalGmResponseJson);
                gmNarration = gmResponseData.narration;
                
                db.prepare(`UPDATE scenes SET game_mode = 'sandbox', sandbox_opponent_details = NULL, player_hp = 0, opponent_hp = 0, round_number = 0 WHERE sceneId = ?`).run(sceneId);
                game_mode = 'sandbox';
                gameOver = false;
            } else { // competitive
                gameOver = true;
                finalReason = player_hp <= 0 ? `${player_side_name} was defeated.` : `${effectiveOpponentName} was vanquished.`;
                const victoryOrDefeatPrompt = `The duel has ended. ${finalReason} Narrate the conclusive end of this conflict. Be dramatic. Do not include damage fields, only a "narration" and "shot_description" field. You are ${gmPersona.name}.`;
                const finalGmResponseJson = await fetchActorResponse(gm_persona_id, victoryOrDefeatPrompt, chat_history);
                gmResponseData = parseAndValidateAIResponse(finalGmResponseJson);
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
        playerHP: player_hp, opponentHP: opponent_hp, gameOver: gameOver, finalReason: finalReason, gameMode: game_mode, sandboxOpponentName: sandbox_opponent_details,
        damageDealtToPlayer: damageDealtToPlayer, damageDealtToOpponent: damageDealtToOpponent
    };
}

async function startServer() {
    console.log("[SERVER] Starting server initialization...");
    await fs.mkdir(SAVES_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(path.join(MODS_DIR, 'personas'), { recursive: true }).catch(console.error);
    console.log("[SERVER] Data directories ensured to exist on persistent disk.");

    loadedPersonas['Tactician_GM'] = { actor_id: 'Tactician_GM', name: 'The Grand Tactician', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Grand Tactician,' an AI Game Master overseeing narrative duels. Your role is to adjudicate simultaneous actions, synthesize them into a narrative, and describe the outcome. Your JSON response MUST include a "narration" field, a "shot_description" field, plus \`"damage_to_player"\` and \`"damage_to_opponent"\` fields with numerical values indicating the result of the round.`, voice: 'onyx' };
    loadedPersonas['The_Conductor'] = { actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Conductor,' an AI Game Master crafting dramatic narratives. All your JSON responses must contain a "narration" field and a "shot_description" field. When adjudicating combat, your JSON response MUST also include \`"damage_to_player"\` and \`"damage_to_opponent"\` fields. For open-ended sandbox play, you can initiate combat if allowed by the rules given in the user prompt by returning \`"initiate_combat": true\`, along with \`"opponent_description"\` and \`"opponent_hp"\`.`, voice: 'nova' };
    console.log("[SERVER] Default personas initialized.");

    await loadMods();
    await loadAesthetics();
    console.log("[SERVER] Mods and Aesthetics loaded.");

    server.listen(PORT, () => console.log(`GlassICE v27.0 (Maestro - Interactive Chronicle) running at http://localhost:${PORT}`));
    console.log("[SERVER] Server started.");
}

startServer();
