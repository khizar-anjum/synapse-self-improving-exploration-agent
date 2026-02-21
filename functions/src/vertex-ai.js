import { VertexAI } from '@google-cloud/vertexai';
import { config } from './config.js';

const vertexAI = new VertexAI({
  project: config.projectId,
  location: config.location,
});

export const model = vertexAI.getGenerativeModel({
  model: config.model,
  generationConfig: {
    temperature: 0.2,
    topP: 0.8,
    maxOutputTokens: 4096,
  },
});

export function startChat(history = []) {
  return model.startChat({ history });
}

export async function generate(prompt) {
  const result = await model.generateContent(prompt);
  return result.response.candidates[0].content.parts[0].text;
}
