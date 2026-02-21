import admin from 'firebase-admin';

// Initialize Firebase Admin (auto-credentials in Cloud Functions)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Get dataset metadata by datasetId and tableId
 */
export async function getDatasetMetadata(datasetId, tableId) {
  const docId = `${datasetId}_${tableId}`;
  const doc = await db.collection('datasets').doc(docId).get();

  if (doc.exists) {
    return { id: docId, ...doc.data() };
  }

  return null;
}

/**
 * Get dataset metadata directly by document ID
 */
export async function getDatasetMetadataById(docId) {
  const doc = await db.collection('datasets').doc(docId).get();

  if (doc.exists) {
    return { id: docId, ...doc.data() };
  }

  return null;
}

/**
 * Save dataset metadata directly by document ID
 */
export async function saveDatasetMetadataById(docId, metadata) {
  await db.collection('datasets').doc(docId).set({
    ...metadata,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return docId;
}

/**
 * Save dataset metadata
 */
export async function saveDatasetMetadata(datasetId, tableId, metadata) {
  const docId = `${datasetId}_${tableId}`;
  await db.collection('datasets').doc(docId).set({
    ...metadata,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return docId;
}

/**
 * Create a new session
 */
export async function createSession(datasetDocId) {
  const sessionRef = await db.collection('sessions').add({
    datasetId: datasetDocId,
    status: 'active',
    history: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return sessionRef.id;
}

/**
 * Get session by ID
 */
export async function getSession(sessionId) {
  const doc = await db.collection('sessions').doc(sessionId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Update session history
 */
export async function updateSessionHistory(sessionId, historyEntry) {
  await db.collection('sessions').doc(sessionId).update({
    history: admin.firestore.FieldValue.arrayUnion(historyEntry),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Save a pending learning
 */
export async function saveLearning(learning) {
  const ref = await db.collection('learnings').add({
    ...learning,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return ref.id;
}

/**
 * Get pending learnings for a dataset
 */
export async function getPendingLearnings(datasetDocId) {
  const snapshot = await db.collection('learnings')
    .where('datasetId', '==', datasetDocId)
    .where('status', '==', 'pending')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Approve or reject a learning
 */
export async function updateLearningStatus(learningId, status) {
  await db.collection('learnings').doc(learningId).update({
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Apply approved learning to dataset metadata
 */
export async function applyLearningToDataset(learningId) {
  const learningDoc = await db.collection('learnings').doc(learningId).get();
  const learning = learningDoc.data();

  const datasetRef = db.collection('datasets').doc(learning.datasetId);

  if (learning.type === 'PATTERN' || learning.type === 'COLUMN_INSIGHT') {
    await datasetRef.update({
      knownPatterns: admin.firestore.FieldValue.arrayUnion(learning.content),
    });
  } else if (learning.type === 'MISTAKE') {
    await datasetRef.update({
      commonMistakes: admin.firestore.FieldValue.arrayUnion(learning.content),
    });
  }
}
