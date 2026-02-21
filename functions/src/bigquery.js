import { BigQuery } from '@google-cloud/bigquery';
import { config } from './config.js';

const bigquery = new BigQuery({
  projectId: config.projectId,
});

export async function runQuery(sql, options = {}) {
  const { maxRows = 100 } = options;

  try {
    const [job] = await bigquery.createQueryJob({
      query: sql,
      maximumBytesBilled: '1000000000',
    });

    const [rows] = await job.getQueryResults({ maxResults: maxRows });

    return {
      success: true,
      rows,
      rowCount: rows.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function getTableSchema(datasetId, tableId) {
  try {
    const [metadata] = await bigquery
      .dataset(datasetId)
      .table(tableId)
      .getMetadata();

    return {
      success: true,
      schema: metadata.schema.fields,
      numRows: metadata.numRows,
      description: metadata.description ?? null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function listDatasets() {
  const [datasets] = await bigquery.getDatasets();
  return datasets.map(d => d.id);
}

export async function listTables(datasetId) {
  const [tables] = await bigquery.dataset(datasetId).getTables();
  return tables.map(t => ({
    id: t.id,
    type: t.metadata.type,
  }));
}
