/* eslint-disable import/no-named-as-default */
import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

class AuthController {
  static async getConnect(req, res) {
    try {
      const credEnc = req.header('Authorization').split(' ')[1];
      const [email, password] = Buffer.from(credEnc, 'base64')
        .toString('ascii')
        .split(':');

      if (!email || !password) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await dbClient
        .usersCollection()
        .findOne({ email, password: sha1(password) });

      if (!user || user.password !== sha1(password)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const token = uuidv4();
      await redisClient.set(`auth_${token}`, user._id.toString(), 60 * 60 * 24);
      return res.status(200).json({ token });
    } catch (error) {
      console.error('Error connecting:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async getDisconnect(req, res) {
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await redisClient.del(`auth_${token}`);
    return res.status(204).end();
  }
}

export default AuthController;
