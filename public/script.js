document.addEventListener('DOMContentLoaded', async () => {
    const API_URL = "";
    let gameState = { currentSceneId: null, playerSideName: 'Player', opponentSideName: 'Opponent', currentAudio: null, personas: [], gameMode: 'sandbox', latestImageB64: null, gameOver: false, playerEffects: [], opponentEffects: [] };
    const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]')).map(el => [el.id.replace(/-(\w)/g, (m, p) => p.toUpperCase()), el]));
    const allScreens = document.querySelectorAll('.screen');
    const showScreen = (screenId) => { allScreens.forEach(screen => { if (screen.id === screenId) { screen.classList.add('active'); screen.classList.remove('hidden'); } else { screen.classList.remove('active'); screen.classList.add('hidden'); } }); };
    const fetchAPI = async (endpoint, options = {}) => { const response = await fetch(`${API_URL}${endpoint}`, options); if (!response.ok) { const errorData = await response.json().catch(() => ({ error: `HTTP Error: ${response.status}` })); throw new Error(errorData.error || `HTTP Error: ${response.status}`); } return response.json(); };
    const typewriter = (el, txt) => new Promise(resolve => { let i = 0; el.innerHTML = ""; const interval = setInterval(() => { if (i < txt.length) { el.innerHTML += txt.charAt(i++).replace(/\n/g, '<br>'); ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight; } else { clearInterval(interval); resolve(); } }, 15); });

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
        
        // Only show the health bar if we are in competitive mode.
        ui.healthStatusBar.classList.toggle('hidden', gameState.gameMode !== 'competitive');
    };
    
    // --- NEW: Function to create the correct input UI based on game mode ---
    const setupInputUI = (mode) => {
        const container = ui.inputFieldsContainer;
        container.innerHTML = ''; // Clear previous UI
        if (mode === 'competitive') {
            container.innerHTML = `
                <div class="input-column">
                    <label class="faction1" id="faction1-label">Faction 1</label>
                    <textarea id="faction1-input" placeholder="Actions for ${gameState.playerSideName}..."></textarea>
                </div>
                <div class="input-column">
                    <label class="faction2" id="faction2-label">Faction 2</label>
                    <textarea id="faction2-input" placeholder="Actions for ${gameState.opponentSideName}..."></textarea>
                </div>
            `;
            document.getElementById('faction1-label').textContent = gameState.playerSideName;
            document.getElementById('faction2-label').textContent = gameState.opponentSideName;
        } else { // Sandbox mode
            container.innerHTML = `
                <div class="input-column">
                    <textarea id="sandbox-input" placeholder="What happens next?"></textarea>
                </div>
            `;
            // Make the single textarea larger
            container.querySelector('textarea').style.height = '120px';
        }
    };
    
    const updateUIFromState = (data) => {
        Object.assign(gameState, data);
        
        updateHealthDisplay(gameState.playerHP, gameState.opponentHP);
        updateStatusEffects(gameState.playerEffects, gameState.opponentEffects);
        setupInputUI(gameState.gameMode); // Re-create the input UI
        
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

    const startChronicle = async (body) => {
        setLoading(true, "Preparing Chronicle...");
        try {
            const data = await fetchAPI('/api/dynamic-narrative/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            showScreen('genesis-screen');
            updateUIFromState(data);
        } catch (e) {
            alert("Failed to start chronicle: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    
    // --- MODIFIED: Submit turn now handles both sandbox and competitive modes ---
    const submitTurn = async () => {
        let payload;
        if (gameState.gameMode === 'competitive') {
            const action1 = document.getElementById('faction1-input').value.trim();
            const action2 = document.getElementById('faction2-input').value.trim();
            if (!action1 || !action2) return alert('Please enter actions for both factions.');
            payload = { playerAction: action1, opponentAction: action2 }; // This will be the structure for Phase 2
        } else {
            const action = document.getElementById('sandbox-input').value.trim();
            if (!action) return alert('Please describe what happens next.');
            payload = { playerAction: action };
        }
        
        setLoading(true, "Resolving Turn...");
        
        // Disable all textareas
        document.querySelectorAll('#input-fields-container textarea').forEach(ta => ta.disabled = true);
        
        try {
            const data = await fetchAPI(`/api/dynamic-narrative/${gameState.currentSceneId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            updateUIFromState(data); // Process the response
        } catch (e) {
            addLog(`Error resolving turn: ${e.message}`, 'SYSTEM ERROR', 'system-error');
        } finally {
            setLoading(false);
            if (!gameState.gameOver) {
                 document.querySelectorAll('#input-fields-container textarea').forEach(ta => {
                    ta.disabled = false;
                    ta.value = ''; // Clear textareas after submission
                 });
                 // Focus the first textarea
                 document.querySelector('#input-fields-container textarea').focus();
            }
        }
    };

    const prepareSandbox = () => { const body = { gameSettingPrompt: ui.promptRpg.value.trim(), playerSideName: ui.playerSideNameInput.value.trim() || 'Player', gameMode: 'sandbox' }; if (!body.gameSettingPrompt) return alert("Please describe the setting."); startChronicle(body); };
    
    const prepareCompetitive = () => {
        const setting = ui.promptRpg.value.trim();
        const playerBrief = ui.initialPlayerSidePrompt.value.trim();
        const opponentBrief = ui.initialOpponentSidePrompt.value.trim();
        if (!setting || !playerBrief || !opponentBrief) return alert("Please complete all three description fields for competitive mode.");
        const fullPrompt = `--- SHARED SETTING ---\n${setting}\n\n--- FACTION 1 BRIEFING ---\n${playerBrief}\n\n--- FACTION 2 BRIEFING ---\n${opponentBrief}`;
        const body = { gameSettingPrompt: fullPrompt, playerSideName: ui.playerSideNameInput.value.trim() || 'Faction 1', opponentSideName: ui.opponentSideNameInput.value.trim() || 'Faction 2', gameMode: 'competitive' };
        startChronicle(body); 
    };
    
    const renderHistory = (history) => {
        ui.chatLogRpg.innerHTML = ''; 
        for (let i = 1; i < history.length; i++) {
            const message = history[i];
            if (message.role === 'assistant') {
                const entryDiv = document.createElement('div');
                entryDiv.className = 'log-entry';
                entryDiv.innerHTML = `<strong class="gm">Director:</strong><span>${message.content.replace(/\n/g, '<br>')}</span>`;
                ui.chatLogRpg.appendChild(entryDiv);
            }
        }
        ui.chatLogRpg.scrollTop = ui.chatLogRpg.scrollHeight;
    };

    const loadSpecificGame = async (sceneId) => {
        setLoading(true, "Loading Chronicle...");
        try {
            const data = await fetchAPI(`/api/chronicles/${sceneId}`);
            showScreen('genesis-screen');
            renderHistory(data.history); 
            updateUIFromState(data);
        } catch (e) {
            alert("Failed to load chronicle: " + e.message);
            showScreen('hub-screen');
        } finally {
            setLoading(false);
        }
    };

    const showLoadGameModal = async () => {
        showScreen('load-game-modal');
        const loadList = ui.loadGameList;
        loadList.innerHTML = '<p>Fetching saved chronicles...</p>';
        try {
            const chronicles = await fetchAPI('/api/chronicles');
            loadList.innerHTML = ''; 
            if (chronicles.length === 0) {
                loadList.innerHTML = '<p>No saved chronicles found.</p>';
                return;
            }
            chronicles.forEach(chronicle => {
                const btn = document.createElement('button');
                btn.innerHTML = `${chronicle.playerSideName} <span>vs ${chronicle.opponentSideName}</span>`;
                btn.onclick = () => loadSpecificGame(chronicle.sceneId);
                loadList.appendChild(btn);
            });
        } catch (e) {
            loadList.innerHTML = `<p class="system-error">Error fetching chronicles: ${e.message}</p>`;
        }
    };

    const setupUIEnhancements = () => {
        ui.hidePanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.add('input-overlay--hidden'); ui.showPanelBtn.classList.remove('hidden'); });
        ui.showPanelBtn.addEventListener('click', () => { ui.inputOverlayContainer.classList.remove('input-overlay--hidden'); ui.showPanelBtn.classList.add('hidden'); });
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) { ui.pttBtn.disabled = true; ui.pttBtn.title = "Speech recognition not supported in this browser."; return; }
        // We will need to enhance PTT later to support two text boxes
    };
    
    try {
        ui.launchSandboxBtn.addEventListener('click', () => { showScreen('creation-screen-rpg'); ui.opponentSideNameFormGroup.classList.add('hidden'); ui.initialOpponentSidePromptFormGroup.classList.add('hidden'); ui.modeTitle.textContent = "Sandbox Narrative Setup"; });
        ui.launchCompetitiveBtn.addEventListener('click', () => { showScreen('creation-screen-rpg'); ui.opponentSideNameFormGroup.classList.remove('hidden'); ui.initialOpponentSidePromptFormGroup.classList.remove('hidden'); ui.modeTitle.textContent = "Competitive Narrative Setup"; });
        ui.startBtnRpg.addEventListener('click', () => { (ui.modeTitle.textContent.includes('Sandbox')) ? prepareSandbox() : prepareCompetitive(); });
        ui.loadChronicleBtn.addEventListener('click', showLoadGameModal);
        ui.closeLoadModalBtn.addEventListener('click', () => showScreen('hub-screen'));
        ui.chatForm.addEventListener('submit', (e) => { e.preventDefault(); if (!gameState.gameOver) { submitTurn(); } });
        setupUIEnhancements();
    } catch(e) {
        alert("Could not connect to the GlassICE server. Please ensure the server is running and refresh the page.");
        console.error("Initialization failed:", e);
    }
});