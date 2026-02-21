import { onRequest } from 'firebase-functions/v2/https';
import { DataAgent } from './agent.js';
import { config } from './config.js';
import { listDatasets, listTables, getTableSchema } from './bigquery.js';
import { logAgentInteraction, flushLogs } from './vertex-ai.js';
import {
  getDatasetMetadata,
  getDatasetMetadataById,
  saveDatasetMetadata,
  saveDatasetMetadataById,
  createSession,
  getSession,
  updateSessionHistory,
  saveLearning,
  getPendingLearnings,
  getAllLearnings,
  updateLearningStatus,
  applyLearningToDataset,
} from './firestore.js';

/**
 * GET /api/datasets - List all BigQuery datasets and tables
 */
export const api = onRequest({
  region: 'us-central1',
  cors: true,
  secrets: ['BRAINTRUST_API_KEY'], // Braintrust logging
}, async (req, res) => {
  // Handle different path formats from Firebase Hosting rewrites
  let path = req.path;
  // Remove /api prefix if present
  if (path.startsWith('/api')) {
    path = path.substring(4);
  }
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  // Handle empty path
  if (path === '/') {
    path = '';
  }

  const method = req.method;

  console.log('Request:', method, req.path, '-> parsed path:', path);

  try {
    // GET /api/datasets
    if (path === '/datasets' && method === 'GET') {
      const datasets = await listDatasets();
      const result = [];

      for (const datasetId of datasets) {
        const tables = await listTables(datasetId);
        result.push({ datasetId, tables });
      }

      return res.json({ datasets: result });
    }

    // GET /api/schema?dataset=X&table=Y
    if (path === '/schema' && method === 'GET') {
      const { dataset, table } = req.query;
      if (!dataset || !table) {
        return res.status(400).json({ error: 'dataset and table required' });
      }

      const schema = await getTableSchema(dataset, table);
      return res.json(schema);
    }

    // POST /api/connect - Connect to a full dataset (all tables) and start session
    if (path === '/connect' && method === 'POST') {
      const { datasetId, businessContext } = req.body;

      // Get all tables in the dataset
      const tables = await listTables(datasetId);
      if (tables.length === 0) {
        return res.status(400).json({ error: 'No tables found in dataset' });
      }

      // Get schema for each table
      const tableSchemas = [];
      for (const table of tables) {
        const schemaResult = await getTableSchema(datasetId, table.id);
        if (schemaResult.success) {
          tableSchemas.push({
            tableName: table.id,
            type: table.type || 'TABLE',
            schema: schemaResult.schema || [],
            rowCount: schemaResult.numRows || '0',
            description: schemaResult.description || '',
          });
        }
      }

      // Get or create metadata for the entire dataset
      let metadata = await getDatasetMetadataById(datasetId);

      if (!metadata) {
        metadata = {
          name: datasetId,
          description: `Dataset ${datasetId} with ${tableSchemas.length} tables`,
          projectId: config.projectId,
          datasetId,
          tables: tableSchemas,
          businessContext: businessContext || '',
          knownPatterns: [],
          commonMistakes: [],
        };

        await saveDatasetMetadataById(datasetId, metadata);
        metadata = await getDatasetMetadataById(datasetId);
      } else {
        // Update tables info if metadata exists
        metadata.tables = tableSchemas;
      }

      // Create session
      const sessionId = await createSession(metadata.id);

      return res.json({
        sessionId,
        datasetId: metadata.id,
        tables: tableSchemas,
      });
    }

    // POST /api/chat - Send message to agent
    if (path === '/chat' && method === 'POST') {
      const { sessionId, message, execute = false } = req.body;

      // Get session
      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Get dataset metadata directly by ID
      const metadata = await getDatasetMetadataById(session.datasetId);

      if (!metadata) {
        return res.status(404).json({ error: 'Dataset not found' });
      }

      // Create agent and initialize with history
      const agent = new DataAgent(metadata);
      agent.initializeChat(session.history || []);

      // Ask the question
      const response = await agent.ask(message);

      // Optionally execute the query
      let queryResult = null;
      if (execute && response.sql) {
        queryResult = await agent.executeQuery(response.sql);
        // Serialize BigQuery results to plain JSON for Firestore
        if (queryResult && queryResult.rows) {
          queryResult.rows = JSON.parse(JSON.stringify(queryResult.rows));
        }
      }

      // Save to history (store summary, not full results)
      const historyEntry = {
        question: message,
        response: response.raw,
        sql: response.sql,
        resultSummary: queryResult ? { success: queryResult.success, rowCount: queryResult.rowCount } : null,
        timestamp: new Date().toISOString(),
      };

      await updateSessionHistory(sessionId, historyEntry);

      // Log to Braintrust
      logAgentInteraction({
        question: message,
        datasetId: session.datasetId,
        tables: metadata.tables?.map(t => t.tableName) || [],
        sql: response.sql,
        reasoning: response.reasoning,
        explanation: response.explanation,
        sessionId,
        querySuccess: queryResult?.success,
        rowCount: queryResult?.rowCount,
      });
      await flushLogs();

      return res.json({
        ...response,
        queryResult,
      });
    }

    // POST /api/feedback - Provide feedback on last query
    if (path === '/feedback' && method === 'POST') {
      const { sessionId, feedback, rating } = req.body;

      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const metadata = await getDatasetMetadataById(session.datasetId);

      const agent = new DataAgent(metadata);
      agent.initializeChat(session.history || []);

      const response = await agent.provideFeedback(feedback, rating);

      // Update last history entry with feedback
      const historyEntry = {
        question: `[FEEDBACK] ${feedback}`,
        response: response.raw,
        sql: response.sql,
        feedback,
        rating,
        timestamp: new Date().toISOString(),
      };

      await updateSessionHistory(sessionId, historyEntry);

      // Log feedback to Braintrust (with rating as score)
      logAgentInteraction({
        question: `[FEEDBACK] ${feedback}`,
        datasetId: session.datasetId,
        sql: response.sql,
        reasoning: response.reasoning,
        explanation: response.explanation,
        sessionId,
        feedback,
        rating,
      });
      await flushLogs();

      return res.json(response);
    }

    // POST /api/end-session - End session and extract learnings
    if (path === '/end-session' && method === 'POST') {
      const { sessionId } = req.body;

      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const metadata = await getDatasetMetadataById(session.datasetId);

      const agent = new DataAgent(metadata);
      const learnings = await agent.extractLearnings(session.history || []);

      // Save learnings
      const savedLearnings = [];
      for (const learning of learnings) {
        const id = await saveLearning({
          ...learning,
          datasetId: session.datasetId,
          sessionId,
        });
        savedLearnings.push({ id, ...learning });
      }

      return res.json({ learnings: savedLearnings });
    }

    // GET /api/learnings?datasetId=X - Get pending learnings
    if (path === '/learnings' && method === 'GET') {
      const { datasetId } = req.query;
      const learnings = await getPendingLearnings(datasetId);
      return res.json({ learnings });
    }

    // GET /api/learnings/history?datasetId=X - Get all learnings history
    if (path === '/learnings/history' && method === 'GET') {
      const { datasetId } = req.query;
      const learnings = await getAllLearnings(datasetId);
      return res.json({ learnings });
    }

    // POST /api/learnings/:id/approve - Approve a learning
    if (path.match(/\/learnings\/\w+\/approve/) && method === 'POST') {
      const learningId = path.split('/')[2];
      await updateLearningStatus(learningId, 'approved');
      await applyLearningToDataset(learningId);
      return res.json({ success: true });
    }

    // POST /api/learnings/:id/reject - Reject a learning
    if (path.match(/\/learnings\/\w+\/reject/) && method === 'POST') {
      const learningId = path.split('/')[2];
      await updateLearningStatus(learningId, 'rejected');
      return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
});
