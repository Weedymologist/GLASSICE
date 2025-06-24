// P.A.N.E. GLASS - v27.0 ("Maestro") - Interactive Chronicle Engine (ICE)
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const fs = require('fs/promises');    // For async file operations (writeFile, unlink, readdir, mkdir)
const fsActual = require('fs');       // For sync file operations (createReadStream, existsSync)
const path = require('path');
const fileUpload = require('express-fileupload'); // Kept for voice upload
const OpenAI = require('openai');
const fetch = require('node-fetch');  // node-fetch v2 is specified in package.json

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = process.env.PORT || 3001; // Your app listens on this port, Render maps it

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
            initialPromptForGM = `You are the Game Master for an open-ended narrative experience. The game setting is: "${gameSettingPrompt}". The player, '${playerSideName}', has presented this opening strategy/composition: "${initialPlayerSidePrompt}". Synthesize this information to introduce the scene, the player's initial status, and set the stage. Conclude by presenting a compelling 'what if' scenario or a clear choice for the player's first move. You are ${gmPersonaToUse.name}.`;
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
            
            This is a duel of attrition. Your JSON response MUST include \`"damage_to_player"\` and \`"damage_to_opponent"\` fields with numerical values, reflecting who gained the upper hand in this specific round. You are ${gmPersonaToUse.name}.`;
        }
        console.log(`[SERVER] Initial Prompt for GM: ${initialPromptForGM.substring(0, 100)}...`);

        const initialGMResponseJson = await fetchActorResponse(gmPersonaToUse.actor_id, initialPromptForGM, []);
        console.log(`[SERVER] Raw AI Response for Start: ${initialGMResponseJson.substring(0, 100)}...`);
        const initialGMResponseData = parseAndValidateAIResponse(initialGMResponseJson);
        console.log(`[SERVER] Parsed AI Response Data:`, initialGMResponseData);

        const gmNarration = initialGMResponseData.narration || "[Initiation failed...]";
        console.log(`[SERVER] GM Narration for Speech: ${gmNarration.substring(0, 100)}...`);

        const audio_base_64 = await generateSpeech(gmNarration, gmPersonaToUse.voice);
        console.log(`[SERVER] Speech generation complete. Audio size: ${audio_base_64 ? audio_base_64.length : 0} bytes.`);


        let history = [{ role: 'assistant', content: { narration: gmNarration } }];
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(history), sceneId);
        console.log(`[SERVER] Chat history updated in DB for scene ${sceneId}.`);

        res.json({
            sceneId,
            response: { narration: gmNarration, audio_base_64 },
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

        const initialCombatPrompt = `You are the Game Master. The player, '${player_side_name}', has chosen to engage in combat with '${opponentDescription}'. Describe the immediate confrontation, setting the stage for tactical actions. Your next response should be in the style of adjudicating simultaneous actions and will require \`"damage_to_player"\` and \`"damage_to_opponent"\` fields. Remember, you are still ${gmPersona.name}.`;
        console.log(`[SERVER] Initial Combat Prompt for GM: ${initialCombatPrompt.substring(0, 100)}...`);

        const initialCombatResponseJson = await fetchActorResponse(gm_persona_id, initialCombatPrompt, chat_history);
        const initialCombatResponseData = parseAndValidateAIResponse(initialCombatResponseJson);
        const gmNarration = initialCombatResponseData.narration || "[Combat initiated...]";
        const audio_base_64 = await generateSpeech(gmNarration, gmPersona.voice);

        chat_history.push({ role: 'assistant', content: { narration: gmNarration } });
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(chat_history), sceneId);

        res.json({
            response: { narration: gmNarration, audio_base_64 },
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
    console.log(`[SERVER] Received /api/adventure/${req.params.sceneId}/chronicle/save request.`);
    const { sceneId } = req.params;

    try {
        const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
        if (!scene) {
            return res.status(404).json({ error: 'Scene to save not found.' });
        }
        
        const history = JSON.parse(scene.chat_history);
        const aesthetic = loadedAesthetics[scene.active_aesthetic_id] || { name: "Unknown" };
        const gm = loadedPersonas[scene.gm_persona_id] || { name: "Unknown Director" };
        
        const gameMode = scene.game_mode; 
        const playerSideName = scene.player_side_name || 'Player';
        const opponentSideName = scene.opponent_side_name || 'Opponent';
        const roundNumber = scene.round_number || 0;
        const playerHP = scene.player_hp || 0;
        const opponentHP = scene.opponent_hp || 0;
        const sandboxOpponentName = scene.sandbox_opponent_details || null;
        
        let htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>GlassICE Chronicle</title><style>body{background-color:#1a1a1a;color:#e0e0e0;font-family:'Courier New',monospace;padding:20px;max-width:900px;margin:auto}.log-entry{margin-bottom:1.5em;line-height:1.6;border-left:3px solid #4a4d6b;padding-left:15px}strong{font-weight:bold;padding-right:10px;color:#00c3ff;display:block;margin-bottom:5px}strong.user,strong.player-side{color:#00ffaa}strong.opponent-side{color:#ff99ff}hr{border:1px solid #4a4d6b;margin:2em 0}h1,h2,h3{color:#e0e0e0;text-shadow:0 0 5px #00c3ff}</style></head><body><h1>GlassICE Chronicle (${gameMode.replace('_',' ').toUpperCase()})</h1><h2>Director: ${gm.name}</h2><h3>Aesthetic (Not used): ${aesthetic.name}</h3>${(gameMode==='competitive'||gameMode==='sandbox_combat')?`<h3>Stats: Rnd ${roundNumber} | ${playerSideName} HP: ${playerHP} | ${sandboxOpponentName||opponentSideName} HP: ${opponentHP}</h3>`:''} <hr>`;
        for(const entry of history){if(entry.role==='assistant'){if(typeof entry.content==='object'&&entry.content!==null){htmlContent+=`<div class="log-entry"><strong>${gm.name}:</strong> ${entry.content.narration}</div>\n`}}else{let author='Player';let className='user';let content=entry.content;const playerPrefix=`${playerSideName.toUpperCase()} ACTION`;const opponentPrefix=`${(sandboxOpponentName||opponentSideName).toUpperCase()} ACTIONS:`;if(content.startsWith(playerPrefix)){author=playerSideName;className='player-side';content=content.substring(content.indexOf(':')+1).trim().replace(/^"|"$/g,'')}else if(content.startsWith(opponentPrefix)){author=(sandboxOpponentName||opponentSideName);className='opponent-side';content=content.substring(content.indexOf(':')+1).trim().replace(/^"|"$/g,'')}htmlContent+=`<div class="log-entry"><strong class="${className}">${author}:</strong> ${content}</div>\n`}}
        htmlContent += `</body></html>`;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const saveFileName = `GlassICE_Chronicle_${timestamp}.html`;
        const saveFilePath = path.join(SAVES_DIR, saveFileName);

        await fs.mkdir(SAVES_DIR, { recursive: true }).catch(console.error);
        await fs.writeFile(saveFilePath, htmlContent);

        res.json({ message: `Chronicle saved as ${saveFileName}`, fileName: saveFileName });
    } catch (error) {
        console.error("[SERVER ERROR] Save Chronicle Error:", error);
        res.status(500).json({ error: 'Failed to save chronicle.' });
    }
});

app.post('/api/adventure/:sceneId/state/save', async (req, res) => {
    console.log(`[SERVER] Received /api/adventure/${req.params.sceneId}/state/save request.`);
    const { sceneId } = req.params;
    try {
        const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
        if (!scene) {
            return res.status(404).json({ error: 'Scene to save not found.' });
        }
        res.json(scene);
        console.log(`[SERVER] Sent game state for scene ${sceneId} to client.`);
    } catch (error) {
        console.error("[SERVER ERROR] Save State Error:", error);
        res.status(500).json({ error: 'Failed to retrieve game state for saving.' });
    }
});

app.post('/api/adventure/state/load', async (req, res) => {
    console.log(`[SERVER] Received /api/adventure/state/load request.`);
    try {
        const loadedState = req.body;
        
        if (!loadedState.chat_history || !loadedState.gm_persona_id) {
            return res.status(400).json({ error: 'Invalid or corrupted save file.' });
        }

        const newSceneId = Date.now().toString();
        
        db.prepare(`INSERT INTO scenes (sceneId, chat_history, gm_persona_id, game_mode, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp, sandbox_opponent_details, director_can_initiate_combat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            newSceneId, loadedState.chat_history, loadedState.gm_persona_id, loadedState.game_mode, 
            loadedState.player_side_name, loadedState.opponent_side_name, loadedState.round_number, 
            loadedState.player_hp, loadedState.opponent_hp, loadedState.sandbox_opponent_details,
            loadedState.director_can_initiate_combat
        );

        console.log(`[SERVER] Successfully loaded state from save file into new scene ${newSceneId}.`);
        const newSceneData = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(newSceneId);
        res.json(newSceneData);

    } catch (error) {
        console.error("[SERVER ERROR] Load State Error:", error);
        res.status(500).json({ error: 'Failed to load game state.' });
    }
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
        throw error;
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

    let promptForGM, gmNarration, audio_base_64, gameOver = false, finalReason = null, damageDealtToPlayer = 0, damageDealtToOpponent = 0;
    let effectiveOpponentName = opponent_side_name, actualOpponentMessage = opponentSideMessage;

    const actualPlayerSideMessage = transcribedMessage || playerSideMessage;
    chat_history.push({ role: 'user', content: `${player_side_name.toUpperCase()} ACTION: "${actualPlayerSideMessage}"` });

    if (game_mode === 'sandbox') {
        promptForGM = `You are the Game Master. The player's action is: "${actualPlayerSideMessage}". Narrate the outcome.`;
        if (director_can_initiate_combat) { promptForGM += `\nRemember, you can initiate combat if narratively appropriate.`; }
        else { promptForGM += `\nRemember, you MUST NOT initiate combat.`; }
        
        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        const gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || "[The GM remains silent...]";

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
        audio_base_64 = await generateSpeech(gmNarration, gmPersona.voice);

    } else if (game_mode === 'competitive' || game_mode === 'sandbox_combat') {
        round_number++;
        effectiveOpponentName = sandbox_opponent_details || opponent_side_name;

        if (game_mode === 'sandbox_combat') {
            promptForGM = `You are the Game Master for a narrative duel between '${player_side_name}' (HP: ${player_hp}) and '${effectiveOpponentName}' (HP: ${opponent_hp}). Player's action: "${actualPlayerSideMessage}". Generate '${effectiveOpponentName}'s counter-action, then adjudicate. Your JSON response MUST include \`"damage_to_player"\` and \`"damage_to_opponent"\`. You are ${gmPersona.name}.`;
            actualOpponentMessage = "";
        } else {
            promptForGM = `You are the Game Master for a duel between '${player_side_name}' (HP: ${player_hp}) and '${opponent_side_name}' (HP: ${opponent_hp}). Player actions: "${actualPlayerSideMessage}". Opponent actions: "${opponentSideMessage}". Adjudicate the turn. Your JSON response MUST include \`"damage_to_player"\` and \`"damage_to_opponent"\`. You are ${gmPersona.name}.`;
        }

        if (actualOpponentMessage) { chat_history.push({ role: 'user', content: `${effectiveOpponentName.toUpperCase()} ACTIONS: "${actualOpponentMessage}"` }); }

        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        const gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || "[The GM remains silent...]";
        
        damageDealtToPlayer = gmResponseData.damage_to_player || 0;
        damageDealtToOpponent = gmResponseData.damage_to_opponent || 0;
        player_hp -= damageDealtToPlayer;
        opponent_hp -= damageDealtToOpponent;
        console.log(`[SERVER] Damage: Player <- ${damageDealtToPlayer}, Opponent <- ${damageDealtToOpponent}. New HP: P=${player_hp}, O=${opponent_hp}`);

        if (player_hp <= 0 || opponent_hp <= 0) {
            if (game_mode === 'sandbox_combat') {
                finalReason = player_hp <= 0 ? `${player_side_name} was defeated, but the adventure continues.` : `${effectiveOpponentName} was vanquished! The journey continues.`;
                const combatEndPrompt = `The combat has ended. ${finalReason} Narrate this outcome and smoothly transition back to open-ended exploration. Do not include damage fields. You are ${gmPersona.name}.`;
                const finalGmResponseJson = await fetchActorResponse(gm_persona_id, combatEndPrompt, chat_history);
                gmNarration = parseAndValidateAIResponse(finalGmResponseJson).narration || `[The battle ends. ${finalReason}]`;
                db.prepare(`UPDATE scenes SET game_mode = 'sandbox', sandbox_opponent_details = NULL, player_hp = 0, opponent_hp = 0, round_number = 0 WHERE sceneId = ?`).run(sceneId);
                game_mode = 'sandbox';
                gameOver = false;
            } else { // competitive
                gameOver = true;
                finalReason = player_hp <= 0 ? `${player_side_name} was defeated.` : `${effectiveOpponentName} was vanquished.`;
                const victoryOrDefeatPrompt = `The duel has ended. ${finalReason} Narrate the conclusive end of this conflict. Be dramatic. Do not include damage fields. You are ${gmPersona.name}.`;
                const finalGmResponseJson = await fetchActorResponse(gm_persona_id, victoryOrDefeatPrompt, chat_history);
                gmNarration = parseAndValidateAIResponse(finalGmResponseJson).narration || `[The conflict ends. ${finalReason}]`;
            }
        }
        audio_base_64 = await generateSpeech(gmNarration, gmPersona.voice);
    }

    chat_history.push({ role: 'assistant', content: { narration: gmNarration } });

    db.prepare(`UPDATE scenes SET chat_history = ?, game_mode = ?, round_number = ?, player_hp = ?, opponent_hp = ?, sandbox_opponent_details = ? WHERE sceneId = ?`).run(
        JSON.stringify(chat_history), game_mode, round_number, player_hp, opponent_hp, sandbox_opponent_details, sceneId
    );

    return {
        response: { narration: gmNarration, audio_base_64: audio_base_64 }, character: gm_persona_id, transcribedMessage: transcribedMessage, currentRound: round_number,
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

    loadedPersonas['Tactician_GM'] = { actor_id: 'Tactician_GM', name: 'The Grand Tactician', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Grand Tactician,' an AI Game Master overseeing narrative duels. Your role is to adjudicate simultaneous actions, synthesize them into a narrative, and describe the outcome. Your JSON response MUST include \`"damage_to_player"\` and \`"damage_to_opponent"\` fields with numerical values indicating the result of the round.`, voice: 'onyx' };
    loadedPersonas['The_Conductor'] = { actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm', model_name: 'gpt-4o', system_prompt: `You are 'The Conductor,' an AI Game Master crafting dramatic narratives. When adjudicating combat, your JSON response MUST include \`"damage_to_player"\` and \`"damage_to_opponent"\` fields. For open-ended sandbox play, you can initiate combat if allowed by the rules given in the user prompt by returning \`"initiate_combat": true\`, along with \`"opponent_description"\` and \`"opponent_hp"\`.`, voice: 'nova' };
    console.log("[SERVER] Default personas initialized.");

    await loadMods();
    await loadAesthetics();
    console.log("[SERVER] Mods and Aesthetics loaded.");

    server.listen(PORT, () => console.log(`GlassICE v27.0 (Maestro - Interactive Chronicle) running at http://localhost:${PORT}`));
    console.log("[SERVER] Server started.");
}

startServer();