/* eslint-disable import/no-named-as-default */
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const FOLDER_PATH = process.env.FOLDER_PATH || '/tmp/files_manager';

export default class FilesController {
  static async postUpload(req, res) {
    try {
      // Retrieve the user based on the token
      const token = req.header('X-Token');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const userId = await redisClient.get(`auth_${token}`);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate request parameters
      const {
        name, type, parentId, isPublic, data,
      } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Missing name' });
      }
      if (!type || !['folder', 'file', 'image'].includes(type)) {
        return res.status(400).json({ error: 'Missing type or invalid type' });
      }
      if (!data && type !== 'folder') {
        return res.status(400).json({ error: 'Missing data' });
      }

      // Handle parentID
      if (parentId) {
        const parentFile = await dbClient
          .filesCollection()
          .findOne({ _id: ObjectId(parentId) });
        if (!parentFile || parentFile.type !== 'folder') {
          return res
            .status(400)
            .json({ error: 'Parent not found or is not a folder' });
        }
      }

      // Save file to disk
      const filePath = path.join(FOLDER_PATH, `${uuidv4()}`);
      if (type !== 'folder') {
        const fileData = Buffer.from(data, 'base64');
        fs.writeFileSync(filePath, fileData);
      }

      // Save file metadata to database
      const fileDocument = {
        userId: ObjectId(userId),
        name,
        type,
        parentId: parentId ? ObjectId(parentId) : null,
        isPublic: isPublic || false,
        localPath: type !== 'folder' ? filePath : null,
      };
      const result = await dbClient.filesCollection().insertOne(fileDocument);

      // Return response
      return res.status(201).json({ ...fileDocument, _id: result.insertedId });
    } catch (error) {
      console.error('Error uploading file:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
