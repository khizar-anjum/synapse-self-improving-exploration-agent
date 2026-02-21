import { BigQuery } from '@google-cloud/bigquery';

const bigquery = new BigQuery({
  projectId: 'feb-488118',
});

async function main() {
  console.log('=== BigQuery Test ===\n');
  console.log('Project: feb-488118\n');

  // List datasets
  console.log('Fetching datasets...');
  const [datasets] = await bigquery.getDatasets();

  if (datasets.length === 0) {
    console.log('\n❌ No datasets found.');
    console.log('\nTo add data, go to:');
    console.log('https://console.cloud.google.com/bigquery?project=feb-488118');
    return;
  }

  console.log(`\n✓ Found ${datasets.length} dataset(s):\n`);

  for (const dataset of datasets) {
    console.log(`📁 ${dataset.id}`);

    // List tables in each dataset
    const [tables] = await bigquery.dataset(dataset.id).getTables();

    if (tables.length === 0) {
      console.log('   (no tables)');
    } else {
      for (const table of tables) {
        const [metadata] = await table.getMetadata();
        const rowCount = metadata.numRows || '?';
        console.log(`   📊 ${table.id} (${rowCount} rows)`);

        // Show schema
        if (metadata.schema?.fields) {
          console.log('      Columns:');
          for (const field of metadata.schema.fields.slice(0, 5)) {
            console.log(`        - ${field.name} (${field.type})`);
          }
          if (metadata.schema.fields.length > 5) {
            console.log(`        ... and ${metadata.schema.fields.length - 5} more`);
          }
        }
      }
    }
    console.log('');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  console.log('\nMake sure you are authenticated:');
  console.log('  gcloud auth application-default login');
});
