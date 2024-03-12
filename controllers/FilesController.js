/* eslint-disable import/no-named-as-default */
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

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
        name, type, isPublic, data,
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
      let parentId = req.body.parentId || 0;
      if (parentId) {
        const parentFile = await dbClient
          .filesCollection()
          .findOne({ _id: ObjectId(parentId) });
        if (!parentFile) {
          return res.status(400).json({ error: 'Parent not found' });
        }

        if (parentFile.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }
      }
      parentId = parentId !== 0 ? ObjectId(parentId) : 0;

      // Save file metadata to database
      const fileDocument = {
        userId,
        name,
        type,
        isPublic: isPublic || false,
        parentId,
      };

      if (type === 'folder') {
        const newFolder = await dbClient.collection('files').insertOne({
          userId,
          name,
          type,
          isPublic: isPublic || false,
          parentId,
        });
        return res
          .status(201)
          .json({ id: newFolder.insertedId, ...fileDocument });
      }

      // Return response
      const folderName = process.env.FOLDER_PATH || '/tmp/files_manager';
      const fileId = uuidv4();
      const localPath = path.join(folderName, fileId);
      await fs.promises.mkdir(folderName, { recursive: true });
      await fs.promises.writeFile(
        path.join(folderName, fileId),
        Buffer.from(data, 'base64'),
      );

      const newFile = await dbClient
        .filesCollection()
        .insertOne({ localPath, ...fileDocument });

      const responseObject = { id: newFile.insertedId, ...fileDocument };
      delete responseObject.localPath;

      return res.status(201).json(responseObject);
    } catch (error) {
      console.error('Error uploading file:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
