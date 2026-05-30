const mongoose = require('mongoose');
const fs = require('fs');

// Use the original URI without specifying a database name
const MONGO = 'mongodb+srv://vishnugupta0611_db_user:a6YZ4jj7krMAQ2Gc@cluster0.y3rpgya.mongodb.net/';
const USER_ID = '69b6c029784ebd70ebfe87cf';

mongoose.connect(MONGO, { serverSelectionTimeoutMS: 15000 }).then(async () => {
  const db = mongoose.connection.db;
  const uid = new mongoose.Types.ObjectId(USER_ID);

  // First check which database we're in and list all collections
  console.log('Connected to DB:', db.databaseName);
  const cols = await db.listCollections().toArray();
  console.log('Collections:', cols.map(c => c.name).join(', '));

  const result = {};

  // Fetch all docs from every collection filtered by userId
  const colNames = cols.map(c => c.name).filter(n => n !== 'users');

  for (const name of colNames) {
    const docs = await db.collection(name).find({ userId: uid }).toArray();
    result[name] = docs;
    console.log(`${name}: ${docs.length} docs`);
  }

  // notechunks via note IDs
  const noteIds = (result['notes'] || []).map(n => n._id);
  if (noteIds.length > 0) {
    const chunks = await db.collection('notechunks').find({ noteId: { $in: noteIds } }).sort({ noteId: 1, seq: 1 }).toArray();
    result['notechunks_full'] = chunks;
    console.log(`notechunks (via notes): ${chunks.length} docs`);
  }

  fs.writeFileSync('user_data_export.json', JSON.stringify(result, null, 2));
  console.log('\nWritten to user_data_export.json');
  process.exit(0);
}).catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
