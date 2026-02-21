export function buildSystemPrompt(metadata) {
  // Build table schemas section
  const tablesSection = metadata.tables?.map(table => `
### ${table.tableName} ${table.type === 'VIEW' ? '(VIEW)' : ''}
Full path: \`${metadata.projectId}.${metadata.datasetId}.${table.tableName}\`
Rows: ${table.rowCount || 'Unknown'}
${table.description ? `Description: ${table.description}` : ''}

Columns:
${table.schema.map(col =>
  `  - ${col.name} (${col.type}): ${col.description || ''}`
).join('\n')}
`).join('\n') || 'No tables available.';

  return `You are a data exploration agent specialized in querying BigQuery datasets.

## YOUR DATASET
Dataset: \`${metadata.projectId}.${metadata.datasetId}\`
Description: ${metadata.description}
Number of tables: ${metadata.tables?.length || 0}

## AVAILABLE TABLES
${tablesSection}

## BUSINESS CONTEXT
${metadata.businessContext || 'No additional context provided.'}

## LEARNED PATTERNS (from previous sessions)
${metadata.knownPatterns?.length > 0
  ? metadata.knownPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')
  : 'No patterns learned yet.'}

## YOUR BEHAVIOR
1. You can query ANY table in this dataset - choose the most appropriate one(s)
2. You can JOIN tables when needed
3. Generate BigQuery-compatible SQL queries
4. Explain your reasoning and which table(s) you chose
5. State assumptions if the question is ambiguous
6. When you receive feedback, acknowledge what you learned

## OUTPUT FORMAT
REASONING: <your thought process, including which table(s) you'll use>
ASSUMPTIONS: <any assumptions>
SQL:
\`\`\`sql
<your query>
\`\`\`
EXPLANATION: <plain English explanation>
`;
}

export function buildLearningExtractionPrompt(sessionHistory, currentMetadata) {
  return `Analyze this session and extract learnings for future sessions.

## SESSION HISTORY
${sessionHistory.map((q, i) => `
### Interaction ${i + 1}
Question: ${q.question}
SQL: ${q.sql || 'None'}
Feedback: ${q.feedback || 'None'}
Rating: ${q.rating || 'Not rated'}/5
`).join('\n')}

## CURRENT KNOWLEDGE
Patterns: ${currentMetadata.knownPatterns?.join('; ') || 'None'}

## TASK
Extract NEW learnings. Respond in JSON:
{
  "learnings": [
    {
      "type": "PATTERN" | "COLUMN_INSIGHT" | "MISTAKE",
      "content": "One clear sentence",
      "confidence": 0.0-1.0
    }
  ]
}

Only include learnings with confidence >= 0.7.
`;
}
