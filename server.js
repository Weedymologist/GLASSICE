// server.js - v35.0 (Simultaneous Action Referee)

const express = require('express');
const cors = require('cors');
const dotenv =require('dotenv');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const PORT = process.env.PORT || 3001;

const activeScenesFilePath = path.join(__dirname, 'active_scenes.json');

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
    return {};
}

let activeScenes = loadScenesFromDisk();

// --- MODIFIED: The AI Referee is now a true impartial judge of two actions ---
async function resolveSimultaneousTurn(history, action1, faction1Name, action2, faction2Name, faction1Effects, faction2Effects) {
    console.log(`[AI-REFEREE] Resolving clash between ${faction1Name} and ${faction2Name}`);
    const system_prompt = `You are a master Wargame Referee and Storyteller AI. You are impartial, creative, and tactical.
Your task is to resolve a turn where two opposing factions, Faction 1 and Faction 2, have submitted their actions simultaneously. Neither knows what the other is doing until the moment of action.

CORE LOGIC:
1.  **Synthesize Actions:** Read both actions. The core of your task is to determine what happens when they intersect. Does one action preempt or cancel the other? Do they happen at the same time? Does one action completely blindside the other?
2.  **Determine Initiative & Causality:** Who acts first? A sniper shot is faster than setting up a mortar. An ambush, if undetected, strikes before the target can react. If Faction 1's action is 'take cover' and Faction 2's is 'throw a grenade at their position', the grenade lands while they are diving for cover.
3.  **Narrate the Clash:** Write a single, cinematic, third-person narration describing the combined result of the two actions. Start by describing the intentions, then the clash, then the outcome. Make it exciting.
4.  **Assign Consequences:** Based on the narrative outcome, assign HP damage and status effects. A successful ambush should be devastating. If both factions charge each other, they will both take damage. An action that is perfectly countered might result in no damage but a tactical advantage for the counter-attacker.
5.  **Consider Context:** Use the entire battle history to inform your decisions about the environment, troop morale, and established strategies. Use active status effects to modify outcomes (e.g., a 'Suppressed' faction's action will be less effective).

You MUST respond with a single JSON object with the following keys:
- "narration": (string) The single, combined story of the turn's events.
- "turn_summary": (string) A brief, clinical summary of the tactical outcome.
- "faction1_hp_change": (number) Damage to Faction 1. Negative integer or 0.
- "faction2_hp_change": (number) Damage to Faction 2. Negative integer or 0.
- "game_over": (boolean) Set to true only if one side's HP is decisively reduced to zero or below.
- "status_effects_applied": (array) An array of NEW status effect objects applied this turn. Example: { "target": "faction1" or "faction2", "name": "EffectName", "duration": number }. Common effects: 'In-Cover', 'Suppressed', 'Flanked', 'On-Fire', 'Bleeding', 'Inspired', 'Stunned'. Must be an empty array [] if no new effects.`;

    const turnPrompt = `
BATTLE STATE:
- Faction 1 (${faction1Name}) Status: ${faction1Effects.length > 0 ? faction1Effects.map(e => e.name).join(', ') : 'Normal'}
- Faction 2 (${faction2Name}) Status: ${faction2Effects.length > 0 ? faction2Effects.map(e => e.name).join(', ') : 'Normal'}

SIMULTANEOUS ACTIONS:
- Faction 1's Action: "${action1}"
- Faction 2's Action: "${action2}"

Resolve the turn.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { "role": "system", "content": system_prompt },
              ...history,
              { "role": "user", "content": turnPrompt }
            ],
            response_format: { type: "json_object" },
        });
        const response = JSON.parse(completion.choices[0].message.content);
        // Basic validation
        if (!response.narration || response.faction1_hp_change === undefined || response.faction2_hp_change === undefined) {
            throw new Error("AI Referee response was malformed.");
        }
        return response;
    } catch (error) {
        console.error("[AI-REFEREE ERROR]", error);
        throw new Error("The AI Referee failed to resolve the turn.");
    }
}


// (Other AI helpers and boilerplate code remain the same)
async function checkForConflict(narration) { console.log("[AI-ARBITER] Checking for conflict..."); const system_prompt = `You are an impartial Event Arbiter in a text-based RPG. Your sole task is to read a piece of narrative text and determine if a direct, unavoidable conflict has just begun. A conflict requires a clear threat and hostile intent. Simple tension or the presence of weapons is NOT a conflict. An attack being launched IS a conflict. You MUST respond ONLY with a single JSON object with the following keys: - "is_conflict": (boolean) true if a fight has just started, otherwise false. - "opponent_name": (string) If is_conflict is true, give a short, descriptive name for the opposition (e.g., "Tavern Brawlers", "City Guards", "Alpha Wolf"). If false, this should be an empty string "". - "reason": (string) A brief explanation for your decision.`; try { const completion = await openai.chat.completions.create({ model: "gpt-4o", messages: [ { "role": "system", content: system_prompt }, { "role": "user", content: narration } ], response_format: { type: "json_object" }, }); const response = JSON.parse(completion.choices[0].message.content); console.log(`[AI-ARBITER] Decision: ${response.reason}`); return response; } catch (error) { console.error("[AI-ARBITER ERROR]", error); return { is_conflict: false, opponent_name: "", reason: "Arbiter AI failed." }; } }
async function fetchNarration(prompt, history = []) { const system_prompt = `You are a master storyteller and game master. Continue the story based on the user's action. Your response must be a single JSON object with one key: "narration".`; try { const completion = await openai.chat.completions.create({ model: "gpt-4o", messages: [ ...history, { role: "user", content: prompt } ], response_format: { type: "json_object" }, }); return JSON.parse(completion.choices[0].message.content).narration; } catch (error) { console.error("[AI-NARRATOR ERROR]", error); throw new Error("The AI Director failed to respond."); } }
async function generateShotDescription(narration) { const system_prompt = `You are a master Art Director. You will receive a piece of narrative text. Your sole purpose is to convert this text into a single, vivid, and detailed 'shot_description' suitable for a text-to-image AI like Stable Diffusion. Focus on visual elements: subject, composition, lighting, environment, mood, and art style. Your response MUST be a single JSON object with one key: "shot_description".`; try { const completion = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: system_prompt }, { role: "user", content: narration }], response_format: { type: "json_object" }, }); return JSON.parse(completion.choices[0].message.content).shot_description; } catch (error) { console.error("[AI-ARTIST ERROR]", error); throw new Error("The AI Art Director failed to respond."); } }
async function generateImage(shotDescription) { if (!shotDescription || !STABILITY_API_KEY) { return null; } const formData = new FormData(); formData.append('prompt', shotDescription); formData.append('aspect_ratio', '16:9'); try { const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", { method: 'POST', headers: { ...formData.getHeaders(), "authorization": `Bearer ${STABILITY_API_KEY}`, "accept": "image/*" }, body: formData, }); if (!response.ok) { throw new Error(`Stability AI Error: ${response.status} ${await response.text()}`); } return (await response.buffer()).toString('base64'); } catch (error) { console.error("[IMAGE] Stable Diffusion generation failed:", error.message); return null; } }
async function generateAudio(text) { if (!text || !process.env.OPENAI_API_KEY) { return null; } try { const mp3 = await openai.audio.speech.create({ model: "tts-1", voice: "alloy", input: text, }); return Buffer.from(await mp3.arrayBuffer()).toString('base64'); } catch (error) { console.error("[AUDIO] OpenAI TTS generation failed:", error); return null; } }

// --- Endpoints ---
app.get('/api/personas', (req, res) => res.json([{ actor_id: 'The_Conductor', name: 'The Conductor', role: 'gm' }, { actor_id: 'Tactician_GM', name: 'The Tactician', role: 'gm' }]));

app.post('/api/dynamic-narrative/start', async (req, res) => {
    const { gameSettingPrompt, playerSideName, opponentSideName, gameMode } = req.body;
    const sceneId = `scene_${Date.now()}`;
    try {
        const narration = await fetchNarration(gameSettingPrompt);
        const [shotDescription, audioB64] = await Promise.all([generateShotDescription(narration), generateAudio(narration)]);
        const imageB64 = await generateImage(shotDescription);
        activeScenes[sceneId] = { history: [{ role: 'system', content: 'The scene begins.' }, { role: 'assistant', content: narration }], playerSideName, opponentSideName, gameMode, playerHP: 100, opponentHP: 100, playerEffects: [], opponentEffects: [] };
        res.status(201).json({ currentSceneId: sceneId, response: { narration, shot_description: shotDescription, image_b64: imageB64, audio_base_64: audioB64 }, ...activeScenes[sceneId] });
        saveScenesToDisk();
    } catch (error) {
        console.error("[START ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});

// --- MODIFIED: The /turn endpoint now handles sandbox vs. the new simul-action competitive mode ---
app.post('/api/dynamic-narrative/:sceneId/turn', async (req, res) => {
    const { sceneId } = req.params;
    const scene = activeScenes[sceneId];
    if (!scene) return res.status(404).json({ error: "Scene not found." });

    try {
        let responsePayload = {};
        if (scene.gameMode === 'competitive') {
            const { playerAction, opponentAction } = req.body;
            if (!playerAction || !opponentAction) return res.status(400).json({ error: "Actions for both factions are required." });
            
            // --- SIMULTANEOUS ACTION LOGIC ---
            const combatResult = await resolveSimultaneousTurn(scene.history, playerAction, scene.playerSideName, opponentAction, scene.opponentSideName, scene.playerEffects, scene.opponentEffects);
            
            // Update state based on new key names from AI
            scene.playerHP = Math.max(0, scene.playerHP + (combatResult.faction1_hp_change || 0));
            scene.opponentHP = Math.max(0, scene.opponentHP + (combatResult.faction2_hp_change || 0));

            // Status effect logic
            if (combatResult.status_effects_applied) {
                combatResult.status_effects_applied.forEach(effect => {
                    if (effect.target === 'faction1') scene.playerEffects.push(effect);
                    else if (effect.target === 'faction2') scene.opponentEffects.push(effect);
                });
            }
            scene.playerEffects.forEach(e => e.duration--);
            scene.opponentEffects.forEach(e => e.duration--);
            scene.playerEffects = scene.playerEffects.filter(e => e.duration > 0);
            scene.opponentEffects = scene.opponentEffects.filter(e => e.duration > 0);
            
            const turnSummaryForHistory = `Actions-> ${scene.playerSideName}: ${playerAction} | ${scene.opponentSideName}: ${opponentAction}`;
            scene.history.push({ role: 'user', content: turnSummaryForHistory }, { role: 'assistant', content: combatResult.narration });
            
            const [shot, audio] = await Promise.all([generateShotDescription(combatResult.narration), generateAudio(combatResult.narration)]);
            const image = await generateImage(shot);
            
            let gameOver = combatResult.game_over || scene.playerHP <= 0 || scene.opponentHP <= 0;
            responsePayload = { response: { narration: combatResult.narration, turn_summary: combatResult.turn_summary, shot_description: shot, image_b64: image, audio_base_64: audio }, ...scene, gameOver };

        } else {
            // --- SANDBOX MODE LOGIC (Unchanged) ---
            const { playerAction } = req.body;
            if (!playerAction) return res.status(400).json({ error: "Player action is required." });

            const newNarration = await fetchNarration(playerAction, scene.history);
            scene.history.push({ role: 'user', content: playerAction }, { role: 'assistant', content: newNarration });
            const arbiterResult = await checkForConflict(newNarration);
            let finalNarration = newNarration;
            if (arbiterResult.is_conflict) {
                scene.gameMode = 'competitive';
                scene.opponentSideName = arbiterResult.opponent_name;
                finalNarration += `\n\n**Conflict! You are now facing the ${arbiterResult.opponent_name}.**`;
            }
            const [shot, audio] = await Promise.all([generateShotDescription(finalNarration), generateAudio(finalNarration)]);
            const image = await generateImage(shot);
            responsePayload = { response: { narration: finalNarration, shot_description: shot, image_b64: image, audio_base_64: audio }, ...scene };
        }
        res.json(responsePayload);
        saveScenesToDisk();
    } catch (error) {
        console.error("[TURN ERROR]", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/chronicles', (req, res) => { const summary = Object.keys(activeScenes).map(sceneId => { const scene = activeScenes[sceneId]; return { sceneId, playerSideName: scene.playerSideName, opponentSideName: scene.opponentSideName, gameMode: scene.gameMode }; }); res.json(summary); });
app.get('/api/chronicles/:sceneId', (req, res) => { const { sceneId } = req.params; const sceneData = activeScenes[sceneId]; if (sceneData) res.json(sceneData); else res.status(404).json({ error: 'Chronicle not found.' }); });

app.listen(PORT, () => { console.log(`GlassICE server running on port ${PORT}`); if (!process.env.OPENAI_API_KEY) console.warn("WARNING: OPENAI_API_KEY is not set."); if (!STABILITY_API_KEY) console.warn("WARNING: STABILITY_API_KEY is not set."); });