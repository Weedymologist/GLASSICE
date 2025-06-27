document.addEventListener('DOMContentLoaded', async () => {
    const API_URL = "";
    let gameState = { currentSceneId: null, playerSideName: 'Player', opponentSideName: 'Opponent', currentAudio: null, gameMode: 'sandbox', gameOver: false, playerEffects: [], opponentEffects: [], artStyle: 'Cinematic Realism', faction1Visuals: '', faction2Visuals: '' };
    const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map(el => [el.id.replace(/-(\w)/g, (m, p) => p.toUpperCase()), el]));
    const allScreens = document.querySelectorAll('.screen');
    const showScreen = (screenId) => { allScreens.forEach(screen => { if (screen.id === screenId) { screen.classList.add('active'); screen.classList.remove('hidden'); } else { screen.classList.remove('active'); screen.classList.add('hidden'); } }); };
    const fetchAPI = async (endpoint, options = {}) => { const response = await fetch(`${API_URL}${endpoint}`, options); if (!response.ok) { const errorData = await response.json().catch(() => ({ error: `HTTP Error: ${response.status}` })); throw new Error(errorData.error || `HTTP Error: ${response.status}`); } return response.json(); };
    const typewriter = (el, txt) => new Promise(resolve => { let i = 0; el.innerHTML = ""; const interval = setInterval(() => { if (i < txt.length) { el.innerHTML += txt.charAt(i++).replace(/\n/g, '<br>'); ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight; } else { clearInterval(interval); resolve(); } }, 15); });

    // MODIFIED: Added the missing setLoading function definition.
    const setLoading = (isLoading, text = 'Loading...') => {
        ui.loadingOverlay.classList.toggle('hidden', !isLoading);
        if (isLoading) {
            ui.loaderTextRpg.textContent = text;
        }
    };

    const playAudio = (b64) => new Promise(resolve => { if (gameState.currentAudio) gameState.currentAudio.pause(); if (b64) { gameState.currentAudio = new Audio("data:audio/mp3;base64," + b64); gameState.currentAudio.play().catch(e => { console.warn("Audio play interrupted:", e); resolve(); }); gameState.currentAudio.onended = () => resolve(); gameState.currentAudio.onerror = (e) => { console.error("Audio playback error:", e); resolve(); }; } else { resolve(); } });
    
    const updateStatusEffects = (playerEffects, opponentEffects) => {
        const renderEffects = (container, effects) => {
            container.innerHTML = '';
            if (effects && effects.length > 0) {
                effects.forEach(effect => {
                    const effectDiv = document.createElement('div');
                    effectDiv.className = 'status-effect debuff';
                    effectDiv.innerHTML = `${effect.name} <span class="duration">${effect.duration}</span>`;
                    container.appendChild(effectDiv);
                });
            }
        };
        renderEffects(ui.playerEffectsContainer, playerEffects);
        renderEffects(ui.opponentEffectsContainer, opponentEffects);
    };

    const updateHealthDisplay = (playerHP, opponentHP) => {
        ui.healthPlayerName.textContent = gameState.playerSideName;
        ui.healthOpponentName.textContent = gameState.opponentSideName;
        ui.healthPlayerBar.style.width = `${playerHP}%`;
        ui.healthOpponentBar.style.width = `${opponentHP}%`;
        ui.healthStatusBar.classList.toggle('hidden', gameState.gameMode !== 'competitive');
    };
    
    const setupInputUI = (mode) => {
        const container = ui.inputFieldsContainer;
        container.innerHTML = '';
        if (mode === 'competitive') {
            container.innerHTML = `<div class="input-column"><label class="faction1" id="faction1-label"></label><textarea id="faction1-input"></textarea></div><div class="input-column"><label class="faction2" id="faction2-label"></label><textarea id="faction2-input"></textarea></div>`;
            document.getElementById('faction1-label').textContent = gameState.playerSideName;
            document.getElementById('faction2-label').textContent = gameState.opponentSideName;
            document.getElementById('faction1-input').placeholder = `Actions for ${gameState.playerSideName}...`;
            document.getElementById('faction2-input').placeholder = `Actions for ${gameState.opponentSideName}...`;
        } else {
            container.innerHTML = `<div class="input-column"><textarea id="sandbox-input" placeholder="What happens next?"></textarea></div>`;
            container.querySelector('textarea').style.height = '120px';
        }
    };
    
    const updateUIFromState = (data) => {
        Object.assign(gameState, data);
        updateHealthDisplay(gameState.playerHP, gameState.opponentHP);
        updateStatusEffects(gameState.playerEffects, gameState.opponentEffects);
        setupInputUI(gameState.gameMode);
        if(data.response) {
            updateBackgroundImage(data.response.image_b64);
            if (data.response.turn_summary) { addLog(data.response.turn_summary, 'Tactical Summary', 'system-info'); }
            addLog(data.response.narration, 'Director');
            setTimeout(() => playAudio(data.response.audio_base_64), 1000);
        }
        if (gameState.gameOver) {
            ui.turnStatus.textContent = "CHRONICLE CONCLUDED";
            ui.submitTurnBtn.disabled = true;
        }
    };

    // MODIFIED: Disabled button on press and re-enabled on error to prevent spamming.
    const startChronicle = async (body) => {
        ui.startBtnRpg.disabled = true;
        setLoading(true, "Preparing Chronicle...");
        try {
            const data = await fetchAPI('/api/dynamic-narrative/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            showScreen('genesis-screen');
            updateUIFromState(data);
        } catch (e) {
            alert("Failed to start chronicle: " + e.message);
            ui.startBtnRpg.disabled = false; // Re-enable on error
        } finally {
            setLoading(false);
        }
    };
    
    // MODIFIED: Disabled button during turn resolution.
    const submitTurn = async () => {
        let payload;
        if (gameState.gameMode === 'competitive') {
            const action1 = document.getElementById('faction1-input').value.trim();
            const action2 = document.getElementById('faction2-input').value.trim();
            if (!action1 || !action2) return alert('Please enter actions for both factions.');
            payload = { playerAction: action1, opponentAction: action2 };
        } else {
            const action = document.getElementById('sandbox-input').value.trim();
            if (!action) return alert('Please describe what happens next.');
            payload = { playerAction: action };
        }
        ui.submitTurnBtn.disabled = true;
        setLoading(true, "Resolving Turn...");
        document.querySelectorAll('#input-fields-container textarea').forEach(ta => ta.disabled = true);
        try {
            const data = await fetchAPI(`/api/dynamic-narrative/${gameState.currentSceneId}/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            updateUIFromState(data);
        } catch (e) {
            addLog(`Error resolving turn: ${e.message}`, 'SYSTEM ERROR', 'system-error');
        } finally {
            setLoading(false);
            if (!gameState.gameOver) {
                 document.querySelectorAll('#input-fields-container textarea').forEach(ta => { ta.disabled = false; ta.value = ''; });
                 document.querySelector('#input-fields-container textarea').focus();
                 ui.submitTurnBtn.disabled = false;
            }
        }
    };

    // --- MODIFIED: Prepare functions now include visual descriptions ---
    const prepareSandbox = () => {
        const body = {
            gameSettingPrompt: ui.promptRpg.value.trim(),
            playerSideName: ui.playerSideNameInput.value.trim() || 'Player',
            gameMode: 'sandbox',
            artStyle: ui.artStyleSelector.value,
            faction1Visuals: ui.faction1VisualsInput.value.trim()
        };
        if (!body.gameSettingPrompt) return alert("Please describe the setting.");
        startChronicle(body);
    };
    
    const prepareCompetitive = () => {
        const setting = ui.promptRpg.value.trim();
        const playerBrief = ui.initialPlayerSidePrompt.value.trim();
        const opponentBrief = ui.initialOpponentSidePrompt.value.trim();
        if (!setting || !playerBrief || !opponentBrief) return alert("Please complete all three description fields for competitive mode.");
        const fullPrompt = `--- SHARED SETTING ---\n${setting}\n\n--- FACTION 1 BRIEFING ---\n${playerBrief}\n\n--- FACTION 2 BRIEFING ---\n${opponentBrief}`;
        const body = {
            gameSettingPrompt: fullPrompt,
            playerSideName: ui.playerSideNameInput.value.trim() || 'Faction 1',
            opponentSideName: ui.opponentSideNameInput.value.trim() || 'Faction 2',
            gameMode: 'competitive',
            artStyle: ui.artStyleSelector.value,
            faction1Visuals: ui.faction1VisualsInput.value.trim(),
            faction2Visuals: ui.faction2VisualsInput.value.trim()
        };
        startChronicle(body); 
    };
    
    const renderHistory = (history) => {
        ui.chatLogRpg.innerHTML = ''; 
        for (let i = 1; i < history.length; i++) { const message = history[i]; if (message.role === 'assistant') { const entryDiv = document.createElement('div'); entryDiv.className = 'log-entry'; entryDiv.innerHTML = `<strong class="gm">Director:</strong><span>${message.content.replace(/\n/g, '<br>')}</span>`; ui.chatLogRpg.appendChild(entryDiv); } }
        ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight;
    };
    const loadSpecificGame = async (sceneId) => {
        setLoading(true, "Loading Chronicle...");
        try { const data = await fetchAPI(`/api/chronicles/${sceneId}`); showScreen('genesis-screen'); renderHistory(data.history); updateUIFromState(data); } catch (e) { alert("Failed to load chronicle: " + e.message); showScreen('hub-screen'); } finally { setLoading(false); }
    };
    const showLoadGameModal = async () => {
        showScreen('load-game-modal');
        const loadList = ui.loadGameList;
        loadList.innerHTML = '<p>Fetching saved chronicles...</p>';
        try {
            const chronicles = await fetchAPI('/api/chronicles');
            loadList.innerHTML = ''; 
            if (chronicles.length === 0) { loadList.innerHTML = '<p>No saved chronicles found.</p>'; return; }
            chronicles.forEach(chronicle => { const btn = document.createElement('button'); btn.innerHTML = `${chronicle.playerSideName} <span>vs ${chronicle.opponentSideName}</span>`; btn.onclick = () => loadSpecificGame(chronicle.sceneId); loadList.appendChild(btn); });
        } catch (e) { loadList.innerHTML = `<p class="system-error">Error fetching chronicles: ${e.message}</p>`; }
    };
    const setupUIEnhancements = () => {
        ui.hidePanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.add('input-overlay--hidden'); ui.showPanelBtn.classList.remove('hidden'); });
        ui.showPanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.remove('input-overlay--hidden'); ui.showPanelBtn.classList.add('hidden'); });
    };
    
    // --- MODIFIED: Show/hide visual description fields based on mode ---
    const setupCreationScreen = (mode) => {
        const isSandbox = mode === 'sandbox';
        showScreen('creation-screen-rpg');
        ui.modeTitle.textContent = isSandbox ? "Sandbox Narrative Setup" : "Competitive Narrative Setup";

        // Toggle visibility of all competitive-only fields
        const competitiveFields = [
            ui.opponentSideNameFormGroup,
            ui.initialOpponentSidePromptFormGroup,
            ui.faction2VisualsGroup
        ];
        competitiveFields.forEach(field => field.classList.toggle('hidden', isSandbox));
    };

    try {
        ui.startBtnRpg.addEventListener('click', () => {
            const isSandbox = ui.modeTitle.textContent.includes('Sandbox');
            if (isSandbox) { prepareSandbox(); } else { prepareCompetitive(); }
        });
        ui.launchSandboxBtn.addEventListener('click', () => setupCreationScreen('sandbox'));
        ui.launchCompetitiveBtn.addEventListener('click', () => setupCreationScreen('competitive'));
        ui.loadChronicleBtn.addEventListener('click', showLoadGameModal);
        ui.closeLoadModalBtn.addEventListener('click', () => showScreen('hub-screen'));
        ui.chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (!gameState.gameOver) { submitTurn(); } });
        setupUIEnhancements();
    } catch(e) {
        alert("Could not connect to the GlassICE server. Please ensure the server is running and refresh the page.");
        console.error("Initialization failed:", e);
    }
});