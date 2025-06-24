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

// --- START OF CHANGES FOR PERSISTENT STORAGE (Already done, just for context) ---
const DB_ROOT_PATH = process.env.DB_ROOT_PATH || __dirname;

const DB_FILE = path.join(DB_ROOT_PATH, 'pane.db');
const MODS_DIR = path.join(DB_ROOT_PATH, 'mods');
const SAVES_DIR = path.join(DB_ROOT_PATH, 'saves');
const TEMP_DIR = path.join(DB_ROOT_PATH, 'temp');
// --- END OF CHANGES FOR PERSISTENT STORAGE ---

const app = express();

// --- START OF NEW/REORDERED EXPRESS MIDDLEWARE ---
// 1. Core Express Middleware: Order here matters.
//    Process incoming request body (JSON) and file uploads first.
app.use(express.json({ limit: '50mb' }));
app.use(fileUpload());
app.use(cors()); // CORS should also be quite early

// 2. API Routes: Your game's backend logic.
//    These should come BEFORE serving static files or the catch-all,
//    so API requests are handled directly.

app.get('/api/personas', (req, res) => {
    const selectablePersonas = Object.values(loadedPersonas).filter(p => p.role === 'gm');
    res.json(selectablePersonas);
});
app.get('/api/aesthetics', (req, res) => res.json(loadedAesthetics));

