import { VertexAI } from '@google-cloud/vertexai';
import { initLogger, wrapTraced } from 'braintrust';
import { config } from './config.js';

// Initialize Braintrust logger (uses BRAINTRUST_API_KEY env var)
const logger = initLogger({
  projectName: 'synapse-data-agent',
  asyncFlush: true,
});

const vertexAI = new VertexAI({
  project: config.projectId,
  location: config.location,
});

const generativeModel = vertexAI.getGenerativeModel({
  model: config.model,
  generationConfig: {
    temperature: 0.2,
    topP: 0.8,
    maxOutputTokens: 4096,
  },
});

/**
 * Wrapped generate function with Braintrust logging
 */
export const generate = wrapTraced(async function generate(prompt) {
  const startTime = Date.now();

  const result = await generativeModel.generateContent(prompt);
  const responseText = result.response.candidates[0].content.parts[0].text;

  const endTime = Date.now();

  // Log to Braintrust
  logger.log({
    input: prompt,
    output: responseText,
    metadata: {
      model: config.model,
      latencyMs: endTime - startTime,
      type: 'generate',
    },
  });

  return responseText;
}, { name: 'generate' });

/**
 * Start a chat session with Braintrust tracing
 */
export function startChat(history = []) {
  const chat = generativeModel.startChat({ history });

  // Wrap sendMessage to log each turn
  const originalSendMessage = chat.sendMessage.bind(chat);

  chat.sendMessage = wrapTraced(async function sendMessage(message) {
    const startTime = Date.now();

    const result = await originalSendMessage(message);
    const responseText = result.response.candidates[0].content.parts[0].text;

    const endTime = Date.now();

    // Log to Braintrust
    logger.log({
      input: message,
      output: responseText,
      metadata: {
        model: config.model,
        latencyMs: endTime - startTime,
        type: 'chat',
        historyLength: history.length,
      },
    });

    return result;
  }, { name: 'chat.sendMessage' });

  return chat;
}

/**
 * Log a complete agent interaction (question -> SQL -> result -> feedback)
 */
export function logAgentInteraction(data) {
  logger.log({
    input: {
      question: data.question,
      datasetId: data.datasetId,
      tables: data.tables,
    },
    output: {
      sql: data.sql,
      reasoning: data.reasoning,
      explanation: data.explanation,
    },
    expected: data.feedback ? {
      feedback: data.feedback,
      rating: data.rating,
    } : undefined,
    scores: data.rating ? {
      userRating: data.rating / 5, // Normalize to 0-1
    } : undefined,
    metadata: {
      sessionId: data.sessionId,
      querySuccess: data.querySuccess,
      rowCount: data.rowCount,
      latencyMs: data.latencyMs,
    },
  });
}

/**
 * Flush logs (call before function exits)
 */
export async function flushLogs() {
  await logger.flush();
}

// Export model for direct access if needed
export const model = generativeModel;
