import { startChat, generate } from './vertex-ai.js';
import { runQuery } from './bigquery.js';
import { buildSystemPrompt, buildLearningExtractionPrompt } from './prompts.js';

/**
 * Data Exploration Agent
 */
export class DataAgent {
  constructor(metadata) {
    this.metadata = metadata;
    this.chat = null;
  }

  /**
   * Initialize chat with conversation history
   */
  initializeChat(history = []) {
    const systemPrompt = buildSystemPrompt(this.metadata);

    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: "I understand. I'm ready to help explore this dataset. What would you like to know?" }] },
    ];

    // Add previous conversation
    for (const entry of history) {
      chatHistory.push({ role: 'user', parts: [{ text: entry.question }] });
      if (entry.response) {
        chatHistory.push({ role: 'model', parts: [{ text: entry.response }] });
      }
    }

    this.chat = startChat(chatHistory);
    return this;
  }

  /**
   * Ask a question
   */
  async ask(question) {
    if (!this.chat) {
      this.initializeChat();
    }

    const result = await this.chat.sendMessage(question);
    const responseText = result.response.candidates[0].content.parts[0].text;

    return this.parseResponse(responseText);
  }

  /**
   * Execute a SQL query
   */
  async executeQuery(sql) {
    return await runQuery(sql);
  }

  /**
   * Provide feedback and get refined query
   */
  async provideFeedback(feedback, rating = null) {
    const refinementPrompt = `
Feedback on the previous query: "${feedback}"
${rating ? `Rating: ${rating}/5` : ''}

Please acknowledge what you learned and provide an improved query if needed.
`;

    const result = await this.chat.sendMessage(refinementPrompt);
    const responseText = result.response.candidates[0].content.parts[0].text;

    return this.parseResponse(responseText);
  }

  /**
   * Extract learnings from session history
   */
  async extractLearnings(sessionHistory) {
    const prompt = buildLearningExtractionPrompt(sessionHistory, this.metadata);
    const response = await generate(prompt);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.learnings || [];
    } catch {
      return [];
    }
  }

  /**
   * Parse structured response
   */
  parseResponse(response) {
    const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)(?=ASSUMPTIONS:|SQL:|$)/i);
    const assumptionsMatch = response.match(/ASSUMPTIONS:\s*([\s\S]*?)(?=SQL:|$)/i);
    const sqlMatch = response.match(/```sql\s*([\s\S]*?)```/);
    const explanationMatch = response.match(/EXPLANATION:\s*([\s\S]*?)$/i);

    return {
      reasoning: reasoningMatch?.[1]?.trim() || '',
      assumptions: assumptionsMatch?.[1]?.trim() || '',
      sql: sqlMatch?.[1]?.trim() || '',
      explanation: explanationMatch?.[1]?.trim() || '',
      raw: response,
    };
  }
}
