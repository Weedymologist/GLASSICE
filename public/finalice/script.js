document.addEventListener('DOMContentLoaded', async () => {
    // ... all setup code remains the same ...
    const API_URL = "";
    let gameState = { /*...*/ };
    const ui = { /*...*/ };

    // --- MODIFIED: submitTurn now has more descriptive loading text ---
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
        setLoading(true, "Director is resolving narrative..."); // New loading text
        document.querySelectorAll('#input-fields-container textarea').forEach(ta => ta.disabled = true);
        
        try {
            const data = await fetchAPI(`/api/dynamic-narrative/${gameState.currentSceneId}/turn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            // The loading text will naturally change as the UI updates from the response
            updateUIFromState(data);

        } catch (e) {
            addLog(`Error resolving turn: ${e.message}`, 'SYSTEM ERROR', 'system-error');
        } finally {
            setLoading(false);
            if (!gameState.gameOver) {
                document.querySelectorAll('#input-fields-container textarea').forEach(ta => {
                    ta.disabled = false;
                    ta.value = '';
                });
                document.querySelector('#input-fields-container textarea').focus();
                ui.submitTurnBtn.disabled = false;
            }
        }
    };

    // --- All other functions (updateUIFromState, startChronicle, etc.) remain unchanged ---
    // ... no changes needed for the rest of the file ...
    const updateUIFromState = (data) => { Object.assign(gameState, data); updateHealthDisplay(gameState.playerHP, gameState.opponentHP); updateStatusEffects(gameState.playerEffects, gameState.opponentEffects); setupInputUI(gameState.gameMode); if(data.response) { updateBackgroundImage(data.response.image_b_64); if(data.response.narration) addLog(data.response.narration, 'Director'); if (data.response.turn_summary) { addLog(data.response.turn_summary, 'Tactical Summary', 'system-info'); } playAudio(data.response.audio_base_64); } if (gameState.gameOver) { ui.turnStatus.textContent = "CHRONICLE CONCLUDED"; ui.submitTurnBtn.disabled = true; } };
    // ... etc ...
});