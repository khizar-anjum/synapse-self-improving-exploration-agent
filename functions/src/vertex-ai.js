import { VertexAI } from '@google-cloud/vertexai';
import { initLogger } from 'braintrust';
import { config } from './config.js';

// Initialize Braintrust logger (uses BRAINTRUST_API_KEY env var)
let logger = null;
try {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  console.log('Braintrust API key present:', !!apiKey, apiKey ? `(${apiKey.substring(0, 8)}...)` : '');

  logger = initLogger({
    projectName: 'synapse-data-agent',
    apiKey: apiKey, // Explicitly pass the API key
    asyncFlush: true,
  });
  console.log('Braintrust logger initialized successfully');
} catch (err) {
  console.error('Failed to initialize Braintrust logger:', err);
}

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
 * Generate function with Braintrust logging
 */
export async function generate(prompt) {
  const startTime = Date.now();

  const result = await generativeModel.generateContent(prompt);
  const responseText = result.response.candidates[0].content.parts[0].text;

  const endTime = Date.now();

  // Log to Braintrust
  if (logger) {
    try {
      logger.log({
        input: prompt,
        output: responseText,
        metadata: {
          model: config.model,
          latencyMs: endTime - startTime,
          type: 'generate',
        },
      });
    } catch (err) {
      console.error('Failed to log generate to Braintrust:', err);
    }
  }

  return responseText;
}

/**
 * Start a chat session with Braintrust logging
 */
export function startChat(history = []) {
  const chat = generativeModel.startChat({ history });

  // Wrap sendMessage to log each turn
  const originalSendMessage = chat.sendMessage.bind(chat);

  chat.sendMessage = async function sendMessage(message) {
    const startTime = Date.now();

    const result = await originalSendMessage(message);
    const responseText = result.response.candidates[0].content.parts[0].text;

    const endTime = Date.now();

    // Log to Braintrust
    if (logger) {
      try {
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
      } catch (err) {
        console.error('Failed to log chat to Braintrust:', err);
      }
    }

    return result;
  };

  return chat;
}

/**
 * Log a complete agent interaction (question -> SQL -> result -> feedback)
 */
export function logAgentInteraction(data) {
  if (!logger) {
    console.warn('Braintrust logger not initialized, skipping log');
    return;
  }

  try {
    console.log('Logging to Braintrust:', { question: data.question, sql: data.sql?.substring(0, 50) });
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
    console.log('Braintrust log queued');
  } catch (err) {
    console.error('Failed to log to Braintrust:', err);
  }
}

/**
 * Flush logs (call before function exits)
 */
export async function flushLogs() {
  if (!logger) {
    console.warn('Braintrust logger not initialized, skipping flush');
    return;
  }

  try {
    console.log('Flushing Braintrust logs...');
    await logger.flush();
    console.log('Braintrust logs flushed successfully');
  } catch (err) {
    console.error('Failed to flush Braintrust logs:', err);
  }
}

// Export model for direct access if needed
export const model = generativeModel;
