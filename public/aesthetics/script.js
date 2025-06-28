--- START OF FILE script.js ---

document.addEventListener('DOMContentLoaded', async () => {
    const API_URL = "";
    const ACTION_POINTS_PER_TURN = 3;
    let gameState = { currentSceneId: null, playerSideName: 'Player', opponentSideName: 'Opponent', gameMode: 'sandbox', gameOver: false, isVsAI: false, playerEffects: [], opponentEffects: [], artStyle: 'Cinematic Realism', faction1Visuals: '', faction2Visuals: '' };
    const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map(el => [el.id.replace(/-(\w)/g, (m, p) => p.toUpperCase()), el]));
    const allScreens = document.querySelectorAll('.screen');
    const showScreen = (screenId) => { allScreens.forEach(screen => { if (screen.id === screenId) { screen.classList.add('active'); screen.classList.remove('hidden'); } else { screen.classList.remove('active'); screen.classList.add('hidden'); } }); };
    const fetchAPI = async (endpoint, options = {}) => { const response = await fetch(`${API_URL}${endpoint}`, options); if (!response.ok) { const errorData = await response.json().catch(() => ({ error: `HTTP Error: ${response.status}` })); throw new Error(errorData.error || `HTTP Error: ${response.status}`); } return response.json(); };
    
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let audioContext;
    let currentAudioSource = null;

    // --- NEW: More descriptive loading text ---
    const setLoading = (isLoading, text = 'Loading...') => {
        ui.loadingOverlay.classList.toggle('hidden', !isLoading);
        if (isLoading) {
            ui.loaderTextRpg.textContent = text;
        }
    };

    // --- NEW: Typewriter effect for narration ---
    const addLog = (text, speaker, styleClass = '') => {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'log-entry';
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
        
        const speakerElement = `<strong class="${styleClass}">${speaker}</strong>`;
        const contentSpan = document.createElement('span');
        
        entryDiv.innerHTML = speakerElement;
        entryDiv.appendChild(contentSpan);
        ui.chatLogRpg.appendChild(entryDiv);
    
        if (speaker === 'Director' && formattedText.length > 0) {
            let i = 0;
            contentSpan.innerHTML = '';
            const typeWriter = () => {
                if (i < formattedText.length) {
                    if (formattedText.charAt(i) === '<') {
                        const tagEnd = formattedText.indexOf('>', i);
                        contentSpan.innerHTML += formattedText.substring(i, tagEnd + 1);
                        i = tagEnd;
                    } else {
                        contentSpan.innerHTML += formattedText.charAt(i);
                    }
                    i++;
                    ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight;
                    setTimeout(typeWriter, 25); // Adjust typing speed here
                }
            };
            typeWriter();
        } else {
            contentSpan.innerHTML = formattedText;
            ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight;
        }
    };

    const updateBackgroundImage = (imageB64) => { const body = document.body; ui.saveImageBtn.disabled = !imageB64; if (imageB64) { body.style.backgroundImage = `url(data:image/jpeg;base64,${imageB64})`; body.classList.add('image-cover'); ui.saveImageBtn.onclick = () => { const link = document.createElement('a'); link.href = `data:image/jpeg;base64,${imageB64}`; link.download = `glassice-chronicle-${Date.now()}.jpg`; link.click(); }; } else { body.style.backgroundImage = ''; body.classList.remove('image-cover'); ui.saveImageBtn.onclick = null; } };
    const playAudio = async (b64) => { if (currentAudioSource) { currentAudioSource.stop(); } if (!audioContext || !b64) { return; } try { const audioData = atob(b64); const aBuffer = new Uint8Array(audioData.length); for(let i=0; i < audioData.length; i++) { aBuffer[i] = audioData.charCodeAt(i); } const decodedBuffer = await audioContext.decodeAudioData(aBuffer.buffer); currentAudioSource = audioContext.createBufferSource(); currentAudioSource.buffer = decodedBuffer; currentAudioSource.connect(audioContext.destination); currentAudioSource.start(0); } catch (error) { console.error("Failed to decode or play audio:", error); addLog("Could not play narrator audio.", "SYSTEM ERROR", "system-error"); } };
    
    // --- NEW: Status Effect Tooltips ---
    const updateStatusEffects = (playerEffects, opponentEffects) => {
        const statusEffectDescriptions = {
            "Burning": "Takes 5 damage at the start of the turn.",
            "Stunned": "Cannot perform actions this turn.",
            "Suppressed": "Actions cost 1 additional AP.",
            "Exposed": "Takes 50% more damage from attacks.",
            "Guarded": "Takes 50% less damage from attacks."
        };

        const renderEffects = (container, effects) => {
            container.innerHTML = '';
            if (effects && effects.length > 0) {
                effects.forEach(effect => {
                    const effectDiv = document.createElement('div');
                    effectDiv.className = 'status-effect debuff';
                    effectDiv.innerHTML = `${effect.name} <span class="duration">${effect.duration}</span>`;
                    effectDiv.title = statusEffectDescriptions[effect.name] || `Effect: ${effect.name}. No description available.`;
                    container.appendChild(effectDiv);
                });
            }
        };
        renderEffects(ui.playerEffectsContainer, playerEffects);
        renderEffects(ui.opponentEffectsContainer, opponentEffects);
    };

    const updateHealthDisplay = (playerHP, opponentHP) => { ui.healthPlayerName.textContent = gameState.playerSideName; ui.healthOpponentName.textContent = gameState.opponentSideName; ui.healthPlayerBar.style.width = `${playerHP}%`; ui.healthOpponentBar.style.width = `${opponentHP}%`; ui.healthStatusBar.classList.toggle('hidden', gameState.gameMode !== 'competitive'); };
    const debounce = (func, delay) => { let timeout; return function(...args) { const context = this; clearTimeout(timeout); timeout = setTimeout(() => func.apply(context, args), delay); }; };
    const updateTotalCosts = () => { ['faction1', 'faction2'].forEach(factionId => { const column = document.getElementById(`${factionId}-column`); if (!column) return; const actionItems = column.querySelectorAll('.action-item'); let totalCost = 0; actionItems.forEach(item => { const costText = item.querySelector('.action-cost').textContent; const costMatch = costText.match(/(\d+)/); if (costMatch) totalCost += parseInt(costMatch[1], 10); }); const totalAPDisplay = column.querySelector('.total-ap-display'); totalAPDisplay.textContent = `Total AP: ${totalCost} / ${ACTION_POINTS_PER_TURN}`; totalAPDisplay.classList.toggle('over-limit', totalCost > ACTION_POINTS_PER_TURN); }); const p1Over = document.getElementById('faction1-ap-total')?.classList.contains('over-limit'); const p2Over = document.getElementById('faction2-ap-total')?.classList.contains('over-limit'); ui.submitTurnBtn.disabled = p1Over || p2Over || false; };
    const analyzeAndDisplayCost = async (textarea) => { const actionText = textarea.value.trim(); const costDisplay = textarea.closest('.action-item').parentElement.querySelector('.action-cost'); if (!costDisplay) return; if (actionText.length < 5) { costDisplay.textContent = 'Cost: 1'; updateTotalCosts(); return; } costDisplay.textContent = 'Analyzing...'; try { const result = await fetchAPI('/api/analyze-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: actionText }) }); costDisplay.textContent = `Cost: ${result.cost}`; } catch (e) { console.error("Action cost analysis failed:", e); costDisplay.textContent = 'Cost: Error'; } updateTotalCosts(); };
    const createActionItem = (factionId) => { const actionItem = document.createElement('div'); actionItem.className = 'action-item'; const textareaId = `${factionId}-action-${Date.now()}`; actionItem.innerHTML = `
            <textarea id="${textareaId}" placeholder="Describe an action..."></textarea>
            <button type="button" class="remove-action-btn" title="Remove Action">X</button>
        `; const metaDiv = document.createElement('div'); metaDiv.className = 'action-meta'; metaDiv.innerHTML = `<div class="action-cost">Cost: 1</div>`; const wrapper = document.createElement('div'); wrapper.appendChild(actionItem); wrapper.appendChild(metaDiv); actionItem.querySelector('textarea').addEventListener('input', debounce((e) => analyzeAndDisplayCost(e.target), 800)); actionItem.querySelector('.remove-action-btn').addEventListener('click', (e) => { e.target.closest('.action-item').parentElement.remove(); updateTotalCosts(); }); return wrapper; };
    const setupInputUI = (mode) => { const container = ui.inputFieldsContainer; container.innerHTML = ''; if (mode === 'competitive') { const playerColumnHTML = `
                <div class="input-column" id="faction1-column">
                    <div class="input-column-header">
                        <label class="faction1">${gameState.playerSideName}</label>
                        <div class="total-ap-display" id="faction1-ap-total">Total AP: 1 / ${ACTION_POINTS_PER_TURN}</div>
                    </div>
                    <div id="faction1-actions-list"></div>
                    <button type="button" class="add-action-btn" data-faction="faction1">+ Add Action</button>
                </div>`; if (gameState.isVsAI) { ui.turnStatus.textContent = `Turn Start: Your Actions vs. ${gameState.opponentSideName}`; container.innerHTML = playerColumnHTML; } else { ui.turnStatus.textContent = `Turn Start: Input Actions`; const opponentColumnHTML = `
                    <div class="input-column" id="faction2-column">
                        <div class="input-column-header">
                            <label class="faction2">${gameState.opponentSideName}</label>
                            <div class="total-ap-display" id="faction2-ap-total">Total AP: 1 / ${ACTION_POINTS_PER_TURN}</div>
                        </div>
                        <div id="faction2-actions-list"></div>
                        <button type="button" class="add-action-btn" data-faction="faction2">+ Add Action</button>
                    </div>`; container.innerHTML = playerColumnHTML + opponentColumnHTML; } document.getElementById('faction1-actions-list').appendChild(createActionItem('faction1')); if (document.getElementById('faction2-actions-list')) { document.getElementById('faction2-actions-list').appendChild(createActionItem('faction2')); } container.querySelectorAll('.add-action-btn').forEach(btn => { btn.addEventListener('click', (e) => { const factionId = e.target.dataset.faction; document.getElementById(`${factionId}-actions-list`).appendChild(createActionItem(factionId)); updateTotalCosts(); }); }); } else { ui.turnStatus.textContent = `Narrative Mode`; container.innerHTML = `<div class="input-column" style="max-width: 600px; margin: auto;"><textarea id="sandbox-input" placeholder="What happens next?"></textarea></div>`; container.querySelector('textarea').style.height = '120px'; } };
    const updateUIFromState = (data) => { if (data.switchedToVsAI) { gameState.isVsAI = true; addLog(`The situation has escalated! You are now in combat with ${data.opponentSideName}.`, "SYSTEM INFO", "system-info"); } Object.assign(gameState, data); updateHealthDisplay(gameState.playerHP, gameState.opponentHP); updateStatusEffects(gameState.playerEffects, gameState.opponentEffects); setupInputUI(gameState.gameMode); if(data.response) { updateBackgroundImage(data.response.image_b_64); if(data.response.narration) addLog(data.response.narration, 'Director'); if (data.response.turn_summary) { addLog(data.response.turn_summary, 'Tactical Summary', 'system-info'); } playAudio(data.response.audio_base_64); } if (gameState.gameOver) { ui.turnStatus.textContent = "CHRONICLE CONCLUDED"; ui.submitTurnBtn.disabled = true; } };
    const startChronicle = async (body, endpoint = '/api/dynamic-narrative/start') => { gameState.isVsAI = (body.gameMode === 'competitive' && !body.opponentSideName); setLoading(true, "Generating opening scene & first image..."); try { const data = await fetchAPI(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); showScreen('genesis-screen'); updateUIFromState(data); } catch (e) { alert("Failed to start chronicle: " + e.message); } finally { setLoading(false); if(ui.startBtnRpg) ui.startBtnRpg.disabled = false; if(ui.startQuickplayBtn) ui.startQuickplayBtn.disabled = false; } };
    const submitTurn = async () => { let payload = {}; if (gameState.gameMode === 'competitive') { const getActions = (factionId) => Array.from(document.querySelectorAll(`#${factionId}-column textarea`)).map(ta => ta.value.trim()).filter(Boolean); const playerActions = getActions('faction1'); if (playerActions.length === 0) return alert('Please enter at least one action for your faction.'); payload.playerActions = playerActions; if (!gameState.isVsAI) { const opponentActions = getActions('faction2'); if (opponentActions.length === 0) return alert('Please enter at least one action for the opposing faction.'); payload.opponentActions = opponentActions; } } else { const action = document.getElementById('sandbox-input').value.trim(); if (!action) return alert('Please describe what happens next.'); payload = { playerAction: action }; } ui.submitTurnBtn.disabled = true; setLoading(true, `Resolving Turn... ${gameState.isVsAI ? '(Awaiting AI response...)' : ''}`); document.querySelectorAll('#input-fields-container textarea').forEach(ta => ta.disabled = true); try { const data = await fetchAPI(`/api/dynamic-narrative/${gameState.currentSceneId}/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); updateUIFromState(data); } catch (e) { addLog(`Error resolving turn: ${e.message}`, 'SYSTEM ERROR', 'system-error'); if (!gameState.gameOver) { document.querySelectorAll('#input-fields-container textarea').forEach(ta => { ta.disabled = false; }); ui.submitTurnBtn.disabled = false; } } finally { setLoading(false); } };
    const prepareCustomSandbox = () => { const body = { gameSettingPrompt: ui.promptRpg.value.trim(), playerSideName: ui.playerSideNameInput.value.trim() || 'Player', gameMode: 'sandbox', artStyle: document.getElementById('art-style-selector').value, faction1Visuals: ui.faction1VisualsInput.value.trim() }; if (!body.gameSettingPrompt) return alert("Please describe the setting."); startChronicle(body); };
    const prepareCustomCompetitive = () => { const body = { gameSettingPrompt: `--- SHARED SETTING ---\n${ui.promptRpg.value.trim()}`, playerSideName: ui.playerSideNameInput.value.trim() || 'Faction 1', opponentSideName: ui.opponentSideNameInput.value.trim() || 'Faction 2', gameMode: 'competitive', artStyle: document.getElementById('art-style-selector').value, faction1Visuals: ui.faction1VisualsInput.value.trim(), faction2Visuals: ui.faction2VisualsInput.value.trim() }; if (!body.gameSettingPrompt || !body.playerSideName || !body.opponentSideName) return alert("Please complete all description fields for competitive mode."); startChronicle(body); };
    const loadSpecificGame = async (sceneId) => { setLoading(true, "Loading Chronicle..."); try { const data = await fetchAPI(`/api/chronicles/${sceneId}`); showScreen('genesis-screen'); updateUIFromState(data); } catch (e) { alert("Failed to load chronicle: " + e.message); showScreen('hub-screen'); } finally { setLoading(false); } };
    const showLoadGameModal = async () => { showScreen('load-game-modal'); const loadList = ui.loadGameList; loadList.innerHTML = '<p>Fetching saved chronicles...</p>'; try { const chronicles = await fetchAPI('/api/chronicles'); loadList.innerHTML = ''; if (chronicles.length === 0) { loadList.innerHTML = '<p>No saved chronicles found.</p>'; return; } chronicles.forEach(chronicle => { const btn = document.createElement('button'); btn.innerHTML = `${chronicle.playerSideName} <span>vs ${chronicle.opponentSideName}</span>`; btn.onclick = () => loadSpecificGame(chronicle.sceneId); loadList.appendChild(btn); }); } catch (e) { loadList.innerHTML = `<p class="system-error">Error fetching chronicles: ${e.message}</p>`; } };
    const setupUIEnhancements = () => { ui.hidePanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.add('input-overlay--hidden'); ui.showPanelBtn.classList.remove('hidden'); }); ui.showPanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.remove('input-overlay--hidden'); ui.showPanelBtn.classList.add('hidden'); }); };
    const setupCreationScreen = (mode) => { const isSandbox = mode === 'sandbox'; showScreen('creation-screen-rpg'); ui.modeTitle.textContent = isSandbox ? "Custom Sandbox Setup" : "Custom Competitive Setup"; const competitiveFields = [ui.opponentSideNameFormGroup, ui.faction2VisualsGroup]; competitiveFields.forEach(field => field.classList.toggle('hidden', isSandbox)); };
    const initializePushToTalk = async () => { if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { console.warn("PTT is not supported on this browser."); ui.pttBtn.disabled = true; return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaRecorder = new MediaRecorder(stream); mediaRecorder.ondataavailable = event => { audioChunks.push(event.data); }; mediaRecorder.onstop = async () => { setLoading(true, "Transcribing speech..."); const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); audioChunks = []; const reader = new FileReader(); reader.readAsDataURL(audioBlob); reader.onloadend = async () => { const audioB64 = reader.result; try { const response = await fetchAPI('/api/transcribe-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioB64 }) }); const activeTextarea = document.querySelector('#faction1-actions-list textarea:last-of-type') || document.getElementById('sandbox-input'); if (activeTextarea) { activeTextarea.value = response.transcription; activeTextarea.dispatchEvent(new Event('input', { bubbles: true })); } } catch (e) { addLog(`Speech-to-text failed: ${e.message}`, 'SYSTEM ERROR', 'system-error'); } finally { setLoading(false); } }; }; ui.pttBtn.disabled = false; } catch (err) { addLog("Microphone access denied. PTT is disabled.", "SYSTEM ERROR", "system-error"); console.error("Mic permissions failed:", err); ui.pttBtn.disabled = true; } };
    const prepareQuickplay = () => { const prompt = ui.quickplayPrompt.value.trim(); if (!prompt) return alert("Please enter your idea for the chronicle."); ui.startQuickplayBtn.disabled = true; const body = { prompt: prompt, artStyle: ui.quickplayArtStyleSelector.value, gameMode: ui.quickplayGameModeSelector.value }; startChronicle(body, '/api/quickplay/start'); };

    // --- NEW: Visual Art Style Selector Setup ---
    const artStyles = [
        { name: "Cinematic Realism", img: "images/style_cinematic.jpg" },
        { name: "Epic Fantasy Painting", img: "images/style_fantasy.jpg" },
        { name: "Gritty Anime Style", img: "images/style_anime.jpg" },
        { name: "Cyberpunk Concept Art", img: "images/style_cyberpunk.jpg" },
        { name: "Vintage Comic Book", img: "images/style_comic.jpg" },
        { name: "Dark Film Noir", img: "images/style_noir.jpg" }
    ];

    const setupArtStyleSelectors = () => {
        const grids = {
            'quickplay-art-style-grid': ui.quickplayArtStyleSelector,
            'art-style-grid': ui.artStyleSelector
        };

        for (const gridId in grids) {
            const grid = document.getElementById(gridId);
            const input = grids[gridId];
            if (!grid || !input) continue;

            grid.innerHTML = '';
            artStyles.forEach(style => {
                const card = document.createElement('div');
                card.className = 'style-card';
                card.dataset.value = style.name;
                card.innerHTML = `<img src="${style.img}" alt="${style.name} preview"><div class="style-name">${style.name}</div>`;
                if (style.name === input.value) {
                    card.classList.add('selected');
                }
                card.addEventListener('click', () => {
                    grid.querySelectorAll('.style-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    input.value = style.name;
                });
                grid.appendChild(card);
            });
        }
    };

    try {
        ui.enableAudioBtn.addEventListener('click', () => { if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); if (audioContext.state === 'suspended') { audioContext.resume(); } } showScreen('hub-screen'); });
        ui.launchQuickplayBtn.addEventListener('click', () => showScreen('quickplay-screen'));
        ui.launchSandboxBtn.addEventListener('click', () => setupCreationScreen('sandbox'));
        ui.launchCompetitiveBtn.addEventListener('click', () => setupCreationScreen('competitive'));
        ui.loadChronicleBtn.addEventListener('click', showLoadGameModal);
        ui.startQuickplayBtn.addEventListener('click', prepareQuickplay);
        ui.backToHubBtnQuickplay.addEventListener('click', () => showScreen('hub-screen'));
        ui.startBtnRpg.addEventListener('click', () => { ui.startBtnRpg.disabled = true; const isSandbox = ui.modeTitle.textContent.includes('Sandbox'); if (isSandbox) { prepareCustomSandbox(); } else { prepareCustomCompetitive(); } });
        ui.backToHubBtnCustom.addEventListener('click', () => showScreen('hub-screen'));
        ui.closeLoadModalBtn.addEventListener('click', () => showScreen('hub-screen'));
        ui.chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (!gameState.gameOver) { submitTurn(); } });
        ui.pttBtn.addEventListener('mousedown', () => { if (mediaRecorder && !isRecording) { isRecording = true; mediaRecorder.start(); ui.pttBtn.classList.add('is-recording'); } });
        ui.pttBtn.addEventListener('mouseup', () => { if (mediaRecorder && isRecording) { isRecording = false; mediaRecorder.stop(); ui.pttBtn.classList.remove('is-recording'); } });
        ui.pttBtn.addEventListener('mouseleave', () => { if (mediaRecorder && isRecording) { isRecording = false; mediaRecorder.stop(); ui.pttBtn.classList.remove('is-recording'); } });
        
        setupUIEnhancements();
        initializePushToTalk();
        setupArtStyleSelectors(); // Initialize the new visual selectors

    } catch(e) {
        alert("Could not connect to the GlassICE server. Please ensure the server is running and refresh the page.");
        console.error("Initialization failed:", e);
    }
});