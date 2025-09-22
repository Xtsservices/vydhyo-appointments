const admin = require('firebase-admin');
const serviceAccount = require('../vydhyo-63363-firebase-adminsdk-fbsvc-9fbe301bbc.json'); // path to your JSON

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
