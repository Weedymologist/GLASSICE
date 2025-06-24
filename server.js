const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve the frontend files

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Chat endpoint for narration and conversation
app.post('/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages) {
            return res.status(400).json({ error: "Request body must contain 'messages' array." });
        }
        
        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4o",
                messages: messages,
                max_tokens: 300,
                temperature: 0.8
            },
            { headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` } }
        );
        res.json({ text: response.data.choices[0].message.content });
    } catch (err) {
        console.error(err.response ? err.response.data : err.message);
        res.status(500).json({ error: "Chat call failed" });
    }
});

// Image generation endpoint
app.post('/image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "Request body must contain 'prompt'." });
        }

        const response = await axios.post(
            "https://api.openai.com/v1/images/generations",
            {
                model: "dall-e-3",
                prompt: `cinematic, masterpiece, high detail, ${prompt}`,
                n: 1,
                size: "1024x1024",
                quality: "hd",
                style: "vivid"
            },
            { headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` } }
        );
        const url = response.data.data[0].url;
        res.json({ url });
    } catch (err) {
        console.error(err.response ? err.response.data : err.message);
        res.status(500).json({ error: "Image call failed" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🤖 P.A.N.E. GLASS (Genesis) server listening on port ${PORT}`);
});