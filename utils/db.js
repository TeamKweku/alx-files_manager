import { MongoClient } from 'mongodb';

class DBClient {
  constructor() {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || 27017;
    const database = process.env.DB_DATABASE || 'files_manager';
    const dbURL = `mongodb://${dbHost}:${dbPort}/${database}`;

    this.client = new MongoClient(dbURL, { useUnifiedTopology: true });
    this.client.connect((err) => {
      if (err) {
        console.error('Error connecting to MongoDB:', err);
      } else {
        console.log('Connected to MongoDB');
      }
    });
  }

  isAlive() {
    return this.client.isConnected();
  }

  async nbUsers() {
    return this.client.db().collection('users').countDocuments();
  }

  async nbFiles() {
    return this.client.db().collection('files').countDocuments();
  }

  usersCollection() {
    return this.client.db().collection('users');
  }

  filesCollection() {
    return this.client.db().collection('files');
  }
}

export const dbClient = new DBClient();
export default dbClient;
