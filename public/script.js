document.addEventListener('DOMContentLoaded', async () => {
    const API_URL = "";
    let gameState = { currentSceneId: null, playerSideName: 'Player', opponentSideName: 'Opponent', gameMode: 'sandbox', gameOver: false, playerEffects: [], opponentEffects: [], artStyle: 'Cinematic Realism', faction1Visuals: '', faction2Visuals: '' };
    const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map(el => [el.id.replace(/-(\w)/g, (m, p) => p.toUpperCase()), el]));
    const allScreens = document.querySelectorAll('.screen');
    const showScreen = (screenId) => { allScreens.forEach(screen => { if (screen.id === screenId) { screen.classList.add('active'); screen.classList.remove('hidden'); } else { screen.classList.remove('active'); screen.classList.add('hidden'); } }); };
    const fetchAPI = async (endpoint, options = {}) => { const response = await fetch(`${API_URL}${endpoint}`, options); if (!response.ok) { const errorData = await response.json().catch(() => ({ error: `HTTP Error: ${response.status}` })); throw new Error(errorData.error || `HTTP Error: ${response.status}`); } return response.json(); };
    
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let audioContext;
    let currentAudioSource = null;

    const setLoading = (isLoading, text = 'Loading...') => { ui.loadingOverlay.classList.toggle('hidden', !isLoading); if (isLoading) { ui.loaderTextRpg.textContent = text; } };
    const addLog = (text, speaker, styleClass = '') => { const entryDiv = document.createElement('div'); entryDiv.className = 'log-entry'; const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); entryDiv.innerHTML = `<strong class="${styleClass}">${speaker}</strong><span>${formattedText}</span>`; ui.chatLogRpg.appendChild(entryDiv); ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight; };
    const updateBackgroundImage = (imageB64) => { const body = document.body; ui.saveImageBtn.disabled = !imageB64; if (imageB64) { body.style.backgroundImage = `url(data:image/jpeg;base64,${imageB64})`; body.classList.add('image-cover'); ui.saveImageBtn.onclick = () => { const link = document.createElement('a'); link.href = `data:image/jpeg;base64,${imageB64}`; link.download = `glassice-chronicle-${Date.now()}.jpg`; link.click(); }; } else { body.style.backgroundImage = ''; body.classList.remove('image-cover'); ui.saveImageBtn.onclick = null; } };
    const playAudio = async (b64) => { if (currentAudioSource) { currentAudioSource.stop(); } if (!audioContext || !b64) { return; } try { const audioData = atob(b64); const aBuffer = new Uint8Array(audioData.length); for(let i=0; i < audioData.length; i++) { aBuffer[i] = audioData.charCodeAt(i); } const decodedBuffer = await audioContext.decodeAudioData(aBuffer.buffer); currentAudioSource = audioContext.createBufferSource(); currentAudioSource.buffer = decodedBuffer; currentAudioSource.connect(audioContext.destination); currentAudioSource.start(0); } catch (error) { console.error("Failed to decode or play audio:", error); addLog("Could not play narrator audio.", "SYSTEM ERROR", "system-error"); } };
    const updateStatusEffects = (playerEffects, opponentEffects) => { const renderEffects = (container, effects) => { container.innerHTML = ''; if (effects && effects.length > 0) { effects.forEach(effect => { const effectDiv = document.createElement('div'); effectDiv.className = 'status-effect debuff'; effectDiv.innerHTML = `${effect.name} <span class="duration">${effect.duration}</span>`; container.appendChild(effectDiv); }); } }; renderEffects(ui.playerEffectsContainer, playerEffects); renderEffects(ui.opponentEffectsContainer, opponentEffects); };
    const updateHealthDisplay = (playerHP, opponentHP) => { ui.healthPlayerName.textContent = gameState.playerSideName; ui.healthOpponentName.textContent = gameState.opponentSideName; ui.healthPlayerBar.style.width = `${playerHP}%`; ui.healthOpponentBar.style.width = `${opponentHP}%`; ui.healthStatusBar.classList.toggle('hidden', gameState.gameMode !== 'competitive'); };

    const setupInputUI = (mode) => {
        const container = ui.inputFieldsContainer;
        container.innerHTML = '';
        if (mode === 'competitive') {
            container.innerHTML = `<div class="input-column"><label class="faction1" id="faction1-label"></label><textarea id="faction1-input" placeholder="Actions..."></textarea><div class="action-cost" id="faction1-cost">Cost: 1</div></div><div class="input-column"><label class="faction2" id="faction2-label"></label><textarea id="faction2-input" placeholder="Actions..."></textarea><div class="action-cost" id="faction2-cost">Cost: 1</div></div>`;
            document.getElementById('faction1-label').textContent = gameState.playerSideName;
            document.getElementById('faction2-label').textContent = gameState.opponentSideName;
        } else {
            container.innerHTML = `<div class="input-column"><textarea id="sandbox-input" placeholder="What happens next?"></textarea><div class="action-cost" id="sandbox-cost">Cost: 1</div></div>`;
            container.querySelector('textarea').style.height = '120px';
        }
        addActionCostAnalysisListeners();
    };
    
    const debounce = (func, delay) => { let timeout; return function(...args) { const context = this; clearTimeout(timeout); timeout = setTimeout(() => func.apply(context, args), delay); }; };

    const analyzeAndDisplayCost = async (event) => {
        const textarea = event.target;
        const actionText = textarea.value.trim();
        const costDisplayId = textarea.id.replace('-input', '-cost');
        const costDisplay = document.getElementById(costDisplayId);
        if (!costDisplay) return;
        if (actionText.length < 10) { costDisplay.textContent = 'Cost: 1'; return; }
        costDisplay.textContent = 'Cost: Analyzing...';
        try {
            const result = await fetchAPI('/api/analyze-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: actionText }) });
            costDisplay.textContent = `Cost: ${result.cost}`;
        } catch (e) {
            console.error("Action cost analysis failed:", e);
            costDisplay.textContent = 'Cost: Error';
        }
    };
    
    const addActionCostAnalysisListeners = () => {
        const textareas = document.querySelectorAll('#input-fields-container textarea');
        textareas.forEach(textarea => {
            textarea.addEventListener('input', debounce(analyzeAndDisplayCost, 800));
        });
    };
    
    const updateUIFromState = (data) => { Object.assign(gameState, data); updateHealthDisplay(gameState.playerHP, gameState.opponentHP); updateStatusEffects(gameState.playerEffects, gameState.opponentEffects); setupInputUI(gameState.gameMode); if(data.response) { updateBackgroundImage(data.response.image_b_64); if(data.response.narration) addLog(data.response.narration, 'Director'); if (data.response.turn_summary) { addLog(data.response.turn_summary, 'Tactical Summary', 'system-info'); } playAudio(data.response.audio_base_64); } if (gameState.gameOver) { ui.turnStatus.textContent = "CHRONICLE CONCLUDED"; ui.submitTurnBtn.disabled = true; } };
    const startChronicle = async (body, endpoint = '/api/dynamic-narrative/start') => { setLoading(true, "Preparing Chronicle..."); try { const data = await fetchAPI(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); showScreen('genesis-screen'); updateUIFromState(data); } catch (e) { alert("Failed to start chronicle: " + e.message); } finally { setLoading(false); if(ui.startBtnRpg) ui.startBtnRpg.disabled = false; if(ui.startQuickplayBtn) ui.startQuickplayBtn.disabled = false; } };
    const submitTurn = async () => { let payload; if (gameState.gameMode === 'competitive') { const action1 = document.getElementById('faction1-input').value.trim(); const action2 = document.getElementById('faction2-input').value.trim(); if (!action1 || !action2) return alert('Please enter actions for both factions.'); payload = { playerAction: action1, opponentAction: action2 }; } else { const action = document.getElementById('sandbox-input').value.trim(); if (!action) return alert('Please describe what happens next.'); payload = { playerAction: action }; } ui.submitTurnBtn.disabled = true; setLoading(true, "Resolving Turn..."); document.querySelectorAll('#input-fields-container textarea').forEach(ta => ta.disabled = true); try { const data = await fetchAPI(`/api/dynamic-narrative/${gameState.currentSceneId}/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); updateUIFromState(data); } catch (e) { addLog(`Error resolving turn: ${e.message}`, 'SYSTEM ERROR', 'system-error'); } finally { setLoading(false); if (!gameState.gameOver) { document.querySelectorAll('#input-fields-container textarea').forEach(ta => { ta.disabled = false; ta.value = ''; }); document.querySelector('#input-fields-container textarea').focus(); ui.submitTurnBtn.disabled = false; } } };
    const prepareCustomSandbox = () => { const body = { gameSettingPrompt: ui.promptRpg.value.trim(), playerSideName: ui.playerSideNameInput.value.trim() || 'Player', gameMode: 'sandbox', artStyle: ui.artStyleSelector.value, faction1Visuals: ui.faction1VisualsInput.value.trim() }; if (!body.gameSettingPrompt) return alert("Please describe the setting."); startChronicle(body); };
    const prepareCustomCompetitive = () => { const fullPrompt = `--- SHARED SETTING ---\n${ui.promptRpg.value.trim()}`; const body = { gameSettingPrompt: fullPrompt, playerSideName: ui.playerSideNameInput.value.trim() || 'Faction 1', opponentSideName: ui.opponentSideNameInput.value.trim() || 'Faction 2', gameMode: 'competitive', artStyle: ui.artStyleSelector.value, faction1Visuals: ui.faction1VisualsInput.value.trim(), faction2Visuals: ui.faction2VisualsInput.value.trim() }; if (!body.gameSettingPrompt || !body.playerSideName || !body.opponentSideName) return alert("Please complete all description fields for competitive mode."); startChronicle(body); };
    const loadSpecificGame = async (sceneId) => { setLoading(true, "Loading Chronicle..."); try { const data = await fetchAPI(`/api/chronicles/${sceneId}`); showScreen('genesis-screen'); updateUIFromState(data); } catch (e) { alert("Failed to load chronicle: " + e.message); showScreen('hub-screen'); } finally { setLoading(false); } };
    const showLoadGameModal = async () => { showScreen('load-game-modal'); const loadList = ui.loadGameList; loadList.innerHTML = '<p>Fetching saved chronicles...</p>'; try { const chronicles = await fetchAPI('/api/chronicles'); loadList.innerHTML = ''; if (chronicles.length === 0) { loadList.innerHTML = '<p>No saved chronicles found.</p>'; return; } chronicles.forEach(chronicle => { const btn = document.createElement('button'); btn.innerHTML = `${chronicle.playerSideName} <span>vs ${chronicle.opponentSideName}</span>`; btn.onclick = () => loadSpecificGame(chronicle.sceneId); loadList.appendChild(btn); }); } catch (e) { loadList.innerHTML = `<p class="system-error">Error fetching chronicles: ${e.message}</p>`; } };
    const setupUIEnhancements = () => { ui.hidePanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.add('input-overlay--hidden'); ui.showPanelBtn.classList.remove('hidden'); }); ui.showPanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.remove('input-overlay--hidden'); ui.showPanelBtn.classList.add('hidden'); }); };
    const setupCreationScreen = (mode) => { const isSandbox = mode === 'sandbox'; showScreen('creation-screen-rpg'); ui.modeTitle.textContent = isSandbox ? "Custom Sandbox Setup" : "Custom Competitive Setup"; const competitiveFields = [ui.opponentSideNameFormGroup, ui.faction2VisualsGroup]; competitiveFields.forEach(field => field.classList.toggle('hidden', isSandbox)); };
    const initializePushToTalk = async () => { if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { console.warn("PTT is not supported on this browser."); ui.pttBtn.disabled = true; return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaRecorder = new MediaRecorder(stream); mediaRecorder.ondataavailable = event => { audioChunks.push(event.data); }; mediaRecorder.onstop = async () => { setLoading(true, "Transcribing speech..."); const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); audioChunks = []; const reader = new FileReader(); reader.readAsDataURL(audioBlob); reader.onloadend = async () => { const audioB64 = reader.result; try { const response = await fetchAPI('/api/transcribe-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioB64 }) }); const faction1Input = document.getElementById('faction1-input'); const sandboxInput = document.getElementById('sandbox-input'); if (faction1Input) { faction1Input.value = response.transcription; } else if (sandboxInput) { sandboxInput.value = response.transcription; } } catch (e) { addLog(`Speech-to-text failed: ${e.message}`, 'SYSTEM ERROR', 'system-error'); } finally { setLoading(false); } }; }; ui.pttBtn.disabled = false; } catch (err) { addLog("Microphone access denied. PTT is disabled.", "SYSTEM ERROR", "system-error"); console.error("Mic permissions failed:", err); ui.pttBtn.disabled = true; } };
    const prepareQuickplay = () => { const prompt = ui.quickplayPrompt.value.trim(); if (!prompt) return alert("Please enter your idea for the chronicle."); ui.startQuickplayBtn.disabled = true; const body = { prompt: prompt, artStyle: ui.quickplayArtStyleSelector.value, gameMode: ui.quickplayGameModeSelector.value }; startChronicle(body, '/api/quickplay/start'); };

    try {
        ui.enableAudioBtn.addEventListener('click', () => { if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); if (audioContext.state === 'suspended') { audioContext.resume(); } } showScreen('hub-screen'); });
        ui.launchQuickplayBtn.addEventListener('click', () => showScreen('quickplay-screen'));
        ui.launchSandboxBtn.addEventListener('click', () => setupCreationScreen('sandbox'));
        ui.launchCompetitiveBtn.addEventListener('click', () => setupCreationScreen('competitive'));
        ui.loadChronicleBtn.addEventListener('click', showLoadGameModal);
        ui.startQuickplayBtn.addEventListener('click', prepareQuickplay);
        ui.backToHubBtnQuickplay.addEventListener('click', () => showScreen('hub-screen'));
        ui.startBtnRpg.addEventListener('click', () => { const isSandbox = ui.modeTitle.textContent.includes('Sandbox'); if (isSandbox) { prepareCustomSandbox(); } else { prepareCustomCompetitive(); } });
        ui.backToHubBtnCustom.addEventListener('click', () => showScreen('hub-screen'));
        ui.closeLoadModalBtn.addEventListener('click', () => showScreen('hub-screen'));
        ui.chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (!gameState.gameOver) { submitTurn(); } });
        ui.pttBtn.addEventListener('mousedown', () => { if (mediaRecorder && !isRecording) { isRecording = true; mediaRecorder.start(); ui.pttBtn.classList.add('is-recording'); } });
        ui.pttBtn.addEventListener('mouseup', () => { if (mediaRecorder && isRecording) { isRecording = false; mediaRecorder.stop(); ui.pttBtn.classList.remove('is-recording'); } });
        ui.pttBtn.addEventListener('mouseleave', () => { if (mediaRecorder && isRecording) { isRecording = false; mediaRecorder.stop(); ui.pttBtn.classList.remove('is-recording'); } });
        setupUIEnhancements();
        initializePushToTalk();
    } catch(e) {
        alert("Could not connect to the GlassICE server. Please ensure the server is running and refresh the page.");
        console.error("Initialization failed:", e);
    }
});