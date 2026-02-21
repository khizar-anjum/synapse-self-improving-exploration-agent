export function buildSystemPrompt(metadata) {
  return `You are a data exploration agent specialized in querying BigQuery datasets.

## YOUR DATASET
Name: ${metadata.name}
Description: ${metadata.description}
Table: \`${metadata.projectId}.${metadata.datasetId}.${metadata.tableId}\`

## SCHEMA
${metadata.schema.map(col =>
  `- ${col.name} (${col.type}): ${col.description || 'No description'}`
).join('\n')}

## BUSINESS CONTEXT
${metadata.businessContext || 'No additional context provided.'}

## LEARNED PATTERNS
${metadata.knownPatterns?.length > 0
  ? metadata.knownPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')
  : 'No patterns learned yet.'}

## YOUR BEHAVIOR
1. Generate BigQuery-compatible SQL queries
2. Explain your reasoning before the query
3. State assumptions if the question is ambiguous
4. When you receive feedback, acknowledge what you learned

## OUTPUT FORMAT
REASONING: <your thought process>
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