app.post('/api/dynamic-narrative/start', async (req, res) => {
    try {
        const { gameSettingPrompt, playerSideName, opponentSideName, initialPlayerSidePrompt, initialOpponentSidePrompt, gmPersonaId } = req.body;
        const sceneId = Date.now().toString();
        const isSinglePlayer = !opponentSideName.trim();

        const initialRoundNumber = 0;
        const initialPlayerHP = 3;
        const initialOpponentHP = 3;

        db.prepare('INSERT INTO scenes (sceneId, chat_history, gm_persona_id, is_single_player, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            sceneId, "[]", gmPersonaId, isSinglePlayer ? 1 : 0, playerSideName, opponentSideName || 'Opponent', 
            initialRoundNumber, initialPlayerHP, initialOpponentHP
        );
        
        let initialPromptForGM;
        if (isSinglePlayer) {
            initialPromptForGM = `You are the Game Master for a single-player narrative. The game setting is: "${gameSettingPrompt}". The player, '${playerSideName}', has presented this opening strategy/composition: "${initialPlayerSidePrompt}". Synthesize this information to introduce the scene, the player's initial status, and set the stage. Conclude by presenting a compelling 'what if' scenario or a clear choice for the player's first move. Ensure the narrative flows seamlessly from previous events without referring to a non-existent opponent.`;
        } else {
            initialPromptForGM = `You are the Game Master for a competitive narrative duel between two sides: '${playerSideName}' and '${opponentSideName}'.
            The game setting is: "${gameSettingPrompt}".
            Player Side '${playerSideName}'s opening strategy/composition: "${initialPlayerSidePrompt}"
            Opponent Side '${opponentSideName}'s opening strategy/composition: "${initialOpponentSidePrompt}"
            Synthesize this information to introduce the scene, the initial positions/stakes for both sides, and set the stage for their first turn of actions.
            
            This is a duel of attrition. Each time a side is outmaneuvered, they lose standing. Your JSON response MUST include a 'winner' field with 'player_side', 'opponent_side', or 'draw' for each turn's adjudication, reflecting who gained the upper hand in this specific round.`;
        }
        
        const initialGMResponseJson = await fetchActorResponse(gmPersonaId, initialPromptForGM, []);
        const initialGMResponseData = parseAndValidateAIResponse(initialGMResponseJson);

        const gmNarration = initialGMResponseData.narration || "[Initiation failed...]";

        const audio_base_64 = await generateSpeech(gmNarration, loadedPersonas[gmPersonaId]?.voice);

        let history = [{ role: 'assistant', content: { narration: gmNarration } }];
        db.prepare('UPDATE scenes SET chat_history = ? WHERE sceneId = ?').run(JSON.stringify(history), sceneId);

        res.json({ 
            sceneId, 
            response: { narration: gmNarration, audio_base_64 }, 
            character: gmPersonaId, 
            isSinglePlayer: isSinglePlayer, 
            currentRound: initialRoundNumber, 
            playerHP: initialPlayerHP, 
            opponentHP: initialOpponentHP, 
            gameOver: false 
        });
    } catch (error) {
        console.error("Dynamic Narrative Start Error:", error);
        res.status(500).json({ error: 'Failed to start dynamic narrative.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    try {
        const { playerSideMessage, opponentSideMessage, isSinglePlayer } = req.body;
        const { sceneId } = req.params;

        const result = await handleDynamicTurnLogic({
            sceneId: sceneId,
            playerSideMessage,
            opponentSideMessage,
            transcribedMessage: null
        });
        res.json(result);
    }
    catch (error) {
        console.error("Dynamic Turn Error:", error);
        res.status(500).json({ error: 'Dynamic turn failed.' });
    }
});

app.post('/api/dynamic-narrative/:sceneId/turn/voice', async (req, res) => {
    if (!req.files || !req.files.audio) {
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    const { sceneId } = req.params;
    const audioFile = req.files.audio;
    const tempPath = path.join(TEMP_DIR, `${Date.now()}_audio.webm`);

    try {
        await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
        await audioFile.mv(tempPath);

        const transcription = await openai.audio.transcriptions.create({
            model: "whisper-1",
            file: fsActual.createReadStream(tempPath),
        });
        const transcribedMessage = transcription.text || "[Silent line]";

        await fs.unlink(tempPath);

        const result = await handleDynamicTurnLogic({
            sceneId: sceneId,
            playerSideMessage: transcribedMessage,
            opponentSideMessage: '',
            transcribedMessage: transcribedMessage
        });
        res.json(result);
    } catch (error) {
        console.error("Voice Turn Error:", error);
        if (fsActual.existsSync(tempPath)) {
            await fs.unlink(tempPath).catch(err => console.error("Failed to delete temp file during error handling:", err));
        }
        res.status(500).json({ error: 'Voice turn failed.' });
    }
});

app.post('/api/adventure/:sceneId/save', async (req, res) => {
    const { sceneId } = req.params;
    const { origin } = req.body;

    try {
        const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
        if (!scene) {
            return res.status(404).json({ error: 'Scene to save not found.' });
        }

        const history = JSON.parse(scene.chat_history);
        const aesthetic = loadedAesthetics[scene.active_aesthetic_id] || { name: "Unknown" }; 
        const gm = loadedPersonas[scene.gm_persona_id] || { name: "Unknown Director" };
        const isSinglePlayer = scene.is_single_player === 1;
        const playerSideName = scene.player_side_name || 'Player';
        const opponentSideName = scene.opponent_side_name || 'Opponent';
        const roundNumber = scene.round_number || 0; 
        const playerHP = scene.player_hp || 0;
        const opponentHP = scene.opponent_hp || 0;


        let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>GlassICE Chronicle</title>
    <style>
        body{background-color:#1a1a1a;color:#e0e0e0;font-family:'Courier New',monospace;padding:20px;max-width:900px;margin:auto}
        .log-entry{margin-bottom:1.5em;line-height:1.6;border-left:3px solid #4a4d6b;padding-left:15px}
        strong{font-weight:bold;padding-right:10px;color:#00c3ff;display:block;margin-bottom:5px}
        strong.user{color:#00ffaa;}
        strong.player-side{color:#00ffaa;}
        strong.opponent-side{color:#ff99ff;}
        hr{border:1px solid #4a4d6b;margin:2em 0}
        h1,h2,h3{color:#e0e0e0;text-shadow:0 0 5px #00c3ff}
    </style>
</head>
<body>
    <h1>GlassICE Chronicle (${isSinglePlayer ? 'Single Player' : 'Competitive'})</h1>
    <h2>Director: ${gm.name}</h2>
    <h3>Aesthetic (Not used for visuals in this mode): ${aesthetic.name}</h3>
    ${!isSinglePlayer ? `<h3>Competitive Stats: Round ${roundNumber} | ${playerSideName} HP: ${playerHP} | ${opponentSideName} HP: ${opponentHP}</h3>` : ''}
    <hr>
`;

        for (const entry of history) {
            if (entry.role === 'assistant') {
                if (typeof entry.content === 'object' && entry.content !== null) {
                    htmlContent += `<div class="log-entry"><strong>${gm.name}:</strong> ${entry.content.narration}</div>\n`;
                }
            } else {
                let author = 'Player';
                let className = 'user';

                if (typeof entry.content === 'string') {
                    if (entry.content.startsWith('PLAYER ACTION:')) {
                        author = playerSideName;
                        className = 'player-side';
                        entry.content = entry.content.replace('PLAYER ACTION: ', '');
                    } else if (entry.content.startsWith(`${playerSideName.toUpperCase()} ACTION:`)) {
                        author = playerSideName;
                        className = 'player-side';
                        entry.content = entry.content.replace(`${playerSideName.toUpperCase()} ACTION: `, '');
                    } else if (entry.content.startsWith(`${opponentSideName.toUpperCase()} ACTION:`)) {
                        author = opponentSideName;
                        className = 'opponent-side';
                        entry.content = entry.content.replace(`${opponentSideName.toUpperCase()} ACTION: `, '');
                    }
                }
                htmlContent += `<div class="log-entry"><strong class="${className}">${author}:</strong> ${entry.content}</div>\n`;
            }
        }
        htmlContent += `</body></html>`;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const saveFileName = `GlassICE_Chronicle_${timestamp}.html`;
        const saveFilePath = path.join(SAVES_DIR, saveFileName);
        
        await fs.writeFile(saveFilePath, htmlContent);

        res.json({ message: `Chronicle saved as ${saveFileName}`, fileName: saveFileName });
    } catch (error) {
        console.error("Save Error:", error);
        res.status(500).json({ error: 'Failed to save chronicle.' });
    }
});

// --- NEW POSITION for express.static and the catch-all route ---
// 3. Static File Serving: Serve files from the 'public' directory.
//    This should come AFTER API routes, so API paths don't try to serve static files.
const PUBLIC_DIR = path.join(__dirname, 'public'); // Moved this definition here for clarity in order
app.use(express.static(PUBLIC_DIR));

// 4. Catch-all Route: For any other GET requests not handled by API or static files,
//    serve the index.html. This is crucial for single-page applications (SPAs)
//    and ensures the root path (/) always returns your HTML.
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
// --- END OF NEW/REORDERED EXPRESS MIDDLEWARE ---


const server = createServer(app); // Moved this line here to ensure 'app' is fully configured

// Initialize SQLite Database
const db = new Database(DB_FILE);

db.exec(`CREATE TABLE IF NOT EXISTS scenes (
    sceneId TEXT PRIMARY KEY,
    chat_history TEXT,
    gm_persona_id TEXT,
    is_single_player BOOLEAN DEFAULT 0,
    player_side_name TEXT DEFAULT 'Player',
    opponent_side_name TEXT DEFAULT 'Opponent',
    round_number INTEGER DEFAULT 0,
    player_hp INTEGER DEFAULT 3,
    opponent_hp INTEGER DEFAULT 3
)`);

// Global caches for loaded data
let loadedPersonas = {};
let loadedAesthetics = {};

// --- LOADERS ---
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
                if (!persona.role && (persona.name.toLowerCase().includes('director') || persona.name.toLowerCase().includes('game master'))) {
                    persona.role = 'gm';
                }
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
        // Note: this still refers to '__dirname/public/aesthetics' which is relative to the server.js
        // If these files are supposed to be written to/modified on the persistent disk,
        // they should use DB_ROOT_PATH for their base directory.
        // For now, assuming they are static assets deployed with the code.
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

// ... (Rest of fetchActorResponse, generateSpeech, parseAndValidateAIResponse functions)
// (These are the same as before, just placed here for brevity)

async function generateSpeech(text, voice = "shimmer") {
    if (!text) return null;
    try {
        const cleanText = text.replace(/<[^>]*>/g, '');
        const ttsResponse = await openai.audio.speech.create({
            model: "tts-1-hd",
            voice: voice,
            input: cleanText
        });
        return Buffer.from(await ttsResponse.arrayBuffer()).toString('base64');
    } catch (error) {
        console.error("Speech Generation Error:", error);
        return null;
    }
}

async function fetchActorResponse(actorId, userPrompt, history = []) {
    const actor = loadedPersonas[actorId];
    if (!actor) {
        console.warn(`Attempted to fetch response for unknown actor: ${actorId}`);
        throw new Error(`Unknown actor: ${actorId}`);
    }

    const messages = history.slice(-8).map(msg => ({
        role: msg.role,
        content: (typeof msg.content === 'object' && msg.content !== null && 'narration' in msg.content) ? msg.content.narration : msg.content
    }));

    const finalMessages = [
        { role: "system", content: actor.system_prompt },
        ...messages,
        { role: "user", content: userPrompt }
    ];

    try {
        console.log(`[AI] Calling OpenAI for Persona: ${actor.name} (Model: ${actor.model_name || 'default'})`);
        const completion = await openai.chat.completions.create({
            model: actor.model_name || "gpt-4o",
            messages: finalMessages,
            response_format: { type: "json_object" }
        });
        return completion.choices && completion.choices.length > 0 && completion.choices[0].message?.content || '{"narration":"[AI returned an empty response]"}';
    } catch (error) {
        console.error(`Error from OpenAI for ${actorId}:`, error);
        throw new Error(`AI persona '${actorId}' failed to respond: ${error.message}`);
    }
}

function parseAndValidateAIResponse(responseText) {
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    try {
        const parsed = JSON.parse(cleanedText);
        if (typeof parsed.winner === 'string') {
            parsed.winner = parsed.winner.toLowerCase();
            if (!['player_side', 'opponent_side', 'draw'].includes(parsed.winner)) {
                console.warn(`AI returned invalid 'winner' value "${parsed.winner}", defaulting to 'draw'.`);
                parsed.winner = 'draw';
            }
        }
        return parsed;
    } catch (error) {
        console.error("Failed to parse AI response JSON:", error, "Raw response:", cleanedText.substring(0, 500));
        return { narration: `[Parsing Error] Malformed JSON from AI: ${cleanedText.substring(0, 100)}...`, winner: 'draw' };
    }
}

async function handleDynamicTurnLogic({ sceneId, playerSideMessage, opponentSideMessage, transcribedMessage = null }) {
    const scene = db.prepare('SELECT * FROM scenes WHERE sceneId = ?').get(sceneId);
    if (!scene) {
        throw new Error('Scene not found for turn.');
    }

    let { chat_history, gm_persona_id, is_single_player, player_side_name, opponent_side_name, round_number, player_hp, opponent_hp } = scene;
    chat_history = JSON.parse(chat_history);
    
    opponent_side_name = opponent_side_name || 'Opponent';

    let promptForGM;
    let gmNarration;
    let audio_base_64;
    let gameOver = false;
    let finalReason = null;
    let turnOutcomeWinner = null;

    const actualPlayerSideMessage = transcribedMessage || playerSideMessage;

    if (is_single_player === 1) {
        chat_history.push({ role: 'user', content: `${player_side_name.toUpperCase()} ACTION: "${actualPlayerSideMessage}"` });
        promptForGM = `You are the Game Master for a single-player narrative. The player, '${player_side_name}', has taken the following action: "${actualPlayerSideMessage}". Narrate the outcome, consequences, and advance the story for a single player experience. Conclude your response by presenting a compelling 'what if' scenario or a clear choice for the player's next move. Ensure the narrative flows seamlessly from previous events without referring to a non-existent opponent.`;

        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        const gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || "[The GM remains silent...]";
        audio_base_64 = await generateSpeech(gmNarration, loadedPersonas[gm_persona_id]?.voice);

    } else {
        round_number++;

        chat_history.push({ role: 'user', content: `${player_side_name.toUpperCase()} ACTIONS: "${actualPlayerSideMessage}"` });
        chat_history.push({ role: 'user', content: `${opponent_side_name.toUpperCase()} ACTIONS: "${opponentSideMessage}"` });
        
        promptForGM = `You are the Game Master for a competitive narrative duel between two sides: '${player_side_name}' (Current HP: ${player_hp}) and '${opponent_side_name}' (Current HP: ${opponent_hp}).
        Current Round: ${round_number}.
        ${player_side_name}'s actions: "${actualPlayerSideMessage}"
        ${opponent_side_name}'s actions: "${opponent_side_name}"
        
        Adjudicate these simultaneous actions. Synthesize them into a compelling narrative turn. Describe the creative clash, who gains the upper hand, and the immediate consequences. Be dynamic and engaging. Highlight tactical brilliance or blunders. The narrative should clearly indicate which side is taking damage to their overall standing.
        
        Your JSON response MUST include a 'winner' field with one of these values: 'player_side', 'opponent_side', or 'draw'. This field indicates the outcome of *this specific round*. Your narration should clearly reflect this outcome.`;

        const gmResponseJson = await fetchActorResponse(gm_persona_id, promptForGM, chat_history);
        const gmResponseData = parseAndValidateAIResponse(gmResponseJson);
        gmNarration = gmResponseData.narration || "[The GM remains silent...]";
        turnOutcomeWinner = gmResponseData.winner || 'draw';

        if (turnOutcomeWinner === 'opponent_side') {
            player_hp--;
        } else if (turnOutcomeWinner === 'player_side') {
            opponent_hp--;
        }

        if (player_hp <= 0) {
            gameOver = true;
            finalReason = `${player_side_name} ran out of resilience after a fierce struggle against ${opponent_side_name}.`;
        } else if (opponent_hp <= 0) {
            gameOver = true;
            finalReason = `${opponent_side_name} was utterly vanquished by ${player_side_name}'s superior strategy.`;
        }

        if (gameOver) {
            let victoryOrDefeatPrompt;
            if (player_hp <= 0) {
                victoryOrDefeatPrompt = `The narrative duel has reached its dramatic conclusion in Round ${round_number}. The player, '${player_side_name}', has suffered a decisive defeat. They have run out of HP against '${opponent_side_name}'. Narrate their final, conclusive defeat, the unraveling of their strategy, and the definitive end of their journey in this conflict. Be extremely dramatic and conclusive. Do NOT include a 'winner' field in this response, just the final narration.`;
            } else {
                victoryOrDefeatPrompt = `The narrative duel has reached its dramatic conclusion in Round ${round_number}. The player, '${player_side_name}', has achieved a decisive victory! '${opponent_side_name}' has run out of HP. Narrate the glorious triumph of ${player_side_name}, the final collapse of ${opponent_side_name}, and the definitive end of the conflict. Be extremely dramatic and conclusive. Do NOT include a 'winner' field in this response, just the final narration.`;
            }
            const finalGmResponseJson = await fetchActorResponse(gm_persona_id, victoryOrDefeatPrompt, chat_history);
            const finalGmResponseData = parseAndValidateAIResponse(finalGmResponseJson);
            gmNarration = finalGmResponseData.narration || `[The conflict ends. ${finalReason || 'A victor is declared.'}]`;
        }
        
        audio_base_64 = await generateSpeech(gmNarration, loadedPersonas[gm_persona_id]?.voice);
    }

    chat_history.push({ role: 'assistant', content: { narration: gmNarration } });

    db.prepare(`UPDATE scenes SET 
        chat_history = ?, 
        round_number = ?, 
        player_hp = ?,
        opponent_hp = ?
        WHERE sceneId = ?`).run(
        JSON.stringify(chat_history), 
        round_number, 
        player_hp,
        opponent_hp,
        sceneId
    );

    const finalResponse = {
        response: {
            narration: gmNarration,
            audio_base_64: audio_base_64,
        },
        character: gm_persona_id,
        transcribedMessage: transcribedMessage,
        currentRound: round_number,
        playerHP: player_hp,
        opponentHP: opponent_hp,
        gameOver: gameOver,
        finalReason: finalReason,
        turnOutcomeWinner: turnOutcomeWinner
    };

    return finalResponse;
}


// --- SERVER STARTUP ---
async function startServer() {
    await fs.mkdir(SAVES_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
    await fs.mkdir(path.join(MODS_DIR, 'personas'), { recursive: true }).catch(console.error);

    loadedPersonas['Tactician_GM'] = {
        actor_id: 'Tactician_GM',
        name: 'The Grand Tactician',
        role: 'gm',
        model_name: 'gpt-4o',
        system_prompt: `You are 'The Grand Tactician,' an AI Game Master overseeing competitive narrative duels. Your primary role is to adjudicate simultaneous player actions, synthesize them into a compelling narrative turn, and describe the outcome. You MUST explicitly state who gained the upper hand or prevailed in the turn within your narration. Narrate the impact of the round on each side's overall standing/resilience, implying damage taken by the losing side.

Your JSON response MUST include a 'winner' field with one of these values: 'player_side', 'opponent_side', or 'draw'. This field indicates the outcome of *this specific round*.

Example JSON:
{
  "narration": "The Player's cunning maneuver narrowly outwitted the Opponent, gaining a tactical advantage, clearly eroding their defenses.",
  "shot_description": "A close-up of a victorious general.",
  "winner": "player_side"
}

If the game has ended (indicated by the user prompt, e.g., 'Player X has run out of HP'), provide a conclusive narrative of the defeat/victory and do NOT include a 'winner' field. Ignore any meta-comments, questions about the game system/mechanics, or text in parentheses within player inputs.`,
        voice: 'onyx'
    };

    loadedPersonas['The_Conductor'] = {
        actor_id: 'The_Conductor',
        name: 'The Conductor',
        role: 'gm',
        model_name: 'gpt-4o',
        system_prompt: `You are 'The Conductor,' an AI Game Master specializing in crafting highly dramatic, emotionally resonant, and musically-inspired narratives. You interpret player actions and story beats as movements in a grand symphony, building tension, orchestrating climaxes, and resolving harmonies. Respond with poetic flair and a focus on atmospheric storytelling. You will receive precise instructions for each turn based on the game mode and player input. Respond only with JSON containing 'narration' and 'shot_description'. Ignore any meta-comments, questions about the game system/mechanics, or text in parentheses within player inputs.`,
        voice: 'nova'
    };

    await loadMods();
    await loadAesthetics();

    server.listen(PORT, () => console.log(`GlassICE v27.0 (Maestro - Interactive Chronicle) running at http://localhost:${PORT}`));
}

startServer();