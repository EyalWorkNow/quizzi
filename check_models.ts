import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function checkModels() {
    try {
        const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const response = await ai.models.generateContent({
            model,
            contents: 'Reply with OK only.',
        });
        console.log(`Model ${model} is reachable.`);
        console.log(response.text);
    } catch (error) {
        console.error('Error checking model:', error);
    }
}

checkModels();
